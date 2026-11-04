import { describe, expect, it } from "vitest";
import {
  aiWindow,
  BLOCK_MAX,
  blockIndexOf,
  blockRef,
  checkImportFile,
  chunkText,
  cleanText,
  decodeText,
  defaultTitle,
  docxXmlToText,
  filterProposals,
  importAccessNote,
  isImportedReport,
  joinPages,
  locateQuote,
  MAX_QUOTE_CHARS,
  MAX_TEXT_CHARS,
  pageLabel,
  parsePublished,
  type RawProposal,
} from "@/lib/domain/report-import";
import { docxToText, ZipError } from "@/lib/docx-text";
import { extractReport } from "@/lib/report-extract";
import { normalizeText } from "@/lib/domain/verify";
import { makePdf } from "./helpers/pdf";
import { makeDocx, makeZip } from "./helpers/zip";

// Een "rapport" van herkenbare, unieke zinnen, zodat elk citaat op één plek staat.
function report(sentences: number): string {
  const out: string[] = [];
  for (let i = 0; i < sentences; i++) {
    out.push(`Zin ${i} meldt dat ${1000 + i} bureaus in regio ${i % 12} actief waren in 2025.`);
    if (i % 7 === 6) out.push("\n\n");
  }
  return cleanText(out.join(" "));
}

describe("bestandscontrole", () => {
  it("accepteert alleen leesbare rapporttypen binnen 20 MB", () => {
    expect(checkImportFile({ name: "Rapport.PDF", size: 1000 })).toEqual({ ok: true, ext: "pdf" });
    expect(checkImportFile({ name: "notulen.docx", size: 1 }).ok).toBe(true);
    expect(checkImportFile({ name: "plaatje.png", size: 1000 }).ok).toBe(false);
    expect(checkImportFile({ name: "deck.pptx", size: 1000 }).ok).toBe(false);
    expect(checkImportFile({ name: "leeg.txt", size: 0 }).ok).toBe(false);
    expect(checkImportFile({ name: "groot.pdf", size: 21 * 1024 * 1024 }).ok).toBe(false);
  });

  it("maakt een titel van de bestandsnaam", () => {
    expect(defaultTitle("map/Marktmonitor_2025.pdf")).toBe("Marktmonitor 2025");
    expect(defaultTitle(".pdf")).toBe("Geïmporteerd rapport");
  });
});

describe("tekst opschonen en decoderen", () => {
  it("houdt woorden letterlijk en ruimt witruimte en stuurtekens op", () => {
    expect(cleanText("a\r\nb\u0000c   d\n\n\n\ne\t f")).toBe("a\nb c d\n\ne f");
  });

  it("leest UTF-8 met BOM en valt terug op Windows-1252", () => {
    expect(decodeText(new Uint8Array([0xef, 0xbb, 0xbf, 0x63, 0x61, 0x66, 0xc3, 0xa9]))).toBe("café");
    expect(decodeText(new Uint8Array([0x63, 0x61, 0x66, 0xe9]))).toBe("café");
  });
});

describe("in blokken verdelen", () => {
  const text = report(400);

  it("maakt blokken onder de grens die samen de hele tekst dekken", () => {
    const blocks = chunkText(text);
    expect(blocks.length).toBeGreaterThan(3);
    for (const b of blocks) {
      expect(b.text.length).toBeLessThanOrEqual(BLOCK_MAX);
      expect(text.slice(b.start, b.end).trim()).toBe(b.text);
    }
    expect(blocks[0].start).toBe(0);
    expect(blocks.at(-1)!.end).toBe(text.length);
    for (let i = 1; i < blocks.length; i++) expect(blocks[i].start).toBeLessThan(blocks[i - 1].end);
    expect(blocks[0].location).toBe(`Rapport, blok 1 van ${blocks.length}`);
  });

  it("vindt elk citaat tot de maximale lengte terug in één blok, ook over een blokgrens", () => {
    const blocks = chunkText(text);
    for (let start = 0; start < text.length - MAX_QUOTE_CHARS; start += 97) {
      const quote = text.slice(start, start + MAX_QUOTE_CHARS);
      expect(locateQuote(quote, blocks).check).toBe("exact");
    }
    // Precies over de grens van blok 1 en 2.
    const edge = blocks[0].end;
    expect(locateQuote(text.slice(edge - 300, edge + 300), blocks).blockIndex).toBeGreaterThanOrEqual(0);
  });

  it("geeft een korte tekst één blok", () => {
    const blocks = chunkText("Een kort rapport met één alinea tekst.");
    expect(blocks).toHaveLength(1);
    expect(blocks[0].location).toBe("Rapport, blok 1 van 1");
  });

  it("noemt de pagina's bij een PDF", () => {
    const { text: joined, pageStarts } = joinPages(["Pagina een tekst.", "  Pagina twee  tekst. ", "Pagina drie."]);
    expect(joined).toBe("Pagina een tekst.\n\nPagina twee tekst.\n\nPagina drie.");
    expect(pageLabel(0, 5, pageStarts)).toBe("p. 1");
    expect(pageLabel(0, joined.length, pageStarts)).toBe("p. 1–3");
    expect(pageLabel(pageStarts[1], pageStarts[1] + 4, pageStarts)).toBe("p. 2");
    expect(pageLabel(0, 5, null)).toBeNull();
    const blocks = chunkText(joined, pageStarts);
    expect(blocks[0].location).toBe("Rapport, blok 1 van 1 · p. 1–3");
  });
});

describe("DOCX", () => {
  it("haalt alinea's, tabellen en entiteiten uit de XML en negeert verwijderde tekst", () => {
    const xml =
      '<w:body><w:p><w:r><w:t>Omzet &amp; groei</w:t></w:r><w:r><w:tab/><w:t xml:space="preserve"> 12,5% </w:t></w:r></w:p>' +
      "<w:tbl><w:tr><w:tc><w:p><w:r><w:t>Regio</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Aantal</w:t></w:r></w:p></w:tc></w:tr>" +
      "<w:tr><w:tc><w:p><w:r><w:t>Noord</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>1.200</w:t></w:r></w:p></w:tc></w:tr></w:tbl>" +
      "<w:p><w:del><w:r><w:delText>weggehaald</w:delText></w:r></w:del><w:r><w:t>&lt;script&gt;niet uitvoeren&lt;/script&gt; &#233;&#x20AC;</w:t></w:r></w:p></w:body>";
    const text = docxXmlToText(xml);
    expect(text).toBe("Omzet & groei 12,5%\nRegio | Aantal\nNoord | 1.200\n<script>niet uitvoeren</script> é€");
    expect(text).not.toContain("weggehaald");
  });

  it("leest een echt DOCX-archief", () => {
    const docx = makeDocx(["Het marktaandeel van online boekingen was 34% in 2024.", "Tweede alinea."]);
    expect(docxToText(docx)).toBe("Het marktaandeel van online boekingen was 34% in 2024.\nTweede alinea.");
  });

  it("weigert een zip-bom, een versleuteld archief en een archief zonder document", () => {
    const huge = "<w:p><w:r><w:t>a</w:t></w:r></w:p>".repeat(2_000_000); // ~ 66 MB uitgepakt
    expect(() => docxToText(makeZip([{ name: "word/document.xml", data: huge, declaredSize: 100 }]))).toThrow(ZipError);
    expect(() => docxToText(makeZip([{ name: "word/document.xml", data: "<w:t>x</w:t>", encrypted: true }]))).toThrow(ZipError);
    expect(() => docxToText(makeZip([{ name: "xl/workbook.xml", data: "<x/>" }]))).toThrow(ZipError);
    expect(() => docxToText(Buffer.from("geen zip"))).toThrow(ZipError);
  });
});

describe("extractReport", () => {
  const LINE = "In Nederland waren in 2025 precies 4100 evenementenbureaus actief volgens de branchevereniging.";

  it("leest een PDF met tekstlaag, met paginanummer als vindplaats", async () => {
    const res = await extractReport(new Uint8Array(makePdf([LINE, "Tweede regel van het rapport over de markt."])), "pdf");
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.pages).toBe(1);
    expect(normalizeText(res.text)).toContain(normalizeText(LINE));
    expect(res.blocks[0].location).toBe("Rapport, blok 1 van 1 · p. 1");
    expect(locateQuote("precies 4100 evenementenbureaus actief", res.blocks, "Er zijn 4100 evenementenbureaus.").check).toBe("exact");
  });

  it("meldt een PDF zonder tekstlaag (scan) en een beschadigde PDF netjes", async () => {
    expect(await extractReport(new Uint8Array(makePdf([])), "pdf")).toEqual({ ok: false, reason: "no_text" });
    expect(await extractReport(new Uint8Array(Buffer.from("%PDF-1.4 kapot")), "pdf")).toEqual({ ok: false, reason: "damaged" });
  });

  it("leest DOCX, TXT, MD en CSV", async () => {
    const long = `${LINE} ${LINE}`;
    const docx = await extractReport(new Uint8Array(makeDocx([long])), "docx");
    expect(docx.ok && docx.blocks.length).toBe(1);
    const txt = await extractReport(new Uint8Array(Buffer.from(`# Kop\n\n${long}`)), "md");
    expect(txt.ok && txt.text.startsWith("# Kop")).toBe(true);
    const csv = await extractReport(new Uint8Array(Buffer.from(`regio;aantal\n${"Noord;1.200\n".repeat(20)}`)), "csv");
    expect(csv.ok).toBe(true);
  });

  it("weigert lege, binaire, te lange en beschadigde bestanden", async () => {
    expect(await extractReport(new Uint8Array(Buffer.from("kort")), "txt")).toEqual({ ok: false, reason: "no_text" });
    expect(await extractReport(new Uint8Array([0x50, 0x4b, 0, 0, 1, 2, 3]), "txt")).toEqual({ ok: false, reason: "damaged" });
    expect(await extractReport(new Uint8Array(Buffer.from("woord ".repeat(MAX_TEXT_CHARS / 5))), "txt")).toEqual({ ok: false, reason: "too_long" });
    expect(await extractReport(new Uint8Array(Buffer.from("geen zip maar wel tekst die lang genoeg is ".repeat(5))), "docx")).toEqual({ ok: false, reason: "damaged" });
  });
});

describe("AI-voorstellen filteren op letterlijke citaten", () => {
  const blocks = [
    { text: "Blok een. In 2025 waren 4.100 evenementenbureaus actief in Nederland." },
    { text: "Blok twee. Klanten noemen de prijs het grootste bezwaar bij het boeken van locaties." },
  ];
  const base = { stance: "supports" as const, question_ref: "V1" };
  const p = (x: Partial<RawProposal>): RawProposal => ({ block_ref: "B1", quote: "", statement: "", ...base, ...x });

  it("houdt alleen woord-voor-woord-citaten, zoekt in alle blokken en ontdubbelt", () => {
    const res = filterProposals(
      [
        p({ quote: "waren 4.100 evenementenbureaus actief", statement: "Er zijn 4.100 evenementenbureaus." }),
        // Verkeerd blok genoemd, citaat staat wel in blok 2.
        p({ block_ref: "B1", quote: "noemen de prijs het grootste bezwaar", statement: "Prijs is het grootste bezwaar." }),
        // Parafrase: weg.
        p({ quote: "er zijn ongeveer vierduizend bureaus", statement: "Ongeveer vierduizend bureaus." }),
        // Getal in de bewering dat niet in het citaat staat: weg.
        p({ quote: "evenementenbureaus actief in Nederland", statement: "Er zijn 5.000 evenementenbureaus." }),
        // Dubbel (andere witruimte en hoofdletters).
        p({ quote: "Waren  4.100 evenementenbureaus actief", statement: "Er zijn 4.100 bureaus." }),
        // Te lang citaat: weg.
        p({ quote: "x".repeat(MAX_QUOTE_CHARS + 1), statement: "Te lang." }),
      ],
      blocks,
      blockIndexOf,
    );
    expect(res.kept.map((k) => k.blockIndex)).toEqual([0, 1]);
    expect(res.notFound).toBe(2);
    expect(res.numbersMismatch).toBe(1);
    expect(res.duplicates).toBe(1);
  });

  it("controleert bij tegenbewijs geen getallen uit de bewering", () => {
    const res = filterProposals([p({ stance: "contradicts", quote: "evenementenbureaus actief in Nederland", statement: "Er zijn geen 5.000 bureaus." })], blocks, blockIndexOf);
    expect(res.kept).toHaveLength(1);
  });

  it("vertaalt blokverwijzingen", () => {
    expect(blockRef(0)).toBe("B1");
    expect(blockIndexOf("B12")).toBe(11);
    expect(blockIndexOf(" b3 ")).toBe(2);
    expect(blockIndexOf("Blok drie")).toBe(-1);
  });

  it("locateQuote meldt niet gevonden en ontbrekende getallen", () => {
    expect(locateQuote("kort", blocks)).toEqual({ blockIndex: -1, check: "not_found" });
    expect(locateQuote("evenementenbureaus actief in Nederland", blocks, "Er zijn 9.999 bureaus.")).toEqual({ blockIndex: 0, check: "numbers_mismatch" });
  });

  it("leest het rapport in delen binnen het tekenbudget", () => {
    const many = Array.from({ length: 10 }, () => ({ text: "x".repeat(1000) }));
    expect(aiWindow(many, 0, 3500)).toEqual({ from: 0, to: 3 });
    expect(aiWindow(many, 9, 3500)).toEqual({ from: 9, to: 10 });
    expect(aiWindow(many, 0, 10)).toEqual({ from: 0, to: 1 });
    expect(aiWindow(many, 20, 3500)).toEqual({ from: 10, to: 10 });
  });
});

describe("gegevens van de bron", () => {
  const now = new Date("2026-11-04T12:00:00Z");

  it("leest jaar, maand of datum en weigert onzin en de toekomst", () => {
    expect(parsePublished("2024", now)).toEqual({ date: "2024-01-01", precision: "year" });
    expect(parsePublished("2024-5", now)).toEqual({ date: "2024-05-01", precision: "month" });
    expect(parsePublished("13-05-2024", now)).toEqual({ date: "2024-05-13", precision: "day" });
    expect(parsePublished("", now)).toEqual({ date: null, precision: null });
    expect(parsePublished("2024-02-30", now).error).toBeTruthy();
    expect(parsePublished("vorig jaar", now).error).toBeTruthy();
    expect(parsePublished("2027", now).error).toBeTruthy();
  });

  it("herkent een geïmporteerd rapport aan de toegangsnotitie", () => {
    const note = importAccessNote({ fileName: "rapport\u0000.pdf", pages: 12, chars: 45000, blocks: 14, precision: "year", at: now });
    expect(isImportedReport(note)).toBe(true);
    expect(note).toContain("12 p.");
    expect(note).toContain("1 januari");
    expect(note).not.toContain("\u0000");
    expect(note.length).toBeLessThanOrEqual(600);
    expect(isImportedReport("Fragment handmatig ingevoerd.")).toBe(false);
    expect(isImportedReport(null)).toBe(false);
  });
});
