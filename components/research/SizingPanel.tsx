"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ActionForm, type FormState } from "@/components/ui/ActionForm";
import { computeSizing, factorConsistency, MODEL_FACTORS, SCENARIO_LABELS, simulateSizing, type FactorUnit, type ScenarioKind, type SizingModel } from "@/lib/domain/sizing";
import { CLAIM_STATUS, type ClaimStatus } from "@/lib/domain/labels";
import { numericFromInput } from "@/lib/domain/verify";
import { Term } from "@/components/ui/Term";
import { Detail } from "@/components/shell/ViewMode";
import { CbsFactorButton, type CbsActions } from "@/components/research/CbsFactorPicker";

type Factor = {
  key: string;
  label: string;
  unit: string;
  value: number;
  claim_id: string | null;
  note: string | null;
  low?: number | null;
  high?: number | null;
  year?: number | null;
  region?: string | null;
};
type Scenario = { id: string; kind: ScenarioKind; model: SizingModel; factors: Factor[] };
type Claim = { id: string; statement: string; status: ClaimStatus; numeric_value: number | null; region?: string | null; reference_date?: string | null };
type Action = (s: FormState, f: FormData) => Promise<FormState>;
type FactorState = { value: number; claim: string; low: string; high: string; year: string; region: string };
const EMPTY: FactorState = { value: 0, claim: "", low: "", high: "", year: "", region: "" };
// Jaar uit een peildatum ("2025-06" → "2025"); leeg als die onbekend is.
const yearOf = (ref: string | null | undefined) => (ref && /^\d{4}/.test(ref) ? ref.slice(0, 4) : "");
const knownText = (v: string | null | undefined) => (v && v.trim().toLowerCase() !== "onbekend" ? v : "");

// De waarden zoals ze op de server staan; de vergelijkingsbasis voor "Niet opgeslagen".
const fromServer = (f: Factor): FactorState => ({
  value: f.value,
  claim: f.claim_id ?? "",
  low: f.low == null ? "" : String(f.low),
  high: f.high == null ? "" : String(f.high),
  year: f.year == null ? "" : String(f.year),
  region: f.region ?? "",
});
const sameFactor = (a: FactorState, b: FactorState) =>
  a.value === b.value && a.claim === b.claim && a.low.trim() === b.low.trim() && a.high.trim() === b.high.trim() && a.year.trim() === b.year.trim() && a.region.trim() === b.region.trim();

// Na "Scenario opslaan" bouwt de pagina dit paneel opnieuw op (de key in de pagina hangt aan de opgeslagen waarden), waardoor
// de bevestiging van het formulier verdween en het paneel terugsprong naar Realistisch. Daarom bewaart de opslaan-actie
// hier kort wat de nieuwe instantie moet laten zien: de bevestiging, het gekozen scenario en nog niet opgeslagen
// wijzigingen in de andere scenario's.
type SavedFlash = { scenarioId: string; kind: ScenarioKind; message: string; at: number; carry: Record<string, Record<string, FactorState>> };
let savedFlash: SavedFlash | null = null;
const FLASH_MS = 10_000;

const eur = (n: number) => `€ ${Math.round(n).toLocaleString("nl-NL")}`;
const int = (n: number) => Math.round(n).toLocaleString("nl-NL");
const unitWord = (u: string) => (u === "percent" ? "procent" : u === "eur" ? "euro" : u === "per_year" ? "per jaar" : "aantal");
const unitShort = (u: string) => (u === "percent" ? "%" : u === "eur" ? "€" : u === "per_year" ? "× per jaar" : "aantal");
// Same reading as the server: "41.230" is forty-one thousand, "2,5" is two and a half.
const num = (s: string) => numericFromInput(s);

// Deterministic, live recalculation: no LLM involved. Each factor shows its provenance. Optional 90%
// ranges per factor feed a seeded Monte Carlo simulation (research 3.8).
export function SizingPanel({
  scenarios,
  claims,
  actions,
  canWrite,
  breakEvenRevenue = null,
  intakePrice = null,
  adoptIntakePrice = null,
  cbsActions = null,
}: {
  scenarios: Scenario[];
  claims: Claim[];
  actions: Record<string, Action>;
  canWrite: boolean;
  breakEvenRevenue?: number | null;
  // Gebruikerstest D5: de prijs uit de intake als jaaromzet per klant (aanname), en de actie om hem over te nemen.
  intakePrice?: { value: number; note: string; offer: string } | null;
  adoptIntakePrice?: Action | null;
  // Fase 2, punt 6: "Haal uit CBS" bij factoren met een aantal of percentage.
  cbsActions?: CbsActions | null;
}) {
  const order: ScenarioKind[] = ["conservative", "realistic", "optimistic"];
  const sorted = order.map((k) => scenarios.find((s) => s.kind === k)).filter(Boolean) as Scenario[];
  // Bevestiging van een opslag vlak voor deze (nieuwe) instantie; alleen als die net is gezet.
  const [flash, setFlash] = useState<SavedFlash | null>(() =>
    savedFlash && Date.now() - savedFlash.at < FLASH_MS && sorted.some((s) => s.id === savedFlash!.scenarioId) ? savedFlash : null,
  );
  useEffect(() => {
    savedFlash = null;
  }, []);
  const [kind, setKind] = useState<ScenarioKind>(flash?.kind ?? "realistic");
  const scenario = sorted.find((s) => s.kind === kind) ?? sorted[0];
  const [values, setValues] = useState<Record<string, Record<string, FactorState>>>(() =>
    Object.fromEntries(
      sorted.map((s) => [s.id, { ...Object.fromEntries(s.factors.map((f) => [f.key, fromServer(f)])), ...(flash?.carry[s.id] ?? {}) }]),
    ),
  );
  // Fase 2 · bevinding 5: welke factoren wijken af van wat er is opgeslagen, per scenario.
  const unsaved = useMemo(
    () =>
      Object.fromEntries(
        sorted.map((s) => [s.id, s.factors.filter((f) => values[s.id]?.[f.key] && !sameFactor(values[s.id][f.key], fromServer(f))).map((f) => f.key)]),
      ) as Record<string, string[]>,
    [sorted, values],
  );
  const anyUnsaved = canWrite && Object.values(unsaved).some((keys) => keys.length > 0);
  // Waarschuw bij vertrek (sluiten, herladen, andere site) zolang er niet-opgeslagen wijzigingen zijn.
  useEffect(() => {
    if (!anyUnsaved) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [anyUnsaved]);
  const scenarioId = scenario?.id ?? "";
  const scenarioKind = scenario?.kind ?? "realistic";
  const baseAction = actions[scenarioId];
  // De opslaan-actie zet de bevestiging klaar voor het geval de pagina dit paneel opnieuw opbouwt.
  const saveAction = useCallback<Action>(
    async (state, form) => {
      const res = await baseAction(state, form);
      if (res.ok && !res.error) {
        const carry = Object.fromEntries(
          Object.entries(unsaved)
            .filter(([id, keys]) => id !== scenarioId && keys.length > 0)
            .map(([id, keys]) => [id, Object.fromEntries(keys.map((k) => [k, values[id][k]]))]),
        );
        savedFlash = { scenarioId, kind: scenarioKind, message: res.ok, at: Date.now(), carry };
      }
      return res;
    },
    [baseAction, scenarioId, scenarioKind, unsaved, values],
  );
  const [threshold, setThreshold] = useState(breakEvenRevenue == null ? "" : String(Math.round(breakEvenRevenue)));
  const current = useMemo(() => (scenario ? values[scenario.id] : {}), [scenario, values]);
  const result = useMemo(() => {
    if (!scenario) return null;
    return computeSizing(
      scenario.model,
      scenario.factors.map((f) => ({
        key: f.key,
        value: current[f.key]?.value ?? 0,
        claimStatus: claims.find((c) => c.id === current[f.key]?.claim)?.status ?? null,
        claimValue: claims.find((c) => c.id === current[f.key]?.claim)?.numeric_value ?? null,
      })),
    );
  }, [scenario, current, claims]);
  const thresholdValue = num(threshold);
  // Golf C, punt 8: passen jaar en regio van de factoren bij elkaar? Zo niet: waarschuwing en bredere band.
  const consistency = useMemo(() => {
    if (!scenario) return null;
    return factorConsistency(
      scenario.factors.map((f) => {
        const y = current[f.key]?.year.trim() ?? "";
        return { key: f.key, label: f.label, year: /^\d{4}$/.test(y) ? Number(y) : null, region: current[f.key]?.region ?? null };
      }),
    );
  }, [scenario, current]);
  const sim = useMemo(() => {
    if (!scenario) return null;
    return simulateSizing(
      scenario.model,
      scenario.factors.map((f) => ({ key: f.key, value: current[f.key]?.value ?? 0, low: num(current[f.key]?.low ?? ""), high: num(current[f.key]?.high ?? "") })),
      { threshold: thresholdValue != null && Number.isFinite(thresholdValue) && thresholdValue >= 0 ? thresholdValue : null, widen: consistency?.widen ?? 1 },
    );
  }, [scenario, current, thresholdValue, consistency]);

  if (!scenario || !result) return <div className="empty-state"><p>Geen scenario&apos;s gevonden.</p></div>;
  const set = (key: string, patch: Partial<FactorState>) => {
    setFlash(null);
    setValues((v) => ({ ...v, [scenario.id]: { ...v[scenario.id], [key]: { ...v[scenario.id][key], ...patch } } }));
  };
  const unsavedHere = canWrite ? (unsaved[scenario.id] ?? []) : [];
  const defs = MODEL_FACTORS[scenario.model];
  const labelOf = (key: string) => defs.find((d) => d.key === key)?.label ?? key;
  const isBreakEven = breakEvenRevenue != null && thresholdValue != null && Math.round(breakEvenRevenue) === thresholdValue;
  const priceKey = scenario.model === "transactions" ? "ticket" : "revenue_per_customer";
  const original = (key: string) => scenario.factors.find((f) => f.key === key);
  // De toelichting (bijv. "Aanname uit intake …") blijft alleen staan zolang de waarde niet is aangepast.
  const noteFor = (key: string) => {
    const o = original(key);
    return o?.note && (current[key]?.value ?? 0) === o.value ? o.note : "";
  };
  const offerPrice = canWrite && intakePrice && adoptIntakePrice && scenario.model !== "transactions" && (current[priceKey]?.value ?? 0) === 0 ? intakePrice : null;
  const notEstablished = result.missing.length > 0;

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
            {canWrite && (unsaved[s.id]?.length ?? 0) > 0 && (
              <>
                {" "}
                <span aria-hidden="true">•</span>
                <span className="sr-only">(niet opgeslagen wijzigingen)</span>
              </>
            )}
          </button>
        ))}
      </div>
      <div className="grid-2">
        <div className="card">
          <h3>{SCENARIO_LABELS[scenario.kind].label} scenario</h3>
          <p className="sub" style={{ marginTop: 7 }}>
            {SCENARIO_LABELS[scenario.kind].meaning}. Pas de waarden aan en zie direct wat dat betekent. Weet je een factor niet precies, geef dan een bandbreedte waarbinnen hij met 90% zekerheid ligt.
          </p>
          <ActionForm key={scenario.id} action={saveAction} submitLabel="Scenario opslaan" submitClass={canWrite ? "btn primary" : "btn primary hidden"}>
            <div className="scenario-inputs">
              {defs.map((def) => {
                const f = current[def.key] ?? EMPTY;
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
                        {unsavedHere.includes(def.key) && (
                          <span className="pill coral" style={{ marginTop: 5, marginLeft: 6 }}>Niet opgeslagen</span>
                        )}
                      </small>
                      {canWrite && (
                        <select className="field" style={{ marginTop: 6, padding: "8px 30px 8px 10px", fontSize: 13 }} name={`claim_${def.key}`} value={f.claim} onChange={(e) => {
                          const c = claims.find((x) => x.id === e.target.value);
                          set(def.key, {
                            claim: e.target.value,
                            ...(c?.numeric_value != null ? { value: c.numeric_value } : {}),
                            // Jaar en regio van de gekoppelde bevinding, als die bekend zijn en het veld nog leeg is.
                            ...(c && !f.year && yearOf(c.reference_date) ? { year: yearOf(c.reference_date) } : {}),
                            ...(c && !f.region && knownText(c.region) ? { region: knownText(c.region) } : {}),
                          });
                        }} aria-label={`Bron voor ${def.label}`}>
                          <option value="">Aanname (geen bron)</option>
                          {claims.map((c) => (
                            <option key={c.id} value={c.id}>{c.statement.slice(0, 70)}</option>
                          ))}
                        </select>
                      )}
                      {canWrite && cbsActions && (def.unit === "count" || def.unit === "percent") && (
                        <CbsFactorButton actions={cbsActions} scenarioId={scenario.id} factor={{ key: def.key, label: def.label, unit: def.unit }} model={scenario.model} />
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
                    <span id={`u-${def.key}`} className="sr-only">{unitWord(def.unit)}</span>
                    <input type="hidden" name={`note_${def.key}`} value={noteFor(def.key)} />
                    {noteFor(def.key) && <small className="tiny" style={{ gridColumn: "1 / -1" }}>{noteFor(def.key)}</small>}
                    <RangeInputs def={def} f={f} canWrite={canWrite} onChange={(patch) => set(def.key, patch)} />
                    <OriginInputs def={def} f={f} canWrite={canWrite} onChange={(patch) => set(def.key, patch)} />
                  </div>
                );
              })}
            </div>
            {unsavedHere.length > 0 ? (
              <div className="form-feedback">
                <div className="note" role="status" style={{ margin: "16px 0 0" }}>
                  <strong>Niet opgeslagen.</strong> {unsavedHere.length === 1 ? "Eén factor wijkt" : `${unsavedHere.length} factoren wijken`} af van wat er is
                  bewaard. De berekening rekent al mee, maar pas na &quot;Scenario opslaan&quot; staat het in het dossier en het rapport.
                </div>
              </div>
            ) : (
              flash &&
              flash.scenarioId === scenario.id && (
                <div className="form-feedback">
                  <div className="form-ok" role="status">{flash.message}</div>
                </div>
              )
            )}
          </ActionForm>
          {offerPrice && (
            <div className="note" role="note">
              <strong>Jaaromzet per klant staat op 0.</strong> De intake noemt {offerPrice.offer}: dat is € {offerPrice.value.toLocaleString("nl-NL")} per jaar. Neem je die
              over, dan blijft het een aanname zonder bron (nog te toetsen), in alle drie de scenario&apos;s.
              <ActionForm action={adoptIntakePrice!} submitLabel="Neem intakeprijs over (aanname)" submitClass="btn white sm" pendingLabel="Overnemen…">
                <span />
              </ActionForm>
            </div>
          )}
        </div>
        <div className="card calc-dark">
          <div className="eyebrow" style={{ color: "var(--color-on-dark)" }}>{result.label}</div>
          <p style={{ color: "var(--color-on-dark-muted)", margin: "13px 0 3px", fontSize: 14 }}>Bereikbare jaaromzet (SOM) in dit scenario</p>
          <div className="num" style={{ font: "700 39px var(--font-heading),sans-serif", letterSpacing: "-.06em" }}>{notEstablished ? "Niet vastgesteld" : eur(result.somRevenue)}</div>
          {notEstablished && (
            <p style={{ color: "var(--color-on-dark-muted)", fontSize: 13, marginTop: 4 }}>Nog onbekend: {result.missing.map((m) => m.toLowerCase()).join(", ")}.</p>
          )}
          <div className="divider" />
          <div className="kpi-row" style={{ gridTemplateColumns: "repeat(3,1fr)" }}>
            <div><p style={{ color: "var(--color-on-dark-muted)", fontSize: 13 }}>Totale markt (<Term k="tam">TAM</Term>, aantal)</p><strong className="num">{result.countsKnown.tam ? int(result.tamCount) : "onbekend"}</strong></div>
            <div><p style={{ color: "var(--color-on-dark-muted)", fontSize: 13 }}>Bedienbare markt (<Term k="sam">SAM</Term>, aantal)</p><strong className="num">{result.countsKnown.sam ? int(result.samCount) : "onbekend"}</strong></div>
            <div><p style={{ color: "var(--color-on-dark-muted)", fontSize: 13 }}>Haalbare klanten (<Term k="som">SOM</Term>)</p><strong className="num">{result.countsKnown.som ? int(result.somCount) : "onbekend"}</strong></div>
          </div>
          <p style={{ color: "var(--color-on-dark-muted)", fontSize: 14, marginTop: 16 }}>Formule</p>
          <div className="calc-formula">{result.formula} = {notEstablished ? "niet vastgesteld" : eur(result.somRevenue)}</div>
          <span className="pill dark">
            {result.provenance.sourced} van {result.provenance.total} factoren met bron · {result.provenance.assumed} aangenomen
          </span>
          <p style={{ color: "var(--color-on-dark-muted)", fontSize: 13, marginTop: 14, lineHeight: 1.6 }}>
            Aantallen, omzet en winst zijn verschillende dingen: dit is omzetpotentieel, geen winst en geen voorspelling.
          </p>
        </div>
      </div>

      {consistency && consistency.warnings.length > 0 && (
        <div className="note" role="note">
          <strong>Factoren passen niet zonder meer bij elkaar.</strong> {consistency.warnings.join(" ")}
        </div>
      )}
      {consistency && consistency.warnings.length === 0 && (consistency.unknownYear.length > 0 || consistency.unknownRegion.length > 0) && (
        <p className="explain">
          Bij {Math.max(consistency.unknownYear.length, consistency.unknownRegion.length)} factor(en) is het jaar of de regio onbekend. Vul ze in, dan controleert ProofLab of de getallen bij elkaar passen.
        </p>
      )}

      {/* Fase 1 · punt 1: de Monte Carlo-bandbreedtes staan in Grondig; de berekening van de scenario's is gelijk. */}
      <Detail>
      <div className="card mt-18" aria-live="polite">
        <div className="section-title">
          <h3>Hoe zeker is dit? (simulatie)</h3>
          <span className="pill orange">Geschat · rust op aannames</span>
        </div>
        {!sim ? (
          <p className="sub">
            Geef bij één of meer factoren een 90%-bandbreedte op (van … tot …). ProofLab rekent dan 5.000 combinaties door en laat zien hoe breed de uitkomst is en welke factor de onzekerheid het meest bepaalt.
          </p>
        ) : (
          <>
            <p className="sub">
              {sim.draws.toLocaleString("nl-NL")} doorgerekende combinaties van de {sim.rangedFactors} factor(en) met een bandbreedte; de overige factoren staan vast op hun waarde.
              P10 betekent: in 10% van de combinaties is de uitkomst lager.
              {sim.widen > 1 ? ` De bandbreedtes zijn ${sim.widen.toLocaleString("nl-NL")}× verbreed, omdat de factoren in jaar of regio verschillen.` : ""}
            </p>
            <div style={{ overflowX: "auto" }}>
              <table className="table mt-12">
                <caption className="sr-only">Uitkomst van de simulatie</caption>
                <thead>
                  <tr><th scope="col">Uitkomst</th><th scope="col">P10 (laag)</th><th scope="col">P50 (midden)</th><th scope="col">P90 (hoog)</th></tr>
                </thead>
                <tbody>
                  <tr>
                    <th scope="row" style={{ fontWeight: 700, textAlign: "left" }}>Haalbare klanten (SOM)</th>
                    <td className="num">{int(sim.somCount.p10)}</td><td className="num">{int(sim.somCount.p50)}</td><td className="num">{int(sim.somCount.p90)}</td>
                  </tr>
                  <tr>
                    <th scope="row" style={{ fontWeight: 700, textAlign: "left" }}>Haalbare omzet (SOM, € per jaar)</th>
                    <td className="num">{eur(sim.somRevenue.p10)}</td><td className="num">{eur(sim.somRevenue.p50)}</td><td className="num">{eur(sim.somRevenue.p90)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div className="double-field mt-18">
              <div className="form-line">
                <label htmlFor="sim-threshold">Drempel voor de jaaromzet (€)</label>
                <input className="field num" id="sim-threshold" inputMode="decimal" value={threshold} onChange={(e) => setThreshold(e.target.value)} />
                <p className="explain">
                  {breakEvenRevenue != null
                    ? `Standaard de break-evenomzet uit de financiële haalbaarheid: ${eur(breakEvenRevenue)} per jaar (vaste kosten gedeeld door de brutomarge).`
                    : "Vul de vaste kosten en brutomarge in bij financiële haalbaarheid om hier de break-evenomzet te gebruiken."}
                </p>
              </div>
              <div className="live-stat">
                <span className="tiny">Kans dat de haalbare omzet (SOM) de drempel haalt</span>
                <strong className="num">{sim.pAboveThreshold == null ? "onbekend" : `${Math.round(sim.pAboveThreshold * 100)}%`}</strong>
                <span className="tiny">
                  {sim.pAboveThreshold == null
                    ? "Vul een drempel in."
                    : `Aandeel van de combinaties met een jaaromzet van minstens ${eur(sim.threshold ?? 0)}${isBreakEven ? " (break-even)" : ""}. Geschat, geen voorspelling.`}
                </span>
              </div>
            </div>
            <p className="field-label" style={{ marginTop: 6 }}>Wat bepaalt de onzekerheid het meest?</p>
            {sim.drivers.map((d, i) => (
              <div className="data-row" key={d.key}>
                <span>{i === 0 ? <strong>{labelOf(d.key)}</strong> : labelOf(d.key)}</span>
                <strong className="num" style={{ textAlign: "right" }}>
                  {eur(d.swing)} verschil · {Math.round(d.share * 100)}%
                </strong>
              </div>
            ))}
            <p className="explain">
              Per factor: het verschil in SOM-omzet tussen de onder- en bovengrens, met de andere factoren op hun waarde; het percentage is het geschatte aandeel in de totale spreiding.
              Onderzoek de bovenste factor eerst. Rekenwijze: {sim.method}; vaste startwaarde, dus dezelfde invoer geeft altijd dezelfde uitkomst.
            </p>
          </>
        )}
      </div>
      </Detail>
    </>
  );
}

function RangeInputs({
  def,
  f,
  canWrite,
  onChange,
}: {
  def: { key: string; label: string; unit: FactorUnit };
  f: FactorState;
  canWrite: boolean;
  onChange: (patch: Partial<FactorState>) => void;
}) {
  const low = num(f.low);
  const high = num(f.high);
  const problem =
    (low == null && f.low.trim() !== "") || (high == null && f.high.trim() !== "")
      ? "Gebruik een getal, bijvoorbeeld 2,5 of 12.000."
      : (f.low.trim() === "") !== (f.high.trim() === "")
      ? "Vul beide grenzen in, of laat ze allebei leeg."
      : low != null && high != null && low > high
        ? "De ondergrens is hoger dan de bovengrens."
        : low != null && high != null && (f.value < low || f.value > high)
          ? "De waarde ligt buiten de bandbreedte."
          : null;
  return (
    <div style={{ gridColumn: "1 / -1", display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", fontSize: 13, color: "var(--color-text-muted)" }}>
      <span id={`r-${def.key}`}>90%-bandbreedte (optioneel, {unitShort(def.unit)}):</span>
      <input
        className="field num"
        name={`low_${def.key}`}
        inputMode="decimal"
        value={f.low}
        onChange={(e) => onChange({ low: e.target.value })}
        disabled={!canWrite}
        aria-label={`Ondergrens ${def.label} (${unitWord(def.unit)})`}
        aria-describedby={problem ? `rp-${def.key}` : `r-${def.key}`}
        style={{ width: 96, padding: "8px 10px" }}
      />
      <span aria-hidden="true">tot</span>
      <input
        className="field num"
        name={`high_${def.key}`}
        inputMode="decimal"
        value={f.high}
        onChange={(e) => onChange({ high: e.target.value })}
        disabled={!canWrite}
        aria-label={`Bovengrens ${def.label} (${unitWord(def.unit)})`}
        aria-describedby={problem ? `rp-${def.key}` : `r-${def.key}`}
        style={{ width: 96, padding: "8px 10px" }}
      />
      {problem && <span id={`rp-${def.key}`} role="status" style={{ color: "var(--color-risk-text)", fontWeight: 700 }}>{problem}</span>}
    </div>
  );
}

// Jaar en regio van het getal (golf C, punt 8). Leeg betekent onbekend.
function OriginInputs({
  def,
  f,
  canWrite,
  onChange,
}: {
  def: { key: string; label: string };
  f: FactorState;
  canWrite: boolean;
  onChange: (patch: Partial<FactorState>) => void;
}) {
  const badYear = f.year.trim() !== "" && !/^\d{4}$/.test(f.year.trim());
  return (
    <div style={{ gridColumn: "1 / -1", display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", fontSize: 13, color: "var(--color-text-muted)" }}>
      <span id={`o-${def.key}`}>Jaar en regio van dit getal:</span>
      <input
        className="field num"
        name={`year_${def.key}`}
        inputMode="numeric"
        maxLength={4}
        placeholder="jaar"
        value={f.year}
        onChange={(e) => onChange({ year: e.target.value })}
        disabled={!canWrite}
        aria-label={`Jaar van ${def.label}`}
        aria-describedby={badYear ? `oy-${def.key}` : `o-${def.key}`}
        style={{ width: 80, padding: "8px 10px" }}
      />
      <input
        className="field"
        name={`region_${def.key}`}
        maxLength={120}
        placeholder="regio"
        value={f.region}
        onChange={(e) => onChange({ region: e.target.value })}
        disabled={!canWrite}
        aria-label={`Regio van ${def.label}`}
        aria-describedby={`o-${def.key}`}
        style={{ width: 150, padding: "8px 10px" }}
      />
      {badYear && <span id={`oy-${def.key}`} role="status" style={{ color: "var(--color-risk-text)", fontWeight: 700 }}>Schrijf het jaar als vier cijfers, bijvoorbeeld 2025.</span>}
    </div>
  );
}
