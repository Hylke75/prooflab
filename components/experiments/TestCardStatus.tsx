import { testCardStatus } from "@/lib/domain/test-card";

// Fase B5: één duidelijke status bovenaan de Test Card: Concept → Klaar voor goedkeuring → Loopt. Dezelfde balk staat
// in de builder (nog niet opgeslagen: Concept) en op de experimentpagina.
export function TestCardStatus({ state, note }: { state: string; note?: string }) {
  const s = testCardStatus(state);
  return (
    <div className="tc-status" aria-label="Status van de Test Card">
      <ol className="stepper tc-status-steps">
        {s.steps.map((st, i) => (
          <li key={st.key} className={st.status === "current" ? "current" : st.status === "done" ? "complete" : undefined} aria-current={st.status === "current" ? "step" : undefined}>
            {i > 0 && <span className="connector" aria-hidden="true" />}
            <span className="step-no" aria-hidden="true">{st.status === "done" ? "✓" : i + 1}</span>
            <span>
              {st.label}
              <span className="sr-only">{st.status === "done" ? " (afgerond)" : st.status === "current" ? " (huidige stap)" : " (nog niet)"}</span>
            </span>
          </li>
        ))}
      </ol>
      <p className="tiny" style={{ margin: "-20px 0 12px" }}>{note ?? s.note}</p>
    </div>
  );
}
