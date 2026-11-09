// Takenlijst per idee (voorstel "ProofLab eenvoudiger", november 2026): één plek die per fase zegt welke taken er
// zijn, welke klaar zijn, waar je mee bezig bent en wat nog niet kan (en waarom). De startpagina "Wat nu?", de kop van
// elke taakpagina en de knop "Volgende taak" lezen allemaal deze functie, zodat ze nooit iets anders zeggen.
// Puur, zonder database of React. De stapregels zelf komen uit getDossierStatus (dossier-status.ts).
//
// Per taak staat ook wat jij doet en wat AI kan. "ai: null" betekent: hier doet AI niets, dit doe je zelf. Een
// berekening met vaste regels is geen AI en staat hier dus ook niet als AI.

import type { IdeaProgress } from "./coach";
import { getDossierStatus, isConclusiveDecision, type DossierInput } from "./dossier-status";
import { forecastFirstLock, MOMENT_LABELS } from "./forecast";

export type PhaseKey = "market" | "assumptions" | "test" | "decide" | "report";
export type TaskStatus = "done" | "busy" | "todo" | "locked";
export type TaskKey =
  | "market-question"
  | "market-competitors"
  | "market-customers"
  | "market-sizing"
  | "assumptions-write"
  | "assumptions-primary"
  | "assumptions-rule"
  | "test-plan"
  | "test-run"
  | "test-learning"
  | "decide-learned"
  | "decide-check"
  | "decide-decision"
  | "report-read"
  | "report-share"
  | "forecast";

export type Task = {
  key: TaskKey;
  phase: PhaseKey;
  label: string;
  status: TaskStatus;
  // Waarom deze status, in één zin. Bij "locked" altijd: wat er eerst moet.
  why: string;
  // Adres binnen het idee, zonder /app/ideas/<id>. Leeg = de startpagina.
  path: string;
  // Aanbevolen maar niet nodig om de fase af te ronden.
  optional?: boolean;
  me: string;
  ai: string | null;
};

export type Phase = { key: PhaseKey; number: number; label: string; tasks: Task[]; status: TaskStatus; summary: string };

export type TaskList = {
  phases: Phase[];
  // Eén taak die vóór alles gaat: de eigen voorspelling bij een open voorspelmoment (anders vergrendelt de app kansen).
  first: Task | null;
  next: Task | null;
  // De fase waar je nu bent (1-5), of null als alles klaar is.
  current: PhaseKey | null;
};

export const PHASE_LABELS: Record<PhaseKey, string> = { market: "Markt", assumptions: "Aannames", test: "Testen", decide: "Besluit", report: "Rapport" };
const PHASE_ORDER: PhaseKey[] = ["market", "assumptions", "test", "decide", "report"];

export const TASK_STATUS_LABELS: Record<TaskStatus, string> = { done: "Klaar", busy: "Bezig", todo: "Te doen", locked: "Kan nog niet" };

// Zelfde terugval als lib/steps.ts (dossierInput), hier zonder import uit lib/ om de domeinlaag puur te houden.
function input(p: IdeaProgress): DossierInput {
  return (
    p.dossier ?? {
      questions: p.questions,
      claims: p.claims,
      verifiedClaims: p.verifiedClaims,
      decisiveQuestion: null,
      assumptions: p.assumptions,
      criticalWithPrimaryTest: 0,
      assumptionsWithEvidence: p.assumptions - p.assumptionsWithoutEvidence,
      experiments: p.experiments.length,
      experimentsLive: p.experimentsLive,
      experimentsEnded: p.experimentsEnded,
      testsWithVerdict: 0,
      realTestObservations: p.behaviourObservations,
      decisions: p.decisions,
      latestDecisionAction: p.latestDecisionAction,
      decisionRule: "unknown",
    }
  );
}

const PREPARING = ["draft", "ready_for_review"];
const RUNNING = ["approved", "live", "paused"];
const ENDED = ["ended", "analyzed", "decided"];

function phaseStatus(tasks: Task[]): TaskStatus {
  const needed = tasks.filter((t) => !t.optional);
  const list = needed.length ? needed : tasks;
  if (list.every((t) => t.status === "done")) return "done";
  if (tasks.some((t) => t.status === "busy" || t.status === "done")) return "busy";
  if (list.every((t) => t.status === "locked")) return "locked";
  return "todo";
}

export function ideaTasks(p: IdeaProgress): TaskList {
  const d = input(p);
  const status = getDossierStatus(d);
  const step = Object.fromEntries(status.steps.map((s) => [s.key, s])) as Record<string, (typeof status.steps)[number]>;
  const exps = p.experiments;
  const preparing = exps.find((e) => PREPARING.includes(e.state));
  const running = exps.find((e) => RUNNING.includes(e.state));
  const ended = exps.filter((e) => ENDED.includes(e.state));
  // Na "verder testen", "bijsturen" of een verlengde testfase hoort er een nieuwe test bij: het testplan staat dan weer
  // open zolang er geen nieuwe test is.
  const newSince = exps.some((e) => !!e.startedAt && !!p.latestDecisionAt && e.startedAt > p.latestDecisionAt);
  const backToTest = ["test_more", "extend", "adjust"].includes(d.latestDecisionAction ?? "") && !running && !preparing && !newSince;
  const pastPlan = exps.some((e) => !PREPARING.includes(e.state)) && !backToTest;
  const cards = p.learningCardsDraft + p.learningCardsApproved;
  const checkStale = !!(p.latestRealityCheckAt && p.latestCardApprovedAt && p.latestCardApprovedAt > p.latestRealityCheckAt);
  const checkDone = !!p.latestRealityCheckAt && !checkStale;
  const conclusive = d.decisions > 0 && isConclusiveDecision(d.latestDecisionAction);

  const market: Task[] = [
    {
      key: "market-question",
      phase: "market",
      label: "Beantwoord je onderzoeksvraag met bronnen",
      status: step.market.state === "done" ? "done" : step.market.state === "running" ? "busy" : "todo",
      why: step.market.why,
      path: "/research",
      me: "Bronnen toevoegen of controleren, en per bevinding bevestigen dat de bron klopt.",
      ai: "Bronnen zoeken en samenvatten. Een AI-tekst is zelf nooit een bron; jij bevestigt elke bevinding.",
    },
    {
      key: "market-competitors",
      phase: "market",
      label: "Concurrenten en alternatieven",
      status: p.competitors > 0 && p.hasAlternatives ? "done" : p.competitors > 0 || p.hasAlternatives ? "busy" : "todo",
      why: p.competitors > 0 ? `${p.competitors} ${p.competitors === 1 ? "concurrent" : "concurrenten"} vastgelegd${p.hasAlternatives ? ", ook alternatieven" : "; nog geen huidig alternatief"}.` : "Nog geen concurrenten of alternatieven.",
      path: "/research?tab=competitors",
      optional: true,
      me: "Kijken wat klanten nu doen in plaats van jouw idee, en concurrenten met prijs en bron vastleggen.",
      ai: "Concurrenten voorstellen. Je neemt een voorstel pas over als de bron klopt.",
    },
    {
      key: "market-customers",
      phase: "market",
      label: "Doelgroep en klantonderzoek",
      status: p.segments > 0 ? "done" : "todo",
      why: p.segments > 0 ? `${p.segments} ${p.segments === 1 ? "doelgroep" : "doelgroepen"} beschreven.` : "Nog geen doelgroep beschreven.",
      path: "/research?tab=customers",
      optional: true,
      me: "Beschrijven wie het probleem heeft, wie betaalt en wie beslist, en met echte klanten praten of een korte enquête uitzetten.",
      ai: "Interviewvragen of een vragenlijst voorstellen en AI-gemodereerde interviews afnemen. Alleen wat mensen zelf zeggen telt.",
    },
    {
      key: "market-sizing",
      phase: "market",
      label: "Marktomvang",
      status: p.sizingEstablished ? "done" : "todo",
      why: p.sizingEstablished ? "Er is een onderbouwde schatting van de marktomvang." : "Nog geen onderbouwde marktomvang.",
      path: "/research?tab=sizing",
      optional: true,
      me: "De aannames invullen (aantallen, prijs, aandeel) met een bron of als schatting.",
      ai: null,
    },
  ];

  const rulePossible = d.decisionRule !== "unknown";
  const assumptions: Task[] = [
    {
      key: "assumptions-write",
      phase: "assumptions",
      label: "Schrijf op wat waar moet zijn",
      status: d.assumptions > 0 ? "done" : "todo",
      why: d.assumptions > 0 ? `${d.assumptions} ${d.assumptions === 1 ? "aanname" : "aannames"} op de risicokaart.` : "Er zijn nog geen aannames.",
      path: "/assumptions?stap=opschrijven",
      me: "Aannames opschrijven en per aanname het belang en het bewijs inschatten.",
      ai: "Kritische tegenvragen stellen (red team) en aannames voorstellen die je over het hoofd ziet.",
    },
    {
      key: "assumptions-primary",
      phase: "assumptions",
      label: "Kies de belangrijkste en wijs een hoofdtest aan",
      status: d.criticalWithPrimaryTest > 0 ? "done" : d.assumptions === 0 ? "locked" : "todo",
      why: d.assumptions === 0 ? "Schrijf eerst je aannames op." : d.criticalWithPrimaryTest > 0 ? "Minstens één kritieke aanname heeft een hoofdtest." : "Wijs bij een kritieke aanname een hoofdtest aan.",
      path: "/assumptions?stap=kiezen",
      me: "Kiezen welke aanname het idee onderuit haalt als hij niet klopt.",
      ai: null,
    },
    ...(rulePossible
      ? [
          {
            key: "assumptions-rule" as const,
            phase: "assumptions" as const,
            label: "Leg vast wanneer je doorgaat",
            status: (d.decisionRule === "saved" ? "done" : d.criticalWithPrimaryTest === 0 ? "locked" : "todo") as TaskStatus,
            why: d.decisionRule === "saved" ? "De beslisregel ligt vast." : d.criticalWithPrimaryTest === 0 ? "Wijs eerst een hoofdtest aan." : "Spreek vooraf af bij welke uitslag je doorgaat.",
            path: "/assumptions?stap=regel#beslisregel",
            me: "Vooraf afspreken bij welke uitslag je doorgaat, zodat je jezelf achteraf niet voor de gek houdt.",
            ai: null,
          },
        ]
      : []),
  ];

  const test: Task[] = [
    {
      key: "test-plan",
      phase: "test",
      label: "Maak een testplan",
      status: pastPlan ? "done" : preparing ? "busy" : d.assumptions === 0 ? "locked" : "todo",
      why: pastPlan
        ? "Er is een goedgekeurd testplan."
        : backToTest
          ? "Je besloot verder te testen of bij te sturen: zet de volgende test op."
          : preparing
            ? `Het testplan "${preparing.title}" is nog niet goedgekeurd.`
            : d.assumptions === 0
              ? "Schrijf eerst je aannames op."
              : "Kies een test bij je belangrijkste aanname.",
      path: preparing ? `/experiments/${preparing.id}` : "/experiments?nieuw=1",
      me: "Kiezen wat je test, bij wie, en vooraf vastleggen wanneer de test geslaagd is.",
      ai: "Teksten voor de testpagina, een vragenlijst of interviewvragen voorstellen.",
    },
    {
      key: "test-run",
      phase: "test",
      label: "Laat de test lopen",
      status: ended.length > 0 && !running ? "done" : running ? "busy" : "locked",
      why: running
        ? running.state === "approved"
          ? `"${running.title}" is goedgekeurd en kan starten.`
          : `"${running.title}" loopt; meet tot de afgesproken eindconditie.`
        : ended.length > 0
          ? `${ended.length} ${ended.length === 1 ? "test" : "tests"} afgerond.`
          : "Er is eerst een goedgekeurd testplan nodig.",
      path: running ? `/experiments/${running.id}` : ended[0] ? `/experiments/${ended[0].id}` : "/experiments",
      me: "Deelnemers werven en de test starten, pauzeren en afronden.",
      ai: "AI-gemodereerde interviews afnemen. Alleen de letterlijke antwoorden van mensen tellen als bewijs.",
    },
    {
      key: "test-learning",
      phase: "test",
      label: "Leg de uitslag vast",
      status: cards > 0 ? "done" : ended.length > 0 ? "todo" : "locked",
      why: cards > 0 ? "Er is een Learning Card." : ended.length > 0 ? "Maak de Learning Card bij de afgeronde test." : "Er is eerst een afgeronde test nodig.",
      path: ended[0] ? `/experiments/${ended[0].id}#learning-card` : "/experiments",
      me: "De uitslag bekijken en vastleggen wat je ervan leert.",
      ai: null,
    },
  ];

  const decide: Task[] = [
    {
      key: "decide-learned",
      phase: "decide",
      label: "Wat heb je geleerd?",
      status: p.learningCardsDraft > 0 ? "busy" : p.learningCardsApproved > 0 ? "done" : "locked",
      why:
        p.learningCardsDraft > 0
          ? `${p.learningCardsDraft} Learning ${p.learningCardsDraft === 1 ? "Card wacht" : "Cards wachten"} op je controle.`
          : p.learningCardsApproved > 0
            ? "Alle Learning Cards zijn gecontroleerd."
            : "Er is eerst een Learning Card nodig (bij een afgeronde test).",
      path: "/evidence?stap=geleerd",
      me: "Het voorstel controleren, aanpassen en goedkeuren.",
      ai: "Een eerste tekst voorstellen op basis van de gemeten uitslag. Zonder AI maakt ProofLab het voorstel met vaste regels.",
    },
    {
      key: "decide-check",
      phase: "decide",
      label: "Klopt het echt? (Reality Check)",
      status: checkDone ? "done" : checkStale ? "busy" : "todo",
      why: checkDone ? "De Reality Check is uitgevoerd op het laatste bewijs." : checkStale ? "Er is nieuw bewijs sinds de laatste check. Voer hem opnieuw uit." : "Zoek naar valkuilen voordat je besluit.",
      path: "/evidence?stap=check",
      me: "Een pre-mortem doen: waarom zou dit over zes maanden mislukt zijn?",
      ai: "Kritische vragen stellen over je bewijs. De vaste controles werken ook zonder AI.",
    },
    {
      key: "decide-decision",
      phase: "decide",
      label: "Neem je besluit",
      status: conclusive ? "done" : d.decisions > 0 ? "busy" : checkDone ? "todo" : "locked",
      why: conclusive ? step.decide.why : d.decisions > 0 ? step.decide.why : checkDone ? "Kies doorgaan, bijsturen, verder testen, pauzeren of stoppen." : "Voer eerst de Reality Check uit.",
      path: "/evidence?stap=besluit",
      me: "Het besluit nemen en onderbouwen. ProofLab adviseert, maar beslist nooit.",
      ai: null,
    },
  ];

  const report: Task[] = [
    {
      key: "report-read",
      phase: "report",
      label: "Lees het rapport na",
      status: p.reports > 0 ? "done" : d.decisions > 0 ? "todo" : "locked",
      why: p.reports > 0 ? "Er is een rapportversie; na elk besluit maakt ProofLab zelf een nieuwe." : d.decisions > 0 ? "Maak een rapportversie met je besluit." : "Het rapport is compleet na je eerste besluit.",
      path: "/report",
      me: "Nalezen, beperkingen aanvullen en een versie vastleggen.",
      ai: null,
    },
    {
      key: "report-share",
      phase: "report",
      label: "Deel het rapport",
      status: p.latestReportShared ? "done" : p.reports > 0 ? "todo" : "locked",
      why: p.latestReportShared ? "Het rapport is gedeeld." : p.reports > 0 ? "Deel het met je opdrachtgever of team." : "Leg eerst een rapportversie vast.",
      path: "/report",
      optional: true,
      me: "Het rapport delen of als pdf downloaden.",
      ai: null,
    },
  ];

  const lists: Record<PhaseKey, Task[]> = { market, assumptions, test, decide, report };
  const summaries: Record<PhaseKey, string> = {
    market: step.market.statusLabel,
    assumptions: step.assumptions.statusLabel,
    test: step.test.statusLabel,
    decide: step.decide.statusLabel,
    report: p.latestReportShared ? "Gedeeld" : p.reports > 0 ? "Versie vastgelegd" : "Nog geen versie",
  };
  const phases: Phase[] = PHASE_ORDER.map((key, i) => ({ key, number: i + 1, label: PHASE_LABELS[key], tasks: lists[key], status: phaseStatus(lists[key]), summary: summaries[key] }));

  const lock = forecastFirstLock(p);
  const first: Task | null = lock
    ? {
        key: "forecast",
        phase: lock === "decision" ? "decide" : lock === "experiment" ? "test" : "market",
        label: "Voorspel eerst wat je verwacht",
        status: "todo",
        why: `${MOMENT_LABELS[lock].label}: geef eerst je eigen kans, daarna zie je de berekende kansen. Zo ankert niemand op een cijfer.`,
        path: lock === "decision" ? "/evidence?stap=besluit" : "/outcome#voorspelling",
        me: "Je eigen kans geven dat het doel wordt gehaald.",
        ai: null,
      }
    : null;

  // De fase waar je nu bent. Een lopende test of een besluit "verder testen" zet je in Testen (dossierstatus). Anders de
  // verste fase waar al iets gebeurd is en die nog niet klaar is (je werkt vooruit); is er zo geen, dan de eerste fase
  // na de verste begonnen fase die nog niet klaar is. Zo wijst de app na een besluit naar Rapport, niet terug naar Markt.
  const started = (ph: Phase) => ph.tasks.some((t) => t.status === "done" || t.status === "busy");
  const open = phases.filter((ph) => ph.status !== "done");
  const furthest = phases.reduce((f, ph, i) => (started(ph) ? i : f), -1);
  const current: PhaseKey | null =
    status.current === "test" && phases[2].status !== "done"
      ? "test"
      : ([...open].reverse().find(started)?.key ?? phases.slice(furthest + 1).find((ph) => ph.status !== "done")?.key ?? open[0]?.key ?? null);
  const actionable = (t: Task) => t.status === "busy" || t.status === "todo";
  const inPhase = (k: PhaseKey | null) => (k ? lists[k].filter((t) => !t.optional).find(actionable) ?? lists[k].find(actionable) : undefined);
  const next =
    first ??
    inPhase(current) ??
    PHASE_ORDER.map((k) => lists[k].filter((t) => !t.optional).find(actionable)).find(Boolean) ??
    PHASE_ORDER.map((k) => lists[k].find(actionable)).find(Boolean) ??
    null;
  return { phases, first, next, current };
}

// Positie van een taak in zijn fase: "taak 2 van 3".
export function taskPosition(list: TaskList, key: TaskKey): { phase: Phase; index: number; total: number; task: Task } | null {
  for (const phase of list.phases) {
    const i = phase.tasks.findIndex((t) => t.key === key);
    if (i >= 0) return { phase, index: i + 1, total: phase.tasks.length, task: phase.tasks[i] };
  }
  return null;
}

// De taak die na deze komt in dezelfde fase, of de eerste taak van de volgende fase.
export function taskAfter(list: TaskList, key: TaskKey): Task | null {
  const all = list.phases.flatMap((ph) => ph.tasks);
  const i = all.findIndex((t) => t.key === key);
  return i >= 0 ? (all[i + 1] ?? null) : null;
}
