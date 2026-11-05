import { formatProbability, formatProbabilityRange } from "@/lib/domain/probability-display";

// Een kans zoals overal in ProofLab: in een band van 10 procentpunt rond de waarde met "niet gekalibreerd" zolang de organisatie
// te weinig opgeloste dossiers heeft, anders afgerond op hele procenten. De exacte waarde staat in de tooltip en
// wordt voorgelezen. showLabel: het label als pil erachter (uit bij krappe plekken; de tooltip noemt het altijd).
// band (fase 1, punt 2): de bandbreedte van de berekening erbij in de tooltip, zodat op het scherm één waarde staat.
export function Probability({ p, calibrated, showLabel = true, high, band }: { p: number; calibrated: boolean; showLabel?: boolean; high?: number; band?: { low: number; high: number } }) {
  const f = high == null ? formatProbability(p, calibrated) : formatProbabilityRange(p, high, calibrated);
  const title = band ? `${f.title} · bandbreedte ${formatProbabilityRange(band.low, band.high, true).exact}` : f.title;
  return (
    <>
      <span title={title} tabIndex={0} style={{ textDecoration: "underline dotted", textUnderlineOffset: 3, cursor: "help" }} className="num">
        <span aria-hidden="true">{f.text}</span>
        {/* Gebruikerstest C6: voorgelezen zonder uitleg; de uitleg over kalibratie staat één keer per kaart. */}
        <span className="sr-only">{`${f.text}${f.label ? `, ${f.label}` : ""}`}</span>
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
