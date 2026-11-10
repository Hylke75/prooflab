"use client";

import { useId, useState } from "react";
import type { BcValue } from "@/lib/domain/business-case";

// Getallen in Nederlandse schrijfwijze: "1.250,50", "1250,5", "60.000" en "60000" werken allemaal. Euro- en
// procenttekens en spaties mogen erbij. undefined = geen getal.
export function parseNl(text: string): number | null | undefined {
  const s = text.trim().replace(/[€%\s]/g, "");
  if (!s) return null;
  let n: string;
  if (s.includes(",")) n = s.replace(/\./g, "").replace(",", ".");
  else if (/^\d{1,3}(\.\d{3})+$/.test(s)) n = s.replace(/\./g, "");
  else n = s;
  if (!/^-?\d+(\.\d+)?$/.test(n)) return undefined;
  return Number(n);
}

export const showNl = (v: number | null) => (v == null ? "" : v.toLocaleString("nl-NL", { maximumFractionDigits: 2 }));

export function eur(n: number | null | undefined, opts: { sign?: boolean } = {}): string {
  if (n == null || !Number.isFinite(n)) return "onbekend";
  const r = Math.round(n);
  const s = `€ ${Math.abs(r).toLocaleString("nl-NL")}`;
  if (r < 0) return `−${s}`;
  return opts.sign && r > 0 ? `+${s}` : s;
}

// Eén getal met eenheid, korte uitleg, foutmelding en het label (schatting, bevestigd of voorstel).
export function NumberField({
  label,
  hint,
  example,
  prefix,
  suffix,
  value,
  onChange,
  max,
  disabled,
  autoFocus,
}: {
  label: string;
  hint?: string;
  example?: string;
  prefix?: string;
  suffix?: string;
  value: BcValue;
  onChange: (v: BcValue) => void;
  max?: number;
  disabled?: boolean;
  autoFocus?: boolean;
}) {
  const id = useId();
  const [text, setText] = useState(showNl(value.v));
  const [error, setError] = useState<string | null>(null);
  // Van buiten veranderd (bijv. "Voorstel overnemen" of "Weggooien"): de tekst volgt.
  const [seen, setSeen] = useState(value.v);
  if (seen !== value.v) {
    setSeen(value.v);
    if (parseNl(text) !== value.v) setText(showNl(value.v));
  }
  const describedBy = [hint ? `${id}-hint` : null, example ? `${id}-ex` : null, error ? `${id}-err` : null].filter(Boolean).join(" ") || undefined;
  const change = (t: string) => {
    setText(t);
    const n = parseNl(t);
    if (n === undefined) {
      setError("Vul een getal in, bijvoorbeeld 1.250 of 12,5.");
      return;
    }
    if (n != null && n < 0) {
      setError("Gebruik een getal van 0 of hoger.");
      return;
    }
    if (n != null && max != null && n > max) {
      setError(`Het hoogste getal hier is ${max.toLocaleString("nl-NL")}.`);
      return;
    }
    setError(null);
    setSeen(n);
    onChange({ ...value, v: n, label: value.label === "proposal" ? "estimate" : value.label });
  };
  return (
    <div className="bc-field">
      <label className="field-label" htmlFor={id}>{label}</label>
      {hint && <p className="field-hint" id={`${id}-hint`}>{hint}</p>}
      <div className={`bc-input${prefix ? " has-prefix" : ""}`}>
        {prefix && <span className="bc-affix" aria-hidden="true">{prefix}</span>}
        <input
          id={id}
          className={`field num${value.label === "proposal" ? " is-proposal" : ""}`}
          inputMode="decimal"
          autoComplete="off"
          value={text}
          disabled={disabled}
          autoFocus={autoFocus}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          onChange={(e) => change(e.target.value)}
        />
        {suffix && <span className="bc-affix suffix">{suffix}</span>}
      </div>
      {example && <p className="tiny bc-example" id={`${id}-ex`}>{example}</p>}
      {error && <p className="field-error" id={`${id}-err`} role="alert">{error}</p>}
      {!disabled && <ValueLabel value={value} onChange={onChange} />}
    </div>
  );
}

// Herkomst van één getal: eigen schatting (standaard), bevestigd (met herkomst) of voorstel (telt pas na overnemen).
export function ValueLabel({ value, onChange }: { value: BcValue; onChange: (v: BcValue) => void }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  if (value.v == null) return null;
  if (value.label === "proposal") {
    return (
      <div className="bc-proposal" role="note">
        <span className="pill orange">Voorstel</span>
        <span className="tiny">{value.source ?? "Voorgesteld door ProofLab"}. Telt pas mee als je het overneemt.</span>
        <button type="button" className="btn sm white" onClick={() => onChange({ ...value, label: "estimate" })}>Overnemen</button>
        <button type="button" className="btn sm clear" onClick={() => onChange({ v: null, label: "estimate" })}>Weggooien</button>
      </div>
    );
  }
  const confirmed = value.label === "confirmed";
  return (
    <div className="bc-label-row">
      <span className={`pill ${confirmed ? "green" : "gray"}`}>{confirmed ? "Bevestigd" : "Eigen schatting"}</span>
      {confirmed && !open && <span className="tiny">{value.source}</span>}
      {!open && (
        <button type="button" className="text-link tiny" onClick={() => setOpen(true)}>
          {confirmed ? "Herkomst wijzigen" : "Heb je hier een bron voor?"}
        </button>
      )}
      {open && (
        <div className="bc-source" id={`${id}-src`}>
          <label className="tiny" htmlFor={`${id}-in`}>Waar komt dit getal vandaan? Bijvoorbeeld een offerte, contract, bron of eigen meting.</label>
          <div className="bc-source-row">
            <input
              id={`${id}-in`}
              className="field"
              maxLength={300}
              defaultValue={value.source ?? ""}
              autoFocus
              onChange={(e) => {
                const source = e.target.value;
                onChange({ ...value, source: source.trim() ? source : null, label: source.trim().length >= 3 ? "confirmed" : "estimate" });
              }}
            />
            <button type="button" className="btn sm white" onClick={() => setOpen(false)}>Klaar</button>
          </div>
        </div>
      )}
    </div>
  );
}
