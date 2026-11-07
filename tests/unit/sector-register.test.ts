import { describe, expect, it } from "vitest";
import {
  attestRegister,
  csvRowsWithLines,
  estimateStatement,
  findInOriginal,
  groupRegisters,
  parseRegisterCount,
  parseRegisterCsv,
  parseRegisterDate,
  parseRegisterLine,
  primaryStatement,
  registerClaimPlan,
  registerLine,
  registerTemplateCsv,
  REGISTER_REQUIRED,
  sumExcerpt,
} from "@/lib/domain/sector-register";
import { checkQuote } from "@/lib/domain/verify";

// Fase 2, punt 6: sectorregisters als CSV. Sjabloon, validatie met fouten per regel, het letterlijke fragment, en de
// regel dat een register alleen als primaire bron telt met een bijgevoegd origineel waarin het aantal staat.

const TODAY = new Date("2026-11-05T12:00:00Z");
const HEAD = "uitgever;bron_url;peildatum;categorie;grootteklasse;regio;aantal;opmerking";

describe("CSV-sjabloon en validatie", () => {
  it("het sjabloon heeft alle verplichte kolommen en geen voorbeeldaantallen", () => {
    const t = registerTemplateCsv();
    expect(t.trim().split("\n")).toHaveLength(1);
    for (const c of REGISTER_REQUIRED) expect(t).toContain(c);
    expect(t).toContain("opmerking");
    expect(parseRegisterCsv(t, TODAY).fatal).toContain("geen regels");
  });

  it("leest een geldig register, ook met komma's en koppen in andere schrijfwijze", () => {
    const csv = ["Uitgever,Bron URL,Peildatum,Categorie,Grootteklasse,Regio,Aantal", 'KNHB,https://knhb.example.nl/clubs,30-06-2025,"Hockey, veld",totaal,Nederland,"1.234"'].join("\r\n");
    const p = parseRegisterCsv(csv, TODAY);
    expect(p.fatal).toBeNull();
    expect(p.errors).toEqual([]);
    expect(p.rows[0]).toMatchObject({ line: 2, publisher: "KNHB", url: "https://knhb.example.nl/clubs", referenceDate: "2025-06-30", category: "Hockey, veld", count: 1234, note: null });
  });

  it("geeft per regel (met het echte regelnummer) wat er mis is, en importeert dan niets", () => {
    const csv = [
      HEAD,
      "Bond;https://b.example.nl;2025;Voetbal;totaal;Nederland;100;",
      "",
      ";niet-een-url;2030-01-01;;totaal;Nederland;12,5;",
      "Bond;https://b.example.nl;31-06-2025;Tennis;;Utrecht;-4;",
    ].join("\n");
    const p = parseRegisterCsv(csv, TODAY);
    expect(p.rows).toHaveLength(1);
    expect(p.errors.map((e) => e.line)).toEqual([4, 5]);
    expect(p.errors[0].messages).toEqual(expect.arrayContaining(["uitgever is leeg", "bron_url is geen geldig webadres (https://…)", "categorie is leeg"]));
    expect(p.errors[0].messages.join(" ")).toContain("peildatum is geen geldige datum");
    expect(p.errors[0].messages.join(" ")).toContain('aantal "12,5" is geen heel getal');
    expect(p.errors[1].messages).toEqual(expect.arrayContaining(["grootteklasse is leeg", 'aantal "-4" is geen heel getal']));
    expect(p.errors[1].messages.join(" ")).toContain("peildatum");
  });

  it("ontbrekende verplichte kolommen of een leeg bestand zijn een duidelijke fout", () => {
    expect(parseRegisterCsv("uitgever;categorie;aantal\nA;B;1", TODAY).fatal).toContain("bron_url, peildatum, grootteklasse, regio");
    expect(parseRegisterCsv("", TODAY).fatal).toContain("leeg");
  });

  it("aantallen en datums", () => {
    expect(parseRegisterCount("1234")).toBe(1234);
    expect(parseRegisterCount("1.234")).toBe(1234);
    expect(parseRegisterCount("1 234")).toBe(1234);
    expect(parseRegisterCount("12,5")).toBeNull();
    expect(parseRegisterCount("ca. 100")).toBeNull();
    expect(parseRegisterDate("2025", TODAY)).toBe("2025");
    expect(parseRegisterDate("2025-06", TODAY)).toBe("2025-06");
    expect(parseRegisterDate("1-7-2025", TODAY)).toBe("2025-07-01");
    expect(parseRegisterDate("2027", TODAY)).toBeNull();
    expect(parseRegisterDate("2025-02-30", TODAY)).toBeNull();
    expect(parseRegisterDate("gisteren", TODAY)).toBeNull();
  });

  it("houdt regelnummers bij, ook met regeleinden binnen aanhalingstekens", () => {
    const rows = csvRowsWithLines('a;b\n"x\ny";1\n\nz;2');
    expect(rows.map((r) => r.line)).toEqual([1, 2, 5]);
  });

  it("groepeert per uitgever, bron en peildatum", () => {
    const p = parseRegisterCsv([HEAD, "A;https://a.nl;2025;X;totaal;NL;1;", "A;https://a.nl;2025;Y;totaal;NL;2;", "B;https://b.nl;2025;X;totaal;NL;3;"].join("\n"), TODAY);
    expect(groupRegisters(p.rows).map((g) => g.rows.length)).toEqual([2, 1]);
  });
});

const ROW = { publisher: "Sportbond", category: "Hockeyclubs", sizeClass: "100-250 leden", region: "Utrecht", referenceDate: "2025-12-31", count: 318, note: null };

describe("het letterlijke fragment", () => {
  it("is terug te lezen en de citaatcontrole vindt alle getallen van de bevinding", () => {
    const line = registerLine(ROW);
    expect(line).toBe("Sectorregister Sportbond; Categorie: Hockeyclubs; Grootteklasse: 100-250 leden; Regio: Utrecht; Peildatum: 2025-12-31; Aantal: 318");
    expect(parseRegisterLine(line)).toEqual(ROW);
    expect(parseRegisterLine(registerLine({ ...ROW, note: "Alleen bondsleden; 2025" }))?.note).toBe("Alleen bondsleden; 2025");
    expect(checkQuote(line, line, estimateStatement(ROW))).toBe("exact");
  });

  it("een optelling is uitdrukkelijk door ProofLab berekend en het citaat bevat aantal regels en totaal", () => {
    const s = sumExcerpt("Sportbond", [ROW, { ...ROW, category: "Korfbalclubs", count: 452 }]);
    expect(s.total).toBe(770);
    expect(s.text.startsWith(s.quote)).toBe(true);
    expect(s.quote).toContain("geen tekst van de uitgever");
    expect(checkQuote(s.quote, s.text, s.statement)).toBe("exact");
  });
});

describe("regel: een register telt alleen als primaire bron met origineel en teruggevonden aantal", () => {
  const original = "Jaarverslag 2025\nAantal clubs per sport\nHockeyclubs | 318\nKorfbalclubs | 0452 (incl. sportparken)";

  it("vindt de passage met categorie en aantal in het origineel", () => {
    expect(findInOriginal(ROW, original)).toBe("Hockeyclubs | 318");
    // Tabelcellen op aparte regels: tot drie regels samen.
    expect(findInOriginal(ROW, "Hockeyclubs\n318\nKorfbal")).toBe("Hockeyclubs 318");
    // Alleen het getal, of alleen de categorie, is niet genoeg.
    expect(findInOriginal(ROW, "Er zijn 318 clubs.")).toBeNull();
    expect(findInOriginal(ROW, "Hockeyclubs: ruim 300")).toBeNull();
    // 3180 is niet 318.
    expect(findInOriginal(ROW, "Hockeyclubs 3180")).toBeNull();
  });

  it("zonder origineel: schatting", () => {
    expect(registerClaimPlan({ rows: [ROW], originalPassages: null })).toMatchObject({ kind: "estimate", sum: false });
  });

  it("met origineel zonder het aantal: schatting", () => {
    expect(registerClaimPlan({ rows: [ROW], originalPassages: ["Korfbalclubs | 452"] })).toMatchObject({ kind: "estimate" });
  });

  it("met origineel waarin categorie en aantal staan: primair, met een bevinding die de citaatcontrole doorstaat", () => {
    const plan = registerClaimPlan({ rows: [ROW], originalPassages: ["Hockeyclubs | 318"] });
    expect(plan).toEqual({ kind: "primary", passage: "Hockeyclubs | 318", reason: expect.any(String) });
    const statement = primaryStatement(ROW, "Hockeyclubs | 318")!;
    expect(checkQuote("Hockeyclubs | 318", "Hockeyclubs | 318", statement)).toBe("exact");
  });

  it("een optelling van meerdere regels is altijd een schatting, ook met origineel", () => {
    expect(registerClaimPlan({ rows: [ROW, { ...ROW, count: 452, category: "Korfbalclubs" }], originalPassages: [original] })).toMatchObject({ kind: "estimate", sum: true });
  });

  it("controleert alle regels van een register tegen het origineel", () => {
    const att = attestRegister([registerLine(ROW), registerLine({ ...ROW, category: "Tennisclubs", count: 1630 })], original);
    expect(att.found.map((f) => f.passage)).toEqual(["Hockeyclubs | 318"]);
    expect(att.missing).toHaveLength(1);
  });
});
