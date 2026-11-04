import { describe, expect, it } from "vitest";
import { assumptionProbabilityV5, type ProbabilityClaim, type ProbabilityObservation } from "@/lib/domain/evidence";
import {
  asEvidenceStanding,
  CERTAINTY_HIGH,
  evidenceStanding,
  nextFromInformationValue,
  primaryStatus,
  type StandingAssumptionInput,
  type StandingInput,
  type StandingTestInput,
} from "@/lib/domain/evidence-standing";

// Fase 1, punt 2: Stand van het bewijs (beslisscherm per idee).
const obs = (id: string, kind: string, sourceKey: string, relation: "supports" | "contradicts" = "supports", extra: Partial<ProbabilityObservation> = {}): ProbabilityObservation => ({
  id,
  kind,
  relation,
  isSynthetic: false,
  origin: "manual",
  sourceKey,
  sourceLabel: sourceKey.startsWith("interview:") ? `Interview ${sourceKey.slice(10)}` : "Landingpagina",
  recruitmentGroup: null,
  ...extra,
});
const claim = (id: string, status: ProbabilityClaim["status"], relation: "supports" | "contradicts" = "supports"): ProbabilityClaim => ({ id, status, relation, sourceKey: `source:${id}`, sourceLabel: `Bron ${id}` });

function assumption(id: string, o: { importance?: number; selected?: boolean; prior?: number; claims?: ProbabilityClaim[]; observations?: ProbabilityObservation[]; primary?: string | null } = {}): StandingAssumptionInput {
  const p = assumptionProbabilityV5(o.claims ?? [], o.observations ?? [], o.prior ?? 0.5);
  return { id, statement: `Aanname ${id}`, importance: o.importance ?? 5, selectedForTest: o.selected ?? true, probability: p, register: p.items, primaryExperimentId: o.primary ?? null };
}
const input = (assumptions: StandingAssumptionInput[], tests: StandingTestInput[] = [], next: StandingInput["next"] = null): StandingInput => ({ ideaId: "idee", assumptions, tests, next, calibrated: false });

describe("Stand van het bewijs: telling van bewijs per kritieke aanname", () => {
  it("meetellend en niet-meetellend met reden, zonder citaten", () => {
    const a = assumption("a1", {
      claims: [claim("c1", "verified"), claim("c2", "contested")],
      observations: [obs("o1", "opinion", "interview:1"), obs("o2", "opinion", "interview:1"), obs("o3", "objection", "interview:2", "contradicts"), obs("o4", "problem_confirmed", "interview:3", "supports", { isSynthetic: true })],
    });
    const s = evidenceStanding(input([a]));
    const row = s.assumptions[0];
    expect(row.tallyLine).toBe("5 voor (2 tellen mee) · 1 tegen");
    expect(row.tally.notCounted).toBe(3);
    const reasons = row.reasons.filter((r) => r.fate === "not_counted").map((r) => `${r.label}: ${r.reason}`);
    expect(reasons).toEqual([
      "Bevinding met tegenstrijdige bronnen (bureauonderzoek): bronnen spreken elkaar tegen",
      'Mening of uitgesproken koopintentie · Interview 1: samengevoegd met een sterker signaal uit dezelfde bron (Interview 1): alleen "Mening of uitgesproken koopintentie" telt',
      "Probleem herkend in eigen recent gedrag · Interview 3: oefengesprek of synthetische data: telt nooit als bewijs",
    ]);
    // Geen citaten: alleen soort en bron.
    expect(JSON.stringify(row.reasons)).not.toMatch(/"quote"|citaat:/);
  });

  it("alleen kritieke aannames (belangrijkheid ≥ 4 en gekozen om te testen)", () => {
    const s = evidenceStanding(input([assumption("a1"), assumption("a2", { importance: 3 }), assumption("a3", { selected: false }), assumption("a4", { importance: 4 })]));
    expect(s.assumptions.map((a) => [a.id, a.number])).toEqual([
      ["a1", 1],
      ["a4", 4],
    ]);
    expect(s.critical.total).toBe(2);
  });
});

describe("Stand van het bewijs: het beslisscherm", () => {
  const tests: StandingTestInput[] = [
    { experimentId: "t1", title: "Landingpagina", state: "analyzed", verdict: "pass", cardStatus: "approved", type: "landing", evidenceLevel: "small_action", successes: 12 },
    { experimentId: "t2", title: "Interviews", state: "analyzed", verdict: "inconclusive", cardStatus: "approved", type: "interview" },
    { experimentId: "t3", title: "Prijstest", state: "live", verdict: null, cardStatus: null, type: "pricing" },
  ];

  it('"x van y kritieke aannames getest": alleen een hoofdtest met uitslag geslaagd of niet geslaagd', () => {
    const s = evidenceStanding(
      input(
        [assumption("a1", { primary: "t1", observations: [obs("o1", "waitlist_signup", "experiment:t1")] }), assumption("a2", { primary: "t2" }), assumption("a3", { primary: "t3" })],
        tests,
      ),
    );
    expect(s.critical).toEqual({ total: 3, tested: 1 });
    expect(s.assumptions.map((a) => a.primary?.status)).toEqual(["Geslaagd · niveau: kleine handeling", "Onbeslist · niveau: probleem in eigen gedrag", "loopt"]);
    // Een concept-Learning Card telt (nog) niet als getest.
    expect(primaryStatus({ primaryExperimentId: "t9" }, [{ experimentId: "t9", state: "ended", verdict: "fail", cardStatus: "draft", type: "landing" }], "idee")).toMatchObject({
      tested: false,
      status: "Niet geslaagd · niveau: kleine handeling (Learning Card nog niet goedgekeurd)",
    });
    expect(primaryStatus({ primaryExperimentId: null }, tests, "idee")).toBeNull();
  });

  it("zekerheid laag: meningen alleen, en zonder kritieke aannames", () => {
    const s = evidenceStanding(input([assumption("a1", { observations: [obs("o1", "opinion", "interview:1"), obs("o2", "opinion", "interview:2")] })]));
    expect(s.certainty).toBe("low");
    expect(s.strongest).toMatchObject({ step: "opinion", level: "opinion", label: "uitgesproken intentie", persons: 2, sources: 2 });
    expect(s.certaintyReason).toBe("laagste kans onder de kritieke aannames 35–45% (aanname 1); zwakste bewijs: mening");
    const none = evidenceStanding(input([assumption("a1", { importance: 3 })]));
    expect(none.certainty).toBe("low");
    expect(none.certaintyReason).toBe("nog geen kritieke aanname gekozen om te testen (belangrijkheid 4 of 5)");
    expect(none.summary).toBe("Zekerheid: laag · 0 van 0 kritieke aannames getest · sterkste bewijs: nog geen echte waarneming");
  });

  it("zekerheid midden en hoog: laagste kans plus het niveau op de schaal (de zwakste kritieke aanname telt)", () => {
    const behaviour = (id: string, prior: number, kinds: string[]) => assumption(id, { prior, observations: kinds.map((k, i) => obs(`${id}-${i}`, k, `interview:${id}-${i}`)) });
    // Kleine handeling, plafond 60%: midden.
    const mid = evidenceStanding(input([behaviour("a1", 0.5, ["waitlist_signup", "demo_request"])]));
    expect(mid.assumptions[0].probability).toBeCloseTo(0.6, 12);
    expect(mid.certainty).toBe("medium");
    // Keuze bij een prijs met hoge startkans: plafond 75%, boven de drempel van 70%: hoog.
    const high = evidenceStanding(input([behaviour("a1", 0.65, ["quote_request", "quote_request"])]));
    expect(high.assumptions[0].probability).toBeGreaterThanOrEqual(CERTAINTY_HIGH);
    expect(high.certainty).toBe("high");
    // Eén kritieke aanname met alleen meningen trekt het geheel naar laag, ook al is een andere hoog.
    const mixed = evidenceStanding(input([behaviour("a1", 0.65, ["quote_request", "quote_request"]), behaviour("a2", 0.65, ["opinion"])]));
    expect(mixed.certainty).toBe("low");
    // Bureauonderzoek is geen klantbewijs: geen trede boven verkenning.
    const desk = evidenceStanding(input([assumption("a1", { prior: 0.65, claims: [claim("c1", "verified"), claim("c2", "verified")] })]));
    expect(desk.assumptions[0].step).toBe("exploration");
    expect(desk.certainty).toBe("low");
  });

  it("sterkste bewijs telt personen: per interview één, per test de geslaagde deelnemers", () => {
    const s = evidenceStanding(
      input([assumption("a1", { primary: "t1", observations: [obs("o1", "waitlist_signup", "experiment:t1"), obs("o2", "demo_request", "interview:7")] })], tests),
    );
    expect(s.strongest).toMatchObject({ step: "behaviour", level: "small_action", persons: 13, sources: 2 });
    expect(s.summary).toBe("Zekerheid: midden · 1 van 1 kritieke aanname getest · sterkste bewijs: kleine handeling (13 personen)");
  });

  it("volgende stap: de eerste uit de informatiewaarde, met test en reden", () => {
    const ranked = [
      { id: "a2", voi: { test: { label: "7 interviews", external: false }, reason: "Test deze eerst, omdat …" } },
      { id: "a1", voi: { test: { label: "een landingpagina", external: false }, reason: "Test deze als tweede, omdat …" } },
    ];
    const next = nextFromInformationValue("idee", ranked)!;
    expect(next).toEqual({ title: "7 interviews (aanname 1)", detail: "Test deze eerst, omdat …", href: "/app/ideas/idee/experiments?assumption=a2" });
    expect(nextFromInformationValue("idee", [])).toBeNull();
    const s = evidenceStanding(input([assumption("a1", { observations: [obs("o1", "opinion", "interview:1")] })], [], next));
    expect(s.summary).toBe("Zekerheid: laag · 0 van 1 kritieke aanname getest · sterkste bewijs: uitgesproken intentie (1 persoon) · volgende stap: 7 interviews (aanname 1)");
    expect(s.next).toEqual(next);
  });

  it("past in een rapportmomentopname en is daaruit terug te lezen", () => {
    const s = evidenceStanding(input([assumption("a1")]));
    expect(asEvidenceStanding(JSON.parse(JSON.stringify(s)))).toEqual(s);
    expect(asEvidenceStanding(undefined)).toBeNull();
    expect(asEvidenceStanding({ summary: "x" })).toBeNull();
  });
});
