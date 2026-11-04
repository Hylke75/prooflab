import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_CAPS, type AssumptionProbability } from "@/lib/domain/evidence";
import { METHOD_VERSIONS, METHODS } from "@/lib/domain/method";
import { PROBABILITY_CASES } from "./fixtures/probability-cases";

// Fase 1, punt 2: het bewijsregister mag de kansberekening niet veranderen. Voor alle vijf methodeversies (2026-11-a
// t/m 2026-11-e) en alle vaste gevallen moet de uitkomst exact (tot op de laatste bit) gelijk zijn aan de uitkomst van
// vóór de refactor, vastgelegd in fixtures/probability-golden.json. Het register zelf (items) valt buiten de vergelijking.
// Opnieuw vastleggen (alleen bij een bewuste nieuwe methodeversie): PROOFLAB_WRITE_GOLDEN=1 npx vitest run probability-golden.

const GOLDEN = path.join(__dirname, "fixtures", "probability-golden.json");

const withoutRegister = (r: AssumptionProbability) => {
  const copy: Record<string, unknown> = { ...r };
  delete copy.items;
  return JSON.parse(JSON.stringify(copy));
};

function compute() {
  const out: Record<string, Record<string, unknown>> = {};
  for (const v of METHOD_VERSIONS) {
    out[v] = {};
    for (const c of PROBABILITY_CASES) {
      out[v][c.name] = withoutRegister(METHODS[v].probability(c.claims, c.observations, c.prior, c.overrides ?? {}, c.caps ?? DEFAULT_CAPS));
    }
  }
  return out;
}

describe("kansberekening ongewijzigd (gelijkheidstest per methodeversie)", () => {
  if (process.env.PROOFLAB_WRITE_GOLDEN === "1") writeFileSync(GOLDEN, `${JSON.stringify(compute())}\n`);
  const golden = JSON.parse(readFileSync(GOLDEN, "utf8")) as Record<string, Record<string, unknown>>;
  const now = compute();
  for (const v of METHOD_VERSIONS) {
    it(`methode ${v}: ${PROBABILITY_CASES.length} gevallen exact gelijk`, () => {
      expect(Object.keys(golden[v])).toHaveLength(PROBABILITY_CASES.length);
      for (const c of PROBABILITY_CASES) expect(now[v][c.name], c.name).toEqual(golden[v][c.name]);
    });
  }
});
