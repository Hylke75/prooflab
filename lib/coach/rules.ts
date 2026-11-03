// Trajectory coach: deterministic rules over the whole dossier. Pure functions, no I/O, so every rule is
// unit-tested. Each rule has a stable code; a rule posts a note while its condition holds and closes its own
// open note when the condition is gone. Notes are advice about the process, never evidence.

import { OWN_BASE_RATE_MIN, openMoment } from "@/lib/domain/forecast";
import { OVERCONFIDENT_GAP, overconfidence } from "@/lib/domain/calibration";

export type NoteKind = "tip" | "warning" | "question" | "praise";
export type NoteAudience = "consultant" | "everyone";

export const NOTE_KINDS: Record<NoteKind, { label: string; pill: string; icon: "spark" | "info" | "users" | "check" }> = {
  tip: { label: "Tip", pill: "blue", icon: "spark" },
  warning: { label: "Let op", pill: "orange", icon: "info" },
  question: { label: "Vraag", pill: "gray", icon: "users" },
  praise: { label: "Goed bezig", pill: "green", icon: "check" },
};

export type CoachNoteDraft = {
  code: string;
  kind: NoteKind;
  title: string;
  body: string;
  href: string;
  audience: NoteAudience;
  // A note that is posted at most once per dossier (praise for a first time).
  once?: boolean;
};

export type ForecastMoment = "intake" | "research" | "experiment" | "decision";

export const FORECAST_MOMENTS: Record<ForecastMoment, string> = {
  intake: "na de intake",
  research: "na het marktonderzoek",
  experiment: "na het eerste experiment",
  decision: "bij het besluit",
};

export type CoachFacts = {
  ideaId: string;
  today: string; // YYYY-MM-DD (Netherlands)
  now: number; // ms since epoch
  sprint: { week: number; weeks: number; state: "not_started" | "running" | "finished"; behindReason: string | null } | null;
  claims: { id: string; statement: string; exactSources: { sourceType: string; isPrimary: boolean }[] }[];
  competitorKinds: string[];
  sourceTypes: string[];
  assumptions: { id: string; statement: string; importance: number; status: string }[];
  experiments: {
    id: string;
    title: string;
    type: string;
    state: string;
    startedAt: string | null;
    endsAt: string | null;
    n: number;
    minSample: number;
    locked: boolean;
    successThresholdPct: number | null;
    failThresholdPct: number | null;
    guide: string[];
    // The assumption the experiment tests (optional for callers that do not know it).
    assumptionId?: string | null;
  }[];
  interviews: { isAcquaintance: boolean }[];
  observations: { kind: string; isBehaviour: boolean; isSynthetic: boolean; createdAt: string }[];
  learningCards: { id: string; status: string; approvedAt: string | null }[];
  realityCheck: { id: string; createdAt: string } | null;
  decisions: { id: string; decidedAt: string; confirmed: boolean }[]; // oldest first
  decisionDeadline: string | null;
  clientDeciderInvited: boolean;
  // question: "stop_review" na een stop of pauze (golf B, punt 1); resolved geldt dan voor de stopvraag.
  outcome: { defined: boolean; due: string | null; resolved: boolean; checkins: string[]; clockStart?: string | null; question?: "success" | "stop_review" };
  // Probabilities only for forecasts the reviewing consultant may see (blind rule, enforced by the database).
  forecasts: { moment: string; kind: string; probability?: number }[];
  // Base rate chosen for this dossier (null: none or "no good reference") and the number of resolved dossiers
  // of the organisation (for the starting calibration before there are enough own outcomes).
  baseRate?: { low: number; high: number } | null;
  // Of er een basispercentage is gekozen, ook "geen goede referentie" (dan is voorspellen toegestaan). Onbekend
  // telt als niet gekozen: de coach vraagt nooit om een voorspelling die de pagina weigert.
  baseRateChosen?: boolean;
  // Beslisvraag en grootste onzekerheid uit de intake (optioneel voor aanroepers die ze niet kennen).
  idea?: { decisionQuestion: string; keyUncertainty: string | null };
  orgResolved?: number;
  // Golf B, punt 6: of het dossier een beslisregel heeft (undefined = onbekend; dan blijft de regel stil).
  decisionRule?: { defined: boolean; locked: boolean };
  outreach: { replies: number; latestReplyAt: string | null; latestImportAt: string | null };
};

const DAY = 86_400_000;
// Below this many data points (interviews, respondents, visitors) for an assumption, a survey adds breadth.
export const SURVEY_SUGGEST_BELOW = 20;

const CUSTOMER_VOICE = ["review_site", "forum", "outreach", "interview", "survey"];
const BEHAVIOUR_TESTS = ["landing", "pricing"];
const ENDED = ["ended", "analyzed", "decided"];

function dayNumber(date: string): number {
  const [y, m, d] = date.slice(0, 10).split("-").map(Number);
  return Math.floor(Date.UTC(y, m - 1, d) / DAY);
}

export function daysBetween(from: string, to: string): number {
  return dayNumber(to) - dayNumber(from);
}

const newer = (a: string | null | undefined, b: string | null | undefined) => !!a && (!b || new Date(a).getTime() > new Date(b).getTime());
const maxIso = (list: (string | null | undefined)[]) => list.filter((x): x is string => !!x).sort().pop() ?? null;
const short = (s: string, n = 90) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

// Questions that ask for an opinion about a hypothetical future instead of past behaviour.
const HYPOTHETICAL =
  /\b(zou(den)?\s+(u|je|jij|jullie)\b|stel\s+(je|u)?\s*(eens\s+)?(voor\s+)?dat\b|wat\s+als\b|zou\s+het\b|bent\s+u\s+bereid|ben\s+je\s+bereid|wil(t)?\s+(u|je|jij)\s+(betalen|kopen|gebruiken|overstappen)|would\s+you|if\s+we\b)/i;

export function hypotheticalQuestions(guide: string[]): string[] {
  return guide.filter((q) => HYPOTHETICAL.test(q));
}

// The forecast moment that is open now. Same rule as the database (open_forecast_moment) and the outcome
// page (lib/domain/forecast.ts openMoment), so the coach never asks for a forecast the database refuses.
export function openForecastMoment(f: CoachFacts): ForecastMoment | null {
  return openMoment({
    outcomeDefined: f.outcome.defined,
    resolved: f.outcome.resolved,
    marketDone: f.claims.length > 0 && f.competitorKinds.some((k) => k === "alternative" || k === "status_quo"),
    experimentEnded: f.experiments.some((e) => ["ended", "analyzed", "decided"].includes(e.state)),
    realityCheckDone: !!f.realityCheck,
    outcomeDue: f.outcome.due,
    clockStart: f.outcome.clockStart ?? null,
    stopped: f.outcome.question === "stop_review",
    today: f.today,
  });
}

// Pace extrapolation for a live test: participants expected at the end date at the current rate.
export function projectedSample(e: { n: number; startedAt: string | null; endsAt: string | null }, now: number): { projected: number; elapsedDays: number; totalDays: number } | null {
  if (!e.startedAt || !e.endsAt) return null;
  const s = new Date(e.startedAt).getTime();
  const end = new Date(e.endsAt).getTime();
  if (!Number.isFinite(s) || !Number.isFinite(end) || end <= s || now <= s || now >= end) return null;
  const elapsedDays = (now - s) / DAY;
  const totalDays = (end - s) / DAY;
  return { projected: Math.floor((e.n / elapsedDays) * totalDays), elapsedDays, totalDays };
}

// Gaat de beslisvraag of de grootste onzekerheid over betalingsbereidheid? Dan is de belangrijkste aanname al bij
// de intake bekend, en hoeft die niet op het einde van het onderzoek te wachten.
const PAYMENT = /\b(betal\w*|prijs\w*|prijzen|budget\w*|kosten|kost|tarie[fv]\w*|willen\s+betalen|betalingsbereid\w*|geld\s+voor)\b/i;

export function paymentFocused(...texts: (string | null | undefined)[]): boolean {
  return texts.some((t) => !!t && PAYMENT.test(t));
}

type Rule = (f: CoachFacts, base: string) => CoachNoteDraft | CoachNoteDraft[] | null;

export const RULES: Record<string, Rule> = {
  alternatives_missing: (f, base) => {
    if (f.claims.length === 0 || f.competitorKinds.some((k) => k === "alternative" || k === "status_quo")) return null;
    return {
      code: "alternatives_missing",
      kind: "warning",
      title: "Huidige alternatieven ontbreken nog",
      body: "Er zijn bevindingen, maar nog geen huidig alternatief of 'niets doen' in kaart. Klanten vergelijken je idee met wat ze nu al doen; dat is vaak de echte concurrent.",
      href: `${base}/research?tab=competitors`,
      audience: "consultant",
    };
  },

  // Aannames en pre-mortem al in week 1, parallel aan het onderzoek. Er wordt niets geblokkeerd.
  assumptions_early: (f, base) => {
    if (f.assumptions.length > 0 || f.experiments.length > 0 || f.decisions.length > 0) return null;
    if (f.sprint && f.sprint.state === "running" && f.sprint.week > 2) return null; // critical_untested en sprint_behind nemen het over
    const pay = paymentFocused(f.idea?.decisionQuestion, f.idea?.keyUncertainty);
    return {
      code: "assumptions_early",
      kind: "tip",
      title: pay ? "Leg de betaalaanname nu al vast" : "Begin al met aannames en een pre-mortem",
      body: pay
        ? "De beslisvraag of de grootste onzekerheid gaat over betalen of prijs. Schrijf die aanname nu al op en doe de pre-mortem: dan kun je een prijs- of aanbodtest voorbereiden terwijl het marktonderzoek loopt."
        : "Je hoeft niet te wachten tot het onderzoek af is. Schrijf de belangrijkste aannames op en doe de pre-mortem ('het is mislukt: waarom?'); het onderzoek kan ze daarna gericht toetsen.",
      href: `${base}/assumptions#nieuwe-aanname`,
      audience: "consultant",
    };
  },

  single_secondary_source: (f, base) => {
    const weak = f.claims.filter(
      (c) => c.exactSources.length === 1 && !c.exactSources[0].isPrimary && !["official_statistic", "primary_document"].includes(c.exactSources[0].sourceType),
    );
    if (weak.length === 0) return null;
    return {
      code: "single_secondary_source",
      kind: "warning",
      title: `${plural(weak.length, "bevinding steunt", "bevindingen steunen")} op één secundaire bron`,
      body: `Bijvoorbeeld "${short(weak[0].statement)}". Zoek een tweede onafhankelijke of primaire bron: één overgenomen bron kan een fout of verouderd cijfer doorgeven.`,
      href: `${base}/research?tab=sources`,
      audience: "consultant",
    };
  },

  opinions_no_behaviour: (f, base) => {
    const real = f.observations.filter((o) => !o.isSynthetic);
    const opinions = real.filter((o) => o.kind === "opinion").length;
    if (opinions < 3 || real.some((o) => o.isBehaviour)) return null;
    return {
      code: "opinions_no_behaviour",
      kind: "warning",
      title: "Veel meningen, nog geen gedrag",
      body: `Er zijn ${opinions} meningen vastgelegd maar nog geen waargenomen handeling. Mensen zijn vriendelijk over ideeën; een aanvraag, aanmelding of aanbetaling zegt veel meer.`,
      href: `${base}/experiments`,
      audience: "consultant",
    };
  },

  critical_untested: (f, base) => {
    if (!f.sprint || f.sprint.state !== "running" || f.sprint.week < 3) return null;
    const a = [...f.assumptions].filter((x) => x.importance >= 4 && x.status === "untested").sort((x, y) => y.importance - x.importance)[0];
    if (!a) return null;
    return {
      code: `critical_untested:${a.id}`,
      kind: "warning",
      title: `Kritieke aanname nog niet getest in week ${f.sprint.week}`,
      body: `"${short(a.statement)}" weegt zwaar (${a.importance}/5) maar is nog niet getest. Werving en meting kosten tijd; zonder test beslis je straks op een aanname.`,
      href: `${base}/experiments?assumption=${a.id}`,
      audience: "consultant",
    };
  },

  test_pace: (f, base) =>
    f.experiments.flatMap((e) => {
      if (e.state !== "live" || e.minSample <= 0 || e.n >= e.minSample) return [];
      const p = projectedSample(e, f.now);
      if (!p || p.elapsedDays < 2 || p.projected >= e.minSample) return [];
      return [
        {
          code: `test_pace:${e.id}`,
          kind: "warning" as const,
          title: `"${short(e.title, 60)}" haalt de steekproef waarschijnlijk niet`,
          body: `In ${Math.floor(p.elapsedDays)} dagen kwamen ${e.n} deelnemers; in dit tempo zijn het er rond ${p.projected} van de minimaal ${e.minSample} op de einddatum. Werf nu extra via een ander kanaal, anders eindigt de test onbeslist.`,
          href: `${base}/experiments/${e.id}`,
          audience: "consultant" as const,
        },
      ];
    }),

  interview_hypothetical: (f, base) =>
    f.experiments.flatMap((e) => {
      if (e.type !== "interview" || ["ended", "analyzed", "decided"].includes(e.state)) return [];
      const bad = hypotheticalQuestions(e.guide);
      if (bad.length === 0) return [];
      return [
        {
          code: `interview_hypothetical:${e.id}`,
          kind: "tip" as const,
          title: "De gespreksleidraad bevat hypothetische vragen",
          body: `Bijvoorbeeld "${short(bad[0], 80)}". Vraag naar gedrag in het verleden ("Wanneer deed u dit voor het laatst?"): wat mensen zeggen te gaan doen, voorspelt slecht wat ze doen.`,
          href: `${base}/experiments/${e.id}`,
          audience: "consultant" as const,
        },
      ];
    }),

  // Interviews told us how people deal with it; a survey shows how often that holds among many more people.
  // Proactive: the coach offers to make the first draft. One note, for the most important assumption.
  survey_suggest: (f, base) => {
    const done = new Set(["refuted", "supported"]);
    const candidates = f.assumptions
      .filter((a) => a.importance >= 4 && !done.has(a.status))
      .map((a) => {
        const tests = f.experiments.filter((e) => e.assumptionId === a.id);
        const interviews = tests.filter((e) => e.type === "interview").reduce((s, e) => s + e.n, 0);
        const points = tests.reduce((s, e) => s + e.n, 0);
        return { a, interviews, points, hasSurvey: tests.some((e) => e.type === "survey") };
      })
      .filter((c) => c.interviews > 0 && c.points < SURVEY_SUGGEST_BELOW && !c.hasSurvey)
      .sort((x, y) => y.a.importance - x.a.importance || x.points - y.points);
    const c = candidates[0];
    if (!c) return null;
    return {
      code: `survey_suggest:${c.a.id}`,
      kind: "tip",
      title: "Meet met een enquête hoe breed het speelt",
      body: `"${short(c.a.statement)}" heeft interviewbewijs (${plural(c.interviews, "gesprek", "gesprekken")}), maar nog maar ${plural(c.points, "datapunt", "datapunten")}. Laat de coach een eerste opzet voor een enquête maken; nodig bij voorkeur bekende respondenten persoonlijk uit. Het blijft zelfrapportage, geen gedrag.`,
      href: `${base}/experiments?assumption=${c.a.id}&type=survey`,
      audience: "consultant",
    };
  },

  acquaintances_majority: (f, base) => {
    if (f.interviews.length < 3) return null;
    const known = f.interviews.filter((i) => i.isAcquaintance).length;
    if (known / f.interviews.length <= 0.5) return null;
    return {
      code: "acquaintances_majority",
      kind: "warning",
      title: "Meer dan de helft van de geïnterviewden zijn bekenden",
      body: `${known} van de ${f.interviews.length} gesprekken waren met bekenden. Bekenden zijn milder en lijken op jou; werf de volgende gesprekken buiten je eigen netwerk.`,
      href: `${base}/experiments`,
      audience: "consultant",
    };
  },

  learning_card_waiting: (f, base) => {
    const drafts = f.learningCards.filter((c) => c.status === "draft");
    if (drafts.length === 0) return null;
    return {
      code: "learning_card_waiting",
      kind: "question",
      title: drafts.length === 1 ? "Een Learning Card wacht op goedkeuring" : `${drafts.length} Learning Cards wachten op goedkeuring`,
      body: "Klopt wat we verwachtten, wat we zagen en wat we daarom doen? Pas na goedkeuring telt de les mee in de Reality Check en het rapport.",
      href: `${base}/evidence`,
      audience: "consultant",
    };
  },

  reality_check_stale: (f, base) => {
    if (!f.realityCheck) return null;
    const latestEvidence = maxIso([
      ...f.learningCards.filter((c) => c.status === "approved").map((c) => c.approvedAt),
      ...f.observations.filter((o) => !o.isSynthetic).map((o) => o.createdAt),
    ]);
    if (!newer(latestEvidence, f.realityCheck.createdAt)) return null;
    return {
      code: `reality_check_stale:${f.realityCheck.id}`,
      kind: "warning",
      title: "De Reality Check is verouderd",
      body: "Er is nieuw bewijs binnengekomen na de laatste check. Doe hem opnieuw vóór het besluit, zodat tegenbewijs en valkuilen op het actuele dossier zijn getoetst.",
      href: `${base}/evidence`,
      audience: "consultant",
    };
  },

  decision_deadline: (f, base) => {
    if (!f.decisionDeadline || f.decisions.length > 0) return null;
    const left = daysBetween(f.today, f.decisionDeadline);
    if (left > 7) return null;
    return {
      code: `decision_deadline:${f.decisionDeadline.slice(0, 10)}`,
      kind: "warning",
      title: left < 0 ? "De besluitdatum is verstreken" : left === 0 ? "Vandaag is de besluitdatum" : `Besluitdatum over ${plural(left, "dag", "dagen")}`,
      body: "Er is nog geen besluit vastgelegd. Plan de besluitsessie met de opdrachtgever en zorg dat Learning Cards en Reality Check vooraf klaar zijn.",
      href: `${base}/evidence`,
      audience: "consultant",
    };
  },

  decision_confirm: (f, base) => {
    const last = f.decisions[f.decisions.length - 1];
    if (!last || last.confirmed || !f.clientDeciderInvited) return null;
    return {
      code: `decision_confirm:${last.id}`,
      kind: "question",
      title: "Er staat een besluit klaar om te bevestigen",
      body: "Het onderzoeksteam heeft een besluit vastgelegd op basis van het bewijs. De aangewezen beslisser bevestigt het in ProofLab, zodat het als gedeeld besluit in het rapport komt.",
      href: `${base}/evidence`,
      audience: "everyone",
    };
  },

  outcome_undefined: (f, base) => {
    if (f.outcome.defined || f.outcome.resolved) return null;
    if (f.claims.length === 0 && !(f.sprint && f.sprint.state !== "not_started")) return null;
    return {
      code: "outcome_undefined",
      kind: "tip",
      title: "Leg vast wat 'geslaagd' betekent",
      body: "Zonder meetbare uitkomst met datum kan niemand achteraf zeggen of het besluit goed was. Bijvoorbeeld: 'Op 1 juli 2027 hebben minstens 15 klanten betaald.'",
      href: `${base}/outcome`,
      audience: "consultant",
    };
  },

  forecast_missing: (f, base) => {
    if (!f.outcome.defined || f.outcome.resolved) return null;
    const m = openForecastMoment(f);
    if (!m) return null;
    if (f.forecasts.some((x) => x.moment === m && x.kind === "consultant")) return null;
    // Voorspellen kan pas vanaf een basispercentage: eerst die tip, dan pas de vraag om een kans.
    if (!f.baseRateChosen)
      return {
        code: "base_rate_missing",
        kind: "tip",
        title: "Kies een basispercentage",
        body: "Hoe vaak slagen vergelijkbare ideeën? Kies een referentie met bron (of leg uit waarom er geen goede is). Daarna kun je voorspellen, vanaf dat vertrekpunt.",
        href: `${base}/outcome#basispercentage`,
        audience: "consultant",
      };
    return {
      code: `forecast:${m}`,
      kind: "question",
      title: `Hoe groot schat je de kans nu, ${FORECAST_MOMENTS[m]}?`,
      body: "Geef blind een kans (5–95%) op de vastgelegde uitkomst, met één zin waarom. Zo zie je later of het team goed voorspelt en welk bewijs echt telde.",
      href: `${base}/outcome`,
      audience: "consultant",
    };
  },

  // Starting calibration (research 3.2/3.4): until there are enough own resolved dossiers, the base rate is
  // the best anchor. A forecast far from it without an ended behaviour test is probably overconfident. The
  // note names no person, value or direction, so it reveals nothing about blind forecasts.
  forecast_overconfident: (f, base) => {
    if (!f.baseRate || f.outcome.resolved || (f.orgResolved ?? 0) >= OWN_BASE_RATE_MIN) return null;
    if (f.experiments.some((e) => BEHAVIOUR_TESTS.includes(e.type) && ENDED.includes(e.state))) return null;
    const order = ["intake", "research", "experiment", "decision"];
    const flagged = f.forecasts
      .filter((x) => (x.kind === "consultant" || x.kind === "client") && x.probability != null)
      .filter((x) => overconfidence(x.probability!, f.baseRate, false)?.flagged)
      .sort((a, b) => order.indexOf(b.moment) - order.indexOf(a.moment))[0];
    if (!flagged) return null;
    const m = (flagged.moment in FORECAST_MOMENTS ? flagged.moment : "intake") as ForecastMoment;
    const pts = Math.round(OVERCONFIDENT_GAP * 100);
    return {
      code: `forecast_overconfident:${m}`,
      kind: "question",
      title: "Een voorspelling ligt ver van het basispercentage",
      body:
        `Minstens één voorspelling ${FORECAST_MOMENTS[m]} ligt meer dan ${pts} procentpunten van het basispercentage ` +
        `(${Math.round(f.baseRate.low * 100)}–${Math.round(f.baseRate.high * 100)}%), zonder afgeronde landingpage- of prijstest. ` +
        "Het basispercentage zegt hoe vaak vergelijkbare ideeën slagen; zonder gedragsbewijs blijven goede voorspellers daar dichtbij. " +
        "Afwijken mag, maar noteer welk bewijs dat rechtvaardigt.",
      href: `${base}/outcome#kalibratiehulp`,
      audience: "consultant",
    };
  },

  outcome_due: (f, base) => {
    if (f.outcome.resolved || !f.outcome.due || f.decisions.length === 0) return null;
    if (daysBetween(f.today, f.outcome.due) > 0) return null;
    if (f.outcome.question === "stop_review")
      return {
        code: "stop_review_due",
        kind: "warning",
        title: "Was stoppen achteraf terecht?",
        body: "Zes maanden na het stop- of pauzebesluit: leg met bewijs vast of stoppen terecht was. Het telt mee bij de terechte stops, niet in de kalibratie van slagingskansen.",
        href: `${base}/outcome#uitkomst`,
        audience: "consultant",
      };
    return {
      code: "outcome_due",
      kind: "warning",
      title: "Tijd om de werkelijke uitkomst vast te leggen",
      body: "De afgesproken uitkomstdatum is bereikt. Leg met bewijs vast of het doel is gehaald; alleen zo leert het team van zijn voorspellingen.",
      href: `${base}/outcome`,
      audience: "consultant",
    };
  },

  outcome_checkin: (f, base) => {
    const last = f.decisions[f.decisions.length - 1];
    if (f.outcome.resolved || !last || !f.outcome.defined || f.outcome.question === "stop_review") return null;
    if (f.outcome.due && daysBetween(f.today, f.outcome.due) <= 0) return null; // outcome_due takes over
    const decided = last.decidedAt.slice(0, 10);
    if (daysBetween(decided, f.today) < 90) return null;
    if (f.outcome.checkins.some((c) => daysBetween(decided, c.slice(0, 10)) >= 60)) return null;
    return {
      code: `outcome_checkin:${last.id}`,
      kind: "tip",
      title: "De check-in na drie maanden is aan de beurt",
      body: "Het besluit is drie maanden oud. Noteer kort of de uitkomst op koers ligt; zo zie je vroeg of bijsturen nodig is.",
      href: `${base}/outcome`,
      audience: "consultant",
    };
  },

  decision_rule_missing: (f, base) => {
    if (!f.decisionRule || f.decisionRule.defined || f.decisions.length > 0 || f.experiments.length === 0) return null;
    const approved = f.experiments.some((e) => !["draft", "ready_for_review"].includes(e.state));
    return {
      code: approved ? "decision_rule_missing:late" : "decision_rule_missing",
      kind: approved ? "warning" : "tip",
      title: approved ? "De beslisregel ontbreekt, terwijl er al getest wordt" : "Leg de beslisregel vast vóór de eerste test",
      body: approved
        ? "Er is al een test goedgekeurd zonder vooraf vastgelegde beslisregel. Leg hem alsnog vast: hij staat dan als 'achteraf vastgelegd' in het rapport."
        : "Welke aannames moeten boven welke kans uitkomen, en welke hoofdtest moet slagen, om door te gaan? Leg dat nu vast; bij de eerste goedgekeurde test gaat de regel op slot.",
      href: `${base}/assumptions#beslisregel`,
      audience: "consultant",
    };
  },

  sprint_behind: (f, base) => {
    if (!f.sprint?.behindReason) return null;
    return {
      code: `sprint_behind:w${f.sprint.week}`,
      kind: "warning",
      title: "De sprint loopt achter",
      body: `${f.sprint.behindReason} Kies de stap die het meeste onzekerheid wegneemt en schuif de rest door.`,
      href: base,
      audience: "consultant",
    };
  },

  no_customer_voice: (f, base) => {
    if (f.claims.length < 3 || f.interviews.length > 0 || f.sourceTypes.some((t) => CUSTOMER_VOICE.includes(t))) return null;
    return {
      code: "no_customer_voice",
      kind: "tip",
      title: "Haal de stem van de klant erbij",
      body: "De bronnen gaan nu over markt en aanbod. Reviews van concurrenten, forumdraden en LinkedIn-antwoorden laten zien welke problemen klanten zelf noemen.",
      href: `${base}/integrations`,
      audience: "consultant",
    };
  },

  outreach_unimported: (f, base) => {
    if (f.outreach.replies === 0 || !newer(f.outreach.latestReplyAt, f.outreach.latestImportAt)) return null;
    return {
      code: "outreach_unimported",
      kind: "tip",
      title: "Nieuwe LinkedIn-antwoorden klaar om op te nemen",
      body: "Via Expandi kwamen antwoorden binnen die nog niet als klantsignaal in de bronnen staan. Neem ze op, zodat ze meetellen in de analyse van klantsignalen.",
      href: `${base}/integrations`,
      audience: "consultant",
    };
  },

  praise_first_behaviour: (f, base) => {
    if (!f.observations.some((o) => o.isBehaviour && !o.isSynthetic)) return null;
    return {
      code: "praise_first_behaviour",
      kind: "praise",
      title: "Het eerste echte klantgedrag is binnen",
      body: "Iemand deed iets in plaats van alleen iets te vinden: dat is sterker bewijs. Kijk wel uit welk kanaal het komt voordat je het generaliseert.",
      href: `${base}/evidence`,
      audience: "consultant",
      once: true,
    };
  },

  praise_preregistered: (f, base) =>
    f.experiments.flatMap((e) => {
      if (!e.locked || !["approved", "live", "paused"].includes(e.state)) return [];
      if (e.successThresholdPct == null || e.failThresholdPct == null || e.minSample <= 0) return [];
      return [
        {
          code: `praise_prereg:${e.id}`,
          kind: "praise" as const,
          title: "Test netjes vooraf vastgelegd",
          body: `"${short(e.title, 70)}" heeft vooraf een succes- en faaldrempel en een minimale steekproef. Daardoor kan niemand achteraf ongemerkt de lat verleggen.`,
          href: `${base}/experiments/${e.id}`,
          audience: "consultant" as const,
          once: true,
        },
      ];
    }),
};

// Short Dutch names per rule code (the part before ':'), for the learning page.
export const RULE_LABELS: Record<string, string> = {
  alternatives_missing: "Huidige alternatieven ontbreken",
  assumptions_early: "Aannames al in week 1",
  single_secondary_source: "Eén secundaire bron",
  opinions_no_behaviour: "Veel meningen, geen gedrag",
  critical_untested: "Kritieke aanname niet getest",
  test_pace: "Steekproef niet op tempo",
  interview_hypothetical: "Hypothetische interviewvragen",
  survey_suggest: "Enquête voorstellen",
  acquaintances_majority: "Vooral bekenden geïnterviewd",
  learning_card_waiting: "Learning Card wacht",
  reality_check_stale: "Reality Check verouderd",
  decision_deadline: "Besluitdatum nadert",
  decision_confirm: "Besluit bevestigen",
  outcome_undefined: "Uitkomst niet vastgelegd",
  forecast: "Voorspelling ontbreekt",
  base_rate_missing: "Basispercentage ontbreekt",
  forecast_overconfident: "Voorspelling ver van basispercentage",
  outcome_due: "Uitkomst vastleggen",
  stop_review_due: "Was stoppen terecht?",
  outcome_checkin: "Check-in na drie maanden",
  decision_rule_missing: "Beslisregel ontbreekt",
  sprint_behind: "Sprint loopt achter",
  no_customer_voice: "Stem van de klant ontbreekt",
  outreach_unimported: "LinkedIn-antwoorden niet opgenomen",
  praise_first_behaviour: "Eerste klantgedrag (compliment)",
  praise_prereg: "Test vooraf vastgelegd (compliment)",
  ai: "AI-coach",
};

export const ruleLabel = (rule: string) => RULE_LABELS[rule] ?? rule;

export function evaluateRules(f: CoachFacts): CoachNoteDraft[] {
  const base = `/app/ideas/${f.ideaId}`;
  const out: CoachNoteDraft[] = [];
  for (const rule of Object.values(RULES)) {
    const r = rule(f, base);
    if (!r) continue;
    for (const d of Array.isArray(r) ? r : [r]) if (!out.some((x) => x.code === d.code)) out.push(d);
  }
  return out;
}

// ---------------------------------------------------------------------------
// "Gedaan": is het werk echt gedaan?
// ---------------------------------------------------------------------------

// Wat we per regel missen zolang de voorwaarde nog geldt ("We zien nog geen …").
export const NOT_DONE: Record<string, string> = {
  alternatives_missing: "We zien nog geen huidig alternatief of 'niets doen' bij de concurrenten.",
  single_secondary_source: "We zien nog geen tweede onafhankelijke of primaire bron bij deze bevinding(en).",
  opinions_no_behaviour: "We zien nog geen waargenomen klantgedrag (een aanvraag, aanmelding of aanbetaling).",
  critical_untested: "We zien nog geen test of nieuwe status voor deze kritieke aanname.",
  test_pace: "We zien nog geen extra deelnemers: in dit tempo haalt de test de steekproef nog niet.",
  interview_hypothetical: "We zien nog geen aangepaste gespreksleidraad: er staan nog hypothetische vragen in.",
  survey_suggest: "We zien nog geen enquête of extra datapunten bij deze aanname.",
  acquaintances_majority: "We zien nog geen extra gesprekken buiten je eigen netwerk.",
  learning_card_waiting: "We zien nog geen goedgekeurde Learning Card.",
  reality_check_stale: "We zien nog geen nieuwe Reality Check na het laatste bewijs.",
  decision_deadline: "We zien nog geen vastgelegd besluit.",
  decision_confirm: "We zien nog geen bevestiging van het besluit door de opdrachtgever.",
  outcome_undefined: "We zien nog geen uitkomstdefinitie.",
  base_rate_missing: "We zien nog geen gekozen basispercentage.",
  forecast: "We zien nog geen voorspelling van het team bij dit moment.",
  forecast_overconfident: "We zien nog geen afgeronde landingpage- of prijstest die de afwijking onderbouwt.",
  outcome_due: "We zien nog geen vastgelegde uitkomst.",
  stop_review_due: "We zien nog geen antwoord op de vraag of stoppen terecht was.",
  outcome_checkin: "We zien nog geen tussenstand na drie maanden.",
  decision_rule_missing: "We zien nog geen vastgelegde beslisregel.",
  sprint_behind: "We zien nog niet dat het dossier de sprintweek heeft ingehaald.",
  no_customer_voice: "We zien nog geen bron met de stem van de klant (review, forum, interview of enquête).",
  outreach_unimported: "We zien nog geen opgenomen LinkedIn-antwoorden bij de bronnen.",
  assumptions_early: "We zien nog geen aannames in het dossier.",
};

export type DoneCheck = { done: true } | { done: false; message: string };

// Puur: een regelnotitie is gedaan als de regel met dezelfde code niet meer afgaat op de actuele feiten.
// Complimenten en notities van de AI-coach hebben geen controleerbare voorwaarde en gelden als gedaan.
export function checkNoteDone(note: { code: string; source: string; kind?: string }, f: CoachFacts): DoneCheck {
  if (note.source !== "rules" || note.kind === "praise") return { done: true };
  const still = evaluateRules(f).some((d) => d.code === note.code);
  if (!still) return { done: true };
  const rule = note.code.split(":")[0];
  return { done: false, message: NOT_DONE[rule] ?? "We zien in het dossier nog geen verandering die dit punt oplost." };
}

// ---------------------------------------------------------------------------
// Reconciling drafts with stored notes
// ---------------------------------------------------------------------------

export type StoredNote = { id: string; code: string; source: string; status: string; resolvedAt: string | null };

// After "Gedaan" the same note does not come back for a week, even if the data still shows the
// condition; "Niet relevant" silences that code for good. New situations carry a new code.
export const DONE_COOLDOWN_DAYS = 7;

export function planNoteChanges(drafts: CoachNoteDraft[], stored: StoredNote[], now: number): { create: CoachNoteDraft[]; close: string[] } {
  const create: CoachNoteDraft[] = [];
  for (const d of drafts) {
    const same = stored.filter((s) => s.code === d.code);
    if (same.some((s) => s.status === "open")) continue;
    if (d.once && same.length > 0) continue;
    if (same.some((s) => s.status === "dismissed")) continue;
    const recentDone = same.some((s) => s.status === "done" && s.resolvedAt && now - new Date(s.resolvedAt).getTime() < DONE_COOLDOWN_DAYS * DAY);
    if (recentDone) continue;
    create.push(d);
  }
  const live = new Set(drafts.map((d) => d.code));
  const close = stored.filter((s) => s.status === "open" && s.source === "rules" && !live.has(s.code)).map((s) => s.id);
  return { create, close };
}
