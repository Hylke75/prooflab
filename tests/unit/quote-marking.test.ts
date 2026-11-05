import { describe, expect, it } from "vitest";
import { checkMarkedQuote, displaySegments, locateQuote, PURGED_TRANSCRIPT, replaceInStored, transcriptChangeAllowed, TRANSCRIPT_FROZEN } from "@/lib/domain/quote-marking";
import { prepareImport } from "@/lib/domain/interview-import";
import { pseudonymizeText } from "@/lib/domain/pseudonymize";
import { readStoredSegments } from "@/lib/domain/transcript-parse";
import { parsePlainText } from "@/lib/domain/transcript-parse";

// Fase 1 · punt 3, deelstap 5 (verplicht): de citaatcontrole bij markeren.
const source = parsePlainText(
  "[00:00:01] Sanne de Vries: Wanneer ging het voor het laatst mis?\n[00:00:09] Peter Bakker: Vorige maand stuurde ik veertig appjes om één wedstrijd te verplaatsen. Dat kostte me een hele avond.\n[00:00:30] Sanne de Vries: Wat heb je toen gedaan?",
);
const prepared = prepareImport(source.segments, []);
if (!prepared.ok) throw new Error("fixture");
const transcript = prepared.transcript;
const segments = readStoredSegments(prepared.segments, transcript.length);
const QUOTE = "Vorige maand stuurde ik veertig appjes om één wedstrijd te verplaatsen.";
const start = transcript.indexOf(QUOTE);
const end = start + QUOTE.length;

describe("citaatcontrole bij markeren", () => {
  it("goed: de selectie is precies het citaat, binnen één uitspraak", () => {
    expect(start).toBeGreaterThan(0);
    expect(checkMarkedQuote(transcript, start, end, QUOTE, segments)).toEqual({ ok: true, quote: QUOTE, segmentIndex: 1 });
    // Witruimte en typografische tekens tellen niet als verschil (dezelfde normalisatie als checkQuote).
    expect(checkMarkedQuote(transcript, start, end, `  ${QUOTE.replace(" ", "  ")} `, segments).ok).toBe(true);
  });

  it("verschoven positie: wordt geweigerd", () => {
    const r = checkMarkedQuote(transcript, start + 3, end + 3, QUOTE, segments);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.reason).toMatch(/komt niet overeen met de gemarkeerde plek/);
  });

  it("gewijzigde tekst: een aangepast citaat op de juiste plek wordt geweigerd", () => {
    const changed = QUOTE.replace("veertig", "vijftig");
    expect(checkMarkedQuote(transcript, start, end, changed, segments).ok).toBe(false);
    // En een citaat dat nergens in het transcript staat, ook niet via de oude controle.
    expect(checkMarkedQuote(`${transcript} ${changed}`, start, end, changed, segments).ok).toBe(false);
  });

  it("over twee uitspraken of met de kop erbij: geweigerd", () => {
    const cross = transcript.indexOf("hele avond.");
    const crossEnd = transcript.indexOf("Wat heb je");
    expect(checkMarkedQuote(transcript, cross, crossEnd + 3, transcript.slice(cross, crossEnd + 3), segments).ok).toBe(false);
    const head = transcript.indexOf("[00:00:09]");
    expect(checkMarkedQuote(transcript, head, end, transcript.slice(head, end), segments).ok).toBe(false);
  });

  it("ongeldige posities, te kort of verwijderd transcript", () => {
    expect(checkMarkedQuote(transcript, end, start, QUOTE, segments).ok).toBe(false);
    expect(checkMarkedQuote(transcript, 0, transcript.length + 1, QUOTE, segments).ok).toBe(false);
    expect(checkMarkedQuote(transcript, start, start + 5, transcript.slice(start, start + 5), segments).ok).toBe(false);
    expect(checkMarkedQuote(PURGED_TRANSCRIPT, 0, 10, PURGED_TRANSCRIPT.slice(0, 10)).ok).toBe(false);
  });

  it("pseudonimisering na markeren is onmogelijk", () => {
    // Zodra er een observatie is, mag het transcript niet meer veranderen (ook de database weigert het).
    expect(transcriptChangeAllowed(1)).toEqual({ ok: false, reason: TRANSCRIPT_FROZEN });
    expect(transcriptChangeAllowed(0)).toEqual({ ok: true });
    // En zou het toch veranderen, dan klopt de oude markering niet meer: het citaat wordt geweigerd.
    const repseudo = pseudonymizeText(transcript, [{ term: "Vorige", kind: "person", label: "Persoon 9", enabled: true }]);
    expect(checkMarkedQuote(repseudo, start, end, QUOTE).ok).toBe(false);
  });
});

describe("zonder muis: het citaat opzoeken", () => {
  it("precies één keer: begin en einde", () => {
    expect(locateQuote(transcript, QUOTE)).toEqual({ start, end });
    expect(locateQuote(transcript, QUOTE.toLowerCase())).toEqual({ start, end });
  });
  it("niet of meer dan eens: vraag om te selecteren", () => {
    expect(locateQuote(transcript, "staat hier helemaal niet in")).toHaveProperty("error");
    expect(locateQuote(`${transcript}\n${QUOTE}`, QUOTE)).toHaveProperty("error");
  });
});

describe("regels om te tonen en een gemiste naam vervangen", () => {
  it("zonder segmenten (geplakt): één regel per tekstregel", () => {
    const segs = displaySegments("Regel een met tekst.\n\nRegel twee.", null);
    expect(segs.map((s) => [s.a, s.b])).toEqual([
      [0, 20],
      [22, 33],
    ]);
  });

  it("vóór het markeren: vervangen met nieuwe, kloppende posities", () => {
    const r = replaceInStored(transcript, prepared.segments, { term: "wedstrijd", kind: "person", label: "Persoon 7", enabled: true });
    expect(r.count).toBe(1);
    expect(r.transcript).toContain("om één Persoon 7 te verplaatsen");
    const segs = readStoredSegments(r.segments, r.transcript.length);
    expect(r.transcript.slice(segs[2].a, segs[2].b)).toBe("Wat heb je toen gedaan?");
  });
});
