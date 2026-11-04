import type { DecisionSheet, SheetVerdict } from "@/lib/report-sheet";
import { nextStepDate } from "@/lib/report-pdf-model";

// Beslisblad (fase B6): pagina 1 van het rapport, ook bij printen. Het volledige dossier volgt als bijlage.
const VERDICT_BG: Record<SheetVerdict, string> = {
  continue: "var(--color-success-soft)",
  stop: "var(--color-warning-soft)",
  undecidable: "var(--color-surface-soft)",
};

export function DecisionSheetView({ sheet, version, date }: { sheet: DecisionSheet; version: number; date: string }) {
  return (
    <section className="report-section decision-sheet" aria-labelledby="beslisblad-titel" style={{ breakAfter: "page" }}>
      <span className="eyebrow">Beslisblad · Versie {version} · {date}</span>
      <div style={{ background: VERDICT_BG[sheet.verdict], border: "1px solid var(--color-border)", borderRadius: "var(--radius-inner)", padding: 18, margin: "12px 0 18px" }}>
        <div className="tiny" style={{ fontWeight: 800, textTransform: "uppercase", letterSpacing: ".14em" }}>Besluit</div>
        <h3 id="beslisblad-titel" className="report-number" style={{ margin: "4px 0 6px" }} data-verdict={sheet.verdict}>
          {sheet.verdictLabel}
        </h3>
        <p style={{ margin: 0 }}>
          Bewijsniveau: <strong>{sheet.evidenceLevel}</strong>.{sheet.ladder ? ` ${sheet.ladder}` : ""}
        </p>
        {sheet.decisionLine && <p className="tiny" style={{ margin: "6px 0 0" }}>Vastgelegd besluit: {sheet.decisionLine}.</p>}
        {sheet.reasons.length > 0 && (
          <ul className="tiny" style={{ margin: "8px 0 0 18px", lineHeight: 1.6 }}>
            {sheet.reasons.map((r) => <li key={r}>{r}</li>)}
          </ul>
        )}
      </div>

      <strong style={{ fontSize: 13 }}>De 3 sterkste bewijsstukken</strong>
      {sheet.strongest.length === 0 ? (
        <p className="tiny">Nog geen geverifieerde bron en geen echte waarneming.</p>
      ) : (
        <ol style={{ margin: "6px 0 14px 18px", fontSize: 13, lineHeight: 1.6, color: "var(--color-text)" }}>
          {sheet.strongest.map((e, i) => (
            <li key={i}>
              {e.against ? "Tegenbewijs: " : ""}
              {e.text}
              {e.note ? <sup>[{e.note}]</sup> : null}
              <div className="tiny">
                Bron:{" "}
                {e.url ? (
                  <a className="text-link" href={e.url} target="_blank" rel="noreferrer noopener">{e.source}</a>
                ) : (
                  e.source
                )}{" "}
                · niveau: {e.level}
              </div>
            </li>
          ))}
        </ol>
      )}

      <strong style={{ fontSize: 13 }}>Wat níét bewezen is</strong>
      {sheet.notProven.length === 0 ? (
        <p className="tiny">Geen open punten vastgesteld. Dat betekent niet dat alles bewezen is; zie het dossier hieronder.</p>
      ) : (
        <ul style={{ margin: "6px 0 4px 18px", fontSize: 13, lineHeight: 1.6, color: "var(--color-text)" }}>
          {sheet.notProven.map((x) => <li key={x}>{x}</li>)}
        </ul>
      )}
      {sheet.notProvenMore > 0 && <p className="tiny">En {sheet.notProvenMore} {sheet.notProvenMore === 1 ? "punt" : "punten"} meer in het dossier.</p>}

      <div className="note" style={{ marginTop: 14 }}>
        <strong>Volgende stap:</strong> {sheet.nextStep.text}
        <div className="tiny">Datum: {nextStepDate(sheet)}</div>
      </div>
      <p className="tiny mt-12">
        Het volledige dossier volgt hieronder als bijlage, in de vaste opbouw.
        {sheet.derived ? " Dit beslisblad is afgeleid uit een rapportversie van vóór het beslisblad." : ""}
      </p>
    </section>
  );
}
