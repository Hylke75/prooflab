import { describe, expect, it } from "vitest";
import { countPerPerson, dedupeByPerson, observationDirection, observationLevel, perPersonLabel, type PersonRef } from "@/lib/domain/per-person";
import { evidenceLadder, ladderSummary, type LadderObservation } from "@/lib/domain/dossier-label";
import { runRealityCheck, type DossierFacts } from "@/lib/domain/reality-check";
import { RULES, type CoachFacts } from "@/lib/coach/rules";

type Obs = PersonRef & { id: string };
const ref = (o: Obs) => o;

describe("dedupeByPerson: per interview per bewijsniveau en richting één waarneming", () => {
  it("houdt van vijf enthousiaste citaten uit één interview er één over", () => {
    const obs: Obs[] = [1, 2, 3, 4, 5].map((i) => ({ id: `o${i}`, interviewId: "iv1", kind: "opinion" }));
    expect(dedupeByPerson(obs, ref).map((o) => o.id)).toEqual(["o1"]);
  });

  it("houdt de sterkste over, bij gelijke sterkte de eerste", () => {
    const obs: Obs[] = [
      { id: "gedrag", interviewId: "iv1", kind: "current_behaviour" }, // niveau probleem, sterkte 2
      { id: "uitgaven", interviewId: "iv1", kind: "current_spend" }, // niveau probleem, sterkte 3
      { id: "herkend", interviewId: "iv1", kind: "problem_confirmed" }, // niveau probleem, sterkte 2
    ];
    expect(dedupeByPerson(obs, ref).map((o) => o.id)).toEqual(["uitgaven"]);
    const tie: Obs[] = [
      { id: "a", interviewId: "iv1", kind: "problem_confirmed" },
      { id: "b", interviewId: "iv1", kind: "current_behaviour" },
    ];
    expect(dedupeByPerson(tie, ref).map((o) => o.id)).toEqual(["a"]);
  });

  it("weegt afwijkende dimensies mee bij het kiezen van de sterkste", () => {
    const obs: Obs[] = [
      { id: "a", interviewId: "iv1", kind: "problem_confirmed" },
      { id: "b", interviewId: "iv1", kind: "problem_confirmed", dims: { isCostly: true } },
    ];
    expect(dedupeByPerson(obs, ref).map((o) => o.id)).toEqual(["b"]);
  });

  it("houdt één waarneming per bewijsniveau: verschillende niveaus blijven naast elkaar staan", () => {
    const obs: Obs[] = [
      { id: "mening", interviewId: "iv1", kind: "opinion" },
      { id: "probleem", interviewId: "iv1", kind: "problem_confirmed" },
      { id: "mening2", interviewId: "iv1", kind: "opinion" },
    ];
    expect(dedupeByPerson(obs, ref).map((o) => o.id)).toEqual(["mening", "probleem"]);
  });

  it("laat tegenbewijs van dezelfde persoon niet wegvallen achter steun", () => {
    const obs: Obs[] = [
      { id: "mening", interviewId: "iv1", kind: "opinion" },
      { id: "bezwaar", interviewId: "iv1", kind: "objection" }, // zelfde niveau (mening), maar tegensprekend
      { id: "bezwaar2", interviewId: "iv1", kind: "problem_absent" }, // ook tegensprekend, zelfde niveau
      { id: "tegen", interviewId: "iv1", kind: "opinion", relation: "contradicts" },
    ];
    expect(dedupeByPerson(obs, ref).map((o) => o.id)).toEqual(["mening", "bezwaar2"]);
    expect(observationDirection({ kind: "objection", relation: "supports" })).toBe("contradicts");
    expect(observationDirection({ kind: "opinion", relation: "contradicts" })).toBe("contradicts");
    expect(observationDirection({ kind: "opinion" })).toBe("supports");
  });

  it("telt verschillende interviews apart", () => {
    const obs: Obs[] = [
      { id: "a", interviewId: "iv1", kind: "opinion" },
      { id: "b", interviewId: "iv2", kind: "opinion" },
      { id: "c", interviewId: "iv1", kind: "opinion" },
    ];
    expect(dedupeByPerson(obs, ref).map((o) => o.id)).toEqual(["a", "b"]);
  });

  it("laat waarnemingen zonder interview en synthetische waarnemingen ongewijzigd", () => {
    const obs: Obs[] = [
      { id: "landing1", kind: "waitlist_signup" },
      { id: "landing2", kind: "waitlist_signup", interviewId: null },
      { id: "synth1", interviewId: "iv1", kind: "opinion", dims: { isSynthetic: true } },
      { id: "synth2", interviewId: "iv1", kind: "opinion", dims: { isSynthetic: true } },
      { id: "echt", interviewId: "iv1", kind: "opinion" },
    ];
    expect(dedupeByPerson(obs, ref).map((o) => o.id)).toEqual(["landing1", "landing2", "synth1", "synth2", "echt"]);
  });

  it("gebruikt de bestaande indeling in bewijsniveaus (KIND_LEVEL)", () => {
    expect(observationLevel("current_spend")).toBe("problem");
    expect(observationLevel("demo_request")).toBe("small_action");
    expect(observationLevel("onbekend")).toBe("opinion");
  });

  it("telt waarnemingen per persoon, citaten en geïnterviewden", () => {
    const obs: Obs[] = [
      { id: "a", interviewId: "iv1", kind: "opinion" },
      { id: "b", interviewId: "iv1", kind: "opinion" },
      { id: "c", interviewId: "iv2", kind: "problem_confirmed" },
      { id: "d", kind: "waitlist_signup" },
    ];
    const c = countPerPerson(obs, ref);
    expect(c).toEqual({ counted: 3, quotes: 4, people: 2 });
    expect(perPersonLabel(c)).toBe("3 waarnemingen (per persoon), uit 4 citaten");
    expect(perPersonLabel({ counted: 1, quotes: 1 })).toBe("1 waarneming (per persoon)");
  });
});

describe("bewijsladder van het dossier telt per persoon", () => {
  const lo = (kind: string, interviewId: string | null = "iv1", isSynthetic = false): LadderObservation => ({ kind, interviewId, isSynthetic });

  it("één enthousiaste geïnterviewde levert geen vijf bewijzen", () => {
    const l = evidenceLadder([lo("problem_confirmed"), lo("current_behaviour"), lo("current_spend"), lo("problem_confirmed"), lo("current_behaviour")]);
    expect(l.highest).toMatchObject({ label: "Probleem in eigen gedrag", count: 1, level: "problem", step: "behaviour" });
    expect(l.counted).toBe(1);
    expect(l.quotes).toBe(5);
    expect(l.people).toBe(1);
    expect(ladderSummary(l)).toBe("Klantbewijs: 1 waarneming (per persoon), uit 5 vastgelegde uitspraken; 1 geïnterviewde. Sterkste: probleem in eigen gedrag (1× per persoon).");
  });

  it("telt meerdere personen en losse testwaarnemingen, zonder synthetische data", () => {
    const l = evidenceLadder([lo("opinion", "iv1"), lo("opinion", "iv2"), lo("opinion", "iv2"), lo("deposit", null), lo("deposit", "iv3", true)]);
    expect(l.rungs.find((r) => r.label === "Uitgesproken belangstelling")!.count).toBe(2);
    expect(l.highest).toMatchObject({ label: "Aanbetaling", count: 1, level: "deposit", step: "payment" });
    expect(l.paymentShown).toBe(true);
    expect(l.quotes).toBe(4);
    expect(l.counted).toBe(3);
  });

  it("zegt eerlijk dat er nog niets is, en niets voor oude rapporten", () => {
    expect(ladderSummary(evidenceLadder([]))).toBe("Klantbewijs: nog geen waarnemingen.");
    expect(ladderSummary(undefined)).toBe("");
  });
});

describe("Realiteitscheck telt per persoon", () => {
  const facts: DossierFacts = {
    ideaAgeDays: 5,
    ideaRegion: "Nederland",
    clientDeciderInvited: true,
    claims: [],
    competitors: [],
    sizing: null,
    assumptions: [{ statement: "Klanten betalen", importance: 5, category: "viability", status: "supported", evidence: 0.8, contradicting: 0 }],
    experiments: [],
    interviews: [],
    observations: [],
    learningCards: [{ status: "approved", verdict: "pass" }],
    decisionsAfterLastLearning: 1,
    isB2B: false,
  };
  const ob = (kind: string, interviewId: string, extra: Partial<DossierFacts["observations"][number]> = {}) => ({
    kind,
    interviewId,
    isBehaviour: true,
    isSynthetic: false,
    isCostly: kind === "current_spend",
    ...extra,
  });

  it("houdt per persoon de sterkste waarneming over, zodat betaald gedrag niet wegvalt achter het eerste citaat", () => {
    const r = runRealityCheck({ ...facts, observations: [ob("current_behaviour", "iv1"), ob("current_spend", "iv1")] });
    expect(r.advice).toBe("continue");
  });

  it("ziet vijf negatieve citaten van één persoon als één tegengeluid, niet als nul", () => {
    const interviews = Array.from({ length: 5 }, () => ({ dmuRole: "user", isAcquaintance: false, consent: true }));
    const obs = [ob("objection", "iv1", { isBehaviour: false }), ob("objection", "iv1", { isBehaviour: false }), ob("problem_confirmed", "iv2")];
    const codes = runRealityCheck({ ...facts, interviews, observations: obs }).findings.map((f) => f.code);
    expect(codes).not.toContain("confirmation_bias");
  });
});

describe("coach: veel meningen telt per persoon", () => {
  const rule = RULES.opinions_no_behaviour;
  const f = (observations: CoachFacts["observations"]) => ({ observations }) as unknown as CoachFacts;
  const op = (interviewId: string | null) => ({ kind: "opinion", isBehaviour: false, isSynthetic: false, createdAt: "2026-11-01T00:00:00Z", interviewId });

  it("drie meningen van één persoon zijn geen 'veel meningen'", () => {
    expect(rule(f([op("iv1"), op("iv1"), op("iv1")]), "/x")).toBeNull();
  });
  it("drie meningen van drie personen wel", () => {
    expect(JSON.stringify(rule(f([op("iv1"), op("iv2"), op("iv3")]), "/x"))).toContain("3 meningen vastgelegd (per persoon geteld)");
  });
});
