import { bucketLabel, pct, type CalibrationRow } from "@/lib/domain/forecast";

const W = 360;
const H = 300;
const M = { top: 14, right: 16, bottom: 46, left: 50 };
const IW = W - M.left - M.right;
const IH = H - M.top - M.bottom;
const x = (p: number) => M.left + p * IW;
const y = (p: number) => M.top + (1 - p) * IH;
const TICKS = [0, 0.25, 0.5, 0.75, 1];

// Calibration: per probability bucket, the mean forecast (x) against how often the outcome happened (y).
// On the dashed diagonal a forecaster is perfectly calibrated. The table below carries the same numbers.
export function CalibrationChart({ rows }: { rows: CalibrationRow[] }) {
  const maxN = Math.max(1, ...rows.map((r) => r.forecasts));
  const radius = (n: number) => 4 + 7 * Math.sqrt(n / maxN);
  return (
    <figure style={{ margin: 0 }}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ maxWidth: 460, display: "block" }} role="img" aria-labelledby="cal-title cal-desc">
        <title id="cal-title">Kalibratie van alle afgeronde voorspellingen</title>
        <desc id="cal-desc">
          {rows.map((r) => `Voorspellingen ${bucketLabel(r.bucket)}: gemiddeld ${pct(r.meanProbability)} gegeven, ${pct(r.observed)} gebeurde, ${r.forecasts} voorspellingen.`).join(" ")}
        </desc>
        {TICKS.map((t) => (
          <g key={t}>
            <line x1={x(0)} x2={x(1)} y1={y(t)} y2={y(t)} style={{ stroke: "var(--color-border)" }} />
            <text x={M.left - 8} y={y(t) + 3} textAnchor="end" fontSize="10" style={{ fill: "var(--color-text-muted)" }}>{pct(t)}</text>
            <text x={x(t)} y={H - M.bottom + 16} textAnchor="middle" fontSize="10" style={{ fill: "var(--color-text-muted)" }}>{pct(t)}</text>
          </g>
        ))}
        <line x1={x(0)} x2={x(1)} y1={y(0)} y2={y(0)} style={{ stroke: "var(--color-border-strong)" }} />
        <line x1={x(0)} x2={x(0)} y1={y(0)} y2={y(1)} style={{ stroke: "var(--color-border-strong)" }} />
        <line x1={x(0)} y1={y(0)} x2={x(1)} y2={y(1)} style={{ stroke: "var(--color-text-muted)" }} strokeDasharray="4 4" />
        <text x={x(0.98)} y={y(0.98) + 14} textAnchor="end" fontSize="10" style={{ fill: "var(--color-text-muted)" }}>perfect gekalibreerd</text>
        {rows.map((r) => (
          <g key={r.bucket}>
            <circle cx={x(r.meanProbability)} cy={y(r.observed)} r={radius(r.forecasts)} style={{ fill: "var(--color-primary)", stroke: "var(--color-surface)" }} fillOpacity={0.85} strokeWidth={1.5} />
            <text x={x(r.meanProbability)} y={y(r.observed) - radius(r.forecasts) - 4} textAnchor="middle" fontSize="10" fontWeight="700" style={{ fill: "var(--color-heading)" }}>n={r.forecasts}</text>
          </g>
        ))}
        <text x={M.left + IW / 2} y={H - 8} textAnchor="middle" fontSize="11" fontWeight="700" style={{ fill: "var(--color-text-muted)" }}>Gegeven kans (gemiddeld per groep, %)</text>
        <text transform={`translate(13 ${M.top + IH / 2}) rotate(-90)`} textAnchor="middle" fontSize="11" fontWeight="700" style={{ fill: "var(--color-text-muted)" }}>Werkelijk gehaald (%)</text>
      </svg>
      <figcaption className="tiny" style={{ marginTop: 6 }}>
        Een punt onder de stippellijn: te optimistisch. Boven de lijn: te voorzichtig. Grotere punten bevatten meer voorspellingen. Deels gehaald telt als 50%.
      </figcaption>
      <table className="table mt-12">
        <caption className="sr-only">Kalibratie per kansgroep</caption>
        <thead>
          <tr>
            <th scope="col">Kansgroep</th>
            <th scope="col">Voorspellingen</th>
            <th scope="col">Gemiddeld gegeven</th>
            <th scope="col">Werkelijk gehaald</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.bucket}>
              <td>{bucketLabel(r.bucket)}</td>
              <td className="num">{r.forecasts}</td>
              <td className="num">{pct(r.meanProbability)}</td>
              <td className="num">{pct(r.observed)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
