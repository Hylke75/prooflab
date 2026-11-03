import Link from "next/link";
import type { ForecastView } from "@/lib/forecast-data";
import { FORECAST_MOMENTS, MOMENT_LABELS, OWN_BASE_RATE_MIN, pct, type ForecastMoment } from "@/lib/domain/forecast";
import { blendedEstimate, OVERCONFIDENT_GAP, overconfidence } from "@/lib/domain/calibration";

// Starting calibration: until the organisation has enough resolved dossiers to score its forecasters, the
// base rate is the yardstick. Shows the viewer's own forecasts against it, and a blended suggestion of
// people, AI and base rate. Uses only forecasts the viewer may see: nothing appears for a moment before the
// viewer's own forecast (the blind rule is enforced by the database; this only reads what it returned).
export function CalibrationGuide({ view }: { view: ForecastView }) {
  const b = view.baseRate;
  if (!view.outcome.statement || !b || b.kind === "none") return null;
  const range = { low: b.low, high: b.high };
  const mine = view.forecasts.filter((f) => f.mine && f.kind !== "ai");
  const enoughOwn = view.orgResolved != null && view.orgResolved >= OWN_BASE_RATE_MIN;
  const momentsSeen = FORECAST_MOMENTS.filter((m) => (view.resolved ? view.forecasts.some((f) => f.moment === m) : mine.some((f) => f.moment === m)));
  const latest: ForecastMoment | undefined = momentsSeen[momentsSeen.length - 1];
  const rows = latest ? view.forecasts.filter((f) => f.moment === latest) : [];
  const blend = latest
    ? blendedEstimate({
        people: rows.filter((r) => r.kind !== "ai").map((r) => r.probability),
        ai: rows.find((r) => r.kind === "ai")?.probability ?? null,
        baseRate: range,
        behaviourTestEnded: view.behaviourTestEnded,
      })
    : null;
  const pts = Math.round(OVERCONFIDENT_GAP * 100);

  return (
    <div className="card" id="kalibratiehulp" style={{ scrollMarginTop: 100 }}>
      <div className="section-title">
        <h3>IJkhulp: jouw voorspelling naast het basispercentage</h3>
        <span className={`pill ${enoughOwn ? "green" : "gray"}`}>{enoughOwn ? "Eigen scores beschikbaar" : "Startkalibratie"}</span>
      </div>
      <p className="sub">
        {enoughOwn ? (
          <>
            Er zijn genoeg afgeronde dossiers om voorspellers echt te scoren; zie <Link className="text-link" href="/app/forecasts">Voorspelkwaliteit</Link>. Deze hulp blijft
            staan als extra controle.
          </>
        ) : (
          <>
            Zolang er minder dan {OWN_BASE_RATE_MIN} eigen afgeronde dossiers zijn, kunnen we niet meten hoe goed iemand voorspelt. Het basispercentage
            ({pct(b.low)}–{pct(b.high)}) zegt hoe vaak vergelijkbare ideeën slagen. Wie zonder gedragsbewijs ver daarvan afwijkt, is meestal te zeker.
          </>
        )}
      </p>

      {mine.length === 0 && !view.resolved ? (
        <p className="tiny mt-8">Geef eerst je eigen voorspelling. Daarna zie je hier hoe die zich verhoudt tot het basispercentage.</p>
      ) : (
        <div className="mt-12">
          {mine.map((f) => {
            const o = overconfidence(f.probability, range, view.behaviourTestEnded);
            if (!o) return null;
            const gap = Math.round(o.gap * 100);
            return (
              <div key={f.id} className="data-row">
                <span>
                  {MOMENT_LABELS[f.moment].label}: <strong className="num">{pct(f.probability)}</strong>
                </span>
                <b className={`pill ${o.flagged ? "orange" : "gray"}`}>
                  {gap === 0 ? "gelijk aan het basispercentage" : `${gap} procentpunt ${o.direction === "higher" ? "hoger" : "lager"}`}
                  {o.flagged ? " · mogelijk te zeker" : ""}
                </b>
              </div>
            );
          })}
        </div>
      )}
      {mine.some((f) => overconfidence(f.probability, range, view.behaviourTestEnded)?.flagged) && (
        <p className="tiny mt-8">
          Meer dan {pts} procentpunt van het midden van het basispercentage, terwijl er nog geen landingpage- of prijstest is afgerond. Afwijken mag; schrijf dan op
          welk bewijs dat rechtvaardigt.
        </p>
      )}

      {blend && latest && (
        <div className="note mt-12">
          <strong>Suggestie, geen voorspelling: gemengde schatting {MOMENT_LABELS[latest].label.toLowerCase()} {pct(blend.estimate)}</strong>
          <p className="tiny mt-8">
            {blend.parts.map((p) => `${p.label} ${pct(p.value)} × ${Math.round(p.weight * 100)}%`).join(" + ")}. Een gewogen gemiddelde trekt een uitschieter
            richting het basispercentage; uit onderzoek naar voorspellers blijkt dat zo&apos;n mengsel gemiddeld beter scoort dan losse inschattingen. Het vervangt
            geen enkele voorspelling en telt nergens mee. Gewichten: zie het methodedocument, hoofdstuk 8.
          </p>
        </div>
      )}
    </div>
  );
}
