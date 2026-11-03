// Trajectory coach: deterministic rules over the whole dossier. Pure functions, no I/O, so every rule is
// unit-tested. Each rule has a stable code; a rule posts a note while its condition holds and closes its own
// open note when the condition is gone. Notes are advice about the process, never evidence.

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
  }[];
  interviews: { isAcquaintance: boolean }[];
  observations: { kind: string; isBehaviour: boolean; isSynthetic: boolean; createdAt: string }[];
  learningCards: { id: string; status: string; approvedAt: string | null }[];
  realityCheck: { id: string; createdAt: string } | null;
  decisions: { id: string; decidedAt: string; confirmed: boolean }[]; // oldest first
  decisionDeadline: string | null;
  clientDeciderInvited: boolean;
  outcome: { defined: boolean; due: string | null; resolved: boolean; checkins: string[] };
  forecasts: { moment: string; kind: string }[];
  outreach: { replies: number; latestReplyAt: string | null; latestImportAt: string | null };
};

const DAY = 86_400_000;
const CUSTOMER_VOICE = ["review_site", "forum", "outreach", "interview"];

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

// The latest forecast moment the dossier has reached.
export function openForecastMoment(f: CoachFacts): ForecastMoment {
  if (f.decisions.length > 0 || f.realityCheck) return "decision";
  if (f.experiments.some((e) => ["ended", "analyzed", "decided"].includes(e.state))) return "experiment";
  if (f.claims.length > 0 && f.competitorKinds.some((k) => k === "alternative" || k === "status_quo")) return "research";
  return "intake";
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
    if (f.forecasts.some((x) => x.moment === m && x.kind === "consultant")) return null;
    return {
      code: `forecast:${m}`,
      kind: "question",
      title: `Hoe groot schat je de kans nu, ${FORECAST_MOMENTS[m]}?`,
      body: "Geef blind een kans (5–95%) op de vastgelegde uitkomst, met één zin waarom. Zo zie je later of het team goed voorspelt en welk bewijs echt telde.",
      href: `${base}/outcome`,
      audience: "consultant",
    };
  },

  outcome_due: (f, base) => {
    if (f.outcome.resolved || !f.outcome.due || f.decisions.length === 0) return null;
    if (daysBetween(f.today, f.outcome.due) > 0) return null;
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
    if (f.outcome.resolved || !last || !f.outcome.defined) return null;
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
