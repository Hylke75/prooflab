import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { cleanThemeLabel, filterThemeProposals, findCode, locateInWindow, mergeThemeFilters } from "@/lib/domain/themes";
import { themeAcceptance, CODING_ACCEPTANCE_THRESHOLD, MIN_REVIEWS } from "@/lib/domain/ai-quality";
import { prepareImport } from "@/lib/domain/interview-import";
import { parsePlainText, readStoredSegments } from "@/lib/domain/transcript-parse";

// Fase 1 · punt 3, deelstap 6: AI-themavoorstellen houden alleen letterlijk teruggevonden citaten, met positie.
const prepared = prepareImport(
  parsePlainText(
    "[00:00:01] Sanne de Vries: Hoe regelen jullie het rooster?\n[00:00:05] Peter Bakker: Via drie appgroepen, en dat kost me elke week een avond. Ouders lezen het niet.\n[00:01:00] Sanne de Vries: En de kosten?\n[00:01:04] Peter Bakker: We betalen twintig euro per maand voor een nieuwsbrief die bijna niemand opent.",
  ).segments,
  [],
);
if (!prepared.ok) throw new Error("fixture");
const transcript = prepared.transcript;
const segments = readStoredSegments(prepared.segments, transcript.length);

describe("AI-themavoorstellen filteren", () => {
  it("houdt alleen letterlijke citaten met positie; samenvoegen per label; dubbele citaten één keer", () => {
    const r = filterThemeProposals(
      [
        { label: "tijdverlies door appgroepen", description: "Rooster via apps kost tijd.", quotes: ["dat kost me elke week een avond", "dat kost me elke week een avond", "Dit zei niemand ooit zo"] },
        { label: "Tijdverlies door appgroepen.", description: "", quotes: ["Ouders lezen het niet."] },
        { label: "Kosten", description: "Betaalde tools.", quotes: ["“we betalen twintig euro per maand”"] },
        { label: "x", description: "", quotes: ["dat kost me elke week een avond"] },
        { label: "Zonder bewijs", description: "", quotes: ["verzonnen citaat dat nergens staat"] },
      ],
      transcript,
      segments,
    );
    expect(r.themes.map((t) => t.label)).toEqual(["Tijdverlies door appgroepen", "Kosten"]);
    expect(r.themes[0].quotes.map((q) => q.quote)).toEqual(["dat kost me elke week een avond", "Ouders lezen het niet."]);
    for (const t of r.themes) for (const q of t.quotes) expect(transcript.slice(q.start, q.end)).toBe(q.quote);
    // Hoofdletters van het origineel, niet van het model.
    expect(r.themes[1].quotes[0].quote).toBe("We betalen twintig euro per maand");
    expect(r).toMatchObject({ notFound: 2, duplicates: 1, invalidLabels: 1 });
  });

  it("geen citaat over twee uitspraken of met de kop (tijd en spreker)", () => {
    expect(locateInWindow(transcript, "Ouders lezen het niet.\n[00:01:00] Spreker A: En de kosten?", segments)).toBeNull();
    expect(locateInWindow(transcript, "Spreker B: Via drie appgroepen", segments)).toBeNull();
    expect(locateInWindow(transcript, "Via drie appgroepen", segments)).toMatchObject({ segmentIndex: 1 });
  });

  it("vensters: eerst binnen het venster zoeken, daarna samenvoegen zonder dubbelingen", () => {
    const second = transcript.indexOf("[00:01:00]");
    const a = filterThemeProposals([{ label: "Kosten", description: "", quotes: ["twintig euro per maand"] }], transcript, segments, { start: 0, end: second });
    const b = filterThemeProposals([{ label: "kosten", description: "", quotes: ["twintig euro per maand", "bijna niemand opent"] }], transcript, segments, { start: second, end: transcript.length });
    const m = mergeThemeFilters([a, b]);
    expect(m.themes).toHaveLength(1);
    expect(m.themes[0].quotes.map((q) => q.quote)).toEqual(["twintig euro per maand", "bijna niemand opent"]);
    expect(m.duplicates).toBe(1);
  });

  it("labels: 3–80 tekens, hoofdletter; zoeken zonder hoofdletter- of leestekenverschil", () => {
    expect(cleanThemeLabel("  'kosten'. ")).toBe("Kosten");
    expect(cleanThemeLabel("ab")).toBeNull();
    expect(cleanThemeLabel("x".repeat(81))).toBeNull();
    expect(findCode([{ id: "1", label: "Tijdverlies door appgroepen" }], "tijdverlies door  appgroepen")?.id).toBe("1");
  });
});

describe("AI-kwaliteit: AI-thema's geaccepteerd", () => {
  it("zelfde drempels als de AI-codering", () => {
    const rows = (accepted: number, rejected: number) => [...Array(accepted).fill({ review_status: "accepted" }), ...Array(rejected).fill({ review_status: "rejected" })];
    expect(themeAcceptance(rows(5, 0)).level).toBe("too_few");
    expect(themeAcceptance(rows(8, 2))).toMatchObject({ level: "meets", threshold: CODING_ACCEPTANCE_THRESHOLD, reviewed: MIN_REVIEWS });
    expect(themeAcceptance(rows(6, 4)).level).toBe("below");
    expect(themeAcceptance(rows(6, 4)).message).toMatch(/AI-thema's blijven een voorstel/);
    expect(themeAcceptance([{ review_status: null }]).reviewed).toBe(0);
  });
});

describe("thema's tellen nooit mee in de kans", () => {
  it("de kansberekening (methodes, bewijs, voortgang) kent geen thema's", () => {
    const root = process.cwd();
    const methodDir = path.join(root, "lib/domain/method");
    const files = [
      ...readdirSync(methodDir).map((f) => path.join(methodDir, f)),
      path.join(root, "lib/domain/evidence.ts"),
      path.join(root, "lib/domain/per-person.ts"),
      path.join(root, "lib/domain/test-counts.ts"),
      path.join(root, "lib/method-data.ts"),
    ];
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      expect(src, f).not.toMatch(/interview_codes|observation_codes|domain\/themes|theme_counts/);
    }
    // De voortgang leest observaties alleen zonder thema-citaten.
    expect(readFileSync(path.join(root, "lib/progress.ts"), "utf8")).toMatch(/withoutThemeOnly/);
  });
});
