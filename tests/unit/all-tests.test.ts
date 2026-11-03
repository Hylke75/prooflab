import { describe, expect, it } from "vitest";
import { allTestsSummary, buildAllTests, isRegistered, type AllTestsInput } from "@/lib/domain/all-tests";

// Golf A, punt 12: het rapport bevat verplicht alle vooraf vastgelegde tests, ook afgebroken, mislukte en verkennende.
const t = (over: Partial<AllTestsInput>): AllTestsInput => ({
  title: "Test",
  type: "Landingpage-test",
  state: "ended",
  assumptionId: "a1",
  assumption: "Eventmanagers willen dit",
  role: "exploratory",
  locked: true,
  endedEarly: false,
  label: "geslaagd",
  level: "small_action",
  n: 20,
  successes: 6,
  ...over,
});

describe("alle tests", () => {
  it("neemt alle vooraf vastgelegde tests op, ook mislukte, afgebroken en verkennende", () => {
    const { rows } = buildAllTests([
      t({ title: "Hoofd", role: "primary", label: "niet geslaagd" }),
      t({ title: "Afgebroken", endedEarly: true, label: "onbeslist" }),
      t({ title: "Loopt", state: "live", label: "loopt nog" }),
      t({ title: "Concept", state: "draft", locked: false }),
      t({ title: "Teruggezet", state: "draft", locked: true }),
    ]);
    expect(rows.map((r) => r.title)).toEqual(["Hoofd", "Afgebroken", "Loopt", "Teruggezet"]);
    expect(rows[0]).toMatchObject({ role: "Hoofdtest", failed: true, outcome: "niet geslaagd · niveau: kleine handeling", result: "6 van 20" });
    expect(rows[1]).toMatchObject({ role: "Verkennend", aborted: true, status: "afgebroken · afgerond" });
    expect(rows[2]).toMatchObject({ status: "loopt nog", outcome: "—" });
    expect(rows[3].status).toMatch(/teruggezet/);
    expect(allTestsSummary(rows)).toBe("4 tests vooraf vastgelegd: 1 niet geslaagd, 1 afgebroken, 3 verkennend.");
  });

  it("telt de tests per aanname, met hoofdtest en verkennend", () => {
    const { perAssumption } = buildAllTests([
      t({ role: "primary" }),
      t({}),
      t({ assumptionId: "a2", assumption: "Bureaus betalen vooraf" }),
      t({ assumptionId: "a2", assumption: "Bureaus betalen vooraf", state: "draft", locked: false }),
    ]);
    expect(perAssumption).toEqual([
      { assumption: "Eventmanagers willen dit", total: 2, primary: 1, exploratory: 1 },
      { assumption: "Bureaus betalen vooraf", total: 1, primary: 0, exploratory: 1 },
    ]);
  });

  it("zonder tests: een eerlijke melding", () => {
    expect(allTestsSummary([])).toBe("Er zijn nog geen tests vooraf vastgelegd.");
    expect(isRegistered({ state: "approved", locked: true })).toBe(true);
    expect(isRegistered({ state: "ready_for_review", locked: false })).toBe(false);
  });
});
