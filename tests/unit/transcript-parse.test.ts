import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  AI_WINDOW_CHARS,
  checkTranscriptFile,
  formatTimestamp,
  MAX_TRANSCRIPT_BYTES,
  parsePlainText,
  parseSrt,
  parseTimestamp,
  parseTranscript,
  parseVtt,
  readStoredSegments,
  renderTranscript,
  segmentAt,
  storeSegments,
  transcriptExt,
  transcriptWindows,
} from "@/lib/domain/transcript-parse";
import { readTranscriptBytes, readTranscriptText, TRANSCRIPT_ERRORS } from "@/lib/transcript-file";
import { makeZip } from "./helpers/zip";

// Fase 1 · punt 3, deelstap 1: transcripten uit Teams, Zoom, Otter, Fathom en eigen notities naar segmenten.
const fixture = (name: string) => readFileSync(path.join(__dirname, "fixtures/transcripts", name), "utf8");

const docx = (paragraphs: string[]) =>
  makeZip([
    {
      name: "word/document.xml",
      data: `<?xml version="1.0"?><w:document xmlns:w="x"><w:body>${paragraphs.map((p) => `<w:p><w:r><w:t xml:space="preserve">${p}</w:t></w:r></w:p>`).join("")}</w:body></w:document>`,
    },
  ]);

describe("tijden", () => {
  it("leest de gangbare notaties", () => {
    expect(parseTimestamp("00:12:03.456")).toBe(723456);
    expect(parseTimestamp("1:02:03,4")).toBe(3723400);
    expect(parseTimestamp("02:03.5")).toBe(123500);
    expect(parseTimestamp("0:0:3.180")).toBe(3180);
    expect(parseTimestamp("12:03")).toBe(723000);
    expect(parseTimestamp("12:75")).toBeNull();
    expect(parseTimestamp("geen tijd")).toBeNull();
    expect(formatTimestamp(723456)).toBe("00:12:03");
    expect(formatTimestamp(3723400)).toBe("01:02:03");
  });
});

describe("bestanden", () => {
  it("kent de toegestane soorten en de groottegrens", () => {
    expect(transcriptExt("Gesprek.VTT")).toBe("vtt");
    expect(transcriptExt("gesprek.pdf")).toBeNull();
    expect(checkTranscriptFile({ name: "a.docx", size: 1000 })).toEqual({ ok: true, ext: "docx" });
    expect(checkTranscriptFile({ name: "a.docx", size: 0 }).ok).toBe(false);
    expect(checkTranscriptFile({ name: "a.srt", size: MAX_TRANSCRIPT_BYTES + 1 }).ok).toBe(false);
    expect(checkTranscriptFile({ name: "a.exe", size: 10 }).ok).toBe(false);
  });
});

describe("VTT", () => {
  it("Teams: sprekers uit <v>, opeenvolgende stukjes van dezelfde spreker samengevoegd, NOTE overgeslagen", () => {
    const p = parseVtt(fixture("teams.vtt"));
    expect(p.speakers).toEqual(["Sanne de Vries", "Peter Bakker"]);
    expect(p.hasTimestamps).toBe(true);
    expect(p.segments).toHaveLength(2);
    expect(p.segments[0]).toEqual({ speaker: "Sanne de Vries", startMs: 1200, endMs: 7000, text: "Goedemorgen, fijn dat je tijd hebt. Ik ben benieuwd hoe jullie nu communiceren." });
    expect(p.segments[1].text).toBe("Bij VV Oranje doen we alles via WhatsApp-groepen. Vorige week zijn we twee uur kwijt geweest aan het rooster rondsturen.");
    expect(p.segments.map((s) => s.text).join(" ")).not.toMatch(/opmerking|0f9a4c1e/);
  });

  it("Zoom: spreker als 'Naam: tekst', cue-nummers niet in de tekst", () => {
    const p = parseVtt(fixture("zoom.vtt"));
    expect(p.segments.map((s) => s.speaker)).toEqual(["Sanne de Vries", "Peter Bakker"]);
    expect(p.segments[1]).toMatchObject({ startMs: 5000, endMs: 12300, text: "Toen moest ik veertig ouders apart appen, dat kostte me een avond." });
  });

  it("een geplakte VTT wordt aan de kop herkend", () => {
    expect(parseTranscript("paste", fixture("zoom.vtt")).segments).toHaveLength(2);
  });
});

describe("SRT", () => {
  it("meerdere regels per cue, sprekers uit 'Naam:', volgnummers weg", () => {
    const p = parseSrt(fixture("sample.srt"));
    expect(p.segments).toHaveLength(2);
    expect(p.segments[0]).toEqual({ speaker: "Sanne", startMs: 1000, endMs: 4000, text: "Wat gebruiken jullie nu voor de clubberichten?" });
    expect(p.segments[1].text).toBe("Een nieuwsbrief in Mailchimp en losse appjes. Dat betalen we zelf, zo'n twintig euro per maand.");
    expect(p.segments[1]).toMatchObject({ startMs: 4500, endMs: 72000 });
  });
});

describe("tekst", () => {
  it("Otter/Teams-tekst: kopregel 'Naam  0:03' met de tekst eronder", () => {
    const p = parsePlainText(fixture("otter.txt"));
    expect(p.segments.map((s) => [s.speaker, s.startMs])).toEqual([
      ["Sanne de Vries", 3000],
      ["Peter Bakker", 9000],
      ["Sanne de Vries", 3735000],
    ]);
    expect(p.segments[1].text).toBe("Vooral via de app van de bond, maar die gebruikt bijna niemand. Daarom sturen we alles ook nog per mail.");
    // Eindtijd = begin van het volgende segment.
    expect(p.segments[0].endMs).toBe(9000);
  });

  it("Fathom: '0:00 - Naam' en regels '[00:01:02] Naam: tekst'", () => {
    const fathom = parsePlainText("0:00 - Sanne de Vries\nHoe gaat het met de ledenwerving?\n\n0:41 - Peter Bakker\nMoeizaam, we zitten op 40 aanmeldingen.");
    expect(fathom.segments.map((s) => s.speaker)).toEqual(["Sanne de Vries", "Peter Bakker"]);
    expect(fathom.segments[1].startMs).toBe(41000);
    const inline = parsePlainText("[00:01:02] Sanne: Wat deed je toen?\n[00:01:09] Peter: Ik belde de trainer.\nPeter (00:01:30): En daarna de ouders.");
    expect(inline.segments.map((s) => [s.speaker, s.startMs, s.text])).toEqual([
      ["Sanne", 62000, "Wat deed je toen?"],
      ["Peter", 69000, "Ik belde de trainer. En daarna de ouders."],
    ]);
  });

  it("Markdown-notities: rollen als spreker, 'Conclusie:' (één keer) niet; geen spreker na een losse alinea", () => {
    const p = parsePlainText(fixture("notes.md"));
    const speakers = p.segments.map((s) => s.speaker);
    expect(p.speakers).toEqual(["Interviewer", "Penningmeester"]);
    expect(p.segments.find((s) => s.text.startsWith("Conclusie"))?.speaker).toBeNull();
    expect(speakers.filter((s) => s === "Interviewer")).toHaveLength(2);
    expect(p.segments.find((s) => s.text.includes("Excel-lijst"))?.speaker).toBe("Penningmeester");
  });

  it("vrije notities zonder sprekers: één segment per alinea", () => {
    const p = parsePlainText("Eerste alinea over de club.\nNog een regel.\n\nTweede alinea.");
    expect(p.segments).toEqual([
      { speaker: null, startMs: null, endMs: null, text: "Eerste alinea over de club. Nog een regel." },
      { speaker: null, startMs: null, endMs: null, text: "Tweede alinea." },
    ]);
  });
});

describe("DOCX", () => {
  it("Teams-DOCX met tijdcodes ('-->'), naam op een eigen regel", () => {
    const bytes = docx([
      "0:0:0.0 --> 0:0:3.520",
      "Sanne de Vries",
      "Goedemorgen, hoe gaat het bij de club?",
      "",
      "0:0:3.520 --> 0:0:9.100",
      "Peter Bakker",
      "Druk, we zoeken nog steeds vrijwilligers voor de kantine.",
    ]);
    const r = readTranscriptBytes(bytes, "docx");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.parsed.segments.map((s) => [s.speaker, s.startMs, s.endMs])).toEqual([
      ["Sanne de Vries", 0, 3520],
      ["Peter Bakker", 3520, 9100],
    ]);
  });

  it("nieuwere Teams-DOCX: 'Naam   0:03' als kopregel", () => {
    const r = readTranscriptBytes(docx(["Sanne de Vries   0:03", "Hoe gaat het bij de club met de communicatie?", "Peter Bakker   0:10", "Rommelig, iedereen appt door elkaar heen."]), "docx");
    expect(r.ok && r.parsed.segments.map((s) => s.speaker)).toEqual(["Sanne de Vries", "Peter Bakker"]);
  });

  it("een kapot bestand geeft een duidelijke melding", () => {
    expect(readTranscriptBytes(new Uint8Array([1, 2, 3, 4]), "docx")).toEqual({ ok: false, error: TRANSCRIPT_ERRORS.docx });
  });
});

describe("grenzen", () => {
  it("te weinig tekst of te lang wordt geweigerd", () => {
    expect(readTranscriptText("paste", "Kort.")).toEqual({ ok: false, error: TRANSCRIPT_ERRORS.empty });
    const long = Array.from({ length: 2100 }, (_, i) => `Spreker ${(i % 2) + 1}: ${"woord ".repeat(18)}${i}`).join("\n");
    expect(readTranscriptText("paste", long)).toEqual({ ok: false, error: TRANSCRIPT_ERRORS.too_long });
  });

  it("de oude grens van 60.000 tekens geldt niet meer", () => {
    const text = Array.from({ length: 900 }, (_, i) => `Spreker ${(i % 2) + 1}: ${"woord ".repeat(14)}${i}`).join("\n");
    expect(text.length).toBeGreaterThan(60_000);
    expect(readTranscriptText("paste", text).ok).toBe(true);
  });
});

describe("genormaliseerde tekst en posities", () => {
  it("'[00:12:03] Spreker A: …' met per segment de exacte positie van de tekst", () => {
    const { text, placed } = renderTranscript([
      { speaker: "Spreker A", startMs: 723000, endMs: null, text: "Eerste uitspraak." },
      { speaker: null, startMs: null, endMs: null, text: "Losse notitie." },
      { speaker: "Spreker B", startMs: null, endMs: null, text: "Tweede." },
    ]);
    expect(text).toBe("[00:12:03] Spreker A: Eerste uitspraak.\nLosse notitie.\nSpreker B: Tweede.");
    for (const p of placed) expect(text.slice(p.charStart, p.charEnd)).toBe(p.text);
    expect(segmentAt(placed, placed[1].charStart + 2)).toBe(1);
    expect(segmentAt(placed, text.length - 1)).toBe(2);
  });

  it("opslag zonder tekst; ongeldige posities worden genegeerd", () => {
    const { text, placed } = renderTranscript(parseVtt(fixture("zoom.vtt")).segments);
    const stored = storeSegments(placed);
    expect(JSON.stringify(stored)).not.toContain("veertig ouders");
    expect(readStoredSegments(stored, text.length)).toEqual(stored);
    expect(readStoredSegments([{ a: 5, b: 2 }, { a: 0, b: text.length + 10 }, "x"], text.length)).toEqual([]);
  });
});

describe("vensters voor de AI", () => {
  it("een kort transcript is één venster", () => {
    const { text, placed } = renderTranscript(parseVtt(fixture("teams.vtt")).segments);
    expect(transcriptWindows(text, placed)).toEqual([{ start: 0, end: text.length }]);
  });

  it("een lang transcript in vensters op segmentgrenzen, met overlap en zonder gaten", () => {
    const segments = Array.from({ length: 400 }, (_, i) => ({ speaker: `Spreker ${(i % 2) + 1}`, startMs: i * 5000, endMs: null, text: `${"bla ".repeat(60)}${i}` }));
    const { text, placed } = renderTranscript(segments);
    const windows = transcriptWindows(text, placed, 20_000, 1_000);
    expect(windows.length).toBeGreaterThan(4);
    for (const w of windows) expect(w.end - w.start).toBeLessThanOrEqual(20_000);
    expect(windows[0].start).toBe(0);
    expect(windows[windows.length - 1].end).toBe(text.length);
    for (let i = 1; i < windows.length; i++) {
      expect(windows[i].start).toBeLessThan(windows[i - 1].end); // overlap
      expect(windows[i].start).toBeGreaterThan(windows[i - 1].start); // vooruitgang
      expect(text[windows[i].start - 1]).toBe("\n"); // begint op een regel
    }
    expect(AI_WINDOW_CHARS).toBeLessThan(200_000);
  });
});
