import { describe, expect, it } from "vitest";
import { checkProbabilityInput } from "@/lib/domain/forecast";

describe("checkProbabilityInput (B0 punt 5)", () => {
  it("heeft geen standaardwaarde: leeg is een fout", () => {
    expect(checkProbabilityInput("")).toMatchObject({ ok: false });
    expect(checkProbabilityInput("  ")).toMatchObject({ ok: false });
  });
  it("accepteert hele getallen tussen 1 en 99 zonder ze te veranderen", () => {
    expect(checkProbabilityInput("35")).toEqual({ ok: true, pct: 35 });
    expect(checkProbabilityInput("1")).toEqual({ ok: true, pct: 1 });
    expect(checkProbabilityInput("99")).toEqual({ ok: true, pct: 99 });
  });
  it("valideert 0–100 en legt uit waarom 0 en 100 niet kunnen", () => {
    expect(checkProbabilityInput("-5")).toMatchObject({ ok: false, message: expect.stringMatching(/tussen 0 en 100/) });
    expect(checkProbabilityInput("120")).toMatchObject({ ok: false, message: expect.stringMatching(/tussen 0 en 100/) });
    expect(checkProbabilityInput("0")).toMatchObject({ ok: false, message: expect.stringMatching(/zekerheid/) });
    expect(checkProbabilityInput("100")).toMatchObject({ ok: false, message: expect.stringMatching(/zekerheid/) });
    expect(checkProbabilityInput("33,5")).toMatchObject({ ok: false, message: expect.stringMatching(/heel getal/) });
    expect(checkProbabilityInput("abc")).toMatchObject({ ok: false });
  });
});
