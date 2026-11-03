"use client";

import { useMemo, useState, useTransition } from "react";
import { ActionForm, type FormState } from "@/components/ui/ActionForm";
import { Icon } from "@/components/Icon";
import { EXPERIMENT_TYPES, HONEST_REVEAL, NEUTRAL_INTERVIEW_GUIDE, type ExperimentType } from "@/lib/domain/labels";
import { checkHypothesis } from "@/lib/domain/hypothesis";
import { testCardDefaults, type Option } from "@/lib/domain/recommend";
import { DECISION_RULES, PASS_PROBABILITY, FAIL_PROBABILITY, requiredSample, sampleFeasibility, wilson, type DecisionRule } from "@/lib/domain/stats";
import { CHANNELS } from "@/lib/domain/tracking";
import { METHODS, type MethodVersion } from "@/lib/domain/method";
import { RECRUITMENT_GROUPS, RECRUITMENT_KEYS, RECRUITMENT_REQUIRED_TYPES, recruitmentMissing, type RecruitmentGroup } from "@/lib/domain/recruitment";
import { auditGuide, guideSummary } from "@/lib/domain/interview-audit";
import { honestyWarnings, type PreparedVariant } from "@/lib/domain/copy-honesty";
import { GuideAuditList } from "@/components/experiments/InterviewAudit";
import { SurveyEditor, type SurveyDraftAction } from "@/components/survey/SurveyEditor";
import { SamplePlanner } from "@/components/survey/SamplePlanner";
import { templateSurvey, type SurveyConfig } from "@/lib/domain/survey";
import { metricFromKey, surveyErrors } from "@/lib/domain/survey-editor";

type VariantsResult = { error: string | null; variants: PreparedVariant[]; draftNotes: string[]; draftWarnings: string[] };
type VariantsAction = (input: { assumption_id: string; type: "landing" | "pricing"; headline: string; subline: string; offer: string }) => Promise<VariantsResult>;

// primary: de huidige hoofdtest van de aanname (locked = al goedgekeurd of gestart), of null.
type Assumption = { id: string; statement: string; primary?: { locked: boolean } | null };
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
  ideaTitle = "",
  aiConnected = false,
  variantsAction,
  initialType,
  researcher = "",
  surveyDraftAction,
  method = "2026-11-c",
}: {
  method?: MethodVersion;
  initialType?: ExperimentType;
  researcher?: string;
  surveyDraftAction?: SurveyDraftAction;
  ideaTitle?: string;
  aiConnected?: boolean;
  variantsAction?: VariantsAction;
  assumptions: Assumption[];
  initialAssumption: string;
  options: Option[];
  warning: string | null;
  audience: string;
  action: Action;
}) {
  const [assumptionId, setAssumptionId] = useState(initialAssumption);
  const assumption = assumptions.find((a) => a.id === assumptionId) ?? assumptions[0];
  const [tier, setTier] = useState(() => Math.max(0, options.findIndex((o) => o.type === initialType)));
  const type: ExperimentType = options[tier].type;
  // The survey is kept while switching assumption or test type; the Test Card metric follows its key question.
  const [survey, setSurvey] = useState<SurveyConfig>(() =>
    templateSurvey({ assumption: assumption.statement, audience: audience || "de doelgroep", researcher: researcher || "de onderzoeker", product: ideaTitle, screen: true }),
  );
  const surveyIssues = useMemo(() => (type === "survey" ? surveyErrors(survey) : []), [type, survey]);
  const defaults = useMemo(() => testCardDefaults(type, assumption.statement, audience), [type, assumption.statement, audience]);
  const withSurveyMetric = (d: typeof defaults, s: SurveyConfig) => (type === "survey" ? { ...d, ...metricFromKey(s) } : d);
  const [card, setCard] = useState(() => withSurveyMetric(defaults, survey));
  const [rule, setRule] = useState<DecisionRule>("probability");
  const [lastKey, setLastKey] = useState(`${type}|${assumption.id}`);
  if (lastKey !== `${type}|${assumption.id}`) {
    setLastKey(`${type}|${assumption.id}`);
    setCard(withSurveyMetric(defaults, survey));
    setRule("probability");
  }
  const updateSurvey = (next: SurveyConfig) => {
    setSurvey(next);
    const m = metricFromKey(next);
    const keyText = (s: SurveyConfig) => s.questions.find((q) => q.id === s.key_question)?.text ?? "";
    const keyChanged = next.key_question !== survey.key_question || next.success_options.join() !== survey.success_options.join() || keyText(next) !== keyText(survey);
    // Teller and noemer always follow the key question; the label only when the key question itself changed.
    setCard((c) => ({ ...c, metric_numerator: m.metric_numerator, metric_denominator: m.metric_denominator, metric_label: keyChanged ? m.metric_label : c.metric_label }));
  };
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
  const [successCount, setSuccessCount] = useState("3");
  const [expectedPct, setExpectedPct] = useState("");
  const [perWeek, setPerWeek] = useState("");
  const chooseRule = (r: DecisionRule) => {
    setRule(r);
    // Bij de aantalregel telt een gesprek alleen met een sterke handeling (aanbetaling of herhaalaankoop).
    setCard((c) =>
      r === "absolute"
        ? { ...c, metric_label: "Aanbetaling of herhaalaankoop", metric_numerator: "geïnterviewden die een aanbetaling deden of opnieuw kochten", metric_denominator: "geïnterviewden uit de doelgroep" }
        : { ...c, metric_label: defaults.metric_label, metric_numerator: defaults.metric_numerator, metric_denominator: defaults.metric_denominator },
    );
  };
  const [channels, setChannels] = useState<string[]>(["linkedin", "network"]);
  // Wervingsgroep (golf A, punt 13): verplicht bij enquête-, landing- en prijstests, zonder vooraf gekozen waarde.
  const [recruitment, setRecruitment] = useState<string>("");
  const recruitmentRequired = (RECRUITMENT_REQUIRED_TYPES as readonly string[]).includes(type);
  const [reach, setReach] = useState("");
  const [guide, setGuide] = useState(NEUTRAL_INTERVIEW_GUIDE.join("\n"));
  const audit = useMemo(() => auditGuide(guide.split("\n"), { productNames: [ideaTitle, page.product_name] }), [guide, ideaTitle, page.product_name]);
  const auditSum = guideSummary(audit);
  const [variants, setVariants] = useState<VariantsResult | null>(null);
  const [variantsPending, startVariants] = useTransition();
  const draftWarnings = honestyWarnings(page.headline, page.subline, page.offer);
  const askVariants = () => {
    if (!variantsAction || type === "interview" || type === "survey") return;
    startVariants(async () => {
      setVariants(await variantsAction({ assumption_id: assumption.id, type, headline: page.headline, subline: page.subline, offer: page.offer }));
    });
  };

  const coach = checkHypothesis({
    ...card,
    success_threshold_pct: rule === "absolute" && type === "interview" ? Math.max(0.1, Math.min(100, ((Number(successCount) || 0) / (Number(card.min_sample) || 1)) * 100)) : Number(card.success_threshold_pct),
    fail_threshold_pct: rule === "absolute" && type === "interview" ? null : card.fail_threshold_pct === null ? null : Number(card.fail_threshold_pct),
    min_sample: Number(card.min_sample),
    max_duration_days: Number(card.max_duration_days),
  });
  const n = Number(card.min_sample) || 0;
  const needed = n > 0 ? minSuccesses(n, Number(card.success_threshold_pct)) : null;
  // Beslisregel (methode 2026-11-b): vooraf rekenen hoeveel deelnemers nodig zijn bij de verwachte uitkomst.
  // Dossiers met methode 2026-11-a houden de intervalregel: geen beslisregel en geen vooraf berekend aantal.
  const v2 = METHODS[method].usesRules;
  const absoluteAllowed = v2 && type === "interview";
  const activeRule: DecisionRule = absoluteAllowed ? rule : "probability";
  const countN = Number(successCount) || 0;
  const thresholdPct = activeRule === "absolute" ? (n > 0 && countN > 0 ? Math.min(100, Math.round((countN / n) * 1000) / 10) : 0) : Number(card.success_threshold_pct);
  const expected = Number(expectedPct);
  const requiredN = expected > 0 && expected <= 100 ? requiredSample({ rule: activeRule, expectedPct: expected, thresholdPct, successCount: countN }) : undefined;
  const feasibility =
    requiredN === undefined ? null : sampleFeasibility({ requiredN, availablePerWeek: Number(perWeek) > 0 ? Number(perWeek) : null, maxDurationDays: Number(card.max_duration_days) || 0, minSample: n });
  const reachN = Number(reach) || 0;
  const set = (k: keyof typeof card, v: string) => setCard((c) => ({ ...c, [k]: v }));

  return (
    <>
      <div className="card">
        <div className="section-title">
          <div>
            <h2 className="as-h3">Welk experiment past bij jouw vraag?</h2>
            <p className="sub" style={{ marginTop: 5 }}>Drie voorstellen, elk met een ander soort bewijs.</p>
          </div>
          <span className="pill blue">Aanbeveling</span>
        </div>
        <label className="field-label" htmlFor="as-select" style={{ marginTop: 6 }}>Aanname die je toetst</label>
        <select className="field" id="as-select" value={assumption.id} onChange={(e) => setAssumptionId(e.target.value)}>
          {assumptions.map((a) => <option key={a.id} value={a.id}>{a.statement}</option>)}
        </select>
        {warning && <div className="note">{warning}</div>}
        <div className={`exp-options${options.length === 4 ? " four" : ""}`} role="radiogroup" aria-label="Experimenttype">
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
          <div><div className="tiny">Wat leer je?</div><p style={{ fontSize: 14 }}>{options[tier].learn}</p></div>
          <div><div className="tiny">Wat kun je níét concluderen?</div><p style={{ fontSize: 14 }}>{options[tier].cannotConclude}</p></div>
          <div>
            <div className="tiny">Inzet · looptijd · kosten · bewijs</div>
            <p style={{ fontSize: 14 }}>{options[tier].effort} · {options[tier].duration} · {options[tier].cost} · {options[tier].strength}</p>
          </div>
        </div>
        <p className="tiny mt-8">Kan de uitkomst de beslissing veranderen? {options[tier].canChangeDecision}</p>
      </div>

      <ActionForm action={action} submitLabel="Test Card opslaan als concept" pendingLabel="Opslaan…" className="grid-2" submitClass="btn primary hidden">
        <input type="hidden" name="assumption_id" value={assumption.id} />
        <input type="hidden" name="type" value={type} />
        <div className="card" style={{ marginTop: 18 }}>
          <div className="section-title"><h2 className="as-h3">Jouw Test Card</h2><span className="pill gray">Concept</span></div>
          <p className="explain" style={{ marginTop: -8, marginBottom: 14 }}>Een Test Card legt vóór de start vast wat je denkt, hoe je het toetst, wat je meet en wanneer het klopt. Na goedkeuring kan dat niet meer stil veranderen.</p>
          <div className="form-line"><label htmlFor="tc-title">Naam van het experiment</label><input className="field" id="tc-title" name="title" defaultValue={`${EXPERIMENT_TYPES[type].label}: ${assumption.statement.slice(0, 60)}`} key={`t-${type}-${assumption.id}`} /></div>
          <div className="form-line"><label htmlFor="tc-believe">Wij denken dat…</label><textarea className="field" id="tc-believe" name="we_believe" rows={3} value={card.we_believe} onChange={(e) => set("we_believe", e.target.value)} /></div>
          <div className="form-line"><label htmlFor="tc-target">Bij wie?</label><input className="field" id="tc-target" name="target_group" value={card.target_group} onChange={(e) => set("target_group", e.target.value)} /></div>
          <div className="form-line"><label htmlFor="tc-method">Dat toetsen we door…</label><input className="field" id="tc-method" name="test_method" value={card.test_method} onChange={(e) => set("test_method", e.target.value)} /></div>
          <div className="form-line"><label htmlFor="tc-metric">En we meten…</label><input className="field" id="tc-metric" name="metric_label" value={card.metric_label} onChange={(e) => set("metric_label", e.target.value)} /></div>
          <div className="double-field">
            <div className="form-line"><label htmlFor="tc-num">Teller</label><input className="field" id="tc-num" name="metric_numerator" value={card.metric_numerator} readOnly={type === "survey"} aria-describedby={type === "survey" ? "tc-metric-hint" : undefined} onChange={(e) => set("metric_numerator", e.target.value)} /></div>
            <div className="form-line"><label htmlFor="tc-den">Noemer</label><input className="field" id="tc-den" name="metric_denominator" value={card.metric_denominator} readOnly={type === "survey"} aria-describedby={type === "survey" ? "tc-metric-hint" : undefined} onChange={(e) => set("metric_denominator", e.target.value)} /></div>
          </div>
          {type === "survey" && <p className="field-hint" id="tc-metric-hint" style={{ marginTop: -8, marginBottom: 12 }}>Teller en noemer volgen uit de kernvraag en de succesopties in de enquête hiernaast.</p>}
          {v2 && <input type="hidden" name="decision_rule" value={activeRule} />}
          {v2 && (
          <fieldset className="form-line" style={{ border: 0, padding: 0, margin: "0 0 15px" }}>
            <legend style={{ fontSize: 14, fontWeight: 700, marginBottom: 6 }}>Beslisregel</legend>
            {absoluteAllowed ? (
              <div className="row" role="radiogroup" aria-label="Beslisregel">
                {(["probability", "absolute"] as DecisionRule[]).map((r) => (
                  <label key={r} className="check-row" style={{ margin: "2px 12px 2px 0" }}>
                    <input type="radio" name="decision_rule_choice" value={r} checked={rule === r} onChange={() => chooseRule(r)} /> {DECISION_RULES[r].label}
                  </label>
                ))}
              </div>
            ) : (
              <p className="field-hint" style={{ margin: 0 }}>{DECISION_RULES.probability.label}: dit testtype meet een percentage.</p>
            )}
            <p className="field-hint" style={{ marginTop: 6 }}>
              {activeRule === "absolute"
                ? "Voor sterke handelingen (aanbetaling, herhaalaankoop): geslaagd als het afgesproken aantal na de eindconditie is gehaald. Een gesprek telt alleen mee met een vastgelegde aanbetaling of herhaalaankoop."
                : `Geslaagd als de kans dat het echte percentage boven de succesdrempel ligt minstens ${PASS_PROBABILITY * 100}% is; niet geslaagd als de kans dat het boven de faaldrempel ligt ${FAIL_PROBABILITY * 100}% of minder is. Daartussen onbeslist.`}
            </p>
          </fieldset>
          )}
          {activeRule === "absolute" ? (
            <>
              <input type="hidden" name="success_threshold_pct" value={thresholdPct || ""} />
              <div className="double-field">
                <div className="form-line"><label htmlFor="tc-count">Geslaagd bij minimaal (aantal)</label><input className="field num" id="tc-count" name="success_count" type="number" min={1} value={successCount} onChange={(e) => setSuccessCount(e.target.value)} /></div>
                <div className="form-line"><label htmlFor="tc-n">Uit (minimale steekproef)</label><input className="field num" id="tc-n" name="min_sample" type="number" min={5} value={card.min_sample} onChange={(e) => set("min_sample", e.target.value)} /></div>
              </div>
              <div className="form-line"><label htmlFor="tc-days">Maximale looptijd (dagen)</label><input className="field num" id="tc-days" name="max_duration_days" type="number" min={1} max={180} value={card.max_duration_days} onChange={(e) => set("max_duration_days", e.target.value)} /></div>
            </>
          ) : (
            <>
              <div className="double-field">
                <div className="form-line"><label htmlFor="tc-succ">Het klopt als ≥ (%)</label><input className="field num" id="tc-succ" name="success_threshold_pct" type="number" min={1} max={100} value={card.success_threshold_pct} onChange={(e) => set("success_threshold_pct", e.target.value)} /></div>
                <div className="form-line"><label htmlFor="tc-fail">Het klopt niet als &lt; (%)</label><input className="field num" id="tc-fail" name="fail_threshold_pct" type="number" min={0} max={100} value={card.fail_threshold_pct ?? ""} onChange={(e) => set("fail_threshold_pct", e.target.value)} /></div>
              </div>
              <div className="double-field">
                <div className="form-line"><label htmlFor="tc-n">Minimale steekproef</label><input className="field num" id="tc-n" name="min_sample" type="number" min={5} value={card.min_sample} onChange={(e) => set("min_sample", e.target.value)} /></div>
                <div className="form-line"><label htmlFor="tc-days">Maximale looptijd (dagen)</label><input className="field num" id="tc-days" name="max_duration_days" type="number" min={1} max={180} value={card.max_duration_days} onChange={(e) => set("max_duration_days", e.target.value)} /></div>
              </div>
            </>
          )}
          {!v2 && (
            needed !== null ? (
              <div className="note" style={{ marginTop: 0 }}>
                Met {n} deelnemers is &quot;geslaagd&quot; pas vast te stellen bij minimaal <strong>{needed}</strong> keer {card.metric_label.toLowerCase()} ({Math.round((needed / n) * 100)}%).
                Daaronder blijft het onbeslist. Dit dossier rekent met methode 2026-11-a (intervalregel).
              </div>
            ) : (
              <div className="note" style={{ marginTop: 0 }}>Met deze steekproef is de succesdrempel niet aantoonbaar te halen. Verhoog de steekproef.</div>
            )
          )}
          {v2 && (
          <>
          <div className="double-field">
            <div className="form-line">
              <label htmlFor="tc-exp">Verwachte uitkomst (%)</label>
              <input className="field num" id="tc-exp" name="expected_pct" type="number" min={1} max={100} step="any" value={expectedPct} onChange={(e) => setExpectedPct(e.target.value)} aria-describedby="tc-plan" required />
            </div>
            <div className="form-line">
              <label htmlFor="tc-week">Beschikbare deelnemers per week</label>
              <input className="field num" id="tc-week" name="available_per_week" type="number" min={0} value={perWeek} onChange={(e) => setPerWeek(e.target.value)} aria-describedby="tc-plan" />
            </div>
          </div>
          <div id="tc-plan" aria-live="polite">
            {requiredN === undefined ? (
              <div className="note" style={{ marginTop: 0 }}>Vul de verwachte uitkomst in: dan rekent ProofLab vóór goedkeuring uit hoeveel deelnemers je nodig hebt om de drempel te kunnen halen.</div>
            ) : (
              <div className={feasibility && feasibility.warnings.length ? "form-error" : "note"} style={{ marginTop: 0 }}>
                {requiredN !== null && (
                  <p style={{ margin: 0 }}>
                    Benodigd: <strong className="num">{requiredN}</strong> deelnemers om bij een uitkomst van {expected}%{" "}
                    {activeRule === "absolute" ? `het aantal van ${countN} te halen` : `de kansregel te halen (≥ ${PASS_PROBABILITY * 100}% kans boven ${thresholdPct}%)`}.
                    {feasibility?.capacity != null ? ` Bereik in de looptijd: ongeveer ${feasibility.capacity}.` : ""}
                  </p>
                )}
                {feasibility?.warnings.map((w) => <p key={w} style={{ margin: "4px 0 0" }}>{w}</p>)}
                {requiredN !== null && requiredN > n && (
                  <button type="button" className="btn white sm mt-8" onClick={() => set("min_sample", String(requiredN))}>Neem {requiredN} over als minimale steekproef</button>
                )}
              </div>
            )}
            {activeRule === "probability" && needed !== null && (
              <p className="field-hint">Ter informatie: met {n} deelnemers is het resultaat &quot;sterk bewezen&quot; (ook de ondergrens van het 95%-interval boven de drempel) vanaf {needed} keer {card.metric_label.toLowerCase()}.</p>
            )}
          </div>
          </>
          )}
          {type === "survey" && (
            <SamplePlanner
              compact
              successPct={Number(card.success_threshold_pct)}
              failPct={card.fail_threshold_pct === null || String(card.fail_threshold_pct) === "" ? null : Number(card.fail_threshold_pct)}
              minSample={n}
            />
          )}
          <div className="form-line"><label htmlFor="tc-bias">Verwachte vertekeningen</label><input className="field" id="tc-bias" name="expected_biases" value={card.expected_biases} onChange={(e) => set("expected_biases", e.target.value)} /></div>
          <fieldset className="form-line" style={{ border: 0, padding: 0, margin: "0 0 15px" }} aria-describedby="tc-rg-hint">
            <legend style={{ fontSize: 14, fontWeight: 700, marginBottom: 6 }}>
              Wervingsgroep{recruitmentRequired ? " (verplicht)" : " (standaard voor de gesprekken)"}
            </legend>
            <div className="row">
              {RECRUITMENT_KEYS.map((k) => (
                <label key={k} className="check-row" style={{ margin: "2px 10px 2px 0" }} title={RECRUITMENT_GROUPS[k].explain}>
                  <input type="radio" name="recruitment_group" value={k} checked={recruitment === k} onChange={() => setRecruitment(k)} required={recruitmentRequired} /> {RECRUITMENT_GROUPS[k].label}
                </label>
              ))}
            </div>
            <p className="field-hint" id="tc-rg-hint">
              {recruitment ? `${RECRUITMENT_GROUPS[recruitment as RecruitmentGroup].explain} ` : ""}
              {recruitmentRequired
                ? "Signalen uit dezelfde wervingsgroep zijn geen onafhankelijk bewijs: herhaling binnen één groep telt afnemend mee."
                : "Per gesprek leg je vast of het een bekende is (eigen netwerk) of welke groep anders geldt."}
            </p>
          </fieldset>
          <fieldset className="form-line" style={{ border: 0, padding: 0, margin: "0 0 15px" }}>
            <legend style={{ fontSize: 14, fontWeight: 700, marginBottom: 6 }}>Wervingskanalen</legend>
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
          {assumption.primary?.locked ? (
            <p className="field-hint">
              Deze aanname heeft al een goedgekeurde hoofdtest. Deze test wordt verkennend: hij geeft richting, maar beslist niet over de aanname.
            </p>
          ) : (
            <label className="check-row">
              <input type="checkbox" name="is_primary" defaultChecked={!assumption.primary} key={`primary-${assumption.id}`} />{" "}
              {assumption.primary ? "Maak dit de hoofdtest van deze aanname (vervangt de huidige hoofdtest, die nog niet is goedgekeurd)" : "Dit is de hoofdtest van deze aanname"}
            </label>
          )}
          <p className="field-hint">
            Per aanname wijs je vooraf één hoofdtest aan; alleen die beslist over de aanname. Andere tests heten verkennend. Na goedkeuring ligt de keuze vast.
          </p>
          <div className="note">Je legt deze criteria vast vóór de test. Na goedkeuring zijn ze vergrendeld; wijzigen kan alleen met een nieuwe versie en een motivering.</div>
          {surveyIssues.length > 0 && <div className="form-error">Maak de enquête eerst compleet (zie de meldingen bij de vragen).</div>}
          {recruitmentMissing(type, recruitment) && <div className="form-error">Kies de wervingsgroep voordat je de Test Card opslaat.</div>}
          <button className="btn primary" style={{ marginTop: 18, width: "100%" }} disabled={!coach.ok || surveyIssues.length > 0 || recruitmentMissing(type, recruitment)}>
            Test Card opslaan als concept <Icon name="arrow" size="sm" />
          </button>
        </div>

        <div className="card" style={{ marginTop: 18 }}>
          <div className="section-title"><h2 className="as-h3">Zo ziet jouw experiment eruit</h2><span className="pill blue">Live preview</span></div>
          {type === "survey" ? (
            <>
              <input type="hidden" name="survey_config" value={JSON.stringify(survey)} />
              <SurveyEditor
                value={survey}
                onChange={updateSurvey}
                productNames={[ideaTitle]}
                assumptionId={assumption.id}
                targetGroup={card.target_group}
                aiConnected={aiConnected}
                draftAction={surveyDraftAction}
              />
            </>
          ) : type === "interview" ? (
            <>
              <div className="form-line">
                <label htmlFor="tc-guide">Gespreksleidraad (één vraag per regel)</label>
                <textarea className="field" id="tc-guide" name="guide" rows={9} value={guide} onChange={(e) => setGuide(e.target.value)} aria-describedby="tc-guide-audit" />
                <p className="field-hint">Vragen over gedrag in het verleden. Geen pitch en geen &quot;zou je dit kopen?&quot;.</p>
              </div>
              <div id="tc-guide-audit" aria-live="polite">
                {auditSum.flagged === 0 ? (
                  <div className="form-ok" style={{ marginTop: 0 }}>Leidraadcontrole: geen hypothetische, sturende of verkopende vragen gevonden.</div>
                ) : (
                  <div className="note" style={{ marginTop: 0 }}>
                    <strong>Leidraadcontrole: {auditSum.flagged} van {auditSum.total} vragen verdienen aandacht.</strong> Dit zijn waarschuwingen; je beslist zelf.
                    <GuideAuditList audit={audit} />
                  </div>
                )}
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
              <div className="mt-12">
                {draftWarnings.length > 0 && (
                  <div className="note" style={{ marginTop: 0 }} role="status">
                    <strong>Eerlijkheidscontrole:</strong>
                    <ul style={{ margin: "6px 0 0 16px", padding: 0 }}>{draftWarnings.map((w) => <li key={w}>{w}</li>)}</ul>
                  </div>
                )}
                {variantsAction && (
                  aiConnected ? (
                    <button type="button" className="btn soft sm mt-8" onClick={askVariants} disabled={variantsPending}>
                      {variantsPending ? "Varianten bedenken…" : "Stel varianten voor (AI)"}
                    </button>
                  ) : (
                    <p className="field-hint">AI niet verbonden: schrijf zelf twee of drie varianten en kies er één. De eerlijkheidscontrole werkt wel.</p>
                  )
                )}
                {variants?.error && <div className="form-error" role="alert">{variants.error}</div>}
                {variants && variants.draftNotes.length > 0 && (
                  <div className="note">
                    <strong>AI over je huidige concept (voorstel):</strong>
                    <ul style={{ margin: "6px 0 0 16px", padding: 0 }}>{variants.draftNotes.map((w) => <li key={w}>{w}</li>)}</ul>
                  </div>
                )}
                {variants && variants.variants.length > 0 && (
                  <div className="stack mt-12" aria-label="Voorgestelde varianten">
                    <div className="tiny"><span className="pill blue">AI-voorstel</span> Kies er één om in je concept over te nemen. Na goedkeuring verandert er niets meer.</div>
                    {variants.variants.map((v, i) => (
                      <div key={i} className="card tight">
                        <div className="tiny">Variant {i + 1} · {v.angle}</div>
                        <strong style={{ display: "block", marginTop: 6 }}>{v.headline}</strong>
                        <p className="sub" style={{ fontSize: 13 }}>{v.subline}</p>
                        <p className="tiny mt-8">{v.offer}</p>
                        {[...v.ai_honesty_notes, ...v.warnings].length > 0 && (
                          <ul className="tiny" style={{ margin: "6px 0 0 16px", padding: 0, color: "var(--color-warning-text)" }}>
                            {[...v.ai_honesty_notes, ...v.warnings].map((w) => <li key={w}>Let op: {w}</li>)}
                          </ul>
                        )}
                        <button type="button" className="btn white sm mt-8" onClick={() => setPage({ ...page, headline: v.headline, subline: v.subline, offer: v.offer })}>
                          Neem variant {i + 1} over
                        </button>
                      </div>
                    ))}
                  </div>
                )}
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
