import { describe, expect, it, vi } from "vitest";
import {
  CBS_CATALOG,
  cbsCellLine,
  cbsNumericInput,
  cbsRegionTitle,
  cbsStatement,
  cbsTable,
  factorUnitFor,
  isCbsCode,
  missingValueReason,
  observationsUrl,
  odataString,
  periodReferenceDate,
  statlineUrl,
  type CbsCellRow,
} from "@/lib/integrations/cbs-catalog";
import { CbsError, fetchCbsCell, fetchCbsMetadata } from "@/lib/integrations/cbs";
import { checkQuote, numericFromInput } from "@/lib/domain/verify";
import { fixtureFetcher } from "./helpers/cbs-fixtures";

// Fase 2, punt 6: de gecureerde CBS-catalogus en de generieke client, getest op opgenomen antwoorden van de live API
// (tests/unit/fixtures/cbs). Geen netwerk.

const AMSTERDAM = { measure: "M000352", period: "2026JJ00", filters: { RegioS: "GM0363" } };

describe("CBS-catalogus", () => {
  it("bevat alleen gecontroleerde tabellen met een totaal als standaard per dimensie", () => {
    expect(CBS_CATALOG.map((t) => t.id)).toEqual(["03759ned", "70072ned", "71486ned", "81589NED", "81578NED", "81575NED", "81644NED"]);
    for (const t of CBS_CATALOG) {
      expect(t.verified, t.id).not.toBeNull();
      expect(t.measures).toContain(t.defaultMeasure);
      expect(t.dimensions.every((d) => isCbsCode(d.default))).toBe(true);
    }
    expect(cbsTable("03759NED")?.id).toBe("03759ned");
    expect(cbsTable("onbekend")).toBeNull();
  });

  it("bouwt de Observations-URL met één code per dimensie (standaard het totaal) en ontsnapt aanhalingstekens", () => {
    const t = cbsTable("03759ned")!;
    const url = observationsUrl(t, AMSTERDAM);
    expect(url.startsWith("https://datasets.cbs.nl/odata/v1/CBS/03759ned/Observations?$filter=")).toBe(true);
    expect(decodeURIComponent(url.split("$filter=")[1])).toBe(
      "Measure eq 'M000352' and Perioden eq '2026JJ00' and BurgerlijkeStaat eq 'T001019' and Geslacht eq 'T001038' and Leeftijd eq '10000' and RegioS eq 'GM0363'",
    );
    expect(decodeURIComponent(observationsUrl(t, { ...AMSTERDAM, period: "latest" }))).not.toContain("Perioden eq");
    expect(odataString("O'Brien")).toBe("'O''Brien'");
    expect(isCbsCode("GM0363")).toBe(true);
    expect(isCbsCode("x' or '1'='1")).toBe(false);
    expect(statlineUrl("81644NED")).toBe("https://opendata.cbs.nl/statline/#/CBS/nl/dataset/81644NED/table");
  });

  it("leidt de peildatum af uit de periode", () => {
    expect(periodReferenceDate("2026JJ00", { referenceDay: "1 januari" })).toBe("2026-01-01");
    expect(periodReferenceDate("2026JJ00", { referenceDay: null })).toBe("2026");
    expect(periodReferenceDate("2026KW04", { referenceDay: null })).toBe("2026");
    expect(periodReferenceDate("2026MM03", { referenceDay: null })).toBe("2026-03");
    expect(periodReferenceDate("onzin", { referenceDay: null })).toBe("onbekend");
  });

  it("past eenheden op factoren en leest decimalen niet als duizendtallen", () => {
    expect(factorUnitFor("aantal")).toBe("count");
    expect(factorUnitFor("Aantal")).toBe("count");
    expect(factorUnitFor("%")).toBe("percent");
    expect(factorUnitFor("1 000 euro")).toBeNull();
    expect(numericFromInput(cbsNumericInput(941927)!)).toBe(941927);
    expect(numericFromInput(cbsNumericInput(12.5)!)).toBe(12.5);
    expect(cbsNumericInput(1.234)).toBeNull();
    expect(missingValueReason("Confidential")).toContain("geheim");
    expect(missingValueReason(null)).toContain("onbekend");
  });
});

describe("CBS-client op opgenomen API-antwoorden", () => {
  it("leest metadata: dimensies, codes, perioden (nieuwste eerst) en alleen toegestane onderwerpen", async () => {
    const meta = await fetchCbsMetadata("03759ned", { fetchJson: fixtureFetcher() });
    expect(meta.measures).toEqual([{ id: "M000352", title: "Bevolking op 1 januari", unit: "aantal" }]);
    expect(meta.periods[0]).toEqual({ id: "2026JJ00", title: "2026", status: "definitief" });
    const region = meta.dimensions.find((d) => d.id === "RegioS")!;
    expect(region.codes.find((c) => c.id === "GM0363")).toEqual({ id: "GM0363", title: "Amsterdam", group: "GMPV27" });
    expect(meta.url).toBe(statlineUrl("03759ned"));
  });

  it("haalt één waarde op als letterlijke tabelregel waarin de citaatcontrole het getal terugvindt", async () => {
    const urls: string[] = [];
    const cell = await fetchCbsCell("03759ned", AMSTERDAM, { fetchJson: fixtureFetcher(urls) });
    expect(cell.row.value).toBe(941927);
    expect(cell.missing).toBeNull();
    expect(cbsRegionTitle(cell.table, cell.row)).toBe("Amsterdam");
    const row = cell.row as CbsCellRow;
    const line = cbsCellLine(row);
    expect(line).toBe(
      "CBS 03759ned (Bevolking op 1 januari en gemiddeld; geslacht, leeftijd en regio); Burgerlijke staat: Totaal burgerlijke staat; Geslacht: Totaal mannen en vrouwen; Leeftijd: Totaal; Regio: Amsterdam; Periode: 2026 (definitief); Onderwerp: Bevolking op 1 januari; Waarde: 941927 aantal",
    );
    expect(checkQuote(line, line, cbsStatement(row))).toBe("exact");
    expect(urls.filter((u) => u.includes("/Observations"))).toHaveLength(1);
  });

  it("vestigingen naar grootteklasse, sector en provincie (81644NED)", async () => {
    const cell = await fetchCbsCell("81644NED", { measure: "WP19079", period: "latest", filters: { RegioS: "PV26" } }, { fetchJson: fixtureFetcher() });
    expect(cell.row.value).toBe(177440);
    expect(cell.selection.period).toBe("2026JJ00");
    expect(cell.row.dims).toEqual([
      { label: "Bedrijfstak (SBI 2008)", title: "A-U Alle economische activiteiten" },
      { label: "Regio", title: "Utrecht (PV)" },
    ]);
    expect(cbsRegionTitle(cell.table, cell.row)).toBe("Utrecht");
    expect(checkQuote(cbsCellLine(cell.row as CbsCellRow), cbsCellLine(cell.row as CbsCellRow), cbsStatement(cell.row as CbsCellRow))).toBe("exact");
  });

  it("zonder waarde bij CBS: onbekend met de reden, nooit een getal", async () => {
    const cell = await fetchCbsCell("81644NED", { measure: "M000200", period: "2025JJ00", filters: { RegioS: "CR17" } }, { fetchJson: fixtureFetcher() });
    expect(cell.row.value).toBeNull();
    expect(cell.missing).toContain("onbekend");
    const secret = await fetchCbsCell("03759ned", AMSTERDAM, {
      fetchJson: fixtureFetcher([], { Observations: (fx) => ({ value: fx.Observations.value.map((o) => ({ ...o, Value: null, ValueAttribute: "Confidential" })) }) }),
    });
    expect(secret.row.value).toBeNull();
    expect(secret.missing).toContain("geheim");
  });

  it("weigert codes die niet in de tabel staan en meldt een gewijzigde tabel", async () => {
    await expect(fetchCbsCell("03759ned", { ...AMSTERDAM, filters: { RegioS: "GM9999" } }, { fetchJson: fixtureFetcher() })).rejects.toMatchObject({ reason: "ongeldige_keuze" });
    await expect(fetchCbsCell("03759ned", { ...AMSTERDAM, measure: "M000365" }, { fetchJson: fixtureFetcher() })).rejects.toBeInstanceOf(CbsError);
    await expect(fetchCbsCell("03759ned", { ...AMSTERDAM, period: "1900JJ00" }, { fetchJson: fixtureFetcher() })).rejects.toMatchObject({ reason: "ongeldige_keuze" });
    const changed = fixtureFetcher([], { Dimensions: () => ({ value: [{ Identifier: "RegioS" }, { Identifier: "Perioden" }, { Identifier: "Nieuw" }] }) });
    await expect(fetchCbsMetadata("03759ned", { fetchJson: changed })).rejects.toMatchObject({ reason: "tabel_gewijzigd" });
    await expect(fetchCbsMetadata("12345ned")).rejects.toMatchObject({ reason: "onbekende_tabel" });
  });
});

describe("ophalen bij CBS", () => {
  it("probeert één keer opnieuw bij een netwerkfout en geeft daarna een eerlijke fout", async () => {
    vi.resetModules();
    const calls: string[] = [];
    vi.doMock("@/lib/fetch-page", async (orig) => {
      const real = await orig<typeof import("@/lib/fetch-page")>();
      return {
        ...real,
        fetchPublic: vi.fn(async (url: string) => {
          calls.push(url);
          if (calls.length === 1) throw new real.PageFetchError("geblokkeerd", "De pagina reageerde niet op tijd.");
          return { url, contentType: "application/json", body: Buffer.from('{"value":[]}'), truncated: false };
        }),
      };
    });
    const { fetchCbsJson } = await import("@/lib/integrations/cbs");
    await expect(fetchCbsJson("https://datasets.cbs.nl/odata/v1/CBS/03759ned/Dimensions")).resolves.toEqual({ value: [] });
    expect(calls).toHaveLength(2);
    calls.length = 0;
    vi.doMock("@/lib/fetch-page", async (orig) => {
      const real = await orig<typeof import("@/lib/fetch-page")>();
      return { ...real, fetchPublic: vi.fn(async (url: string) => (calls.push(url), Promise.reject(new real.PageFetchError("geblokkeerd", "time-out")))) };
    });
    vi.resetModules();
    const again = await import("@/lib/integrations/cbs");
    await expect(again.fetchCbsJson("https://datasets.cbs.nl/odata/v1/CBS/03759ned/Dimensions")).rejects.toMatchObject({ reason: "onbereikbaar" });
    expect(calls).toHaveLength(2);
    vi.doUnmock("@/lib/fetch-page");
  });
});
