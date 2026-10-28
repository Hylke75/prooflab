"use client";

import { useMemo, useState } from "react";
import { ActionForm, type FormState } from "@/components/ui/ActionForm";
import { computeUnitEconomics, type UnitEconomicsInput } from "@/lib/domain/sizing";

type Action = (s: FormState, f: FormData) => Promise<FormState>;

const FIELDS: { key: keyof UnitEconomicsInput; name: string; label: string; suffix: string }[] = [
  { key: "pricePerCustomerYear", name: "price_per_customer_year", label: "Prijs per klant per jaar", suffix: "€" },
  { key: "grossMarginPct", name: "gross_margin_pct", label: "Brutomarge", suffix: "%" },
  { key: "cacEur", name: "cac_eur", label: "Kosten om één klant te werven", suffix: "€" },
  { key: "annualChurnPct", name: "annual_churn_pct", label: "Klantverloop per jaar", suffix: "%" },
  { key: "fixedCostsYear", name: "fixed_costs_year", label: "Vaste kosten per jaar", suffix: "€" },
  { key: "upfrontInvestment", name: "upfront_investment", label: "Benodigde investering", suffix: "€" },
];

const eur = (n: number | null) => (n == null ? "onbekend" : `€ ${Math.round(n).toLocaleString("nl-NL")}`);

export function UnitEconomicsPanel({ initial, action, canWrite }: { initial: UnitEconomicsInput; action: Action; canWrite: boolean }) {
  const [v, setV] = useState(initial);
  const r = useMemo(() => computeUnitEconomics(v), [v]);
  return (
    <div className="grid-2 mt-18">
      <div className="card">
        <h3>Financiële haalbaarheid</h3>
        <p className="sub" style={{ marginTop: 7 }}>Een grote markt is nog geen rendabel bedrijf. Laat velden leeg als ze onbekend zijn.</p>
        <ActionForm action={action} submitLabel="Opslaan" submitClass={canWrite ? "btn primary" : "btn primary hidden"}>
          <div className="double-field mt-12">
            {FIELDS.map((f) => (
              <div className="form-line" key={f.key}>
                <label htmlFor={`ue-${f.name}`}>{f.label} ({f.suffix})</label>
                <input
                  className="field num"
                  id={`ue-${f.name}`}
                  name={f.name}
                  inputMode="decimal"
                  defaultValue={initial[f.key] ?? ""}
                  disabled={!canWrite}
                  onChange={(e) => setV((x) => ({ ...x, [f.key]: e.target.value === "" ? null : Number(e.target.value.replace(",", ".")) }))}
                />
              </div>
            ))}
          </div>
        </ActionForm>
      </div>
      <div className="card">
        <h3>Wat betekent dat?</h3>
        <div className="data-row"><span>Brutomarge per klant per jaar</span><strong className="num">{eur(r.marginPerCustomerYear)}</strong></div>
        <div className="data-row"><span>Terugverdientijd wervingskosten</span><strong className="num">{r.paybackMonths == null ? "onbekend" : `${r.paybackMonths.toFixed(1)} maanden`}</strong></div>
        <div className="data-row"><span>Klantwaarde (marge × levensduur)</span><strong className="num">{eur(r.lifetimeValue)}</strong></div>
        <div className="data-row"><span>Klantwaarde / wervingskosten</span><strong className="num">{r.ltvToCac == null ? "onbekend" : `${r.ltvToCac.toFixed(1)}×`}</strong></div>
        <div className="data-row"><span>Klanten nodig voor break-even</span><strong className="num">{r.breakEvenCustomers == null ? "onbekend" : r.breakEvenCustomers.toLocaleString("nl-NL")}</strong></div>
        {r.warnings.map((w) => <div className="note" key={w}>{w}</div>)}
        {r.missing.length > 0 && <div className="note">Nog onbekend: {r.missing.join(", ")}. Deze waarden zijn scenario-invoer, geen bewezen cijfers.</div>}
      </div>
    </div>
  );
}
