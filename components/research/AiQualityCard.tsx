import { Explain } from "@/components/ui/Explain";
import { CODING_ACCEPTANCE_THRESHOLD, MIN_REVIEWS, SUPPORT_AGREEMENT_THRESHOLD, type QualityMeasure } from "@/lib/domain/ai-quality";

const LEVEL = { meets: ["Boven de drempel", "green"], below: ["Onder de drempel", "coral"], too_few: ["Te weinig gegevens", "gray"] } as const;

// How good is the AI at its own tasks in this workspace (research 7.9)? Measured against consultants.
export function AiQualityCard({ measures }: { measures: { title: string; measure: QualityMeasure }[] }) {
  return (
    <div className="card">
      <div className="section-title">
        <h3>AI-kwaliteit</h3>
        <span className="pill gray">Gemeten tegen consultants</span>
      </div>
      {measures.map(({ title, measure: m }) => {
        const [label, pill] = LEVEL[m.level];
        return (
          <div key={title} className="data-row" style={{ alignItems: "flex-start" }}>
            <div>
              <strong style={{ display: "block", fontSize: 13 }}>{title}</strong>
              <span>{m.message}</span>
            </div>
            <div style={{ textAlign: "right" }}>
              <strong className="num" style={{ display: "block" }}>{m.rate === null ? "—" : `${Math.round(m.rate * 100)}%`}</strong>
              <span className={`pill ${pill}`}>{label}</span>
            </div>
          </div>
        );
      })}
      {/* Fase 1 · punt 1: de drempelnote één keer per pagina (in Snel); daarna alleen de term met tooltip. */}
      <Explain k="ai-drempel" as="div" className="note" term="Drempels voor AI-kwaliteit">
        Drempels: minimaal {Math.round(SUPPORT_AGREEMENT_THRESHOLD * 100)}% overeenstemming bij steuncontroles en minimaal{" "}
        {Math.round(CODING_ACCEPTANCE_THRESHOLD * 100)}% acceptatie bij AI-codering, telkens over minstens {MIN_REVIEWS} beoordelingen. Daaronder
        blijft elk AI-oordeel een voorstel.
      </Explain>
    </div>
  );
}
