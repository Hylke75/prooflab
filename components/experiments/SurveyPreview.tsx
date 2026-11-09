import type { SurveyConfig } from "@/lib/domain/survey";

// Tab "Voorbeeld" bij een enquête: wat de respondent ziet, alleen-lezen en live met de vragenlijst mee. Geen echte
// invoer: de publieke enquête (app/s/[slug]) is de enige plek waar antwoorden worden verzameld.
export function SurveyPreview({ survey }: { survey: SurveyConfig }) {
  return (
    <div className="preview-mini survey-preview" style={{ textAlign: "left", minHeight: 0, padding: 22 }}>
      <div className="preview-tag">ENQUÊTE · VOORBEELD</div>
      <h3>{survey.title || "Titel van de enquête"}</h3>
      <p>{survey.intro || "Korte uitleg: waarover, hoe lang, geen goede of foute antwoorden."}</p>
      <p className="tiny">
        Door {survey.researcher || "—"} · ongeveer {survey.estimated_minutes} min · {survey.questions.length} {survey.questions.length === 1 ? "vraag" : "vragen"}
      </p>
      <ol className="sv-preview-list">
        {survey.questions.map((q) => (
          <li key={q.id}>
            <strong>{q.text || "Vraag zonder tekst"}</strong>
            {q.showIf && <span className="tiny"> (alleen bij een eerder antwoord)</span>}
            {(q.type === "single" || q.type === "multi") && (
              <ul className="sv-preview-options" aria-label={q.type === "single" ? "Eén antwoord kiezen" : "Meerdere antwoorden mogelijk"}>
                {(q.options ?? []).map((o) => (
                  <li key={o.id}>
                    <span className={`sv-preview-mark ${q.type}`} aria-hidden="true" /> {o.label}
                  </li>
                ))}
              </ul>
            )}
            {q.type === "scale" && q.scale && (
              <p className="tiny">
                Schaal {q.scale.min}–{q.scale.max}
                {q.scale.minLabel || q.scale.maxLabel ? ` (${q.scale.minLabel || q.scale.min} … ${q.scale.maxLabel || q.scale.max})` : ""}
              </p>
            )}
            {q.type === "number" && <p className="tiny">Antwoord: een getal</p>}
            {q.type === "text" && <p className="tiny">Antwoord: open tekst</p>}
          </li>
        ))}
      </ol>
      <p className="tiny" style={{ marginTop: 12 }}>Na afloop: {survey.thank_you || "—"}</p>
    </div>
  );
}
