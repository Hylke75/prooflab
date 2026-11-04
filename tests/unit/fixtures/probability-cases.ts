// Vaste invoer voor de gelijkheidstest van de kansberekening (fase 1, punt 2): handgekozen gevallen uit
// tests/unit/evidence*.test.ts en desk-tally.test.ts, aangevuld met een reproduceerbare (geseede) reeks combinaties.
// De verwachte uitkomsten per methodeversie staan in probability-golden.json en zijn gemaakt vóór de refactor van
// probabilityCore; ze mogen niet veranderen.

import type { EvidenceCaps, ProbabilityClaim, ProbabilityObservation } from "@/lib/domain/evidence";
import type { LrOverrides } from "@/lib/domain/calibration";

export type ProbabilityCase = {
  name: string;
  claims: ProbabilityClaim[];
  observations: ProbabilityObservation[];
  prior: number;
  overrides?: LrOverrides;
  caps?: EvidenceCaps;
};

const KINDS = [
  "opinion",
  "objection",
  "problem_absent",
  "problem_confirmed",
  "current_behaviour",
  "current_spend",
  "counter_example",
  "waitlist_signup",
  "demo_request",
  "quote_request",
  "deposit",
  "repeat_purchase",
  "survey_answer",
  "other",
] as const;
const STATUSES = ["verified", "estimate", "insufficient", "contested", "refuted", "outdated"] as const;
const GROUPS = [null, "own_network", "warm", "cold", "panel"] as const;

// Kleine deterministische generator (mulberry32), zodat de reeks overal gelijk is.
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const obs = (kind: string, sourceKey: string | null, relation: "supports" | "contradicts" = "supports", extra: Partial<ProbabilityObservation> = {}): ProbabilityObservation => ({
  kind,
  relation,
  isSynthetic: false,
  origin: "manual",
  sourceKey,
  sourceLabel: sourceKey ? `Bron ${sourceKey}` : null,
  recruitmentGroup: null,
  ...extra,
});
const claim = (status: (typeof STATUSES)[number], relation: "supports" | "contradicts" = "supports", extra: Partial<ProbabilityClaim> = {}): ProbabilityClaim => ({
  status,
  relation,
  sourceKey: null,
  sourceLabel: null,
  ...extra,
});
const times = <T>(n: number, f: (i: number) => T): T[] => Array.from({ length: n }, (_, i) => f(i));

const HANDPICKED: ProbabilityCase[] = [
  { name: "leeg", claims: [], observations: [], prior: 0.5 },
  { name: "leeg, hoge beginwaarde", claims: [], observations: [], prior: 0.8 },
  { name: "één aanbetaling", claims: [], observations: [obs("deposit", "a")], prior: 0.5 },
  { name: "huidige werkwijze bij 20%", claims: [], observations: [obs("current_behaviour", "a")], prior: 0.2 },
  { name: "één bezwaar", claims: [], observations: [obs("objection", "a")], prior: 0.5 },
  { name: "20 meningen", claims: [], observations: times(20, (i) => obs("opinion", `o${i}`)), prior: 0.5 },
  { name: "drie signalen één bron", claims: [], observations: [obs("opinion", "x"), obs("demo_request", "x"), obs("problem_confirmed", "x")], prior: 0.5 },
  { name: "vijf bezwaren één interview", claims: [], observations: times(5, () => obs("objection", "interview:1", "contradicts")), prior: 0.5 },
  { name: "vijf bezwaren vijf interviews", claims: [], observations: times(5, (i) => obs("objection", `interview:${i}`, "contradicts")), prior: 0.5 },
  {
    name: "gemengd tegen per bron",
    claims: [],
    observations: [obs("objection", "interview:1", "contradicts"), obs("counter_example", "interview:1", "contradicts"), obs("objection", "interview:1", "contradicts"), obs("problem_confirmed", "interview:1")],
    prior: 0.5,
  },
  { name: "wervingsgroep herhaling", claims: [], observations: times(4, (i) => obs("waitlist_signup", `s${i}`, "supports", { recruitmentGroup: "warm" })), prior: 0.5 },
  {
    name: "AI-codering",
    claims: [],
    observations: [
      obs("deposit", "a", "supports", { origin: "ai", reviewStatus: null }),
      obs("problem_confirmed", "b", "supports", { origin: "ai", reviewStatus: "accepted" }),
      obs("objection", "c", "contradicts", { origin: "ai", reviewStatus: "rejected" }),
    ],
    prior: 0.5,
  },
  { name: "synthetisch", claims: [], observations: [obs("deposit", "a", "supports", { isSynthetic: true }), obs("opinion", "b")], prior: 0.5 },
  {
    name: "bevindingen alle statussen steunend",
    claims: STATUSES.map((s, i) => claim(s, "supports", { sourceKey: `source:${i}`, sourceLabel: `Bron ${i}` })),
    observations: [],
    prior: 0.5,
  },
  {
    name: "bevindingen alle statussen tegen",
    claims: STATUSES.map((s, i) => claim(s, "contradicts", { sourceKey: `source:${i}`, sourceLabel: `Bron ${i}` })),
    observations: [],
    prior: 0.5,
  },
  { name: "weerlegd steunend", claims: [claim("refuted", "supports")], observations: [], prior: 0.5 },
  { name: "weerlegd tegen", claims: [claim("refuted", "contradicts")], observations: [], prior: 0.5 },
  { name: "indirect bewijs", claims: [claim("verified", "supports", { relevance: "indirect" }), claim("verified", "supports", { relevance: "direct" })], observations: [], prior: 0.5 },
  { name: "herhaalaankoop zonder plafond", claims: [], observations: [obs("repeat_purchase", "a"), obs("deposit", "b")], prior: 0.9 },
  {
    name: "geleerde factoren",
    claims: [],
    observations: [obs("opinion", "a"), obs("demo_request", "b"), obs("objection", "c", "contradicts")],
    prior: 0.5,
    overrides: { opinion: { lr: 1.4, lrAgainst: 1.2 }, objection: { lr: 2, lrAgainst: 2.5 } },
  },
  {
    name: "eigen plafonds",
    claims: [],
    observations: [obs("waitlist_signup", "a"), obs("waitlist_signup", "b"), obs("current_spend", "c")],
    prior: 0.6,
    caps: { opinion: 0.3, problem: 0.45, small_action: 0.55, quote: 0.7, deposit: 0.85 },
  },
];

function generated(count: number): ProbabilityCase[] {
  const r = rng(20261104);
  const pick = <T>(list: readonly T[]) => list[Math.floor(r() * list.length)];
  const out: ProbabilityCase[] = [];
  for (let n = 0; n < count; n++) {
    const sources = 1 + Math.floor(r() * 4);
    const claims = times(Math.floor(r() * 4), () =>
      claim(pick(STATUSES), r() < 0.7 ? "supports" : "contradicts", {
        sourceKey: r() < 0.8 ? `source:${Math.floor(r() * sources)}` : null,
        sourceLabel: "Bron",
        recruitmentGroup: r() < 0.2 ? pick(GROUPS) : null,
        relevance: r() < 0.3 ? "indirect" : r() < 0.5 ? "direct" : null,
      }),
    );
    const observations = times(Math.floor(r() * 7), () => {
      const ai = r() < 0.25;
      return obs(pick(KINDS), r() < 0.85 ? `interview:${Math.floor(r() * sources)}` : null, r() < 0.75 ? "supports" : "contradicts", {
        isSynthetic: r() < 0.08,
        origin: ai ? "ai" : "manual",
        reviewStatus: ai ? pick([null, "accepted", "rejected"] as const) : null,
        recruitmentGroup: pick(GROUPS),
      });
    });
    out.push({ name: `generated ${n}`, claims, observations, prior: pick([0.2, 0.35, 0.5, 0.65, 0.8]) });
  }
  return out;
}

export const PROBABILITY_CASES: ProbabilityCase[] = [...HANDPICKED, ...generated(160)];
