import Link from "next/link";
import { notFound } from "next/navigation";
import { PageFrame } from "@/components/shell/PageFrame";
import { ActionForm, Field } from "@/components/ui/ActionForm";
import { FormPendingOverlay } from "@/components/ui/SavingOverlay";
import { TranscriptMarker, type CodeOption } from "@/components/experiments/TranscriptMarker";
import { getIdea } from "@/lib/data";
import { supabaseServer } from "@/lib/supabase/server";
import { DMU_ROLES, OBSERVATION_KINDS } from "@/lib/domain/labels";
import { fictionSignals, fictionWarning, PRACTICE_LABELS, practiceStatus } from "@/lib/domain/practice";
import { recruitmentLabel, interviewRecruitment } from "@/lib/domain/recruitment";
import { TRANSCRIPT_FORMATS, type TranscriptFormat } from "@/lib/domain/transcript-parse";
import { displaySegments, PURGED_TRANSCRIPT, TRANSCRIPT_FROZEN } from "@/lib/domain/quote-marking";
import { EXPLORATORY_INTERVIEW_NOTE } from "@/lib/domain/interview-import";
import { PSEUDONYMIZE_NOTICE } from "@/lib/domain/pseudonymize";
import { addMarkedObservation, replaceNameInTranscript } from "@/app/app/ideas/[id]/experiments/transcript-actions";
import { deleteObservation } from "@/app/app/ideas/[id]/experiments/actions";

// Fase 1 · punt 3: de transcriptpagina. Eén weergave voor een gesprek uit een interviewtest
// (/experiments/[expId]/interviews/[ivId]) en een verkennend interview (/interviews/[ivId]). Alleen voor het
// onderzoeksteam: opdrachtgevers lezen geen transcripten of citaten (RLS).

type Row = Record<string, unknown> & {
  id: string;
  experiment_id: string | null;
  participant_label: string;
  dmu_role: string;
  held_on: string;
  transcript: string;
  is_practice: boolean | null;
  consent_recorded: boolean;
  is_acquaintance: boolean;
  recruitment_group: string | null;
  retention_until: string;
  segment: string | null;
};

export async function TranscriptView({
  ideaId,
  interviewId,
  expId,
  searchParams,
  themes,
}: {
  ideaId: string;
  interviewId: string;
  expId: string | null;
  searchParams: Record<string, string | string[] | undefined>;
  themes?: (ctx: { codes: CodeOption[]; canMark: boolean; observationIds: string[] }) => React.ReactNode;
}) {
  const { idea, canWrite } = await getIdea(ideaId);
  const supabase = await supabaseServer();
  const section = expId ? `/experiments/${expId}/interviews/${interviewId}` : `/interviews/${interviewId}`;
  if (!canWrite) {
    return (
      <PageFrame crumbs={["Werkruimte", idea.title, "Interview"]} coach="experiments" ideaId={ideaId} section={section}>
        <h1>Interview</h1>
        <p className="sub">Je kijkt mee. Transcripten en citaten ziet alleen het onderzoeksteam; de aantallen per thema staan bij Interviews en in het rapport.</p>
        <Link className="text-link" href={`/app/ideas/${ideaId}/interviews`}>Naar de aantallen per thema →</Link>
      </PageFrame>
    );
  }
  const { data } = await supabase.from("interviews").select("*").eq("id", interviewId).eq("idea_id", ideaId).maybeSingle();
  const iv = data as Row | null;
  if (!iv || (iv.experiment_id ?? null) !== expId) notFound();
  const [{ data: exp }, { data: assumptions }, { data: observations }, { data: codes }] = await Promise.all([
    expId
      ? supabase.from("experiments").select("title, state, recruitment_group, hypotheses(assumption_id)").eq("id", expId).eq("idea_id", ideaId).maybeSingle()
      : Promise.resolve({ data: null }),
    expId ? supabase.from("assumptions").select("id, statement").eq("idea_id", ideaId).order("created_at") : Promise.resolve({ data: [] as { id: string; statement: string }[] }),
    supabase.from("observations").select("*, assumption_observations(assumption_id, relation)").eq("interview_id", interviewId).order("created_at"),
    supabase.from("interview_codes").select("id, label, status").eq("idea_id", ideaId).eq("status", "accepted").order("label"),
  ]);
  if (expId && !exp) notFound();
  const purged = iv.transcript === PURGED_TRANSCRIPT;
  const segments = purged ? [] : displaySegments(iv.transcript, iv.segments);
  const obs = (observations ?? []) as (Record<string, unknown> & {
    id: string;
    kind: string;
    summary: string;
    quote: string | null;
    origin: string;
    review_status: string | null;
    quote_start?: number | null;
    quote_end?: number | null;
    theme_only?: boolean;
    assumption_observations: { assumption_id: string; relation: string }[];
  })[];
  const marks = obs.filter((o) => o.quote_start != null && o.quote_end != null).map((o) => ({ id: o.id, start: o.quote_start as number, end: o.quote_end as number }));
  const running = expId ? ["live", "paused"].includes(exp?.state ?? "") : true;
  const canMark = !purged && running;
  const practice = practiceStatus(iv.is_practice);
  const practiceLabel = PRACTICE_LABELS[practice];
  const statement = new Map((assumptions ?? []).map((a) => [a.id, a.statement]));
  const fiction = practice !== "practice" && searchParams.controleer ? fictionWarning(fictionSignals(`${iv.participant_label}\n${iv.transcript}`)) : null;
  const backHref = expId ? `/app/ideas/${ideaId}/experiments/${expId}` : `/app/ideas/${ideaId}/interviews`;
  const format = (iv.source_format as TranscriptFormat | undefined) ?? "paste";
  const evidenceObs = obs.filter((o) => !o.theme_only);

  return (
    <PageFrame crumbs={["Werkruimte", idea.title, expId ? "Testen" : "Markt", iv.participant_label]} coach={expId ? "experiments" : "research"} ideaId={ideaId} section={section}>
      <div className="section-row">
        <div>
          <div className="eyebrow">{expId ? `Interview · ${exp?.title ?? "interviewronde"}` : "Verkennend interview"}</div>
          <h1>{iv.participant_label}</h1>
          <p className="sub">
            {DMU_ROLES[iv.dmu_role as keyof typeof DMU_ROLES] ?? iv.dmu_role} · {new Date(iv.held_on).toLocaleDateString("nl-NL")} · wervingsgroep{" "}
            {recruitmentLabel(interviewRecruitment(iv.is_acquaintance, iv.recruitment_group, exp?.recruitment_group ?? null)).toLowerCase()} · {TRANSCRIPT_FORMATS[format] ?? format}
            {iv.pseudonymized_at ? " · gepseudonimiseerd" : ""} · bewaard tot {new Date(iv.retention_until).toLocaleDateString("nl-NL")}
          </p>
        </div>
        <div className="row" style={{ gap: 6, flexWrap: "wrap", justifyContent: "flex-end" }}>
          <span className={`pill ${practiceLabel.pill}`}>{practiceLabel.label}</span>
          {!iv.consent_recorded && practice === "real" && <span className="pill orange">Zonder toestemming: telt niet mee</span>}
          <Link className="btn white sm" href={backHref}>← Terug</Link>
        </div>
      </div>

      {searchParams.geimporteerd && <div className="form-ok" role="status">Geïmporteerd en gepseudonimiseerd. Het bestand en de originele namen zijn niet bewaard. Markeer nu citaten.</div>}
      {fiction && <div className="note" role="note"><strong>Let op:</strong> {fiction}</div>}
      {!expId && <div className="note">{EXPLORATORY_INTERVIEW_NOTE}</div>}
      {iv.pseudonymized_at ? <p className="tiny">{PSEUDONYMIZE_NOTICE}</p> : <p className="tiny">Dit transcript is zelf geplakt en niet door ProofLab gepseudonimiseerd.</p>}
      {expId && !running && !purged && <div className="note">De interviewronde loopt niet (meer): citaten markeren kan alleen tijdens de ronde.</div>}

      <div className="mt-18">
        {purged ? (
          <div className="note">Het transcript is verwijderd na afloop van de bewaartermijn. De observaties (zonder citaat), thema&apos;s en aantallen blijven.</div>
        ) : (
          <TranscriptMarker
            key={marks.length}
            transcript={iv.transcript}
            segments={segments}
            marks={marks}
            action={addMarkedObservation.bind(null, ideaId, interviewId)}
            canMark={canMark}
            isTest={!!expId}
            assumptions={assumptions ?? []}
            defaultAssumption={exp?.hypotheses?.assumption_id ?? null}
            codes={(codes ?? []).map((c) => ({ id: c.id, label: c.label }))}
          />
        )}
      </div>

      <section className="card mt-18" aria-labelledby="obs-h">
        <div className="section-title">
          <h2 className="as-h3" id="obs-h">Observaties uit dit gesprek</h2>
          <span className="pill gray">{evidenceObs.length}</span>
        </div>
        {evidenceObs.length === 0 && <p className="sub">Nog geen observaties. Markeer een citaat in het transcript.</p>}
        {evidenceObs.map((o) => (
          <div className="evidence-event" key={o.id}>
            <div className="icon-circle">{o.kind === "problem_confirmed" ? "✓" : o.kind === "problem_absent" || o.kind === "counter_example" ? "✕" : "•"}</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <strong>{OBSERVATION_KINDS[o.kind as keyof typeof OBSERVATION_KINDS] ?? o.kind}: {o.summary}</strong>
              {o.quote && <blockquote className="quote">“{o.quote}”</blockquote>}
              <p className="tiny">
                {o.origin === "ai" ? (o.review_status === "accepted" ? "AI-codering, geaccepteerd" : o.review_status === "rejected" ? "AI-codering, afgewezen" : "AI-voorstel") : "Handmatig"}
                {o.quote_start != null ? ` · gemarkeerd op positie ${o.quote_start}–${o.quote_end}` : ""}
                {o.assumption_observations.length
                  ? ` · ${o.assumption_observations.map((l) => `${l.relation === "supports" ? "bevestigt" : "weerlegt"}: ${statement.get(l.assumption_id) ?? "aanname"}`).join("; ")}`
                  : " · niet gekoppeld aan een aanname (telt niet mee in de kans)"}
              </p>
            </div>
            {o.origin === "manual" && canMark && (
              <form action={deleteObservation.bind(null, ideaId, o.id)}>
                <button className="text-link">Verwijder</button>
                <FormPendingOverlay />
              </form>
            )}
          </div>
        ))}
      </section>

      {themes?.({ codes: (codes ?? []).map((c) => ({ id: c.id, label: c.label })), canMark, observationIds: obs.map((o) => o.id) })}

      {!purged && !!iv.pseudonymized_at && (
        <section className="card mt-18" aria-labelledby="rename-h">
          <h2 className="as-h3" id="rename-h">Een gemiste naam vervangen</h2>
          {obs.length > 0 ? (
            <p className="sub">{TRANSCRIPT_FROZEN} Verwijder het interview en importeer het opnieuw als er nog een naam in staat.</p>
          ) : (
            <ActionForm action={replaceNameInTranscript.bind(null, ideaId, interviewId)} submitLabel="Vervang overal" submitClass="btn white sm" pendingLabel="Vervangen…" noValidate resetOnSuccess>
              <p className="sub">Zolang er nog geen citaten zijn gemarkeerd, kun je een naam die ProofLab miste alsnog vervangen. Daarna ligt de tekst vast.</p>
              <div className="double-field">
                <Field name="term" id="rn-term" label="Naam of term in de tekst" required><input className="field" maxLength={80} /></Field>
                <Field name="label" id="rn-label" label="Vervangen door" required hint="Bijv. Persoon 3 of Club 2."><input className="field" maxLength={40} /></Field>
              </div>
              <input type="hidden" name="kind" value="person" />
            </ActionForm>
          )}
        </section>
      )}
    </PageFrame>
  );
}
