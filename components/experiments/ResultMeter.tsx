import { pct, type Verdict } from "@/lib/domain/stats";

// Point estimate, 95% interval and the pre-registered thresholds on one scale.
export function ResultMeter({ v, success, fail }: { v: Verdict; success: number; fail: number | null }) {
  const max = Math.min(1, Math.max(v.interval.high, success / 100, (fail ?? 0) / 100) * 1.25 || 1);
  const x = (p: number) => `${Math.min(100, (p / max) * 100)}%`;
  return (
    <div>
      <div className="meter" role="img" aria-label={`Gemeten ${pct(v.interval.point)}, 95%-interval ${pct(v.interval.low)} tot ${pct(v.interval.high)}, succesdrempel ${success}%`}>
        <div className="ci" style={{ left: x(v.interval.low), width: `calc(${x(v.interval.high)} - ${x(v.interval.low)})` }} />
        <div className="pt" style={{ left: x(v.interval.point) }} />
        <div className="th" style={{ left: x(success / 100) }}><span>succes {success}%</span></div>
        {fail != null && <div className="th" style={{ left: x(fail / 100), background: "#a43c42" }}><span style={{ color: "#a43c42" }}>faal {fail}%</span></div>}
      </div>
      <p className="tiny">Gemeten {pct(v.interval.point)} · 95%-interval {pct(v.interval.low)} – {pct(v.interval.high)}</p>
    </div>
  );
}
