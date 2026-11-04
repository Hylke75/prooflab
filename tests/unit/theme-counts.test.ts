import { describe, expect, it } from "vitest";
import { countsFromRpc, themeCounts, xOfN, type CountInterview } from "@/lib/domain/theme-counts";

// Fase 1 · punt 3, deelstap 7: "X van N geïnterviewden" per thema en aanname.
const iv = (id: string, o: Partial<CountInterview> = {}): CountInterview => ({ id, dmuRole: "user", isAcquaintance: false, recruitmentGroup: "cold", testGroup: null, isPractice: false, consent: true, ...o });

const interviews = [
  iv("a", { dmuRole: "payer" }),
  iv("b", { isAcquaintance: true, recruitmentGroup: "cold" }), // bekende = eigen netwerk
  iv("c", { recruitmentGroup: null, testGroup: "warm" }), // groep van de test
  iv("p", { isPractice: true }), // oefening: buiten N en X
  iv("u", { isPractice: null }), // niet aangegeven: buiten N en X
  iv("n", { consent: false }), // zonder toestemming: buiten N en X
];
const codes = [
  { id: "t1", label: "Tijdverlies door appgroepen", status: "accepted" },
  { id: "t2", label: "Privacy", status: "accepted" },
  { id: "t3", label: "Voorstel", status: "proposed" },
  { id: "t4", label: "Afgewezen", status: "rejected" },
];

describe("X van N", () => {
  const r = themeCounts({
    interviews,
    codes,
    assignments: [
      { interviewId: "a", codeId: "t1", origin: "manual", reviewStatus: null },
      { interviewId: "a", codeId: "t1", origin: "ai", reviewStatus: "accepted" }, // zelfde persoon: één keer
      { interviewId: "b", codeId: "t1", origin: "ai", reviewStatus: "accepted" },
      { interviewId: "c", codeId: "t1", origin: "ai", reviewStatus: null }, // niet beoordeeld: telt niet
      { interviewId: "p", codeId: "t1", origin: "manual", reviewStatus: null }, // oefening
      { interviewId: "n", codeId: "t1", origin: "manual", reviewStatus: null }, // zonder toestemming
      { interviewId: "c", codeId: "t2", origin: "ai", reviewStatus: "rejected" },
      { interviewId: "a", codeId: "t3", origin: "manual", reviewStatus: null }, // thema nog voorstel
      { interviewId: "a", codeId: "t4", origin: "manual", reviewStatus: null }, // thema afgewezen
    ],
    assumptions: [{ id: "as1", statement: "Clubs verliezen tijd" }],
    links: [
      { interviewId: "a", assumptionId: "as1", origin: "manual", reviewStatus: null, isSynthetic: false },
      { interviewId: "b", assumptionId: "as1", origin: "ai", reviewStatus: null, isSynthetic: false }, // AI zonder beoordeling
      { interviewId: "c", assumptionId: "as1", origin: "manual", reviewStatus: null, isSynthetic: true },
      { interviewId: "p", assumptionId: "as1", origin: "manual", reviewStatus: null, isSynthetic: false },
    ],
  });
  const get = (id: string) => r.items.find((i) => i.id === id)!;

  it("N = echte gesprekken met toestemming; X = verschillende geïnterviewden met een meetellende toewijzing", () => {
    expect(r.total).toBe(3);
    expect(get("t1")).toMatchObject({ mentioned: 2, total: 3 });
    expect(get("t1").interviewIds.sort()).toEqual(["a", "b"]);
    expect(get("t2").mentioned).toBe(0);
    expect(xOfN(get("t1"))).toBe("2 van 3 geïnterviewden");
  });

  it("voorgestelde en afgewezen thema's staan er niet in", () => {
    expect(r.items.map((i) => i.id)).not.toContain("t3");
    expect(r.items.map((i) => i.id)).not.toContain("t4");
  });

  it("uitsplitsing per rol en wervingsgroep (bekende = eigen netwerk, anders de groep van de test)", () => {
    expect(get("t1").byRole).toEqual([
      { key: "user", mentioned: 1, total: 2 },
      { key: "payer", mentioned: 1, total: 1 },
    ]);
    expect(get("t1").byRecruitment).toEqual(
      expect.arrayContaining([
        { key: "cold", mentioned: 1, total: 1 },
        { key: "own_network", mentioned: 1, total: 1 },
        { key: "warm", mentioned: 0, total: 1 },
      ]),
    );
  });

  it("per aanname: alleen handmatige of geaccepteerde, niet-synthetische koppelingen uit echte gesprekken", () => {
    expect(get("as1")).toMatchObject({ type: "assumption", mentioned: 1, total: 3 });
  });

  it("thema's eerst, op aantal", () => {
    expect(r.items.map((i) => i.id)).toEqual(["t1", "t2", "as1"]);
  });
});

describe("opdrachtgever: dezelfde vorm uit interview_theme_counts", () => {
  it("zet de rijen om, zonder interviews of citaten", () => {
    const r = countsFromRpc([
      { item_type: "theme", item_id: "t1", label: "Tijdverlies", dimension: "all", bucket: "all", mentioned: "2", total: "3" },
      { item_type: "theme", item_id: "t1", label: "Tijdverlies", dimension: "role", bucket: "payer", mentioned: 1, total: 1 },
      { item_type: "theme", item_id: "t1", label: "Tijdverlies", dimension: "recruitment", bucket: "cold", mentioned: 1, total: 1 },
      { item_type: "assumption", item_id: "as1", label: "Clubs verliezen tijd", dimension: "all", bucket: "all", mentioned: 1, total: 3 },
    ]);
    expect(r.total).toBe(3);
    expect(r.items[0]).toMatchObject({ id: "t1", mentioned: 2, total: 3, interviewIds: [], byRole: [{ key: "payer", mentioned: 1, total: 1 }] });
    expect(r.items[1]).toMatchObject({ type: "assumption", mentioned: 1 });
  });
});
