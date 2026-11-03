import { formatProbability, formatProbabilityRange } from "@/lib/domain/probability-display";

// Een kans zoals overal in ProofLab: in een band van 10 procentpunt met "niet gekalibreerd" zolang de organisatie
// te weinig opgeloste dossiers heeft, anders afgerond op hele procenten. De exacte waarde staat in de tooltip en
// wordt voorgelezen. showLabel: het label als pil erachter (uit bij krappe plekken; de tooltip noemt het altijd).
export function Probability({ p, calibrated, showLabel = true, high }: { p: number; calibrated: boolean; showLabel?: boolean; high?: number }) {
  const f = high == null ? formatProbability(p, calibrated) : formatProbabilityRange(p, high, calibrated);
  return (
    <>
      <span title={f.title} tabIndex={0} style={{ textDecoration: "underline dotted", textUnderlineOffset: 3, cursor: "help" }} className="num">
        <span aria-hidden="true">{f.text}</span>
        <span className="sr-only">{`${f.text}${f.label ? `, ${f.label}` : ""}. ${f.title}`}</span>
      </span>
      {showLabel && f.label && (
        <>
          {" "}
          <span className="pill gray" aria-hidden="true">{f.label}</span>
        </>
      )}
    </>
  );
}
