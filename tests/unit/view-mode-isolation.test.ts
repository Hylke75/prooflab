import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Fase 1 · punt 1: de stand (Snel of Grondig) is alleen weergave. Deze test dwingt af dat geen rekenmodule hem kan
// lezen: niets in lib/ (kansen, statussen, dossier, rapport, PDF, coach) noemt de kolom of importeert de weergave,
// op een paar bestanden na die er bewust voor zijn. Wie de stand ergens anders nodig heeft, hoort in een component of
// pagina (weergave), niet in de berekening.

const ROOT = path.resolve(__dirname, "../..");

// Bestanden die de stand wel mogen kennen, met de reden.
const ALLOWED = new Set([
  "lib/view-mode.ts", // de definitie van de standen (zonder imports)
  "lib/data.ts", // getViewMode voor servercomponenten (alleen weergave)
  "lib/database.types.ts", // het databaseschema
]);

// Wat op het lezen van de stand wijst.
const PATTERNS = [/detail_level/, /view-mode/, /getViewMode/, /useViewMode/, /ViewMode/, /DetailLevel/, /components\/shell\//];

function files(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) out.push(...files(p));
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

describe("de stand zit niet in de berekening", () => {
  it("geen enkel bestand in lib/ (behalve de toegestane) leest of importeert de stand", () => {
    const offenders: string[] = [];
    for (const file of files(path.join(ROOT, "lib"))) {
      const rel = path.relative(ROOT, file).split(path.sep).join("/");
      if (ALLOWED.has(rel)) continue;
      const text = readFileSync(file, "utf8");
      for (const re of PATTERNS) if (re.test(text)) offenders.push(`${rel}: ${re}`);
    }
    expect(offenders).toEqual([]);
  });

  it("lib/domain kent ook de standaardwaarden-lijst niet (alleen herkomst, nooit invoer van een berekening)", () => {
    const offenders = files(path.join(ROOT, "lib/domain"))
      .filter((f) => /defaulted_fields|defaulted-fields|defaulted-test-card/.test(readFileSync(f, "utf8")))
      .map((f) => path.relative(ROOT, f));
    expect(offenders).toEqual([]);
  });

  it("de server-PDF en de rapportmomentopname zijn altijd volledig: geen weergave-afhankelijkheid", () => {
    for (const rel of ["lib/report.ts", "lib/report-pdf.tsx", "lib/report-pdf-model.ts", "lib/report-sheet.ts", "app/app/ideas/[id]/report/pdf/route.ts"]) {
      const p = path.join(ROOT, rel);
      let text = "";
      try {
        text = readFileSync(p, "utf8");
      } catch {
        continue; // bestand bestaat (nog) niet onder deze naam
      }
      for (const re of PATTERNS) expect(re.test(text), `${rel}: ${re}`).toBe(false);
    }
  });

  it("de toegestane bestanden bestaan en de definitie heeft geen imports", () => {
    for (const rel of ALLOWED) expect(statSync(path.join(ROOT, rel)).isFile(), rel).toBe(true);
    expect(readFileSync(path.join(ROOT, "lib/view-mode.ts"), "utf8")).not.toMatch(/^import /m);
  });
});
