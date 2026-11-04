import type { BaseRateView } from "@/lib/forecast-data";
import { pct } from "@/lib/domain/forecast";

export function baseRateRange(b: BaseRateView | null): string {
  if (!b || b.kind === "none") return "onbekend";
  return b.low === b.high ? pct(b.low) : `${pct(b.low)}–${pct(b.high)}`;
}

// The chosen base rate, always with its source (or an explicit "onbekend").
export function BaseRateSummary({ baseRate, id }: { baseRate: BaseRateView; id?: string }) {
  return (
    <div className="note" id={id} style={{ marginTop: 12 }}>
      <strong style={{ color: "var(--color-heading)" }}>
        Basispercentage: {baseRateRange(baseRate)}
      </strong>
      {baseRate.kind === "class" && (
        <>
          <br />
          {baseRate.label} · Bron:{" "}
          {baseRate.sourceUrl ? (
            <a href={baseRate.sourceUrl} target="_blank" rel="noreferrer noopener">
              {baseRate.sourceTitle}
            </a>
          ) : (
            baseRate.sourceTitle
          )}
          <br />
          Let op: {baseRate.caveat}
        </>
      )}
      {baseRate.kind === "own" && (
        <>
          <br />
          Bron: eigen afgeronde dossiers in ProofLab, gemeten zes maanden na het besluit.
        </>
      )}
      {baseRate.kind === "none" && (
        <>
          <br />
          Geen goede referentie gevonden; het basispercentage is onbekend.
        </>
      )}
      {baseRate.note && (
        <>
          <br />
          Toelichting: {baseRate.note}
        </>
      )}
    </div>
  );
}
