import { describe, expect, it } from "vitest";
import { buildReportCounts, formatGroups } from "@/lib/domain/report-counts";

// Golf C, punt 19: geanonimiseerde momentopname van alle aantallen bij een rapport.
const metric = (n: number, successes: number) => ({ n, successes, interval: { point: 0, low: 0, high: 0 }, responses: n + 2, tooFast: 1, screenedOut: 1, failedAttention: 0, straightlining: 0 });

describe("buildReportCounts", () => {
  const counts = buildReportCounts([
    {
      title: "Landingpage",
      type: "Landingpagetest",
      state: "completed",
      metrics: { n: 120, successes: 9, byChannel: [{ channel: "linkedin", visitors: 80, actions: 4 }, { channel: "network", visitors: 40, actions: 5 }, { channel: "direct", visitors: 0, actions: 0 }], survey: null },
      recruitmentGroup: "cold",
    },
    {
      title: "Enquête",
      type: "Enquête",
      state: "live",
      metrics: {
        n: 50,
        successes: 20,
        byChannel: [{ channel: "email", visitors: 30, actions: 14 }, { channel: "linkedin", visitors: 20, actions: 6 }],
        survey: { invitation: metric(30, 14), openLink: metric(20, 6), responses: 54 },
      },
      // Test van vóór golf A: geen wervingsgroep.
      recruitmentGroup: null,
    },
    {
      title: "Gesprekken",
      type: "Klantinterview",
      state: "completed",
      metrics: {
        n: 3,
        successes: 2,
        byChannel: [{ channel: "network", visitors: 3, actions: 2 }],
        survey: null,
        byRecruitment: [
          { group: "own_network", n: 2, successes: 1 },
          { group: "warm", n: 1, successes: 1 },
        ],
      },
      recruitmentGroup: "warm",
    },
    { title: "Afgebroken", type: "Prijstest", state: "stopped", metrics: null, recruitmentGroup: "paid_panel" },
  ]);

  it("telt n en successen per test en in totaal", () => {
    expect(counts.tests.map((t) => [t.test, t.n, t.successes])).toEqual([
      ["Landingpage", 120, 9],
      ["Enquête", 50, 20],
      ["Gesprekken", 3, 2],
      ["Afgebroken", 0, 0],
    ]);
    expect(counts.totals).toEqual({ tests: 4, n: 173, successes: 31 });
  });

  it("splitst per kanaal (zonder lege kanalen) en per bron", () => {
    expect(counts.tests[0].byChannel).toEqual([
      { channel: "linkedin", n: 80, successes: 4 },
      { channel: "network", n: 40, successes: 5 },
    ]);
    expect(counts.tests[0].bySource).toEqual([
      { source: "linkedin", n: 80, successes: 4 },
      { source: "network", n: 40, successes: 5 },
    ]);
  });

  it("geeft bij een enquête de kernvraag per bron", () => {
    expect(counts.tests[1].keyQuestion).toEqual([
      { source: "uitnodiging", n: 30, successes: 14, responses: 32 },
      { source: "open link", n: 20, successes: 6, responses: 22 },
    ]);
    expect(counts.tests[1].bySource.map((s) => s.source)).toEqual(["uitnodiging", "open link"]);
    expect(counts.tests[0].keyQuestion).toBeNull();
  });

  it("verdeelt per wervingsgroep (golf A) met n en successen", () => {
    // Interviews: per gesprek (uit de metingen, alleen gesprekken met toestemming).
    expect(counts.tests[2].byGroup).toEqual([
      { group: "own_network", label: "Eigen netwerk", n: 2, successes: 1 },
      { group: "warm", label: "Warm contact", n: 1, successes: 1 },
    ]);
    // Andere tests: de groep van de test geldt voor alle deelnemers.
    expect(counts.tests[0].byGroup).toEqual([{ group: "cold", label: "Koud", n: 120, successes: 9 }]);
    // Zonder vastgelegde groep: onbekend.
    expect(counts.tests[1].byGroup).toEqual([{ group: "unknown", label: "Onbekend", n: 50, successes: 20 }]);
    // Zonder deelnemers geen verdeling.
    expect(counts.tests[3].byGroup).toEqual([]);
    expect(formatGroups(counts.tests[2].byGroup)).toBe("Eigen netwerk 1/2 · Warm contact 1/1");
  });

  it("een onleesbare groep telt als onbekend en groepen worden samengeteld", () => {
    const c = buildReportCounts([
      {
        title: "Gesprekken",
        type: "Klantinterview",
        state: "completed",
        metrics: { n: 3, successes: 1, byChannel: [], survey: null, byRecruitment: [{ group: "unknown", n: 1, successes: 0 }, { group: "iets anders", n: 2, successes: 1 }] },
      },
    ]);
    expect(c.tests[0].byGroup).toEqual([{ group: "unknown", label: "Onbekend", n: 3, successes: 1 }]);
  });

  it("toont rapporten met de eerdere momentopname (versie 1) zoals ze zijn", () => {
    expect(formatGroups([{ group: "bekenden", n: 2, successes: null }, { group: "onbekenden", n: 1, successes: null }])).toBe("bekenden 2 · onbekenden 1");
  });

  it("bevat geen persoonsgegevens en vermeldt dat herleiding na de bewaartermijn alleen op aantallen kan", () => {
    const text = JSON.stringify(counts);
    expect(text).not.toMatch(/@|recruitedVia|isAcquaintance|consent|recruitmentGroup|byRecruitment/);
    expect(counts.note).toContain("alleen op deze aantallen");
    expect(buildReportCounts([])).toEqual({ version: 2, note: counts.note, tests: [], totals: { tests: 0, n: 0, successes: 0 } });
  });
});
