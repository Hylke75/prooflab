import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { GLOSSARY, glossaryEntry, isGlossaryKey, type GlossaryKey } from "@/lib/glossary";

// Het woordenboek van vaktermen (lib/glossary.ts) en het gebruik ervan via <Term k="…">.

const ROOT = path.resolve(__dirname, "../..");

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) out.push(...sourceFiles(p));
    else if (/\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

// Alle sleutels die de code via <Term k="…"> gebruikt, met het bestand erbij.
function usedKeys(): { key: string; file: string }[] {
  const found: { key: string; file: string }[] = [];
  for (const dir of ["app", "components", "lib"]) {
    for (const file of sourceFiles(path.join(ROOT, dir))) {
      const text = readFileSync(file, "utf8");
      for (const m of text.matchAll(/<Term\s+k=(?:"([^"]*)"|\{\s*"([^"]*)"\s*\}|'([^']*)')/g)) {
        found.push({ key: m[1] ?? m[2] ?? m[3], file: path.relative(ROOT, file) });
      }
    }
  }
  return found;
}

describe("woordenboek van vaktermen", () => {
  const entries = Object.entries(GLOSSARY) as [GlossaryKey, (typeof GLOSSARY)[GlossaryKey]][];

  it("elke sleutel heeft een term en een uitleg van 1–2 zinnen in gewone taal", () => {
    expect(entries.length).toBeGreaterThanOrEqual(30);
    for (const [k, e] of entries) {
      expect(k, "sleutel in kleine letters met streepjes").toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      expect(e.term.trim().length, k).toBeGreaterThan(1);
      expect(e.uitleg.trim().length, k).toBeGreaterThan(30);
      expect(e.uitleg.length, `${k}: kort genoeg voor een tooltip`).toBeLessThanOrEqual(320);
      // Hooguit twee zinnen: tel zinseinden gevolgd door een spatie en een hoofdletter.
      const sentences = e.uitleg.split(/[.!?](?=\s+[A-Z“"])/).length;
      expect(sentences, `${k}: hooguit twee zinnen`).toBeLessThanOrEqual(2);
      expect(e.uitleg.trim(), k).toMatch(/[.”]$/);
    }
  });

  it("geen dubbele sleutels in het bronbestand en geen dubbele termen", () => {
    const src = readFileSync(path.join(ROOT, "lib/glossary.ts"), "utf8");
    const keys = [...src.matchAll(/^ {2}(?:"([a-z0-9-]+)"|([a-z0-9]+)): \{$/gm)].map((m) => m[1] ?? m[2]);
    expect(keys.length).toBe(entries.length);
    expect(new Set(keys).size).toBe(keys.length);
    const terms = entries.map(([, e]) => e.term.toLowerCase());
    expect(new Set(terms).size).toBe(terms.length);
  });

  it("bevat de termen uit de opdracht", () => {
    const required: GlossaryKey[] = [
      "beslissende-vraag", "aanname", "kritieke-aanname", "hoofdtest", "verkennende-test", "test-card", "succesdrempel", "faaldrempel",
      "minimale-steekproef", "kansregel", "aantalregel", "interval-95", "bewijsniveau", "plafond", "informatiewaarde", "basispercentage",
      "reality-check", "learning-card", "beslisregel", "wervingsgroep", "per-persoon", "oefengesprek", "geverifieerde-bron", "letterlijk-citaat",
      "tegenbewijs", "tam", "sam", "som", "brier-score", "kalibratie",
    ];
    for (const k of required) expect(isGlossaryKey(k), k).toBe(true);
  });

  it("uitleg klopt met de vaste getallen van de methode", () => {
    expect(glossaryEntry("kansregel").uitleg).toContain("80%");
    expect(glossaryEntry("kansregel").uitleg).toContain("20%");
    expect(glossaryEntry("kritieke-aanname").uitleg).toMatch(/4 of 5/);
    expect(glossaryEntry("brier-score").uitleg).toContain("0,25");
    expect(glossaryEntry("kalibratie").uitleg).toContain("10 afgeronde dossiers");
  });

  it("alle sleutels die de code gebruikt bestaan, en het component wordt echt gebruikt", () => {
    const used = usedKeys();
    expect(used.length).toBeGreaterThanOrEqual(30);
    const missing = used.filter((u) => !isGlossaryKey(u.key));
    expect(missing).toEqual([]);
    // Op de afgesproken plekken: Testkaart, risicokaart, bewijs & besluit, rapport en voorspelling.
    const files = new Set(used.map((u) => u.file));
    for (const f of [
      "components/experiments/ExperimentBuilder.tsx",
      "components/assumptions/RiskBoard.tsx",
      "app/app/ideas/[id]/evidence/page.tsx",
      "app/app/ideas/[id]/report/page.tsx",
      "components/forecast/ForecastPanel.tsx",
    ]) {
      expect(files.has(f), f).toBe(true);
    }
  });

  it("niet in de PDF: het PDF-rapport gebruikt geen Term", () => {
    expect(readFileSync(path.join(ROOT, "lib/report-pdf.tsx"), "utf8")).not.toContain("<Term");
    expect(isGlossaryKey("bestaat-niet")).toBe(false);
    expect(isGlossaryKey("toString")).toBe(false);
  });
});
