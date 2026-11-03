import { describe, expect, it } from "vitest";
import {
  countsAsEvidence,
  fictionSignals,
  fictionWarning,
  isPracticeObservation,
  practiceStatus,
  realInterviewIds,
  withPracticeFlag,
} from "@/lib/domain/practice";

describe("fictionSignals", () => {
  it("vindt de afgesproken woorden als hele woorden, zonder hoofdlettergevoeligheid", () => {
    expect(fictionSignals("Dit is een FICTIEF gesprek met een fictieve klant.")).toEqual(["fictief", "fictieve"]);
    expect(fictionSignals("Even een test. Daarna het testgesprek.")).toEqual(["test", "testgesprek"]);
    expect(fictionSignals("Een voorbeeld van een oefening, als oefen-interview.")).toEqual(["voorbeeld", "oefening", "oefen"]);
    expect(fictionSignals("dummy tekst, lorem  ipsum dolor")).toEqual(["dummy", "lorem ipsum"]);
    expect(fictionSignals("Een verzonnen rollenspel met John Doe en Jan Jansen.")).toEqual(["verzonnen", "rollenspel", "john doe", "jan jansen"]);
  });

  it("vindt niets binnen andere woorden", () => {
    expect(fictionSignals("Ik heb een attest nodig, bijvoorbeeld voor de contest of het testament.")).toEqual([]);
    expect(fictionSignals("De protester en de testen-reeks")).toEqual([]);
    expect(fictionSignals("Jan Janssen en Johnny Doerak")).toEqual([]);
  });

  it("geeft elk signaal één keer", () => {
    expect(fictionSignals("test test Test")).toEqual(["test"]);
  });

  it("geeft een lege lijst voor een gewoon transcript", () => {
    expect(fictionSignals("Vorige week heb ik drie offertes opgevraagd en de goedkoopste gekozen.")).toEqual([]);
    expect(fictionSignals("")).toEqual([]);
  });
});

describe("fictionWarning", () => {
  it("noemt de signalen en vraagt de keuze te controleren", () => {
    expect(fictionWarning(["fictief", "test"])).toBe('Dit transcript lijkt fictief: "fictief", "test"; controleer de keuze.');
    expect(fictionWarning([])).toBeNull();
  });
});

describe("oefendata telt niet als bewijs", () => {
  it("alleen een echt gesprek telt", () => {
    expect(countsAsEvidence(false)).toBe(true);
    expect(countsAsEvidence(true)).toBe(false);
    expect(countsAsEvidence(null)).toBe(false);
    expect(countsAsEvidence(undefined)).toBe(false);
    expect(practiceStatus(false)).toBe("real");
    expect(practiceStatus(true)).toBe("practice");
    expect(practiceStatus(null)).toBe("unknown");
  });

  it("behandelt waarnemingen uit oefen- en niet-aangegeven gesprekken als synthetisch", () => {
    const real = realInterviewIds([
      { id: "echt", is_practice: false },
      { id: "oefen", is_practice: true },
      { id: "onbekend", is_practice: null },
    ]);
    expect([...real]).toEqual(["echt"]);
    expect(isPracticeObservation({ interview_id: null }, real)).toBe(false);
    expect(isPracticeObservation({ interview_id: "echt" }, real)).toBe(false);
    expect(isPracticeObservation({ interview_id: "oefen" }, real)).toBe(true);
    expect(isPracticeObservation({ interview_id: "onbekend" }, real)).toBe(true);

    expect(withPracticeFlag({ interview_id: "oefen", is_synthetic: false, kind: "x" }, real)).toEqual({ interview_id: "oefen", is_synthetic: true, is_practice: true, kind: "x" });
    expect(withPracticeFlag({ interview_id: "echt", is_synthetic: false }, real)).toEqual({ interview_id: "echt", is_synthetic: false, is_practice: false });
    // Een al synthetische waarneming blijft synthetisch.
    expect(withPracticeFlag({ interview_id: null, is_synthetic: true }, real).is_synthetic).toBe(true);
  });
});
