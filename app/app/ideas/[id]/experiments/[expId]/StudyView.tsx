import Link from "next/link";
import { PageFrame } from "@/components/shell/PageFrame";
import { ActionForm } from "@/components/ui/ActionForm";
import { Distribution } from "@/components/survey/Distribution";
import { SurveyResults } from "@/components/survey/SurveyResults";
import { StudyEditor } from "@/components/survey/StudyEditor";
import { ISSUE_LABEL } from "@/lib/domain/interview-audit";
import { supabaseServer } from "@/lib/supabase/server";
import { surveyConfigOf } from "@/lib/experiment-metrics";
import { describeDraftEdit, draftEdit, surveyDraftText } from "@/lib/domain/ai-draft";
import { aiConfigured, trackingConfigured } from "@/lib/env";
import { EXPERIMENT_STATES, type ExperimentState } from "@/lib/domain/labels";
import { recruitmentLabel } from "@/lib/domain/recruitment";
import { approvalChecks, auditStudy, CONSENT_QUESTION_ID, EXPLORATORY_NOTE, STUDY_FORMATS, studyFormatOf } from "@/lib/domain/customer-research";
import { QUESTION_TYPES } from "@/lib/domain/survey";
import { transitionExperiment } from "../actions";
import { deleteStudyDraft, draftStudyWithCoach, saveStudyConfig } from "../../research/study-actions";
import type { IdeaAccess } from "@/lib/data";

type Exp = {
  id: string;
  idea_id: string;
  title: string;
  type: string;
  state: string;
  config: unknown;
  public_slug: string | null;
  ai_draft_id: string | null;
  recruitment_group: string | null;
  started_at: string | null;
  ends_at: string | null;
};
type Hyp = {
  we_believe: string;
  target_group: string;
  min_sample: number;
  max_duration_days: number;
  locked_at: string | null;
  success_threshold_pct: number | null;
  research_question_id?: string | null;
};

const CHECK_LABELS: Record<string, string> = {
  check_honest: "Het onderzoek zegt eerlijk wie de vragen stelt en waarvoor; er wordt niets verkocht.",
  check_privacy: "Er wordt niet om naam of e-mailadres gevraagd in de vragen; uitnodigingen gaan alleen naar mensen met een bestaande relatie en vervallen na 180 dagen.",
  check_neutral: "De vragen gaan over recent, concreet gedrag: geen pitch, sturende of hypothetische vragen.",
};

const NEW_NOTE: Record<string, string> = {
  ai: "Concept gemaakt met een AI-voorstel. ProofLab heeft sturende en hypothetische vragen eruit gehaald; controleer en pas aan.",
  terugval: "De AI kon geen voorstel maken; het concept begint met het sjabloon van ProofLab. Pas de vragen aan.",
  sjabloon: "Concept gemaakt met het sjabloon van ProofLab. Pas de vragen aan op je doelgroep.",
  leeg: "Leeg concept gemaakt. Voeg hieronder je vragen toe.",
  leidraad: "Online interview gemaakt met de interviewleidraad: toestemming bovenaan, daarna open vragen. Pas de vragen aan.",
};

// Een verkennend onderzoek vanuit Markt: een enquête of een online interview (schriftelijk) zonder drempels. Geen
// oordeel, geen leerkaart, geen hoofdtest; wel de editor, goedkeuren, verspreiden en de antwoorden.
export async function StudyView({
  ideaId,
  idea,
  canWrite,
  exp,
  h,
  isNew,
}: {
  ideaId: string;
  idea: IdeaAccess["idea"];
  canWrite: boolean;
  exp: Exp;
  h: Hyp;
  isNew?: string;
}) {
  const supabase = await supabaseServer();
  const config = surveyConfigOf(exp.config);
  const format = studyFormatOf(config);
  const state = exp.state as ExperimentState;
  const { data: question } = h.research_question_id
    ? await supabase.from("research_questions").select("position, question").eq("id", h.research_question_id).maybeSingle()
    : { data: null };
  const surveyDraft = await (async () => {
    if (!exp.ai_draft_id || !config) return null;
    const { data: d } = await supabase.from("ai_drafts").select("content").eq("id", exp.ai_draft_id).maybeSingle();
    const original = d ? surveyConfigOf(d.content) : null;
    return original ? draftEdit(surveyDraftText(original), surveyDraftText(config)) : null;
  })();
  const productNames = [idea.title];
  const audit = config ? auditStudy(config, productNames) : [];
  const editable = canWrite && (state === "draft" || state === "ready_for_review");
  const running = state === "live" || state === "paused";
  const checks = approvalChecks(exp.type, true, format);
  const label = STUDY_FORMATS[format].label;
  const back = `/app/ideas/${ideaId}/research?tab=klantonderzoek`;

  return (
    <PageFrame crumbs={["Werkruimte", idea.title, "Markt", "Klantonderzoek", exp.title]} coach="research" ideaId={ideaId} section="/research">
      <p className="tiny" style={{ margin: "0 0 10px" }}>
        <Link className="text-link" href={back}>← Terug naar Klantonderzoek</Link>
      </p>
      <div className="section-row">
        <div>
          <div className="eyebrow">Stap 1 van 4 · Markt · Klantonderzoek</div>
          <h1 style={{ overflowWrap: "anywhere" }}>{exp.title}</h1>
          <p className="sub">
            {question ? <>Onderzoeksvraag {question.position}: {question.question}</> : "De onderzoeksvraag van dit onderzoek is verwijderd."}
          </p>
        </div>
        <span className={`pill ${EXPERIMENT_STATES[state]?.pill ?? "gray"}`}>{EXPERIMENT_STATES[state]?.label ?? state}</span>
      </div>
      <div className="row" style={{ flexWrap: "wrap", gap: 6, marginBottom: 12 }}>
        <span className="pill blue">{label}</span>
        <span className="pill gray">Verkennend</span>
        <span className="pill orange">Zelfrapportage, geen gedrag</span>
      </div>
      {isNew && NEW_NOTE[isNew] && <div className="form-ok" role="status">{NEW_NOTE[isNew]}</div>}
      <div className="note" style={{ marginTop: 0 }}>{EXPLORATORY_NOTE}</div>
      {!config && <div className="form-error" role="alert">De opzet van dit onderzoek is ongeldig; het kan niet worden getoond of verspreid.</div>}

      {running && (
        <div className="insight-banner">
          <div>
            <span className="pill green">{state === "live" ? "Loopt" : "Gepauzeerd"}</span>
            <h2 className="as-h3" style={{ margin: "10px 0 3px" }}>Deel de link en lees de antwoorden hieronder.</h2>
            <p>
              Gestart {exp.started_at ? new Date(exp.started_at).toLocaleDateString("nl-NL") : "—"} · loopt tot uiterlijk {exp.ends_at ? new Date(exp.ends_at).toLocaleDateString("nl-NL") : "—"}.
            </p>
          </div>
        </div>
      )}

      <div className="grid-2 mt-18">
        <div className="card">
          <div className="section-title">
            <h2 className="as-h3">Opzet</h2>
            <span className={`pill ${h.locked_at ? "dark" : "gray"}`}>{h.locked_at ? `Vastgelegd ${new Date(h.locked_at).toLocaleDateString("nl-NL")}` : "Concept"}</span>
          </div>
          <div className="data-row"><span>Soort</span><strong style={{ textAlign: "right" }}>{label}</strong></div>
          <div className="data-row"><span>Wat we willen leren</span><strong style={{ textAlign: "right" }}>{h.we_believe}</strong></div>
          <div className="data-row"><span>Doelgroep</span><strong style={{ textAlign: "right" }}>{h.target_group}</strong></div>
          <div className="data-row"><span>Streefaantal · looptijd</span><strong className="num" style={{ textAlign: "right" }}>{h.min_sample} · max. {h.max_duration_days} dagen</strong></div>
          <div className="data-row"><span>Drempel</span><strong style={{ textAlign: "right" }}>Geen: verkennend onderzoek beslist niets</strong></div>
          <div className="data-row"><span>Wie nodig je uit</span><strong style={{ textAlign: "right" }}>{exp.recruitment_group ? recruitmentLabel(exp.recruitment_group) : "Niet vastgelegd"}</strong></div>
          {surveyDraft && <div className="data-row"><span>Vragen</span><strong style={{ textAlign: "right" }}>AI-concept · {describeDraftEdit(surveyDraft)}</strong></div>}
        </div>

        <div className="card">
          <div className="section-title"><h2 className="as-h3">Volgende stap</h2></div>
          {!canWrite && <p className="sub">Je kijkt mee. Het onderzoeksteam beheert dit onderzoek.</p>}
          {canWrite && state === "draft" && (
            <ActionForm
              action={transitionExperiment.bind(null, ideaId, exp.id, "ready_for_review")}
              submitLabel="Ter review aanbieden"
              footer={<button formAction={deleteStudyDraft.bind(null, ideaId, exp.id)} className="text-link" style={{ color: "var(--color-risk-text)" }}>Concept verwijderen</button>}
            >
              <p className="sub">Pas de vragen hieronder aan en sla ze op. Bied het onderzoek daarna aan voor review; pas na goedkeuring kan het live.</p>
            </ActionForm>
          )}
          {canWrite && state === "ready_for_review" && (
            <ActionForm action={transitionExperiment.bind(null, ideaId, exp.id, "approved")} submitLabel="Akkoord: keur goed en leg vast">
              <p className="sub">Goedkeuren legt de vragen vast. Bevestig:</p>
              {checks.map((k) => (
                <label key={k} className="check-row"><input type="checkbox" name={k} /> {CHECK_LABELS[k]}</label>
              ))}
              {format === "interview" && <p className="tiny">De toestemmingsvraag staat bovenaan; wie geen toestemming geeft, stopt daar en telt niet mee.</p>}
            </ActionForm>
          )}
          {canWrite && state === "approved" && (
            <>
              {!trackingConfigured() && <div className="form-error" id="tracking-block">Meting is niet geconfigureerd (INGEST_SECRET en TRACKING_SALT ontbreken). Het onderzoek kan nog niet live.</div>}
              <ActionForm action={transitionExperiment.bind(null, ideaId, exp.id, "live")} submitLabel="Publiceer en start" disabled={!trackingConfigured()} describedBy={trackingConfigured() ? undefined : "tracking-block"}>
                <p className="sub">Na de start tellen antwoorden via de links mee. Er wordt niets automatisch verstuurd of betaald.</p>
              </ActionForm>
            </>
          )}
          {canWrite && running && (
            <div className="row">
              <ActionForm action={transitionExperiment.bind(null, ideaId, exp.id, state === "live" ? "paused" : "live")} submitLabel={state === "live" ? "Pauzeer" : "Hervat"} submitClass="btn white sm"><span /></ActionForm>
              <ActionForm action={transitionExperiment.bind(null, ideaId, exp.id, "ended")} submitLabel="Rond af" submitClass="btn dark sm"><span /></ActionForm>
            </div>
          )}
          {state === "ended" && <p className="sub">Afgerond. Neem de open antwoorden op als klantsignalen; daar groepeert Markt ze in pijnpunten, wensen en bezwaren.</p>}
          <Link className="btn soft sm mt-12" href={back}>Naar Klantonderzoek</Link>
        </div>
      </div>

      {audit.length > 0 && (
        <div className="note">
          <strong>Vragencontrole: {audit.length} {audit.length === 1 ? "vraag verdient" : "vragen verdienen"} aandacht.</strong> Waarschuwing, geen blokkade.
          <ul style={{ margin: "6px 0 0 16px", padding: 0 }}>
            {audit.map((a) => (
              <li key={a.id}>
                “{a.text}”: {a.issues.map((i) => `${ISSUE_LABEL[i.kind]}. ${i.suggestion}`).join(" ")}
              </li>
            ))}
          </ul>
        </div>
      )}

      {config && (
        <section className="card mt-18" aria-labelledby="study-q">
          <div className="section-title">
            <h2 className="as-h3" id="study-q">{format === "interview" ? "Vragen van het online interview" : "Vragen van de enquête"}</h2>
            <span className="pill gray">{config.questions.length} vragen</span>
          </div>
          {editable ? (
            <StudyEditor
              initial={config}
              productNames={productNames}
              targetGroup={h.target_group}
              aiConnected={aiConfigured()}
              draftAction={format === "survey" ? draftStudyWithCoach.bind(null, ideaId, exp.id) : undefined}
              saveAction={saveStudyConfig.bind(null, ideaId, exp.id)}
            />
          ) : (
            <>
              <p className="sub">{config.intro}</p>
              <ol className="study-questions">
                {config.questions.map((q) => (
                  <li key={q.id}>
                    {q.text} <span className="tiny">({q.id === CONSENT_QUESTION_ID ? "toestemming" : QUESTION_TYPES[q.type].toLowerCase()}{q.id === config.key_question ? ", kernvraag zonder drempel" : ""})</span>
                  </li>
                ))}
              </ol>
            </>
          )}
        </section>
      )}

      <Distribution ideaId={ideaId} exp={exp} canWrite={canWrite} />

      {config && <SurveyResults ideaId={ideaId} exp={exp} h={h} m={null} canWrite={canWrite} />}
    </PageFrame>
  );
}
