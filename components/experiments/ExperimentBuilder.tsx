"use client";

import { startTransition, useActionState, useMemo, useRef, useState, useTransition } from "react";
import { RequiredMark, type FormState } from "@/components/ui/ActionForm";
import { Term } from "@/components/ui/Term";
import { SavingOverlay } from "@/components/ui/SavingOverlay";
import { Icon } from "@/components/Icon";
import { EXPERIMENT_TYPES, HONEST_REVEAL, NEUTRAL_INTERVIEW_GUIDE, type ExperimentType } from "@/lib/domain/labels";
import { testCardDefaults, type Option } from "@/lib/domain/recommend";
import { DECISION_RULES, PASS_PROBABILITY, FAIL_PROBABILITY, FLAT_PRIOR, wilson, type BetaPrior, type DecisionRule } from "@/lib/domain/stats";
import {
  daysUntil,
  deadlineFromDays,
  detailFieldErrors,
  formatAmount,
  headlineFromIdea,
  intakePrice,
  isoDay,
  orderedErrors,
  recruitmentFromChannels,
  sampleBand,
  validateTestCard,
  type FieldErrors,
} from "@/lib/domain/test-card";
import { GO_RULE_DEFAULT_PROBABILITY } from "@/lib/domain/decision-rule-proposal";
import { TestCardStatus } from "@/components/experiments/TestCardStatus";
import { CHANNELS } from "@/lib/domain/tracking";
import { METHODS, type MethodVersion } from "@/lib/domain/method";
import { RECRUITMENT_GROUPS, RECRUITMENT_KEYS, RECRUITMENT_REQUIRED_TYPES, type RecruitmentGroup } from "@/lib/domain/recruitment";
import { auditGuide, guideSummary } from "@/lib/domain/interview-audit";
import { honestyWarnings, type PreparedVariant } from "@/lib/domain/copy-honesty";
import { GuideAuditList } from "@/components/experiments/InterviewAudit";
import { SurveyEditor, type SurveyDraftAction } from "@/components/survey/SurveyEditor";
import { SamplePlanner } from "@/components/survey/SamplePlanner";
import { templateSurvey, type SurveyConfig } from "@/lib/domain/survey";
import { metricFromKey, surveyErrors } from "@/lib/domain/survey-editor";
import { assumptionKind, assumptionKindLabel, interviewGuideFor, metricFitsAssumption, type AssumptionKind } from "@/lib/domain/assumption-kind";

type VariantsResult = { error: string | null; variants: PreparedVariant[]; draftNotes: string[]; draftWarnings: string[] };
type VariantsAction = (input: { assumption_id: string; type: "landing" | "pricing"; headline: string; subline: string; offer: string }) => Promise<VariantsResult>;

// primary: de huidige hoofdtest van de aanname (locked = al goedgekeurd of gestart), of null.
// kind: soort aanname (B0 punt 3); ontbreekt hij, dan leidt de builder hem af uit de tekst.
type Assumption = { id: string; statement: string; kind?: AssumptionKind; primary?: { locked: boolean } | null };
type SaveState = FormState & { fieldErrors?: Record<string, string> };
type Action = (s: SaveState, f: FormData) => Promise<SaveState>;

// B1: verplichte velden van de Test Card (zie validateTestCard); ze tonen "(verplicht)" en dragen aria-required.
const REQUIRED_FIELDS = new Set(["title", "we_believe", "target_group", "test_method", "metric_label", "metric_numerator", "success_threshold_pct", "fail_threshold_pct", "success_count", "min_sample", "max_duration_days", "channels", "headline", "price_points"]);
const CTA_DEFAULT: Record<ExperimentType, string> = { interview: "Plan een gesprek", pricing: "Kies dit aanbod", landing: "Vraag een demo aan", survey: "Vraag een demo aan" };

// Veld → element dat focus krijgt bij een fout (B1a).
const FIELD_FOCUS: Record<string, string> = {
  title: "tc-title",
  we_believe: "tc-believe",
  target_group: "tc-target",
  test_method: "tc-method",
  metric_label: "tc-metric",
  metric_numerator: "tc-num",
  success_threshold_pct: "tc-succ",
  fail_threshold_pct: "tc-fail",
  success_count: "tc-count",
  thresholds: "tc-lock",
  min_sample: "tc-n",
  max_duration_days: "tc-deadline",
  recruitment_group: "tc-rg-0",
  channels: "tc-ch-0",
  guide: "tc-guide",
  headline: "pg-head",
  price_points: "pp-l-0",
  survey: "tc-survey",
};

const kindOf = (a: Assumption): AssumptionKind => a.kind ?? assumptionKind({ statement: a.statement, category: "" });
const defaultGuide = (kind: AssumptionKind) => interviewGuideFor(kind, NEUTRAL_INTERVIEW_GUIDE).join("\n");

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
  method = "2026-11-d",
  priors = {},
  intake = { description: "", texts: [] },
  goRuleMissing = false,
}: {
  // B5: wat de intake al weet (prijs, beschrijving), om de Test Card vooraf in te vullen.
  intake?: { description: string; texts: (string | null | undefined)[]; price_eur?: number | null; price_period?: string | null };
  // B5: het dossier heeft nog geen go-regel; na opslaan van een hoofdtest stelt ProofLab die voor.
  goRuleMissing?: boolean;
  priors?: Partial<Record<ExperimentType, BetaPrior>>;
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
  const kind = kindOf(assumption);
  const [guide, setGuide] = useState(() => defaultGuide(kind));
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
  // B5: kop en aanbod staan vooringevuld uit de intake (onder "Details" aan te passen).
  const [page, setPage] = useState(() => ({
    headline: headlineFromIdea(intake.description, ideaTitle),
    subline: "",
    offer: intake.description.trim().slice(0, 600),
    cta_label: CTA_DEFAULT[type],
    product_name: "",
  }));
  // B5: vandaag (lokale datum) voor de deadline; de looptijd in dagen gaat naar de database.
  const [today] = useState(() => isoDay(new Date()));
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [isPrimary, setIsPrimary] = useState(() => !assumption.primary);
  const titleFor = () => `${EXPERIMENT_TYPES[type].label}: ${assumption.statement.slice(0, 60)}`;
  const [title, setTitle] = useState(titleFor);
  // Fase B1b, stap 1: de drempels liggen vast vóórdat ProofLab rekent. Wijzigen kan daarna alleen met een motivering.
  const [locked, setLocked] = useState(false);
  const [lockedAt, setLockedAt] = useState<string | null>(null); // drempels zoals ze de eerste keer zijn vastgelegd
  const [changing, setChanging] = useState(false);
  const [changeReason, setChangeReason] = useState("");
  const [lockError, setLockError] = useState<string | null>(null);
  if (lastKey !== `${type}|${assumption.id}`) {
    setLastKey(`${type}|${assumption.id}`);
    setCard(withSurveyMetric(defaults, survey));
    setRule("probability");
    setTitle(titleFor());
    // De knoptekst volgt het testtype, tenzij de gebruiker hem zelf heeft aangepast.
    setPage((pg) => (Object.values(CTA_DEFAULT).includes(pg.cta_label) ? { ...pg, cta_label: CTA_DEFAULT[type] } : pg));
    setLocked(false);
    setLockedAt(null);
    setChanging(false);
    setChangeReason("");
    setIsPrimary(!assumption.primary);
    // De standaardleidraad volgt de soort aanname (prijs: ook uitgaven en budget), tenzij de gebruiker hem aanpaste.
    const prev = assumptions.find((a) => a.id === lastKey.split("|")[1]);
    if (prev) setGuide((g) => (g === defaultGuide(kindOf(prev)) ? defaultGuide(kind) : g));
  }
  const updateSurvey = (next: SurveyConfig) => {
    setSurvey(next);
    const m = metricFromKey(next);
    const keyText = (s: SurveyConfig) => s.questions.find((q) => q.id === s.key_question)?.text ?? "";
    const keyChanged = next.key_question !== survey.key_question || next.success_options.join() !== survey.success_options.join() || keyText(next) !== keyText(survey);
    // Teller and noemer always follow the key question; the label only when the key question itself changed.
    setCard((c) => ({ ...c, metric_numerator: m.metric_numerator, metric_denominator: m.metric_denominator, metric_label: keyChanged ? m.metric_label : c.metric_label }));
  };
  // B5: het eerste prijspunt komt uit de intake ("€ 249 per maand"), als die een prijs noemt.
  const fromIntake = useMemo(() => intakePrice(intake), [intake]);
  const [prices, setPrices] = useState(() => [
    { label: "Basis", amount: fromIntake ? formatAmount(fromIntake.amount) : "", period: fromIntake?.period ?? "per maand" },
    { label: "Plus", amount: "", period: fromIntake?.period ?? "per maand" },
    { label: "", amount: "", period: fromIntake?.period ?? "per maand" },
  ]);
  const [successCount, setSuccessCount] = useState("3");
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
  // Wervingsgroep (golf A, punt 13): verplicht bij enquête-, landing- en prijstests. B5: zolang de consultant niets
  // kiest, volgt de groep uit de kanalen (eigen netwerk bij organische kanalen); "onbekend" is geen standaard.
  const [recruitmentChoice, setRecruitment] = useState<string>("");
  // Het bewaarde AI-origineel van de enquête (golf A, punt 17), zodat zichtbaar blijft wat de mens aanpaste.
  const [surveyDraftId, setSurveyDraftId] = useState<string | null>(null);
  const recruitmentRequired = (RECRUITMENT_REQUIRED_TYPES as readonly string[]).includes(type);
  const derivedRecruitment = recruitmentRequired ? recruitmentFromChannels(channels) : "unknown";
  const recruitment = recruitmentChoice || (derivedRecruitment !== "unknown" ? derivedRecruitment : "");
  const recruitmentDerived = !recruitmentChoice && recruitment !== "";
  const [reach, setReach] = useState("");
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

  const n = Number(card.min_sample) || 0;
  const needed = n > 0 ? minSuccesses(n, Number(card.success_threshold_pct)) : null;
  // Beslisregel (methode 2026-11-b): vooraf rekenen hoeveel deelnemers nodig zijn.
  // Dossiers met methode 2026-11-a houden de intervalregel: geen beslisregel en geen vooraf berekend aantal.
  const v2 = METHODS[method].usesRules;
  const absoluteAllowed = v2 && type === "interview";
  const activeRule: DecisionRule = absoluteAllowed ? rule : "probability";
  const countN = Number(successCount) || 0;
  const thresholdPct = activeRule === "absolute" ? (n > 0 && countN > 0 ? Math.min(100, Math.round((countN / n) * 1000) / 10) : 0) : Number(card.success_threshold_pct);
  const prior = priors[type] ?? FLAT_PRIOR;
  // B0 punt 3: past de maatstaf bij de soort aanname? Opslaan als concept mag; goedkeuren niet.
  const fit = metricFitsAssumption(kind, { type, metric_label: card.metric_label, metric_numerator: card.metric_numerator, decision_rule: v2 ? activeRule : null });
  const suggestedTier = fit.suggestedType ? options.findIndex((o) => o.type === fit.suggestedType) : -1;
  const band =
    v2 && locked && thresholdPct > 0
      ? sampleBand({ rule: activeRule, thresholdPct, successCount: countN, prior, availablePerWeek: Number(perWeek) > 0 ? Number(perWeek) : null, maxDurationDays: Number(card.max_duration_days) || 0 })
      : null;
  const thresholdKey = () => (activeRule === "absolute" ? `${countN}/${n}` : `${card.success_threshold_pct}|${card.fail_threshold_pct ?? ""}`);
  const thresholdErrors = (): string | null => {
    if (activeRule === "absolute") {
      if (countN < 1) return "Leg vast hoeveel sterke handelingen minimaal nodig zijn.";
      if (n < 5) return "Kies een minimale steekproef van minstens 5.";
      if (countN > n) return "Het afgesproken aantal kan niet groter zijn dan de minimale steekproef.";
      return null;
    }
    const succ = Number(card.success_threshold_pct);
    const fail = card.fail_threshold_pct === null || String(card.fail_threshold_pct) === "" ? null : Number(card.fail_threshold_pct);
    if (!(succ > 0) || succ > 100) return "Kies een succesdrempel tussen 0 en 100%.";
    if (fail != null && (fail < 0 || fail > succ)) return "De faaldrempel ligt tussen 0% en de succesdrempel.";
    return null;
  };
  const lockThresholds = () => {
    const err = thresholdErrors();
    if (err) return setLockError(err);
    if (changing && lockedAt !== null && lockedAt !== thresholdKey() && changeReason.trim().length < 10) {
      return setLockError("Leg in een zin uit waarom je de drempels wijzigt (minstens 10 tekens). De motivering wordt bewaard bij de Test Card.");
    }
    setLockError(null);
    if (lockedAt === null) setLockedAt(thresholdKey());
    setLocked(true);
    setChanging(false);
  };
  const thresholdsChanged = lockedAt !== null && lockedAt !== thresholdKey();
  const validPrices = prices.filter((p) => p.label.trim() && Number(p.amount.replace(",", ".")) > 0).length;
  const liveErrors: FieldErrors = {
    ...validateTestCard({
      type,
      title,
      we_believe: card.we_believe,
      target_group: card.target_group,
      test_method: card.test_method,
      metric_label: card.metric_label,
      metric_numerator: card.metric_numerator,
      metric_denominator: card.metric_denominator,
      success_threshold_pct: activeRule === "absolute" ? thresholdPct : Number(card.success_threshold_pct),
      fail_threshold_pct: activeRule === "absolute" || card.fail_threshold_pct === null || String(card.fail_threshold_pct) === "" ? null : Number(card.fail_threshold_pct),
      min_sample: Number(card.min_sample) || null,
      max_duration_days: Number(card.max_duration_days) || null,
      rule: v2 ? activeRule : null,
      success_count: activeRule === "absolute" ? countN : null,
      thresholds_locked: locked,
      recruitment_group: recruitment,
      channels,
      headline: page.headline,
      price_points: validPrices,
      guide_questions: guide.split("\n").map((x) => x.trim()).filter(Boolean).length,
    }),
    ...(surveyIssues.length ? { survey: "Maak de enquête eerst compleet (zie de meldingen bij de vragen)." } : {}),
  };
  // Opslaan (B1a): één knop, nooit uitgeschakeld. Eerst de controle op het scherm; bij fouten geen verzoek, wel
  // een melding bij elk veld en een samenvatting bij de knop. De server controleert hetzelfde nog een keer.
  const [saveState, saveAction, saving] = useActionState<SaveState, FormData>(action, { error: null });
  const [tried, setTried] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const shown: FieldErrors = tried ? liveErrors : {};
  const errs = orderedErrors(shown);
  const serverOnly = tried && errs.length === 0 && saveState.error ? saveState.error : null;
  const focusField = (field: string) => {
    const go = () => {
      const el = document.getElementById(FIELD_FOCUS[field] ?? "");
      if (el) {
        el.scrollIntoView({ block: "center", behavior: "smooth" });
        (el as HTMLElement).focus({ preventScroll: true });
      }
    };
    // B5: een veld onder "Details" is pas te zien (en te focussen) als "Details" openstaat.
    if (detailFieldErrors({ [field]: "x" }).length && !detailsOpen) {
      setDetailsOpen(true);
      requestAnimationFrame(go);
    } else go();
  };
  const submit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setTried(true);
    // B5: een verplicht detailveld met een fout opent "Details" vanzelf; de fout staat dan zichtbaar bij het veld.
    if (detailFieldErrors(liveErrors).length) setDetailsOpen(true);
    const first = orderedErrors(liveErrors)[0];
    if (first) return focusField(first.field);
    const fd = new FormData(e.currentTarget);
    startTransition(() => saveAction(fd));
  };
  const fieldError = (f: string) => (shown[f] ? <p className="field-error" id={`err-${f}`} role="alert">{shown[f]}</p> : null);
  // B1: verplichte velden dragen aria-required, ook zonder fout.
  const aria = (f: string) => ({ "aria-required": REQUIRED_FIELDS.has(f) || undefined, ...(shown[f] ? { "aria-invalid": true as const, "aria-describedby": `err-${f}` } : {}) });
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
        <p className="field-hint" style={{ marginTop: 6 }}>Soort aanname: {assumptionKindLabel(kind)}</p>
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
        {!fit.ok && (
          <div className="form-error" role="status" id="tc-fit">
            <p style={{ margin: 0 }}>{fit.reason} Opslaan als concept kan; goedkeuren pas als testtype en maatstaf bij de aanname passen.</p>
            {suggestedTier >= 0 && suggestedTier !== tier && (
              <button type="button" className="btn white sm mt-8" onClick={() => setTier(suggestedTier)}>
                Kies de {EXPERIMENT_TYPES[options[suggestedTier].type].label.toLowerCase()}
              </button>
            )}
          </div>
        )}
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

      <form ref={formRef} className="grid-2" noValidate onSubmit={submit} aria-label="Test Card">
        <input type="hidden" name="assumption_id" value={assumption.id} />
        <input type="hidden" name="type" value={type} />
        {locked && <input type="hidden" name="thresholds_locked" value="1" />}
        {thresholdsChanged && <input type="hidden" name="threshold_change_reason" value={changeReason.trim()} />}
        <div className="card" style={{ marginTop: 18 }}>
          <div className="section-title"><h2 className="as-h3">Jouw Test Card</h2></div>
          {/* B5: één duidelijke status bovenaan; een nieuwe Test Card is altijd een concept. */}
          <TestCardStatus state="draft" note="Nog niet opgeslagen. Na opslaan bied je de Test Card aan voor goedkeuring; daarna start de test." />
          <p className="explain" style={{ marginTop: 0, marginBottom: 14 }}>Vijf vragen; de rest staat vooringevuld onder Details. Na goedkeuring kan niets meer stil veranderen.</p>
          <div className="form-line"><label htmlFor="tc-believe">Wat test je?<RequiredMark /></label><textarea className="field" id="tc-believe" name="we_believe" rows={3} value={card.we_believe} onChange={(e) => set("we_believe", e.target.value)} {...aria("we_believe")} />{fieldError("we_believe")}</div>
          <div className="form-line"><label htmlFor="tc-target">Bij wie?<RequiredMark /></label><input className="field" id="tc-target" name="target_group" value={card.target_group} onChange={(e) => set("target_group", e.target.value)} {...aria("target_group")} />{fieldError("target_group")}</div>
          {v2 && <input type="hidden" name="decision_rule" value={activeRule} />}
          <section className="tc-step" aria-labelledby="tc-step1">
          <h3 id="tc-step1" className="tc-step-title"><span className="num">1</span> Wanneer is de test geslaagd?</h3>
          {v2 && (
          <fieldset disabled={locked} className="form-line" style={{ border: 0, padding: 0, margin: "0 0 15px" }}>
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
              <p className="field-hint" style={{ margin: 0 }}><Term k="kansregel">{DECISION_RULES.probability.label}</Term>: dit testtype meet een percentage.</p>
            )}
            <p className="field-hint" style={{ marginTop: 6 }}>
              {activeRule === "absolute"
                ? <><Term k="aantalregel">Voor sterke handelingen</Term> (aanbetaling, herhaalaankoop): geslaagd als het afgesproken aantal na de eindconditie is gehaald. Een gesprek telt alleen mee met een vastgelegde aanbetaling of herhaalaankoop.</>
                : <>Geslaagd als de kans dat het echte percentage boven de <Term k="succesdrempel">succesdrempel</Term> ligt minstens {PASS_PROBABILITY * 100}% is; niet geslaagd als de kans dat het boven de <Term k="faaldrempel">faaldrempel</Term> ligt {FAIL_PROBABILITY * 100}% of minder is. Daartussen onbeslist.</>}
            </p>
          </fieldset>
          )}
          {activeRule === "absolute" ? (
            <>
              <input type="hidden" name="success_threshold_pct" value={thresholdPct || ""} />
              <div className="double-field">
                <div className="form-line"><label htmlFor="tc-count">Geslaagd bij minimaal (aantal)<RequiredMark /></label><input className="field num" id="tc-count" name="success_count" type="number" min={1} value={successCount} readOnly={locked} onChange={(e) => setSuccessCount(e.target.value)} {...aria("success_count")} />{fieldError("success_count")}</div>
                <div className="form-line"><label htmlFor="tc-n">Uit (<Term k="minimale-steekproef">minimale steekproef</Term>)<RequiredMark /></label><input className="field num" id="tc-n" name="min_sample" type="number" min={5} value={card.min_sample} readOnly={locked} onChange={(e) => set("min_sample", e.target.value)} {...aria("min_sample")} />{fieldError("min_sample")}</div>
              </div>
            </>
          ) : (
            <div className="double-field">
              <div className="form-line"><label htmlFor="tc-succ"><Term k="succesdrempel">Het klopt als ≥ (%)</Term><RequiredMark /></label><input className="field num" id="tc-succ" name="success_threshold_pct" type="number" min={1} max={100} value={card.success_threshold_pct} readOnly={locked} onChange={(e) => set("success_threshold_pct", e.target.value)} {...aria("success_threshold_pct")} />{fieldError("success_threshold_pct")}</div>
              <div className="form-line"><label htmlFor="tc-fail"><Term k="faaldrempel">Het klopt niet als &lt; (%)</Term><RequiredMark /></label><input className="field num" id="tc-fail" name="fail_threshold_pct" type="number" min={0} max={100} value={card.fail_threshold_pct ?? ""} readOnly={locked} onChange={(e) => set("fail_threshold_pct", e.target.value)} {...aria("fail_threshold_pct")} />{fieldError("fail_threshold_pct")}</div>
            </div>
          )}
          {v2 && (
            <div className="tc-lock" aria-live="polite">
              {locked ? (
                <>
                  <p className="form-ok" style={{ margin: 0 }}>
                    <Icon name="check" size="sm" /> Drempels vastgelegd{thresholdsChanged ? " (gewijzigd, met motivering)" : ""}. Ze veranderen niet meer stil.
                  </p>
                  <button type="button" className="text-link mt-8" id="tc-lock" onClick={() => { setLocked(false); setChanging(true); }}>
                    Drempels wijzigen (met motivering)
                  </button>
                </>
              ) : (
                <>
                  {changing && (
                    <div className="form-line">
                      <label htmlFor="tc-reason">Waarom wijzig je de drempels?</label>
                      <textarea className="field" id="tc-reason" rows={2} value={changeReason} onChange={(e) => setChangeReason(e.target.value)} placeholder="Bijv. de opdrachtgever legde een hogere minimale omzet vast." />
                      <p className="field-hint">De motivering wordt bewaard bij de Test Card. Een lagere lat om de test te laten slagen ondermijnt het besluit.</p>
                    </div>
                  )}
                  <button type="button" className="btn white" id="tc-lock" onClick={lockThresholds} {...aria("thresholds")}>
                    <Icon name="check" size="sm" /> {changing ? "Leg de drempels opnieuw vast" : "Leg drempels vast"}
                  </button>
                  {lockError && <p className="field-error" role="alert">{lockError}</p>}
                  {fieldError("thresholds")}
                  <p className="field-hint">Eerst de lat, dan pas het rekenwerk: zo past niemand de drempel aan op wat haalbaar lijkt.</p>
                </>
              )}
            </div>
          )}
          </section>
          <section className="tc-step" aria-labelledby="tc-step2">
          <h3 id="tc-step2" className="tc-step-title"><span className="num">2</span> Hoeveel deelnemers heb je nodig?</h3>
          {v2 && !locked && <p className="sub" style={{ fontSize: 14, marginTop: 0 }}>Leg eerst de drempels vast. Daarna rekent ProofLab uit hoeveel deelnemers je nodig hebt.</p>}
          {v2 && band && (
            <div id="tc-plan" aria-live="polite">
              {band.requiredN != null ? (
                <p className="tc-need">Je hebt ongeveer <strong className="num">{band.requiredN}</strong> deelnemers nodig.</p>
              ) : (
                <p className="tc-need">Met dit testtype is de drempel niet aantoonbaar te halen. Opslaan als concept kan; goedkeuren niet.</p>
              )}
              {band.advice && <div className="form-error" role="status">{band.advice}</div>}
              <details className="mt-8">
                <summary className="text-link">Hoe is dit berekend?</summary>
                <div className="note" style={{ marginTop: 8 }}>
                  <p style={{ marginTop: 0 }}>
                    {band.basis === "earlier_tests"
                      ? `Op basis van ${band.earlierTests} afgeronde ${EXPERIMENT_TYPES[type].label.toLowerCase()}s in je organisatie: wat die tests werkelijk lieten zien (25e, 50e en 75e percentiel).`
                      : `Er zijn nog geen drie afgeronde ${EXPERIMENT_TYPES[type].label.toLowerCase()}s in je organisatie. ProofLab rekent daarom met scenario's net boven je succesdrempel: hoeveel deelnemers heb je nodig als het echte percentage de drempel ruim haalt?`}
                  </p>
                  <table className="table">
                    <thead><tr><th scope="col">Scenario</th><th scope="col">Echt percentage</th><th scope="col">Benodigd</th></tr></thead>
                    <tbody>
                      {band.scenarios.map((sc) => (
                        <tr key={sc.key}><td>{sc.label}</td><td className="num">{sc.ratePct}%</td><td className="num">{sc.requiredN ?? "niet haalbaar"}</td></tr>
                      ))}
                    </tbody>
                  </table>
                  <p className="tiny">
                    Regel: {activeRule === "absolute" ? `geslaagd als het afgesproken aantal van ${countN} is gehaald.` : `geslaagd als de kans dat het echte percentage boven ${thresholdPct}% ligt minstens ${PASS_PROBABILITY * 100}% is.`}{" "}
                    Het getal hierboven is het {band.shown === "low" ? "voorzichtige" : "middelste"} scenario.{band.capacity != null ? ` Bereik in de looptijd: ongeveer ${band.capacity}.` : ""}
                  </p>
                  {activeRule === "probability" && needed !== null && (
                    <p className="tiny">Met een minimale steekproef van {n} is het resultaat &quot;sterk bewezen&quot; (ook de ondergrens van het <Term k="interval-95">95%-interval</Term> boven de drempel) vanaf {needed} keer {card.metric_label.toLowerCase()}.</p>
                  )}
                  {type === "survey" && (
                    <SamplePlanner
                      compact
                      successPct={Number(card.success_threshold_pct)}
                      failPct={card.fail_threshold_pct === null || String(card.fail_threshold_pct) === "" ? null : Number(card.fail_threshold_pct)}
                      minSample={n}
                    />
                  )}
                </div>
              </details>
            </div>
          )}
          <div className="double-field">
            {activeRule !== "absolute" && (
              <div className="form-line">
                <label htmlFor="tc-n"><Term k="minimale-steekproef">Minimale steekproef</Term><RequiredMark /></label>
                <input className="field num" id="tc-n" name="min_sample" type="number" min={5} value={card.min_sample} onChange={(e) => set("min_sample", e.target.value)} {...aria("min_sample")} />
                {fieldError("min_sample")}
                {band?.requiredN != null && band.requiredN !== n && (
                  <button type="button" className="text-link mt-8" onClick={() => set("min_sample", String(band.requiredN))}>Neem {band.requiredN} over</button>
                )}
              </div>
            )}
            {/* B5: de deadline is een datum op het scherm; de database bewaart de maximale looptijd in dagen. */}
            <div className="form-line">
              <label htmlFor="tc-deadline">Deadline<RequiredMark /></label>
              <input type="hidden" name="max_duration_days" value={card.max_duration_days} />
              <input
                className="field num"
                id="tc-deadline"
                type="date"
                min={deadlineFromDays(1, today)}
                max={deadlineFromDays(180, today)}
                value={deadlineFromDays(Number(card.max_duration_days), today)}
                onChange={(e) => set("max_duration_days", String(daysUntil(e.target.value, today) ?? ""))}
                suppressHydrationWarning
                {...aria("max_duration_days")}
                aria-describedby={shown.max_duration_days ? "err-max_duration_days tc-deadline-hint" : "tc-deadline-hint"}
              />
              {fieldError("max_duration_days")}
              <p className="field-hint" id="tc-deadline-hint">
                {Number(card.max_duration_days) > 0
                  ? `Maximaal ${card.max_duration_days} dagen. Start je later, dan schuift de deadline mee.`
                  : "De uiterste einddatum als je vandaag start."}
              </p>
            </div>
          </div>
          </section>
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
          {goRuleMissing && isPrimary && (
            <p className="field-hint" id="tc-go-rule">
              Dit dossier heeft nog geen go-regel. Na opslaan stelt ProofLab hem voor: doorgaan als deze hoofdtest slaagt en de aanname minstens{" "}
              {Math.round(GO_RULE_DEFAULT_PROBABILITY * 100)}% kans haalt. Een hoofdtest start pas als de go-regel vastligt.
            </p>
          )}
          {/* B5: alles hieronder staat vooringevuld. Een verplicht veld met een fout opent dit deel vanzelf. */}
          <details className="tc-details" open={detailsOpen} onToggle={(e) => setDetailsOpen(e.currentTarget.open)}>
          <summary id="tc-details">
            <strong>Details</strong> <small>naam, meting, vertekeningen, werving{type === "landing" || type === "pricing" ? ", aanbodtekst" : ""}{type === "pricing" ? " en prijspunten" : ""}{type === "interview" ? " en gespreksleidraad" : ""} (vooringevuld)</small>
            {tried && detailFieldErrors(liveErrors).length > 0 && <span className="pill coral">{detailFieldErrors(liveErrors).length} aan te vullen</span>}
          </summary>
          <div className="form-line mt-12"><label htmlFor="tc-title">Naam van het experiment<RequiredMark /></label><input className="field" id="tc-title" name="title" value={title} onChange={(e) => setTitle(e.target.value)} {...aria("title")} />{fieldError("title")}</div>
          <div className="form-line"><label htmlFor="tc-method">Dat toetsen we door…<RequiredMark /></label><input className="field" id="tc-method" name="test_method" value={card.test_method} onChange={(e) => set("test_method", e.target.value)} {...aria("test_method")} />{fieldError("test_method")}</div>
          <div className="form-line"><label htmlFor="tc-metric">En we meten…<RequiredMark /></label><input className="field" id="tc-metric" name="metric_label" value={card.metric_label} onChange={(e) => set("metric_label", e.target.value)} {...aria("metric_label")} />{fieldError("metric_label")}</div>
          <div className="double-field">
            <div className="form-line"><label htmlFor="tc-num">Teller<RequiredMark /></label><input className="field" id="tc-num" name="metric_numerator" value={card.metric_numerator} readOnly={type === "survey"} aria-describedby={type === "survey" ? "tc-metric-hint" : undefined} onChange={(e) => set("metric_numerator", e.target.value)} {...aria("metric_numerator")} /></div>
            <div className="form-line"><label htmlFor="tc-den">Noemer<RequiredMark /></label><input className="field" id="tc-den" name="metric_denominator" value={card.metric_denominator} readOnly={type === "survey"} aria-describedby={type === "survey" ? "tc-metric-hint" : undefined} onChange={(e) => set("metric_denominator", e.target.value)} aria-required /></div>
          </div>
          {fieldError("metric_numerator")}
          {type === "survey" && <p className="field-hint" id="tc-metric-hint" style={{ marginTop: -8, marginBottom: 12 }}>Teller en noemer volgen uit de kernvraag en de succesopties in de enquête hiernaast.</p>}
          <div className="form-line"><label htmlFor="tc-bias">Verwachte vertekeningen</label><input className="field" id="tc-bias" name="expected_biases" value={card.expected_biases} onChange={(e) => set("expected_biases", e.target.value)} /></div>
          {v2 && (
            <div className="form-line">
              <label htmlFor="tc-week">Beschikbare deelnemers per week (optioneel)</label>
              <input className="field num" id="tc-week" name="available_per_week" type="number" min={0} value={perWeek} onChange={(e) => setPerWeek(e.target.value)} aria-describedby="tc-week-hint" />
              <p className="field-hint" id="tc-week-hint">Hoeveel mensen uit de doelgroep je per week kunt bereiken. ProofLab toetst daarmee of de test vóór de deadline haalbaar is.</p>
            </div>
          )}
          <fieldset className="form-line" style={{ border: 0, padding: 0, margin: "0 0 15px" }} aria-describedby="tc-rg-hint">
            <legend style={{ fontSize: 14, fontWeight: 700, marginBottom: 6 }}>
              <Term k="wervingsgroep">Wervingsgroep</Term>{recruitmentRequired ? " (verplicht)" : " (standaard voor de gesprekken)"}
            </legend>
            <div className="row">
              {RECRUITMENT_KEYS.map((k, i) => (
                <label key={k} className="check-row" style={{ margin: "2px 10px 2px 0" }} title={RECRUITMENT_GROUPS[k].explain}>
                  <input type="radio" id={`tc-rg-${i}`} name="recruitment_group" value={k} checked={recruitment === k} onChange={() => setRecruitment(k)} required={recruitmentRequired} {...(i === 0 ? aria("recruitment_group") : {})} /> {RECRUITMENT_GROUPS[k].label}
                </label>
              ))}
            </div>
            {fieldError("recruitment_group")}
            <p className="field-hint" id="tc-rg-hint">
              {recruitmentDerived ? "Standaard afgeleid uit de kanalen; kies een andere groep als die beter past. " : ""}
              {recruitment ? `${RECRUITMENT_GROUPS[recruitment as RecruitmentGroup].explain} ` : ""}
              {recruitmentRequired
                ? "Signalen uit dezelfde wervingsgroep zijn geen onafhankelijk bewijs: herhaling binnen één groep telt afnemend mee."
                : "Per gesprek leg je vast of het een bekende is (eigen netwerk) of welke groep anders geldt."}
            </p>
          </fieldset>
          <fieldset className="form-line" style={{ border: 0, padding: 0, margin: "0 0 15px" }}>
            <legend style={{ fontSize: 14, fontWeight: 700, marginBottom: 6 }}>Wervingskanalen<RequiredMark /></legend>
            <div className="row">
              {Object.entries(CHANNELS).filter(([k]) => k !== "direct").map(([k, v], i) => (
                <label key={k} className="check-row" style={{ margin: "2px 10px 2px 0" }}>
                  <input type="checkbox" id={`tc-ch-${i}`} name="channels" value={k} checked={channels.includes(k)} onChange={(e) => setChannels((c) => (e.target.checked ? [...c, k] : c.filter((x) => x !== k)))} {...(i === 0 ? aria("channels") : {})} /> {v}
                </label>
              ))}
            </div>
            {fieldError("channels")}
          </fieldset>
          <div className="double-field">
            <div className="form-line"><label htmlFor="tc-reach">Verwacht bereik (personen)</label><input className="field num" id="tc-reach" name="expected_reach" type="number" min={0} value={reach} onChange={(e) => setReach(e.target.value)} /></div>
            <div className="form-line"><label htmlFor="tc-cost">Verwachte kosten (€)</label><input className="field num" id="tc-cost" name="cost_estimate_eur" type="number" min={0} defaultValue={0} /></div>
          </div>
          {reachN > 0 && reachN < n && <div className="form-error">Het verwachte bereik ({reachN}) haalt de minimale steekproef ({n}) niet. Voeg een kanaal toe of verleng de looptijd.</div>}
          {assumption.primary?.locked ? (
            <p className="field-hint">
              Deze aanname heeft al een goedgekeurde hoofdtest. Deze test wordt verkennend: hij geeft richting, maar beslist niet over de aanname.
            </p>
          ) : (
            <label className="check-row">
              <input type="checkbox" name="is_primary" checked={isPrimary} onChange={(e) => setIsPrimary(e.target.checked)} />{" "}
              {assumption.primary ? "Maak dit de hoofdtest van deze aanname (vervangt de huidige hoofdtest, die nog niet is goedgekeurd)" : "Dit is de hoofdtest van deze aanname"}
            </label>
          )}
          <p className="field-hint">
            Per aanname wijs je vooraf één <Term k="hoofdtest">hoofdtest</Term> aan; alleen die beslist over de aanname. Andere tests heten <Term k="verkennende-test">verkennend</Term>. Na goedkeuring ligt de keuze vast.
          </p>
          {type === "interview" && (
            <>
              <div className="form-line">
                <label htmlFor="tc-guide">Gespreksleidraad (één vraag per regel)<RequiredMark /></label>
                <textarea className="field" id="tc-guide" name="guide" rows={9} value={guide} onChange={(e) => setGuide(e.target.value)} aria-describedby={shown.guide ? "err-guide tc-guide-audit" : "tc-guide-audit"} aria-invalid={shown.guide ? true : undefined} aria-required />
                {fieldError("guide")}
                <p className="field-hint">Vragen over gedrag in het verleden. Geen pitch en geen &quot;zou je dit kopen?&quot;. De controle staat hiernaast.</p>
              </div>
              <div className="form-line">
                <label htmlFor="tc-screen">Selectiecriteria en uitsluitingen</label>
                <textarea className="field" id="tc-screen" name="screener" rows={3} placeholder="Bijv. organiseert minstens 4 zakelijke events per jaar; geen vrienden of collega's" />
              </div>
            </>
          )}
          {(type === "landing" || type === "pricing") && (
            <>
              <div className="form-line"><label htmlFor="pg-name">Naam van het aanbod (merkneutraal)</label><input className="field" id="pg-name" name="product_name" value={page.product_name} onChange={(e) => setPage({ ...page, product_name: e.target.value })} /></div>
              <div className="form-line"><label htmlFor="pg-head">Kop<RequiredMark /></label><input className="field" id="pg-head" name="headline" value={page.headline} onChange={(e) => setPage({ ...page, headline: e.target.value })} {...aria("headline")} />{fieldError("headline")}</div>
              <div className="form-line"><label htmlFor="pg-sub">Ondertitel</label><input className="field" id="pg-sub" name="subline" value={page.subline} onChange={(e) => setPage({ ...page, subline: e.target.value })} /></div>
              <div className="form-line"><label htmlFor="pg-offer">Aanbod (wat krijgt iemand precies?)</label><textarea className="field" id="pg-offer" name="offer" rows={3} value={page.offer} onChange={(e) => setPage({ ...page, offer: e.target.value })} /></div>
              <div className="form-line"><label htmlFor="pg-cta">Knoptekst</label><input className="field" id="pg-cta" name="cta_label" value={page.cta_label} onChange={(e) => setPage({ ...page, cta_label: e.target.value })} /></div>
              {type === "pricing" && (
                <p className="field-hint" id="pp-hint">
                  {fromIntake
                    ? `Prijs uit de intake overgenomen: ${fromIntake.text}.${fromIntake.period ? "" : " De intake noemt geen periode: controleer die."}`
                    : "De intake noemt geen prijs: vul minstens één prijspunt in."}
                </p>
              )}
              {type === "pricing" &&
                prices.map((p, i) => (
                  <div className="double-field" key={i}>
                    <div className="form-line"><label htmlFor={`pp-l-${i}`}>Prijspunt {i + 1}: naam{i === 0 && <RequiredMark />}</label><input className="field" id={`pp-l-${i}`} name={`price_label_${i}`} {...(i === 0 ? aria("price_points") : {})} value={p.label} onChange={(e) => setPrices(prices.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} /></div>
                    <div className="form-line"><label htmlFor={`pp-a-${i}`}>Bedrag (€) en periode</label>
                      <div className="row" style={{ flexWrap: "nowrap" }}>
                        <input className="field num" id={`pp-a-${i}`} name={`price_amount_${i}`} inputMode="decimal" value={p.amount} onChange={(e) => setPrices(prices.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)))} />
                        <input className="field" aria-label={`Periode prijspunt ${i + 1}`} name={`price_period_${i}`} value={p.period} onChange={(e) => setPrices(prices.map((x, j) => (j === i ? { ...x, period: e.target.value } : x)))} />
                      </div>
                    </div>
                  </div>
                ))}
              {type === "pricing" && fieldError("price_points")}
              <label className="check-row"><input type="checkbox" name="collect_email" defaultChecked={type === "landing"} /> Na de klik om een e-mailadres vragen (met toestemming)</label>
              <div className="form-line"><label htmlFor="pg-reveal">Bericht na de klik</label><textarea className="field" id="pg-reveal" name="reveal_message" rows={3} defaultValue="Bedankt! We nemen contact op zodra we kunnen starten." /></div>
              <p className="field-hint">Na elke klik toont ProofLab altijd ook: “{HONEST_REVEAL}” Dit is niet uit te zetten.</p>
            </>
          )}
          </details>
          <div className="note">Je legt deze criteria vast vóór de test. Na goedkeuring zijn ze vergrendeld; wijzigen kan alleen met een nieuwe versie en een motivering.</div>
          <div className="tc-save" id="tc-save">
            {errs.length > 0 && (
              <div className="form-error" role="alert" aria-labelledby="tc-err-title">
                <p id="tc-err-title" style={{ margin: 0 }}>Nog niet opgeslagen: {errs.length === 1 ? "1 punt" : `${errs.length} punten`} {errs.length === 1 ? "moet" : "moeten"} nog worden aangevuld.</p>
                <ul style={{ margin: "6px 0 0 18px", padding: 0, fontWeight: 400 }}>
                  {errs.map((x) => (
                    <li key={x.field}>
                      <button type="button" className="text-link" onClick={() => focusField(x.field)}>{x.label}</button>: {x.message}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {serverOnly && <div className="form-error" role="alert">{serverOnly}</div>}
            <button type="submit" className="btn primary" style={{ marginTop: 18, width: "100%" }} disabled={saving}>
              {saving ? "Opslaan…" : "Test Card opslaan als concept"} <Icon name="arrow" size="sm" />
            </button>
          </div>
          <SavingOverlay active={saving} label="Test Card opslaan…" />
        </div>

        <div className="card" style={{ marginTop: 18 }}>
          <div className="section-title"><h2 className="as-h3">Zo ziet jouw experiment eruit</h2><span className="pill blue">Live preview</span></div>
          {type === "survey" ? (
            <>
              <input type="hidden" name="survey_config" value={JSON.stringify(survey)} />
              <div id="tc-survey" tabIndex={-1}>{fieldError("survey")}</div>
              {surveyDraftId && <input type="hidden" name="survey_ai_draft_id" value={surveyDraftId} />}
              <SurveyEditor
                value={survey}
                onChange={updateSurvey}
                productNames={[ideaTitle]}
                assumptionId={assumption.id}
                targetGroup={card.target_group}
                aiConnected={aiConnected}
                draftAction={surveyDraftAction}
                onDraftId={setSurveyDraftId}
              />
            </>
          ) : type === "interview" ? (
            <>
              {/* B5: de leidraad bewerk je onder Details; hier staat wat de deelnemer hoort. */}
              <ol className="signal-steps" aria-label="Gespreksleidraad">
                {guide.split("\n").map((q) => q.trim()).filter(Boolean).map((q, i) => <li key={i}>{q}</li>)}
              </ol>
              <div id="tc-guide-audit" aria-live="polite" className="mt-12">
                {auditSum.flagged === 0 ? (
                  <div className="form-ok" style={{ marginTop: 0 }}>Leidraadcontrole: geen hypothetische, sturende of verkopende vragen gevonden.</div>
                ) : (
                  <div className="note" style={{ marginTop: 0 }}>
                    <strong>Leidraadcontrole: {auditSum.flagged} van {auditSum.total} vragen verdienen aandacht.</strong> Dit zijn waarschuwingen; je beslist zelf.
                    <GuideAuditList audit={audit} />
                  </div>
                )}
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
                    <button type="button" className="btn ai sm mt-8" onClick={askVariants} disabled={variantsPending}>
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
              <p className="field-hint mt-12">Kop, aanbod{type === "pricing" ? " en prijspunten" : ""} pas je aan onder Details in de Test Card.</p>
            </>
          )}
        </div>
      </form>
    </>
  );
}
