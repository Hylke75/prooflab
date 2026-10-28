"use client";

import { useMemo, useState } from "react";
import { ActionForm, type FormState } from "@/components/ui/ActionForm";
import { Icon } from "@/components/Icon";
import { EXPERIMENT_TYPES, HONEST_REVEAL, NEUTRAL_INTERVIEW_GUIDE, type ExperimentType } from "@/lib/domain/labels";
import { checkHypothesis } from "@/lib/domain/hypothesis";
import { testCardDefaults, type Option } from "@/lib/domain/recommend";
import { wilson } from "@/lib/domain/stats";
import { CHANNELS } from "@/lib/domain/tracking";

type Assumption = { id: string; statement: string };
type Action = (s: FormState, f: FormData) => Promise<FormState>;

function minSuccesses(n: number, thresholdPct: number): number | null {
  for (let s = 0; s <= n; s++) if (wilson(s, n).low >= thresholdPct / 100) return s;
  return null;
}

export function ExperimentBuilder({
  assumptions,
  initialAssumption,
  options,
  warning,
  audience,
  action,
}: {
  assumptions: Assumption[];
  initialAssumption: string;
  options: Option[];
  warning: string | null;
  audience: string;
  action: Action;
}) {
  const [assumptionId, setAssumptionId] = useState(initialAssumption);
  const assumption = assumptions.find((a) => a.id === assumptionId) ?? assumptions[0];
  const [tier, setTier] = useState(0);
  const type: ExperimentType = options[tier].type;
  const defaults = useMemo(() => testCardDefaults(type, assumption.statement, audience), [type, assumption.statement, audience]);
  const [card, setCard] = useState(defaults);
  const [lastKey, setLastKey] = useState(`${type}|${assumption.id}`);
  if (lastKey !== `${type}|${assumption.id}`) {
    setLastKey(`${type}|${assumption.id}`);
    setCard(defaults);
  }
  const [page, setPage] = useState({
    headline: "",
    subline: "",
    offer: "",
    cta_label: type === "interview" ? "Plan een gesprek" : type === "pricing" ? "Kies dit aanbod" : "Vraag een demo aan",
    product_name: "",
  });
  const [prices, setPrices] = useState([
    { label: "Basis", amount: "", period: "per maand" },
    { label: "Plus", amount: "", period: "per maand" },
    { label: "", amount: "", period: "per maand" },
  ]);
  const [channels, setChannels] = useState<string[]>(["linkedin", "network"]);
  const [reach, setReach] = useState("");

  const coach = checkHypothesis({
    ...card,
    success_threshold_pct: Number(card.success_threshold_pct),
    fail_threshold_pct: card.fail_threshold_pct === null ? null : Number(card.fail_threshold_pct),
    min_sample: Number(card.min_sample),
    max_duration_days: Number(card.max_duration_days),
  });
  const n = Number(card.min_sample) || 0;
  const needed = n > 0 ? minSuccesses(n, Number(card.success_threshold_pct)) : null;
  const reachN = Number(reach) || 0;
  const set = (k: keyof typeof card, v: string) => setCard((c) => ({ ...c, [k]: v }));

  return (
    <>
      <div className="card">
        <div className="section-title">
          <div>
            <h3>Welk experiment past bij jouw vraag?</h3>
            <p className="sub" style={{ marginTop: 5 }}>Drie voorstellen, elk met een ander soort bewijs.</p>
          </div>
          <span className="pill blue">Aanbeveling</span>
        </div>
        <label className="field-label" htmlFor="as-select" style={{ marginTop: 6 }}>Aanname die je toetst</label>
        <select className="field" id="as-select" value={assumption.id} onChange={(e) => setAssumptionId(e.target.value)}>
          {assumptions.map((a) => <option key={a.id} value={a.id}>{a.statement}</option>)}
        </select>
        {warning && <div className="note">{warning}</div>}
        <div className="exp-options" role="radiogroup" aria-label="Experimenttype">
          {options.map((o, i) => (
            <button key={o.tier} type="button" role="radio" aria-checked={tier === i} className={`exp-option${tier === i ? " selected" : ""}`} onClick={() => setTier(i)}>
              <span className="exp-ico">{EXPERIMENT_TYPES[o.type].icon}</span>
              <span className="pill gray" style={{ marginBottom: 8 }}>{o.tier}</span>
              <strong>{EXPERIMENT_TYPES[o.type].label}</strong>
              <small>{o.why}</small>
            </button>
          ))}
        </div>
        <div className="grid-3" style={{ gap: 12 }}>
          <div><div className="tiny">Wat leer je?</div><p style={{ fontSize: 12 }}>{options[tier].learn}</p></div>
          <div><div className="tiny">Wat kun je níét concluderen?</div><p style={{ fontSize: 12 }}>{options[tier].cannotConclude}</p></div>
          <div>
            <div className="tiny">Inzet · looptijd · kosten · bewijs</div>
            <p style={{ fontSize: 12 }}>{options[tier].effort} · {options[tier].duration} · {options[tier].cost} · {options[tier].strength}</p>
          </div>
        </div>
        <p className="tiny mt-8">Kan de uitkomst de beslissing veranderen? {options[tier].canChangeDecision}</p>
      </div>

      <ActionForm action={action} submitLabel="Test Card opslaan als concept" pendingLabel="Opslaan…" className="grid-2" submitClass="btn primary hidden">
        <input type="hidden" name="assumption_id" value={assumption.id} />
        <input type="hidden" name="type" value={type} />
        <div className="card" style={{ marginTop: 18 }}>
          <div className="section-title"><h3>Jouw Test Card</h3><span className="pill gray">Concept</span></div>
          <div className="form-line"><label htmlFor="tc-title">Naam van het experiment</label><input className="field" id="tc-title" name="title" defaultValue={`${EXPERIMENT_TYPES[type].label}: ${assumption.statement.slice(0, 60)}`} key={`t-${type}-${assumption.id}`} /></div>
          <div className="form-line"><label htmlFor="tc-believe">Wij denken dat…</label><textarea className="field" id="tc-believe" name="we_believe" rows={3} value={card.we_believe} onChange={(e) => set("we_believe", e.target.value)} /></div>
          <div className="form-line"><label htmlFor="tc-target">Bij wie?</label><input className="field" id="tc-target" name="target_group" value={card.target_group} onChange={(e) => set("target_group", e.target.value)} /></div>
          <div className="form-line"><label htmlFor="tc-method">Dat toetsen we door…</label><input className="field" id="tc-method" name="test_method" value={card.test_method} onChange={(e) => set("test_method", e.target.value)} /></div>
          <div className="form-line"><label htmlFor="tc-metric">En we meten…</label><input className="field" id="tc-metric" name="metric_label" value={card.metric_label} onChange={(e) => set("metric_label", e.target.value)} /></div>
          <div className="double-field">
            <div className="form-line"><label htmlFor="tc-num">Teller</label><input className="field" id="tc-num" name="metric_numerator" value={card.metric_numerator} onChange={(e) => set("metric_numerator", e.target.value)} /></div>
            <div className="form-line"><label htmlFor="tc-den">Noemer</label><input className="field" id="tc-den" name="metric_denominator" value={card.metric_denominator} onChange={(e) => set("metric_denominator", e.target.value)} /></div>
          </div>
          <div className="double-field">
            <div className="form-line"><label htmlFor="tc-succ">Het klopt als ≥ (%)</label><input className="field num" id="tc-succ" name="success_threshold_pct" type="number" min={1} max={100} value={card.success_threshold_pct} onChange={(e) => set("success_threshold_pct", e.target.value)} /></div>
            <div className="form-line"><label htmlFor="tc-fail">Het klopt niet als &lt; (%)</label><input className="field num" id="tc-fail" name="fail_threshold_pct" type="number" min={0} max={100} value={card.fail_threshold_pct ?? ""} onChange={(e) => set("fail_threshold_pct", e.target.value)} /></div>
          </div>
          <div className="double-field">
            <div className="form-line"><label htmlFor="tc-n">Minimale steekproef</label><input className="field num" id="tc-n" name="min_sample" type="number" min={5} value={card.min_sample} onChange={(e) => set("min_sample", e.target.value)} /></div>
            <div className="form-line"><label htmlFor="tc-days">Maximale looptijd (dagen)</label><input className="field num" id="tc-days" name="max_duration_days" type="number" min={1} max={180} value={card.max_duration_days} onChange={(e) => set("max_duration_days", e.target.value)} /></div>
          </div>
          {needed !== null ? (
            <div className="note" style={{ marginTop: 0 }}>
              Met {n} deelnemers is &quot;geslaagd&quot; pas vast te stellen bij minimaal <strong>{needed}</strong> keer {card.metric_label.toLowerCase()} ({Math.round((needed / n) * 100)}%).
              Daaronder blijft het onbeslist.
            </div>
          ) : (
            <div className="note" style={{ marginTop: 0 }}>Met deze steekproef is de succesdrempel niet aantoonbaar te halen. Verhoog de steekproef.</div>
          )}
          <div className="form-line"><label htmlFor="tc-bias">Verwachte vertekeningen</label><input className="field" id="tc-bias" name="expected_biases" value={card.expected_biases} onChange={(e) => set("expected_biases", e.target.value)} /></div>
          <fieldset className="form-line" style={{ border: 0, padding: 0, margin: "0 0 15px" }}>
            <legend style={{ fontSize: 12, fontWeight: 800, marginBottom: 6 }}>Wervingskanalen</legend>
            <div className="row">
              {Object.entries(CHANNELS).filter(([k]) => k !== "direct").map(([k, v]) => (
                <label key={k} className="check-row" style={{ margin: "2px 10px 2px 0" }}>
                  <input type="checkbox" name="channels" value={k} checked={channels.includes(k)} onChange={(e) => setChannels((c) => (e.target.checked ? [...c, k] : c.filter((x) => x !== k)))} /> {v}
                </label>
              ))}
            </div>
          </fieldset>
          <div className="double-field">
            <div className="form-line"><label htmlFor="tc-reach">Verwacht bereik (personen)</label><input className="field num" id="tc-reach" name="expected_reach" type="number" min={0} value={reach} onChange={(e) => setReach(e.target.value)} /></div>
            <div className="form-line"><label htmlFor="tc-cost">Verwachte kosten (€)</label><input className="field num" id="tc-cost" name="cost_estimate_eur" type="number" min={0} defaultValue={0} /></div>
          </div>
          {reachN > 0 && reachN < n && <div className="form-error">Het verwachte bereik ({reachN}) haalt de minimale steekproef ({n}) niet. Voeg een kanaal toe of verleng de looptijd.</div>}
          {!coach.ok && (
            <div className="note">
              <strong>Hypothesecoach:</strong>
              <ul style={{ margin: "6px 0 0 16px", padding: 0 }}>{coach.issues.map((i) => <li key={i.message}>{i.message}</li>)}</ul>
            </div>
          )}
          <div className="note">Je legt deze criteria vast vóór de test. Na goedkeuring zijn ze vergrendeld; wijzigen kan alleen met een nieuwe versie en een motivering.</div>
          <button className="btn primary" style={{ marginTop: 18, width: "100%" }} disabled={!coach.ok}>
            Test Card opslaan als concept <Icon name="arrow" size="sm" />
          </button>
        </div>

        <div className="card" style={{ marginTop: 18 }}>
          <div className="section-title"><h3>Zo ziet jouw experiment eruit</h3><span className="pill blue">Live preview</span></div>
          {type === "interview" ? (
            <>
              <div className="form-line">
                <label htmlFor="tc-guide">Gespreksleidraad (één vraag per regel)</label>
                <textarea className="field" id="tc-guide" name="guide" rows={9} defaultValue={NEUTRAL_INTERVIEW_GUIDE.join("\n")} />
                <p className="field-hint">Vragen over gedrag in het verleden. Geen pitch en geen &quot;zou je dit kopen?&quot;.</p>
              </div>
              <div className="form-line">
                <label htmlFor="tc-screen">Selectiecriteria en uitsluitingen</label>
                <textarea className="field" id="tc-screen" name="screener" rows={3} placeholder="Bijv. organiseert minstens 4 zakelijke events per jaar; geen vrienden of collega's" />
              </div>
            </>
          ) : (
            <>
              <div className="preview-mini">
                <div className="preview-tag">{type === "pricing" ? "PRIJS-/AANBODTEST" : "LANDINGPAGE"}</div>
                <h3>{page.headline || "Jouw kop verschijnt hier."}</h3>
                <p>{page.subline || "Eén concrete belofte voor één doelgroep."}</p>
                {type === "pricing" && (
                  <div className="row" style={{ justifyContent: "center", marginBottom: 14 }}>
                    {prices.filter((p) => p.label && p.amount).map((p, i) => (
                      <span key={i} className="pill gray">{p.label}: € {p.amount} {p.period}</span>
                    ))}
                  </div>
                )}
                <span className="btn dark sm">{page.cta_label} →</span>
              </div>
              <div className="form-line mt-12"><label htmlFor="pg-name">Naam van het aanbod (merkneutraal)</label><input className="field" id="pg-name" name="product_name" value={page.product_name} onChange={(e) => setPage({ ...page, product_name: e.target.value })} /></div>
              <div className="form-line"><label htmlFor="pg-head">Kop</label><input className="field" id="pg-head" name="headline" value={page.headline} onChange={(e) => setPage({ ...page, headline: e.target.value })} /></div>
              <div className="form-line"><label htmlFor="pg-sub">Ondertitel</label><input className="field" id="pg-sub" name="subline" value={page.subline} onChange={(e) => setPage({ ...page, subline: e.target.value })} /></div>
              <div className="form-line"><label htmlFor="pg-offer">Aanbod (wat krijgt iemand precies?)</label><textarea className="field" id="pg-offer" name="offer" rows={3} value={page.offer} onChange={(e) => setPage({ ...page, offer: e.target.value })} /></div>
              <div className="form-line"><label htmlFor="pg-cta">Knoptekst</label><input className="field" id="pg-cta" name="cta_label" value={page.cta_label} onChange={(e) => setPage({ ...page, cta_label: e.target.value })} /></div>
              {type === "pricing" &&
                prices.map((p, i) => (
                  <div className="double-field" key={i}>
                    <div className="form-line"><label htmlFor={`pp-l-${i}`}>Prijspunt {i + 1}: naam</label><input className="field" id={`pp-l-${i}`} name={`price_label_${i}`} value={p.label} onChange={(e) => setPrices(prices.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} /></div>
                    <div className="form-line"><label htmlFor={`pp-a-${i}`}>Bedrag (€) en periode</label>
                      <div className="row" style={{ flexWrap: "nowrap" }}>
                        <input className="field num" id={`pp-a-${i}`} name={`price_amount_${i}`} inputMode="decimal" value={p.amount} onChange={(e) => setPrices(prices.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)))} />
                        <input className="field" aria-label={`Periode prijspunt ${i + 1}`} name={`price_period_${i}`} value={p.period} onChange={(e) => setPrices(prices.map((x, j) => (j === i ? { ...x, period: e.target.value } : x)))} />
                      </div>
                    </div>
                  </div>
                ))}
              <label className="check-row"><input type="checkbox" name="collect_email" defaultChecked={type === "landing"} /> Na de klik om een e-mailadres vragen (met toestemming)</label>
              <div className="form-line"><label htmlFor="pg-reveal">Bericht na de klik</label><textarea className="field" id="pg-reveal" name="reveal_message" rows={3} defaultValue="Bedankt! We nemen contact op zodra we kunnen starten." /></div>
              <p className="field-hint">Na elke klik toont ProofLab altijd ook: “{HONEST_REVEAL}” Dit is niet uit te zetten.</p>
            </>
          )}
        </div>
      </ActionForm>
    </>
  );
}
