import { pct, type BayesEstimate, type Verdict } from "@/lib/domain/stats";

// Point estimate, 95% interval and the pre-registered thresholds on one scale. Next to it, after the
// end condition only, the Bayesian estimate that takes earlier tests into account (research 3.6).
export function ResultMeter({ v, success, fail, bayes }: { v: Verdict; success: number; fail: number | null; bayes?: BayesEstimate | null }) {
  const max = Math.min(1, Math.max(v.interval.high, bayes?.high ?? 0, success / 100, (fail ?? 0) / 100) * 1.25 || 1);
  const x = (p: number) => `${Math.min(100, (p / max) * 100)}%`;
  const showBayes = !!bayes && v.kind !== "running";
  return (
    <div>
      <div className="meter" role="img" aria-label={`Gemeten ${pct(v.interval.point)}, 95%-interval ${pct(v.interval.low)} tot ${pct(v.interval.high)}, succesdrempel ${success}%`}>
        <div className="ci" style={{ left: x(v.interval.low), width: `calc(${x(v.interval.high)} - ${x(v.interval.low)})` }} />
        <div className="pt" style={{ left: x(v.interval.point) }} />
        <div className="th" style={{ left: x(success / 100) }}><span>succes {success}%</span></div>
        {fail != null && <div className="th" style={{ left: x(fail / 100), background: "var(--color-risk)" }}><span style={{ color: "var(--color-risk-text)" }}>faal {fail}%</span></div>}
      </div>
      <p className="tiny">Gemeten {pct(v.interval.point)} · 95%-interval {pct(v.interval.low)} – {pct(v.interval.high)}</p>
      <p className="explain">
        Het 95%-interval is de bandbreedte waarbinnen de werkelijke waarde vrijwel zeker ligt. Geslaagd is de test pas als ook de ondergrens boven de succesdrempel ligt.
      </p>
      {showBayes && bayes && (
        <div className="mt-12">
          <div className="eyebrow">Schatting met voorkennis</div>
          <div
            className="meter"
            role="img"
            aria-label={`Geschat ${pct(bayes.mean)} rekening houdend met eerdere tests, 90%-interval ${pct(bayes.low)} tot ${pct(bayes.high)}`}
          >
            <div className="ci" style={{ left: x(bayes.low), width: `calc(${x(bayes.high)} - ${x(bayes.low)})`, background: "var(--color-success-soft)" }} />
            <div className="pt" style={{ left: x(bayes.mean) }} />
            <div className="th" style={{ left: x(success / 100) }}><span>succes {success}%</span></div>
          </div>
          <p className="tiny">
            Geschat {pct(bayes.mean)} · 90%-interval {pct(bayes.low)} – {pct(bayes.high)} · kans dat het werkelijke percentage ≥ {success}% is: {pct(bayes.pAboveThreshold, 0)}
          </p>
          <p className="explain">
            Rekening houdend met eerdere tests: een toevallig hoge of lage score bij weinig deelnemers telt minder zwaar.{" "}
            {bayes.prior.source === "empirical"
              ? `Voorkennis uit ${bayes.prior.tests} eerdere afgeronde tests van dit type in je organisatie (gemiddeld ${pct(bayes.prior.mean)}), die samen meewegen als ${Math.round(bayes.prior.strength)} deelnemers.`
              : `Er zijn minder dan 3 eerdere afgeronde tests van dit type, dus de voorkennis is neutraal (weegt als 2 deelnemers).`}{" "}
            Dit is een schatting naast het oordeel; het oordeel volgt alleen de vooraf vastgelegde regel.
          </p>
        </div>
      )}
    </div>
  );
}
