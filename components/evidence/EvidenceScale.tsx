import { EVIDENCE_SCALE, scaleIndex, type ScaleStep } from "@/lib/domain/evidence-scale";

// Fase 1, punt 2: de bewijsschaal als vijf treden (verkenning → mening → gedrag → betaling → herhaling). De bereikte
// treden zijn gevuld, de huidige omlijnd. Toegankelijk als geordende lijst met aria-current; de uitleg per trede staat in
// de tooltip en wordt voorgelezen.
export function EvidenceScale({ step, label = "Bewijsschaal" }: { step: ScaleStep; label?: string }) {
  const current = scaleIndex(step);
  return (
    <ol className="evidence-scale" aria-label={`${label}: ${EVIDENCE_SCALE[current].label}, trede ${current + 1} van ${EVIDENCE_SCALE.length}`} data-testid="bewijsschaal">
      {EVIDENCE_SCALE.map((s, i) => (
        <li key={s.step} className={`${i <= current ? "reached" : ""}${i === current ? " current" : ""}`} aria-current={i === current ? "step" : undefined} title={s.explain}>
          <span className="bar" aria-hidden="true" />
          <span className="step-label">{s.label}</span>
          <span className="sr-only">
            {i < current ? "bereikt" : i === current ? "huidige trede" : "nog niet bereikt"}: {s.explain}
          </span>
        </li>
      ))}
    </ol>
  );
}
