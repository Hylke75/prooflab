import type { ActionCounts } from "@/lib/domain/action-counts";
import { SUCCESS_METRICS, type SuccessMetric } from "@/lib/domain/test-page-generator";

// Fase 2 · punt 4: wat er op de testpagina gebeurde, per persoon geteld. Dubbele betalingen, toezeggingen of afspraken
// van dezelfde persoon tellen één keer; terugbetaald, testmodus en geannuleerd tellen niet.
export function PerPersonCounts({
  counts,
  available,
  metric,
  deposit,
}: {
  counts: ActionCounts;
  available: boolean;
  metric: SuccessMetric;
  deposit: boolean;
}) {
  const steps: { label: string; value: number; hint: string; strong?: boolean }[] = [
    { label: "Unieke bezoekers", value: counts.visitors, hint: "n: anonieme bezoekcode per test" },
    { label: "Unieke klikkers", value: counts.clickers, hint: "klik na een weergave", strong: metric === "signup" },
    { label: "Unieke aanmelders", value: counts.submitters, hint: "formulier na een klik", strong: metric === "signup" },
  ];
  if (deposit || metric === "payment" || counts.payers || counts.testPayers) {
    steps.push({ label: "Unieke betalers (live)", value: counts.payers, hint: "Geverifieerde betaling via Mollie", strong: metric === "payment" });
  }
  if (metric === "commitment" || counts.committers) steps.push({ label: "Unieke toezeggers", value: counts.committers, hint: "getekend document of digitaal akkoord", strong: metric === "commitment" });
  if (metric === "booking" || counts.bookers || counts.cancelledBookings) steps.push({ label: "Unieke bookers", value: counts.bookers, hint: "geboekte afspraak (Calendly/Cal.com)", strong: metric === "booking" });
  return (
    <section className="card mt-18" aria-labelledby="pp-h" id="per-persoon">
      <div className="section-title">
        <h2 className="as-h3" id="pp-h">Per persoon geteld</h2>
        <span className="pill blue">Succes = {SUCCESS_METRICS[metric].short} · {SUCCESS_METRICS[metric].evidence}</span>
      </div>
      {!available && (
        <p className="tiny">De telling van betalingen, toezeggingen en afspraken vraagt een database-update (migratie 20261116090000_fase2_testen). Bezoekers, klikkers en aanmelders tellen wel.</p>
      )}
      <div className="grid-3" style={{ gap: 12 }}>
        {steps.map((s) => (
          <div key={s.label} className="live-stat">
            <small>{s.label}</small>
            <strong className="num" style={s.strong ? { color: "var(--blue)" } : undefined}>{s.value}</strong>
            <span className="tiny">{s.hint}</span>
          </div>
        ))}
      </div>
      <p className="tiny mt-8">
        Dezelfde persoon telt één keer, ook bij twee betalingen, toezeggingen of afspraken.
        {counts.testPayers > 0 && ` ${counts.testPayers} ${counts.testPayers === 1 ? "betaling" : "betalingen"} in testmodus (tellen niet als bewijs).`}
        {counts.refunded > 0 && ` ${counts.refunded} terugbetaald of teruggeboekt (telt niet meer).`}
        {counts.cancelledBookings > 0 && ` ${counts.cancelledBookings} ${counts.cancelledBookings === 1 ? "afspraak" : "afspraken"} geannuleerd (telt niet).`}
      </p>
    </section>
  );
}
