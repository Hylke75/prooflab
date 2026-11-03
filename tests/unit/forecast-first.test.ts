import { describe, expect, it } from "vitest";
import { aggregate, aiAsOneVote, aiAsOneVotePerKey, forecastFirstLock, scoreSet, type ForecastState, type ForecasterKind } from "@/lib/domain/forecast";
import type { IdeaProgress } from "@/lib/domain/coach";

// Golf B, punt 15: eerst de eigen voorspelling, en de AI als één stem.

function progress(forecast: Partial<ForecastState> | undefined, over: Partial<IdeaProgress> = {}): IdeaProgress {
  return {
    ideaId: "i1",
    questions: 4,
    claims: 3,
    verifiedClaims: 1,
    weakClaims: 0,
    competitors: 2,
    hasAlternatives: true,
    segments: 1,
    sizingEstablished: false,
    assumptions: 3,
    assumptionsWithoutEvidence: 0,
    untestedCritical: 0,
    topAssumption: null,
    experiments: [],
    experimentsDraft: 0,
    experimentsLive: 0,
    experimentsEnded: 1,
    learningCardsDraft: 0,
    learningCardsApproved: 1,
    latestCardApprovedAt: "2026-10-20T10:00:00Z",
    latestRealityCheckAt: null,
    decisions: 0,
    latestDecisionAt: null,
    latestDecisionConfirmed: false,
    reports: 0,
    latestReportAt: null,
    latestReportShared: false,
    behaviourObservations: 1,
    forecast:
      forecast === undefined
        ? undefined
        : { outcomeDefined: true, baseRateChosen: true, outcomeDue: null, ownMoments: [], checkins: 0, resolved: false, today: "2026-11-07", ...forecast },
    ...over,
  };
}

describe("eerst voorspellen", () => {
  it("vergrendelt zolang de gebruiker het open moment nog niet heeft voorspeld", () => {
    expect(forecastFirstLock(progress({}))).toBe("experiment");
    expect(forecastFirstLock(progress({ ownMoments: ["experiment"] }))).toBeNull();
    // Bij het besluit (Reality Check gedaan) gaat het om het besluitmoment.
    expect(forecastFirstLock(progress({}, { latestRealityCheckAt: "2026-11-01T10:00:00Z" }))).toBe("decision");
  });

  it("vergrendelt niet als voorspellen nog niet kan of niet meer hoeft", () => {
    expect(forecastFirstLock(progress(undefined))).toBeNull();
    expect(forecastFirstLock(progress({ outcomeDefined: false }))).toBeNull();
    expect(forecastFirstLock(progress({ baseRateChosen: false }))).toBeNull();
    expect(forecastFirstLock(progress({ resolved: true }))).toBeNull();
    expect(forecastFirstLock(progress({ question: "stop_review" }, { latestRealityCheckAt: "2026-11-01T10:00:00Z" }))).toBeNull();
  });
});

describe("de AI als één stem", () => {
  const rows: { kind: ForecasterKind; probability: number; id: string }[] = [
    { id: "c1", kind: "consultant", probability: 0.6 },
    { id: "k1", kind: "client", probability: 0.7 },
    { id: "a1", kind: "ai", probability: 0.2 },
    { id: "a2", kind: "ai", probability: 0.4 },
    { id: "a3", kind: "ai", probability: 0.9 },
  ];

  it("middelt de modellen tot één stem naast elke mens", () => {
    const votes = aiAsOneVote(rows);
    expect(votes.map((v) => [v.kind, Math.round(v.probability * 100)])).toEqual([
      ["consultant", 60],
      ["client", 70],
      ["ai", 50],
    ]);
    expect(votes[2].models).toBe(3);
    expect(aggregate(votes.map((v) => v.probability))!.n).toBe(3);
    expect(aiAsOneVote(rows.slice(0, 2))).toHaveLength(2);
  });

  it("scoort per dossier één AI-stem", () => {
    const multi = [...rows.map((r) => ({ ...r, idea: "x" })), { id: "a4", kind: "ai" as const, probability: 0.8, idea: "y" }];
    const votes = aiAsOneVotePerKey(multi, (r) => r.idea);
    expect(votes.filter((v) => v.kind === "ai").map((v) => Math.round(v.probability * 100))).toEqual([50, 80]);
    const s = scoreSet(votes.map((v) => ({ probability: v.probability, achieved: "yes" as const })));
    expect(s!.n).toBe(4);
  });
});
