import { ActionForm, Field } from "@/components/ui/ActionForm";
import { FormPendingOverlay } from "@/components/ui/SavingOverlay";
import { AiQualityCard } from "@/components/research/AiQualityCard";
import { Detail } from "@/components/shell/ViewMode";
import { THEMES_NEVER_COUNT } from "@/lib/domain/themes";
import type { QualityMeasure } from "@/lib/domain/ai-quality";
import {
  acceptThemeAssignments,
  assignThemeCode,
  createThemeCode,
  removeThemeAssignment,
  reviewThemeAssignment,
  reviewThemeCode,
  suggestThemes,
} from "@/app/app/ideas/[id]/experiments/theme-actions";

// Fase 1 · punt 3: thema's in één gesprek. Per thema de citaten uit dit gesprek, met de herkomst (handmatig of AI) en
// de beoordeling. Een AI-thema en elke AI-toewijzing zijn een voorstel; alleen handmatige of geaccepteerde
// toewijzingen tellen mee in "X van N geïnterviewden". Thema's tellen nooit mee in de kans.

type Code = { id: string; label: string; description: string | null; origin: string; status: string };
type Assignment = { observation_id: string; code_id: string; origin: string; review_status: string | null };
type Obs = { id: string; quote: string | null; summary: string; themeOnly: boolean };

export function ThemePanel({
  ideaId,
  interviewId,
  codes,
  observations,
  assignments,
  canEdit,
  aiAllowed,
  pseudonymized,
  quality,
}: {
  ideaId: string;
  interviewId: string;
  codes: Code[];
  observations: Obs[];
  assignments: Assignment[];
  canEdit: boolean;
  aiAllowed: boolean;
  pseudonymized: boolean;
  quality: QualityMeasure;
}) {
  const byObs = new Map(observations.map((o) => [o.id, o]));
  const used = codes.filter((c) => assignments.some((a) => a.code_id === c.id));
  const accepted = codes.filter((c) => c.status === "accepted");
  const evidence = observations.filter((o) => !o.themeOnly);
  return (
    <section className="card mt-18" aria-labelledby="themes-h">
      <div className="section-title">
        <h2 className="as-h3" id="themes-h">Thema&apos;s in dit gesprek</h2>
        <span className="pill gray">{used.length}</span>
      </div>
      <p className="tiny" style={{ marginTop: -6 }}>{THEMES_NEVER_COUNT}</p>
      {canEdit && (
        <div className="row mt-8" style={{ gap: 8, flexWrap: "wrap", alignItems: "flex-start" }}>
          {aiAllowed ? (
            <ActionForm action={suggestThemes.bind(null, ideaId, interviewId)} submitLabel="Laat AI thema's voorstellen" submitClass="btn ai sm" pendingLabel="Thema's zoeken…">
              <span className="tiny">De AI leest alleen de gepseudonimiseerde tekst; elk citaat wordt letterlijk teruggezocht.</span>
            </ActionForm>
          ) : (
            <p className="tiny">{pseudonymized ? "AI is niet verbonden: maak thema's zelf." : "AI-thema's alleen bij een geïmporteerd (gepseudonimiseerd) transcript. Maak thema's hier zelf."}</p>
          )}
          <details>
            <summary className="text-link">+ Nieuw thema</summary>
            <ActionForm action={createThemeCode.bind(null, ideaId)} submitLabel="Thema toevoegen" submitClass="btn white sm" resetOnSuccess noValidate>
              <Field name="label" id={`th-new-${interviewId}`} label="Thema" required hint="3–80 tekens, zonder namen. Bijv. 'Tijdverlies door appgroepen'.">
                <input className="field" maxLength={80} />
              </Field>
              <Field name="description" id={`th-desc-${interviewId}`} label="Omschrijving (optioneel)"><input className="field" maxLength={400} /></Field>
            </ActionForm>
          </details>
        </div>
      )}

      {codes.filter((c) => c.status === "proposed").length > 0 && (
        <div className="note mt-12">
          <strong>Voorgestelde AI-thema&apos;s.</strong> Een voorstel telt nergens mee tot je het accepteert.
          <ul className="study-list mt-8">
            {codes
              .filter((c) => c.status === "proposed")
              .map((c) => (
                <li key={c.id} className="row" style={{ gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                  <strong style={{ flex: "1 1 200px" }}>{c.label}{c.description ? <span className="tiny" style={{ display: "block", fontWeight: 400 }}>{c.description}</span> : null}</strong>
                  <form action={reviewThemeCode.bind(null, ideaId, c.id, "accepted")}><button className="btn white sm">Accepteer thema</button><FormPendingOverlay /></form>
                  <form action={reviewThemeCode.bind(null, ideaId, c.id, "rejected")}><button className="btn white sm">Wijs af</button><FormPendingOverlay /></form>
                </li>
              ))}
          </ul>
        </div>
      )}

      {used.length === 0 && <p className="sub mt-12">Nog geen thema&apos;s in dit gesprek.</p>}
      {used.map((c) => {
        const rows = assignments.filter((a) => a.code_id === c.id);
        const openAi = rows.filter((a) => a.origin === "ai" && !a.review_status).length;
        return (
          <div key={c.id} className="mt-12">
            <div className="row" style={{ gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <h3 style={{ fontSize: 15, margin: 0 }}>{c.label}</h3>
              <span className={`pill ${c.status === "accepted" ? "green" : c.status === "rejected" ? "gray" : "blue"}`}>
                {c.status === "accepted" ? (c.origin === "ai" ? "AI-thema, geaccepteerd" : "Handmatig thema") : c.status === "rejected" ? "Afgewezen: telt niet" : "AI-voorstel"}
              </span>
              {canEdit && openAi > 1 && c.status === "accepted" && (
                <form action={acceptThemeAssignments.bind(null, ideaId, interviewId, c.id)}><button className="text-link">Accepteer alle {openAi} AI-citaten</button><FormPendingOverlay /></form>
              )}
            </div>
            {rows.map((a) => {
              const o = byObs.get(a.observation_id);
              const counts = c.status === "accepted" && (a.origin === "manual" || a.review_status === "accepted");
              return (
                <div className="evidence-event" key={`${a.observation_id}-${a.code_id}`}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    {o?.quote ? <blockquote className="quote" style={{ marginTop: 0 }}>“{o.quote}”</blockquote> : <p className="tiny">{o?.summary ?? "Citaat"} (citaat verwijderd na de bewaartermijn)</p>}
                    <p className="tiny">
                      {a.origin === "manual" ? "Handmatig toegewezen" : a.review_status === "accepted" ? "AI, geaccepteerd" : a.review_status === "rejected" ? "AI, afgewezen" : "AI-voorstel"}
                      {" · "}
                      {counts ? "telt mee in X van N" : "telt niet mee"}
                    </p>
                  </div>
                  {canEdit && a.origin === "ai" && !a.review_status && (
                    <div className="row" style={{ gap: 6 }}>
                      <form action={reviewThemeAssignment.bind(null, ideaId, a.observation_id, a.code_id, "accepted")}><button className="btn white sm">Klopt</button><FormPendingOverlay /></form>
                      <form action={reviewThemeAssignment.bind(null, ideaId, a.observation_id, a.code_id, "rejected")}><button className="btn white sm">Klopt niet</button><FormPendingOverlay /></form>
                    </div>
                  )}
                  {canEdit && a.origin === "manual" && (
                    <form action={removeThemeAssignment.bind(null, ideaId, a.observation_id, a.code_id)}><button className="text-link">Haal weg</button><FormPendingOverlay /></form>
                  )}
                </div>
              );
            })}
          </div>
        );
      })}

      {canEdit && accepted.length > 0 && evidence.length > 0 && (
        <details className="mt-12">
          <summary className="text-link">Thema toewijzen aan een vastgelegde observatie</summary>
          {evidence.map((o) => (
            <ActionForm key={o.id} action={assignThemeCode.bind(null, ideaId, o.id)} submitLabel="Wijs toe" submitClass="btn white sm" pendingLabel="Bezig…">
              <p className="tiny" style={{ margin: "10px 0 4px" }}>{o.quote ? `“${o.quote.slice(0, 160)}${o.quote.length > 160 ? "…" : ""}”` : o.summary}</p>
              <label className="sr-only" htmlFor={`th-as-${o.id}`}>Thema voor deze observatie</label>
              <select className="field" id={`th-as-${o.id}`} name="code_id" defaultValue="">
                <option value="" disabled>Kies een thema</option>
                {accepted.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
              </select>
            </ActionForm>
          ))}
        </details>
      )}

      <Detail>
        <div className="mt-18">
          <AiQualityCard measures={[{ title: "AI-thema's: geaccepteerd", measure: quality }]} />
        </div>
      </Detail>
    </section>
  );
}
