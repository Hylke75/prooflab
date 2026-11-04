import { describe, expect, it } from "vitest";
import { z } from "zod";
import { fieldErrorsFrom, savedNothing } from "@/lib/domain/form-errors";

describe("fieldErrorsFrom (B1)", () => {
  it("geeft per veld de eerste melding en gebruikt een eigen tekst als die er is", () => {
    const s = z.object({ a: z.string().min(3, "Te kort."), b: z.string().min(1).max(2), c: z.enum(["x"]) });
    const r = s.safeParse({ a: "", b: "", c: "y" });
    if (r.success) throw new Error("moet falen");
    expect(fieldErrorsFrom(r.error.issues, { c: "Kies een waarde." })).toEqual({ a: "Te kort.", b: expect.any(String), c: "Kies een waarde." });
  });

  it("vat het aantal punten samen voor bij de knop", () => {
    expect(savedNothing("Het besluit", { a: "x" })).toBe("Het besluit is nog niet opgeslagen: 1 punt moet nog worden aangevuld.");
    expect(savedNothing("Het besluit", { a: "x", b: "y" })).toMatch(/2 punten moeten/);
    expect(savedNothing("Het besluit", {})).toBe("Het besluit is niet opgeslagen.");
  });
});
