import { describe, expect, it } from "vitest";
import { selfApproval, selfApprovalText } from "@/lib/domain/experiment-gates";
import { buildAllTests, type AllTestsInput } from "@/lib/domain/all-tests";

// Gebruikerstest B4: zelfgoedkeuring zichtbaar maken (geen vier-ogenregel).

describe("selfApproval", () => {
  it("eigenaar keurt goed → zelf", () => {
    expect(selfApproval({ ownerId: "u1", submittedBy: "u2", approverId: "u1" })).toEqual({ self: true, owner: true, submitter: false });
  });
  it("indiener keurt goed → zelf", () => {
    expect(selfApproval({ ownerId: "u1", submittedBy: "u2", approverId: "u2" })).toEqual({ self: true, owner: false, submitter: true });
  });
  it("iemand anders keurt goed → niet zelf", () => {
    expect(selfApproval({ ownerId: "u1", submittedBy: "u2", approverId: "u3" }).self).toBe(false);
  });
  it("zonder indiener (database vóór de migratie): alleen de eigenaar telt", () => {
    expect(selfApproval({ ownerId: "u1", submittedBy: null, approverId: "u1" }).self).toBe(true);
    expect(selfApproval({ ownerId: "u1", submittedBy: undefined, approverId: "u2" }).self).toBe(false);
  });
  it("zonder goedkeurder nooit zelf", () => {
    expect(selfApproval({ ownerId: null, submittedBy: null, approverId: null }).self).toBe(false);
  });
  it("de melding zegt waarom", () => {
    expect(selfApprovalText(selfApproval({ ownerId: "u1", submittedBy: "u1", approverId: "u1" }))).toMatch(/maakte hem en bood hem zelf ter review aan/);
    expect(selfApprovalText(selfApproval({ ownerId: "u1", submittedBy: "u2", approverId: "u1" }))).toMatch(/^Je keurt je eigen test goed: je maakte hem zelf/);
  });
});

describe("rapport: alle tests", () => {
  const t = (over: Partial<AllTestsInput>): AllTestsInput => ({
    title: "Kanaaltest",
    type: "Landingpage-test",
    state: "ended",
    assumptionId: "a1",
    assumption: "Clubs zijn te bereiken via bonden",
    role: "primary",
    locked: true,
    endedEarly: false,
    label: "geslaagd",
    level: null,
    n: 20,
    successes: 8,
    ...over,
  });
  it("een zelf goedgekeurde test staat zo in de status", () => {
    expect(buildAllTests([t({ selfApproved: true })]).rows[0].status).toBe("afgerond · zelf goedgekeurd");
    expect(buildAllTests([t({})]).rows[0].status).toBe("afgerond");
  });
});
