import { describe, expect, it } from "vitest";
import { CONSENT_REQUIRED, interviewIntake, interviewRecruitmentDefault } from "@/lib/domain/interview-intake";

// Gebruikerstest C8: toestemming alleen bij een echt gesprek; één veld voor wervingsgroep en "bekende".

describe("interviewIntake: toestemming", () => {
  it("echt gesprek zonder toestemming → fout", () => {
    expect(interviewIntake({ isPractice: false, consent: false, recruitmentGroup: "cold", recruitedVia: "outreach" }).error).toBe(CONSENT_REQUIRED);
  });
  it("echt gesprek met toestemming → opgeslagen als true", () => {
    const r = interviewIntake({ isPractice: false, consent: true, recruitmentGroup: "cold", recruitedVia: "outreach" });
    expect(r.error).toBeNull();
    expect(r.consent_recorded).toBe(true);
  });
  it("oefening zonder toestemming → mag, en consent_recorded is de werkelijke waarde (false)", () => {
    const r = interviewIntake({ isPractice: true, consent: false, recruitmentGroup: null, recruitedVia: "network" });
    expect(r.error).toBeNull();
    expect(r.consent_recorded).toBe(false);
  });
});

describe("interviewIntake: wervingsgroep en bekende", () => {
  it("eigen netwerk gekozen → bekende", () => {
    expect(interviewIntake({ isPractice: false, consent: true, recruitmentGroup: "own_network", recruitedVia: "outreach" })).toMatchObject({ recruitment_group: "own_network", is_acquaintance: true });
  });
  it("een andere groep gekozen → geen bekende", () => {
    expect(interviewIntake({ isPractice: false, consent: true, recruitmentGroup: "warm", recruitedVia: "network" })).toMatchObject({ recruitment_group: "warm", is_acquaintance: false });
  });
  it("zonder keuze: uit het wervingskanaal, niet 'onbekend'", () => {
    expect(interviewIntake({ isPractice: false, consent: true, recruitmentGroup: "", recruitedVia: "outreach" })).toMatchObject({ recruitment_group: "cold", is_acquaintance: false });
    expect(interviewIntake({ isPractice: false, consent: true, recruitmentGroup: null, recruitedVia: "network" })).toMatchObject({ recruitment_group: "own_network", is_acquaintance: true });
  });
  it("zegt het kanaal niets, dan de groep van de test, en pas daarna onbekend", () => {
    expect(interviewRecruitmentDefault("onbekend-kanaal", "paid_panel")).toBe("paid_panel");
    expect(interviewRecruitmentDefault(null, null)).toBe("unknown");
  });
});
