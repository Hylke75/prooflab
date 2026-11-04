import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  heldOnError,
  missingImportSchema,
  parseDecisionsField,
  parseNamesField,
  participantLabelError,
  prepareImport,
  retentionFrom,
} from "@/lib/domain/interview-import";
import { proposePseudonyms } from "@/lib/domain/pseudonymize";
import { interviewIntake } from "@/lib/domain/interview-intake";
import { parseVtt, readStoredSegments } from "@/lib/domain/transcript-parse";
import { readTranscriptText } from "@/lib/transcript-file";

// Fase 1 · punt 3, deelstap 4: een geïmporteerd transcript klaarmaken voor opslag.
const teams = parseVtt(readFileSync(path.join(__dirname, "fixtures/transcripts/teams.vtt"), "utf8")).segments;

describe("bewaartermijn vanaf de gespreksdatum", () => {
  it("12 maanden na het gesprek, ook bij het einde van de maand", () => {
    expect(retentionFrom("2026-03-10")).toBe("2027-03-10");
    expect(retentionFrom("2024-02-29")).toBe("2025-02-28");
    expect(retentionFrom("2026-12-31")).toBe("2027-12-31");
  });

  it("geen gesprek in de toekomst of van vóór de bewaartermijn", () => {
    expect(heldOnError("2026-11-05", "2026-11-04")).toMatch(/toekomst/);
    expect(heldOnError("2025-10-01", "2026-11-04")).toMatch(/bewaartermijn/);
    expect(heldOnError("2026-01-15", "2026-11-04")).toBeNull();
    expect(heldOnError("", "2026-11-04")).toMatch(/datum/);
  });
});

describe("toestemming (C8)", () => {
  it("alleen verplicht bij een echt gesprek; een oefening vraagt geen vinkje", () => {
    expect(interviewIntake({ isPractice: true, consent: false, recruitmentGroup: null, recruitedVia: "network" }).error).toBeNull();
    expect(interviewIntake({ isPractice: false, consent: false, recruitmentGroup: null, recruitedVia: "network" }).error).toMatch(/toestemming/);
  });
});

describe("klaarmaken voor opslag", () => {
  it("zonder keuzes geldt het voorstel van de server: alles vervangen, posities kloppen, geen namen in de opslag", () => {
    const r = prepareImport(teams, []);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.transcript).toBe(
      "[00:00:01] Spreker A: Goedemorgen, fijn dat je tijd hebt. Ik ben benieuwd hoe jullie nu communiceren.\n[00:00:07] Spreker B: Bij Club 1 doen we alles via WhatsApp-groepen. Vorige week zijn we twee uur kwijt geweest aan het rooster rondsturen.",
    );
    const stored = readStoredSegments(r.segments, r.transcript.length);
    expect(stored).toHaveLength(2);
    expect(r.transcript.slice(stored[1].a, stored[1].b)).toMatch(/^Bij Club 1/);
    const json = JSON.stringify({ segments: r.segments, labels: r.labels });
    for (const name of ["Sanne", "Peter", "Bakker", "Oranje"]) expect(json).not.toContain(name);
    expect(r.speakers).toEqual(["Spreker A", "Spreker B"]);
  });

  it("een label dat een naam bevat, wordt geweigerd; een uitgezette naam blijft staan", () => {
    const bad = prepareImport(teams, [{ term: "Peter Bakker", kind: "speaker", label: "Peter", enabled: true }]);
    expect(bad.ok).toBe(false);
    const off = prepareImport(teams, [{ term: "VV Oranje", kind: "club", label: "Club 1", enabled: false }]);
    expect(off.ok && off.transcript).toContain("VV Oranje");
  });

  it("e-mailadressen kunnen niet worden uitgezet", () => {
    const { parsed } = readTranscriptText("paste", "Interviewer: Hoe bereik ik je?\nRespondent: Mail naar jan.jansen@club.nl, dat lees ik elke dag.") as { parsed: { segments: typeof teams } };
    const r = prepareImport(parsed.segments, [{ term: "jan.jansen@club.nl", kind: "email", label: "E-mail 1", enabled: false }]);
    expect(r.ok && r.transcript).toContain("Mail naar E-mail 1, dat lees ik elke dag.");
  });

  it("het pseudoniem van de deelnemer mag geen gevonden naam bevatten", () => {
    const decisions = proposePseudonyms(teams).map(({ term, kind, label, enabled }) => ({ term, kind, label, enabled }));
    expect(participantLabelError("Peter (penningmeester)", decisions)).toMatch(/naam/);
    expect(participantLabelError("Deelnemer A", decisions)).toBeNull();
    expect(participantLabelError("jan@club.nl", decisions)).toMatch(/e-mailadres/);
  });
});

describe("formuliervelden en terugval", () => {
  it("ongeldige JSON is een lege lijst (dan geldt het voorstel van de server)", () => {
    expect(parseDecisionsField("{kapot")).toEqual([]);
    expect(parseDecisionsField(JSON.stringify([{ term: "A", kind: "person", label: "Persoon 1", enabled: true }, 3]))).toHaveLength(1);
    expect(parseNamesField(JSON.stringify(["Ozan", 4, "Yilmaz"]))).toEqual(["Ozan", "Yilmaz"]);
  });

  it("herkent een database zonder de migratie", () => {
    expect(missingImportSchema({ code: "PGRST204", message: "Could not find the 'source_format' column of 'interviews' in the schema cache" })).toBe(true);
    expect(missingImportSchema({ code: "42703", message: 'column "source_hash" does not exist' })).toBe(true);
    expect(missingImportSchema({ code: "23505", message: "duplicate key" })).toBe(false);
    expect(missingImportSchema(null)).toBe(false);
  });
});
