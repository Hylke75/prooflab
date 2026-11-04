// Fase B0, punt 4: een onbesliste test, of een test met minder deelnemers dan de minimale steekproef
// (hypotheses.min_sample), verandert de kans en de rangorde van een aanname niet.
//
// Waarnemingen uit zo'n test blijven bestaan en zichtbaar (niets wordt verwijderd), maar tellen niet mee in de kans
// (assumptionProbability*), de bewijsas en daarmee de rangorde (rankAssumptions en de informatiewaarde). Op het scherm
// staat kort waarom: "telt niet mee: onbeslist" of "telt niet mee: onder de minimale steekproef van N".
// Puur, zonder database.

export type TestOutcome = {
  experimentId: string;
  title?: string | null;
  // De uitkomst van de Learning Card (goedgekeurd, anders het concept); null of "running" zolang er geen is.
  verdict: "pass" | "fail" | "inconclusive" | "running" | null;
  // Het aantal deelnemers: van de Learning Card, of bij een lopende interviewtest de gecodeerde interviews.
  // null = onbekend (geen steekproefregel).
  n: number | null;
  minSample: number | null;
};

export type TestExclusion = {
  experimentId: string;
  title: string;
  reason: "under_sample" | "inconclusive";
  text: string; // "telt niet mee: onbeslist"
};

// Waarom deze test niet meetelt, of null als hij meetelt. Onder de steekproef gaat voor: dat zegt het meest.
export function testExclusion(t: TestOutcome): TestExclusion | null {
  const base = { experimentId: t.experimentId, title: t.title?.trim() || "Test" };
  if (t.n != null && t.minSample != null && t.minSample > 0 && t.n < t.minSample) {
    return { ...base, reason: "under_sample", text: `telt niet mee: onder de minimale steekproef van ${t.minSample}` };
  }
  if (t.verdict === "inconclusive") return { ...base, reason: "inconclusive", text: "telt niet mee: onbeslist" };
  return null;
}

// Per experiment-id de tests die niet meetellen.
export function excludedTests(tests: TestOutcome[]): Map<string, TestExclusion> {
  const out = new Map<string, TestExclusion>();
  for (const t of tests) {
    const x = testExclusion(t);
    if (x) out.set(t.experimentId, x);
  }
  return out;
}

// Laat alles weg wat uit een niet-meetellende test komt. Signalen zonder test (bureauonderzoek, losse observaties)
// blijven staan.
export function withoutExcludedTests<T>(items: T[], experimentOf: (t: T) => string | null | undefined, excluded: Map<string, TestExclusion>): T[] {
  return items.filter((i) => {
    const e = experimentOf(i);
    return !e || !excluded.has(e);
  });
}

// De sleutel waarmee een bevinding uit een enquête naar haar test verwijst (evidenceSourceKey: "experiment:<id>").
export function experimentFromSourceKey(key: string | null | undefined): string | null {
  return key?.startsWith("experiment:") ? key.slice("experiment:".length) : null;
}

// Een test die al loopt of klaar is (concepten en goedgekeurde, nog niet gestarte tests tellen nergens mee).
export const isStarted = (state: string) => !["draft", "ready_for_review", "approved"].includes(state);

// Fase 1, punt 2 (Stand van het bewijs): ook het testtype, of de Learning Card goedgekeurd is, het vastgelegde bewijsniveau
// en het aantal geslaagde deelnemers (metrics.successes). Alleen voor weergave; uitsluiting en kans gebruiken ze niet.
export type TestOutcomeRow = TestOutcome & {
  assumptionId: string | null;
  state: string;
  type?: string | null;
  cardStatus?: "approved" | "draft" | null;
  evidenceLevel?: string | null;
  successes?: number | null;
};

// De uitkomst en het aantal deelnemers per test, uit gegevens die consultant en opdrachtgever allebei mogen lezen:
// - met Learning Card (goedgekeurd, anders het concept): het oordeel en n van die kaart;
// - interviewtest zonder kaart: het aantal verschillende interviews met gecodeerde, niet-synthetische uitspraken;
// - andere tests zonder kaart: n onbekend (hun meting wordt pas met de kaart een waarneming), dus geen uitsluiting.
export function testOutcomesFrom(
  experiments: { id: string; title: string; type: string; state: string; hypotheses: { assumption_id: string | null; min_sample: number } | null }[],
  cards: { experiment_id: string; status: string; verdict: string; metrics: unknown }[],
  interviewObservations: { experiment_id: string | null; interview_id: string | null; is_synthetic: boolean }[],
): TestOutcomeRow[] {
  return experiments.map((e) => {
    const own = cards.filter((c) => c.experiment_id === e.id);
    const card = own.find((c) => c.status === "approved") ?? own.find((c) => c.status === "draft") ?? null;
    const metrics = card?.metrics as { n?: unknown; successes?: unknown; evidence_level?: unknown } | null;
    const cardN = Number(metrics?.n);
    const successes = Number(metrics?.successes);
    const coded = new Set(interviewObservations.filter((o) => o.experiment_id === e.id && o.interview_id && !o.is_synthetic).map((o) => o.interview_id)).size;
    const n = card ? (Number.isFinite(cardN) ? cardN : null) : e.type === "interview" ? coded : null;
    return {
      experimentId: e.id,
      title: e.title,
      assumptionId: e.hypotheses?.assumption_id ?? null,
      state: e.state,
      verdict: card ? (card.verdict as TestOutcome["verdict"]) : null,
      n,
      minSample: e.hypotheses?.min_sample ?? null,
      type: e.type,
      cardStatus: card ? (card.status === "approved" ? "approved" : "draft") : null,
      evidenceLevel: typeof metrics?.evidence_level === "string" ? metrics.evidence_level : null,
      successes: card && metrics?.successes != null && Number.isFinite(successes) ? successes : null,
    };
  });
}
