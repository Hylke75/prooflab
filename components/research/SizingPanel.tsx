"use client";

import { useMemo, useState } from "react";
import { ActionForm, type FormState } from "@/components/ui/ActionForm";
import { computeSizing, MODEL_FACTORS, SCENARIO_LABELS, type ScenarioKind, type SizingModel } from "@/lib/domain/sizing";
import { CLAIM_STATUS, type ClaimStatus } from "@/lib/domain/labels";

type Factor = { key: string; label: string; unit: string; value: number; claim_id: string | null; note: string | null };
type Scenario = { id: string; kind: ScenarioKind; model: SizingModel; factors: Factor[] };
type Claim = { id: string; statement: string; status: ClaimStatus; numeric_value: number | null };
type Action = (s: FormState, f: FormData) => Promise<FormState>;

const eur = (n: number) => `€ ${Math.round(n).toLocaleString("nl-NL")}`;
const int = (n: number) => Math.round(n).toLocaleString("nl-NL");

// Deterministic, live recalculation: no LLM involved. Each factor shows its provenance.
export function SizingPanel({ scenarios, claims, actions, canWrite }: { scenarios: Scenario[]; claims: Claim[]; actions: Record<string, Action>; canWrite: boolean }) {
  const order: ScenarioKind[] = ["conservative", "realistic", "optimistic"];
  const sorted = order.map((k) => scenarios.find((s) => s.kind === k)).filter(Boolean) as Scenario[];
  const [kind, setKind] = useState<ScenarioKind>("realistic");
  const scenario = sorted.find((s) => s.kind === kind) ?? sorted[0];
  const [values, setValues] = useState<Record<string, Record<string, { value: number; claim: string }>>>(() =>
    Object.fromEntries(sorted.map((s) => [s.id, Object.fromEntries(s.factors.map((f) => [f.key, { value: f.value, claim: f.claim_id ?? "" }]))])),
  );
  const current = useMemo(() => (scenario ? values[scenario.id] : {}), [scenario, values]);
  const result = useMemo(() => {
    if (!scenario) return null;
    return computeSizing(
      scenario.model,
      scenario.factors.map((f) => ({
        key: f.key,
        value: current[f.key]?.value ?? 0,
        claimStatus: claims.find((c) => c.id === current[f.key]?.claim)?.status ?? null,
      })),
    );
  }, [scenario, current, claims]);

  if (!scenario || !result) return <div className="empty-state"><p>Geen scenario&apos;s gevonden.</p></div>;
  const set = (key: string, patch: Partial<{ value: number; claim: string }>) =>
    setValues((v) => ({ ...v, [scenario.id]: { ...v[scenario.id], [key]: { ...v[scenario.id][key], ...patch } } }));

  return (
    <>
      <div className="section-title">
        <div>
          <h2>Hoe groot kan de markt zijn?</h2>
          <p className="sub">Geen willekeurig AI-getal. Een berekening van onderaf, met per factor een bron of het label &quot;nog te toetsen&quot;.</p>
        </div>
        <span className={`pill ${result.established ? "blue" : "orange"}`}>{result.label}</span>
      </div>
      <div className="scenario-tabs" role="group" aria-label="Scenario">
        {sorted.map((s) => (
          <button key={s.id} className={`filter-btn${s.kind === kind ? " active" : ""}`} aria-pressed={s.kind === kind} onClick={() => setKind(s.kind)}>
            {SCENARIO_LABELS[s.kind].label}
          </button>
        ))}
      </div>
      <div className="grid-2">
        <div className="card">
          <h3>{SCENARIO_LABELS[scenario.kind].label} scenario</h3>
          <p className="sub" style={{ marginTop: 7 }}>{SCENARIO_LABELS[scenario.kind].meaning}. Pas de waarden aan en zie direct wat dat betekent.</p>
          <ActionForm key={scenario.id} action={actions[scenario.id]} submitLabel="Scenario opslaan" submitClass={canWrite ? "btn primary" : "btn primary hidden"}>
            <div className="scenario-inputs">
              {MODEL_FACTORS[scenario.model].map((def) => {
                const f = current[def.key] ?? { value: 0, claim: "" };
                const linked = claims.find((c) => c.id === f.claim);
                return (
                  <div key={def.key} className="factor">
                    <label htmlFor={`f-${def.key}`}>
                      {def.label}
                      <small>{def.hint}</small>
                      <small>
                        {linked ? (
                          <span className={`pill ${CLAIM_STATUS[linked.status].pill}`} style={{ marginTop: 5 }}>
                            Bron: {CLAIM_STATUS[linked.status].label}
                          </span>
                        ) : (
                          <span className="pill orange" style={{ marginTop: 5 }}>Nog te toetsen</span>
                        )}
                      </small>
                      {canWrite && (
                        <select className="field" style={{ marginTop: 6, padding: "8px 30px 8px 10px", fontSize: 11 }} name={`claim_${def.key}`} value={f.claim} onChange={(e) => {
                          const c = claims.find((x) => x.id === e.target.value);
                          set(def.key, { claim: e.target.value, ...(c?.numeric_value != null ? { value: c.numeric_value } : {}) });
                        }} aria-label={`Bron voor ${def.label}`}>
                          <option value="">Aanname (geen bron)</option>
                          {claims.map((c) => (
                            <option key={c.id} value={c.id}>{c.statement.slice(0, 70)}</option>
                          ))}
                        </select>
                      )}
                    </label>
                    <input
                      className="field num"
                      id={`f-${def.key}`}
                      name={`value_${def.key}`}
                      type="number"
                      min={0}
                      max={def.unit === "percent" ? 100 : undefined}
                      step="any"
                      value={Number.isFinite(f.value) ? f.value : 0}
                      onChange={(e) => set(def.key, { value: Number(e.target.value) })}
                      disabled={!canWrite}
                      aria-describedby={`u-${def.key}`}
                    />
                    <span id={`u-${def.key}`} className="sr-only">{def.unit === "percent" ? "procent" : def.unit === "eur" ? "euro" : def.unit === "per_year" ? "per jaar" : "aantal"}</span>
                  </div>
                );
              })}
            </div>
          </ActionForm>
        </div>
        <div className="card calc-dark">
          <div className="eyebrow" style={{ color: "#c5df93" }}>{result.label.toUpperCase()}</div>
          <p style={{ color: "#b3bfd2", margin: "13px 0 3px", fontSize: 12 }}>Bereikbare jaaromzet (SOM) in dit scenario</p>
          <div className="num" style={{ font: "700 39px var(--font-space-grotesk),sans-serif", letterSpacing: "-.06em" }}>{eur(result.somRevenue)}</div>
          <div className="divider" />
          <div className="kpi-row" style={{ gridTemplateColumns: "repeat(3,1fr)" }}>
            <div><p style={{ color: "#b5bfd0", fontSize: 11 }}>TAM (aantal)</p><strong className="num">{int(result.tamCount)}</strong></div>
            <div><p style={{ color: "#b5bfd0", fontSize: 11 }}>SAM (aantal)</p><strong className="num">{int(result.samCount)}</strong></div>
            <div><p style={{ color: "#b5bfd0", fontSize: 11 }}>SOM (klanten)</p><strong className="num">{int(result.somCount)}</strong></div>
          </div>
          <p style={{ color: "#b5bfd0", fontSize: 12, marginTop: 16 }}>Formule</p>
          <div className="calc-formula">{result.formula} = {eur(result.somRevenue)}</div>
          <span className="pill dark">
            {result.provenance.sourced} van {result.provenance.total} factoren met bron · {result.provenance.assumed} aangenomen
          </span>
          <p style={{ color: "#b5bfd0", fontSize: 11, marginTop: 14, lineHeight: 1.6 }}>
            Aantallen, omzet en winst zijn verschillende dingen: dit is omzetpotentieel, geen winst en geen voorspelling.
          </p>
        </div>
      </div>
    </>
  );
}
