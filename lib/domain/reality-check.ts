// Reality Check: a mandatory, rule-based review before every decision and report. It looks for
// the pitfalls of experimentation and for conclusions the evidence does not carry. AI can add
// critical questions on top, but these rules always run and cannot be switched off.

import type { ClaimStatus, DecisionAction } from "./labels";

export type Severity = "blocker" | "warning" | "info";

export type Finding = {
  code: string;
  severity: Severity;
  title: string;
  detail: string;
};

export type DossierFacts = {
  ideaAgeDays: number;
  clientDeciderInvited: boolean;
  claims: { status: ClaimStatus; section: string; sourceTypes: string[] }[];
  competitors: { kind: string }[];
  sizing: { established: boolean; assumedFactors: number; totalFactors: number; revenueFactorSourced: boolean } | null;
  assumptions: { statement: string; importance: number; category: string; status: string; evidence: number; contradicting: number }[];
  experiments: {
    type: "landing" | "interview" | "pricing";
    state: string;
    assumptionCategory: string;
    verdict: "pass" | "fail" | "inconclusive" | "running" | null;
    n: number;
    minSample: number;
    endedEarly: boolean;
    channels: string[];
  }[];
  interviews: { dmuRole: string; isAcquaintance: boolean; consent: boolean }[];
  observations: { kind: string; isBehaviour: boolean; isSynthetic: boolean; isCostly: boolean }[];
  learningCards: { status: "draft" | "approved"; verdict: "pass" | "fail" | "inconclusive" }[];
  decisionsAfterLastLearning: number;
  isB2B: boolean;
};

export type RealityCheckResult = {
  findings: Finding[];
  advice: DecisionAction;
  adviceReason: string;
  investorQuestions: string[];
};

const STRONG_SOURCE_TYPES = ["official_statistic", "primary_document", "research_report", "dataset_upload"];

export function runRealityCheck(f: DossierFacts): RealityCheckResult {
  const out: Finding[] = [];
  const add = (code: string, severity: Severity, title: string, detail: string) => out.push({ code, severity, title, detail });

  const started = f.experiments.filter((e) => !["draft", "ready_for_review", "approved"].includes(e.state));
  const behaviour = f.observations.filter((o) => o.isBehaviour && !o.isSynthetic);
  const costly = behaviour.filter((o) => o.isCostly);
  const synthetic = f.observations.filter((o) => o.isSynthetic);

  // --- Pitfalls of the method ---
  if (f.claims.length >= 10 && started.length === 0) {
    add("analysis_paralysis", "warning", "Veel onderzoek, nog geen test",
      `Er liggen ${f.claims.length} onderzoeksbevindingen, maar er is nog geen experiment gestart. Meer bureauonderzoek beantwoordt de beslisvraag niet.`);
  }
  if (f.ideaAgeDays > 21 && started.length === 0) {
    add("time_trap", "warning", "Tijdval",
      `Het traject loopt ${f.ideaAgeDays} dagen zonder experiment. Plan deze week een kleine test.`);
  }
  if (f.observations.length > 0 && behaviour.length === 0) {
    add("weak_data", "warning", "Alleen wat mensen zeggen",
      "Alle observaties zijn meningen of uitspraken. Er is nog geen waargenomen gedrag.");
  }
  const interviewObs = f.observations.filter((o) => ["problem_confirmed", "problem_absent", "counter_example", "objection", "current_behaviour", "current_spend"].includes(o.kind));
  const negatives = interviewObs.filter((o) => ["problem_absent", "counter_example", "objection"].includes(o.kind));
  if (f.interviews.length >= 5 && negatives.length === 0) {
    add("confirmation_bias", "warning", "Geen enkel tegengeluid",
      "Na vijf of meer interviews is er geen tegenvoorbeeld, bezwaar of 'herken ik niet' vastgelegd. Controleer op selectieve citaten.");
  }
  const top = [...f.assumptions].sort((a, b) => b.importance - a.importance || a.evidence - b.evidence)[0];
  if (top && top.evidence < 0.3 && f.experiments.length > 0) {
    add("too_few_experiments", "info", "Belangrijkste aanname nog zwak onderbouwd",
      `"${top.statement}" heeft nog weinig bewijs. Eén experiment is zelden genoeg voor de kritiekste aanname.`);
  }
  const approvedCards = f.learningCards.filter((c) => c.status === "approved");
  if (approvedCards.length > 0 && f.decisionsAfterLastLearning === 0) {
    add("failure_to_learn", "info", "Geleerd, nog niet besloten",
      "Er is een goedgekeurde Learning Card zonder vervolgbesluit. Leren zonder bijsturen is de valkuil 'niet aanpassen'.");
  }
  if (!f.clientDeciderInvited) {
    add("outsourced_testing", "warning", "Opdrachtgever niet betrokken",
      "Er is geen opdrachtgever uitgenodigd om mee te beslissen. Als het leren alleen bij de consultant zit, is testen uitbesteed.");
  }

  // --- Red flags on research quality ---
  if (f.claims.length > 0) {
    const independent = f.claims.some((c) => c.sourceTypes.some((t) => STRONG_SOURCE_TYPES.includes(t)));
    if (!independent) {
      add("no_independent_source", "warning", "Geen onafhankelijke marktbron",
        "Alle bevindingen steunen op bedrijfswebsites, nieuws of blogs. Voeg een officiële statistiek of onderzoeksrapport toe.");
    }
    const contested = f.claims.filter((c) => c.status === "contested").length;
    if (contested) {
      add("contested_claims", "warning", `${contested} bewering(en) met tegenstrijdige bronnen`,
        "Los de tegenstrijdigheid op of neem beide waarden mee in de scenario's.");
    }
  }
  if (f.competitors.length > 0 && !f.competitors.some((c) => c.kind === "alternative" || c.kind === "status_quo")) {
    add("missing_alternatives", "warning", "Huidige alternatieven ontbreken",
      "De concurrentiekaart mist hoe klanten het nu zonder product oplossen, of 'niets doen'.");
  }
  if (f.sizing) {
    if (!f.sizing.established) {
      add("sizing_unestablished", "warning", "Marktomvang niet vastgesteld",
        "Het basisaantal in de marktomvang heeft geen gecontroleerde bron. Het is een verkennend scenario.");
    }
    if (!f.sizing.revenueFactorSourced) {
      add("price_assumed", "warning", "Omzet rust op een aangenomen prijs",
        "De omzet per klant is niet onderbouwd met prijsonderzoek of een test. Presenteer de omzet niet als potentieel.");
    }
  }

  // --- Experiment quality ---
  for (const e of started) {
    if (e.assumptionCategory === "viability" && e.type === "landing") {
      add("clicks_claimed_as_payment", "warning", "Klikken gemeten, betaling geclaimd",
        "Een landingspagina meet belangstelling. Voor een aanname over betalen is een prijs- of aanbodtest nodig.");
    }
    if (e.verdict && e.verdict !== "running" && e.n < e.minSample) {
      add("small_sample", "warning", "Te kleine steekproef",
        `Een experiment eindigde met ${e.n} deelnemers terwijl er ${e.minSample} waren afgesproken.`);
    }
    if (e.endedEarly) {
      add("ended_early", "info", "Test vroegtijdig beëindigd",
        "Een vroegtijdig gestopte test kan toevallig gunstig of ongunstig uitvallen. Vermeld dit in het rapport.");
    }
    if (e.type !== "interview" && e.channels.length === 1 && e.channels[0] === "network") {
      add("warm_traffic_only", "info", "Alleen warm verkeer",
        "Alle bezoekers kwamen uit het eigen netwerk. Bekenden reageren positiever dan onbekende klanten.");
    }
  }
  if (f.interviews.length > 0) {
    const acquainted = f.interviews.filter((i) => i.isAcquaintance).length;
    if (acquainted / f.interviews.length > 0.5) {
      add("friendly_sample", "warning", "Vooral bekenden geïnterviewd",
        `${acquainted} van de ${f.interviews.length} geïnterviewden zijn bekenden. Dat vertekent naar positief.`);
    }
    if (f.isB2B && !f.interviews.some((i) => i.dmuRole === "decider" || i.dmuRole === "buyer")) {
      add("no_budget_holder", "warning", "Geen budgethouder gesproken",
        "In B2B beslist vaak iemand anders dan de gebruiker. Spreek ook de inkoper of budgethouder.");
    }
    const noConsent = f.interviews.filter((i) => !i.consent).length;
    if (noConsent) {
      add("missing_consent", "blocker", "Interviews zonder vastgelegde toestemming",
        `${noConsent} interview(s) hebben geen vastgelegde toestemming. Verwijder ze of leg de grondslag vast voordat je ze gebruikt.`);
    }
  }
  if (synthetic.length) {
    add("synthetic_excluded", "info", "Synthetische data uitgesloten",
      `${synthetic.length} synthetische observatie(s) zijn uitgesloten van elk oordeel.`);
  }

  // --- Advice ---
  const critical = f.assumptions.filter((a) => a.importance >= 4);
  const refutedCritical = critical.filter((a) => a.status === "refuted");
  const failed = f.learningCards.filter((c) => c.status === "approved" && c.verdict === "fail");
  const passed = f.learningCards.filter((c) => c.status === "approved" && c.verdict === "pass");
  const blockers = out.filter((x) => x.severity === "blocker");
  const criticalWeak = critical.filter((a) => a.status !== "supported");

  let advice: DecisionAction;
  let reason: string;
  if (blockers.length) {
    advice = "pause";
    reason = "Er zijn blokkerende problemen in het dossier die eerst moeten worden opgelost.";
  } else if (refutedCritical.length && failed.length >= 2) {
    advice = "stop";
    reason = "Meerdere tests spreken een kritieke aanname tegen. Doorgaan zou geld kosten zonder onderbouwing.";
  } else if (refutedCritical.length || failed.length) {
    advice = "adjust";
    reason = "Een kritieke aanname wordt tegengesproken. Pas aanbod, doelgroep of belofte aan en toets opnieuw.";
  } else if (passed.length && costly.length && criticalWeak.length === 0) {
    advice = "continue";
    reason = "De kritieke aannames zijn ondersteund, inclusief gedrag waarin klanten iets investeren.";
  } else if (behaviour.length === 0) {
    advice = "test_more";
    reason = "Er is nog geen waargenomen klantgedrag. Bureauonderzoek alleen draagt deze beslissing niet.";
  } else {
    advice = "test_more";
    reason = criticalWeak.length
      ? `${criticalWeak.length} kritieke aanname(s) zijn nog niet ondersteund door voldoende bewijs.`
      : "Het bewijs is positief maar nog niet sterk genoeg (geen betaling of toezegging).";
  }

  return {
    findings: out.sort((a, b) => rank(a.severity) - rank(b.severity)),
    advice,
    adviceReason: reason,
    investorQuestions: [
      "Welk bewijs laat zien dat klanten hiervoor betalen, niet alleen dat ze het interessant vinden?",
      "Welke bevinding spreekt het idee het sterkst tegen, en hoe weegt die mee?",
      "Welke alternatieve verklaring voor het resultaat hebben we niet uitgesloten?",
      "Hoe groot is de markt als we alleen de onderbouwde factoren gebruiken?",
      "Onder welke uitkomst van de volgende test stoppen we?",
    ],
  };
}

function rank(s: Severity): number {
  return s === "blocker" ? 0 : s === "warning" ? 1 : 2;
}
