import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { CBS_CATALOG, codesUrl, factorUnitFor, observationsUrl, tableApiUrl } from "@/lib/integrations/cbs-catalog";

// Controle van de CBS-catalogus tegen de LIVE API (datasets.cbs.nl). Draait alleen met CBS_LIVE=1, want gewone tests
// gebruiken geen netwerk: CBS_LIVE=1 npx vitest run tests/unit/cbs-live.test.ts. Gebruikt curl, zodat een
// ingestelde proxy (HTTPS_PROXY) wordt gevolgd. Per tabel: dezelfde dimensies, alle onderwerpen bestaan met eenheid
// aantal of %, de standaardcode per dimensie bestaat, en er is een echte waarde voor het standaardonderwerp.

const get = (url: string) => (JSON.parse(execFileSync("curl", ["-sS", "-m", "90", url], { maxBuffer: 50_000_000 }).toString()) as { value: Record<string, unknown>[] }).value;

describe.runIf(process.env.CBS_LIVE === "1")("CBS-catalogus tegen de live API", () => {
  for (const t of CBS_CATALOG) {
    it(`${t.id}: ${t.title}`, { timeout: 180_000 }, () => {
      const dims = get(`${tableApiUrl(t.id)}/Dimensions`).map((d) => String(d.Identifier));
      expect(dims.sort()).toEqual([...t.dimensions.map((d) => d.id), "Perioden"].sort());
      const measures = get(`${tableApiUrl(t.id)}/MeasureCodes?$select=Identifier,Unit`);
      for (const m of t.measures) {
        const hit = measures.find((x) => x.Identifier === m);
        expect(hit, m).toBeTruthy();
        expect(factorUnitFor(String(hit!.Unit)), m).not.toBeNull();
      }
      for (const d of t.dimensions) expect(get(codesUrl(t.id, d.id)).some((c) => c.Identifier === d.default), `${d.id}=${d.default}`).toBe(true);
      const obs = get(observationsUrl(t, { measure: t.defaultMeasure, period: "latest", filters: {} }));
      expect(obs.some((o) => typeof o.Value === "number")).toBe(true);
    });
  }
});
