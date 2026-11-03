"use client";

import { useId, useMemo, useState } from "react";
import { FAIL_PROBABILITY, PASS_PROBABILITY, lnGamma, probabilityAbove, wilson } from "@/lib/domain/stats";

// De kansregel om aan te raken: dezelfde functies als de app (lib/domain/stats.ts). Voorbeeld: een
// landingpagina-test met 40 bezoekers, succesdrempel 20% en faaldrempel 10%.
const N = 40;
const SUCCESS = 20;
const FAIL = 10;
const X_MAX = 0.6;
const W = 560;
const H = 170;

function density(x: number, a: number, b: number) {
  if (x <= 0 || x >= 1) return 0;
  return Math.exp(lnGamma(a + b) - lnGamma(a) - lnGamma(b) + (a - 1) * Math.log(x) + (b - 1) * Math.log(1 - x));
}

const pctNl = (x: number) => `${Math.round(x * 100)}%`;

export function RuleExplorer() {
  const [s, setS] = useState(11);
  const id = useId();

  const view = useMemo(() => {
    const a = 1 + s;
    const b = 1 + N - s;
    const pts: [number, number][] = [];
    for (let i = 0; i <= 120; i++) {
      const x = (i / 120) * X_MAX;
      pts.push([x, density(x, a, b)]);
    }
    const max = Math.max(...pts.map((p) => p[1])) || 1;
    const sx = (x: number) => (x / X_MAX) * W;
    const sy = (y: number) => H - (y / max) * (H - 8);
    const line = pts.map(([x, y], i) => `${i ? "L" : "M"}${sx(x).toFixed(1)} ${sy(y).toFixed(1)}`).join(" ");
    const above = pts.filter(([x]) => x >= SUCCESS / 100);
    const area =
      `M${sx(SUCCESS / 100).toFixed(1)} ${H} ` +
      above.map(([x, y]) => `L${sx(x).toFixed(1)} ${sy(y).toFixed(1)}`).join(" ") +
      ` L${W} ${H} Z`;
    const pAbove = probabilityAbove(s, N, SUCCESS);
    const pFail = probabilityAbove(s, N, FAIL);
    const ci = wilson(s, N);
    const strong = ci.low >= SUCCESS / 100;
    const verdict =
      pAbove >= PASS_PROBABILITY ? (strong ? "sterk bewezen" : "geslaagd") : pFail <= FAIL_PROBABILITY ? "niet geslaagd" : "onbeslist";
    return { line, area, pAbove, ci, verdict, thresholdX: sx(SUCCESS / 100), failX: sx(FAIL / 100) };
  }, [s]);

  return (
    <div className="lp-rule">
      <div className="lp-rule-chart">
        <svg viewBox={`0 0 ${W} ${H + 24}`} role="img" aria-label={`Kansverdeling na ${s} van ${N}; kans boven ${SUCCESS}% is ${pctNl(view.pAbove)}`}>
          <path d={view.area} className="lp-rule-area" />
          <path d={view.line} className="lp-rule-line" />
          <line x1={view.failX} x2={view.failX} y1="0" y2={H} className="lp-rule-fail" />
          <line x1={view.thresholdX} x2={view.thresholdX} y1="0" y2={H} className="lp-rule-threshold" />
          <line x1="0" x2={W} y1={H} y2={H} className="lp-rule-axis" />
          {[0, 10, 20, 30, 40, 50, 60].map((v) => (
            <text key={v} x={(v / 60) * W} y={H + 18} className="lp-rule-tick-text" textAnchor={v === 0 ? "start" : v === 60 ? "end" : "middle"}>
              {v}%
            </text>
          ))}
        </svg>
      </div>
      <div className="lp-rule-control">
        <label htmlFor={id}>
          Aanmeldingen: <strong>{s} van {N}</strong> bezoekers
        </label>
        <input id={id} type="range" min={0} max={24} value={s} onChange={(e) => setS(Number(e.target.value))} />
      </div>
      <dl className="lp-rule-stats">
        <div>
          <dt>P(echte waarde &gt; {SUCCESS}%)</dt>
          <dd>{pctNl(view.pAbove)}</dd>
        </div>
        <div>
          <dt>95%-interval</dt>
          <dd>
            {pctNl(view.ci.low)}–{pctNl(view.ci.high)}
          </dd>
        </div>
        <div>
          <dt>Uitkomst</dt>
          <dd>
            <span className="lp-verdict" data-verdict={view.verdict} aria-live="polite">
              {view.verdict}
            </span>
          </dd>
        </div>
      </dl>
    </div>
  );
}
