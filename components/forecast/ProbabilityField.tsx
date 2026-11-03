"use client";

import { useId, useState } from "react";

// A probability between 5 and 95%, as a slider and a number field that stay in sync.
export function ProbabilityField({ initial, describedBy }: { initial: number; describedBy?: string }) {
  const [value, setValue] = useState(Math.min(95, Math.max(5, Math.round(initial))));
  const id = useId();
  const set = (raw: string) => {
    const n = Number(raw);
    if (Number.isFinite(n)) setValue(Math.min(95, Math.max(5, Math.round(n))));
  };
  return (
    <div>
      <div className="range-label" style={{ marginTop: 18 }}>
        <label htmlFor={`${id}-range`} style={{ fontWeight: 800 }}>
          Kans dat het doel wordt gehaald
        </label>
        <strong aria-hidden="true">{value}%</strong>
      </div>
      <div className="row" style={{ alignItems: "center", gap: 12, flexWrap: "nowrap" }}>
        <input
          id={`${id}-range`}
          type="range"
          min={5}
          max={95}
          step={1}
          value={value}
          onChange={(e) => set(e.target.value)}
          aria-describedby={describedBy}
          aria-valuetext={`${value} procent`}
          style={{ flex: 1, minHeight: 44 }}
        />
        <label className="sr-only" htmlFor={`${id}-num`}>
          Kans in procenten
        </label>
        <input
          id={`${id}-num`}
          className="field num"
          name="probability"
          type="number"
          inputMode="numeric"
          min={5}
          max={95}
          step={1}
          value={value}
          onChange={(e) => set(e.target.value)}
          style={{ width: 86, minHeight: 44, padding: "10px 12px" }}
        />
        <span aria-hidden="true" className="tiny">%</span>
      </div>
      <div className="chart-labels" aria-hidden="true">
        <span>5% · vrijwel zeker niet</span>
        <span>50%</span>
        <span>95% · vrijwel zeker wel</span>
      </div>
    </div>
  );
}
