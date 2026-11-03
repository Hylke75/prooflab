import { afterEach, describe, expect, it, vi } from "vitest";
import { pageProblem, UrlLedger } from "@/lib/ai/web-evidence";
import { makePdf } from "./helpers/pdf";

// Een volledige zoekstap per vraag (searchQuestion) met een gemockte Claude-respons en gemockt ophalen van pagina's:
// (1) citaten aanwezig, (2) alleen door Claude gelezen pagina's zonder citaten (met een PDF en een lege pagina),
// (3) alleen zoekresultaten die ProofLab zelf opent (met een PDF, een lege pagina en een geblokkeerde pagina).
// Gecontroleerd wordt dat passages bewaard blijven en dat het zoeklogboek per zoekterm de juiste redenen bevat.
// Er wordt nooit een echte API aangeroepen.

const idea = {
  title: "Vergaderzaal-app",
  decisionQuestion: "Investeren we?",
  description: "Een app om vergaderzalen te boeken",
  targetAudience: "eventmanagers",
  region: "Nederland",
  projectType: "new_product",
  sector: "events",
  keyUncertainty: null,
};
const QUESTION = "Hoeveel evenementenbureaus zijn er in Nederland actief?";

const PDF_LINE = "In Nederland waren in 2025 precies 4100 evenementenbureaus actief volgens de branchevereniging.";
const LONG_PARA =
  "Het aantal evenementenbureaus in Nederland steeg in 2025 naar 4.100 bedrijven, blijkt uit de jaarlijkse telling van de branche.";
const filler = "Overige tekst over het weer en het verkeer die niets met de vraag te maken heeft, maar de pagina wel lang genoeg maakt.";

const message = (content: unknown[], extra: Record<string, unknown> = {}) => ({
  id: "msg_1",
  type: "message",
  role: "assistant",
  model: "claude-test",
  stop_reason: "end_turn",
  stop_sequence: null,
  content,
  usage: { input_tokens: 1000, output_tokens: 200, server_tool_use: { web_search_requests: 1 } },
  ...extra,
});
const searchUse = (id: string, query: string) => ({ type: "server_tool_use", id, name: "web_search", input: { query } });
const fetchUse = (id: string, url: string) => ({ type: "server_tool_use", id, name: "web_fetch", input: { url } });
const results = (id: string, urls: string[]) => ({
  type: "web_search_tool_result",
  tool_use_id: id,
  content: urls.map((url) => ({ type: "web_search_result", url, title: `Titel ${url}`, page_age: null, encrypted_content: "versleuteld" })),
});
const textDoc = (id: string, url: string, data: string) => ({
  type: "web_fetch_tool_result",
  tool_use_id: id,
  content: { type: "web_fetch_result", url, retrieved_at: null, content: { type: "document", title: `Pagina ${url}`, citations: null, source: { type: "text", media_type: "text/plain", data } } },
});
const pdfDoc = (id: string, url: string, pdf: Buffer) => ({
  type: "web_fetch_tool_result",
  tool_use_id: id,
  content: { type: "web_fetch_result", url, retrieved_at: null, content: { type: "document", title: "Rapport (PDF)", citations: null, source: { type: "base64", media_type: "application/pdf", data: pdf.toString("base64") } } },
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetModules();
});

async function claudeSearch(responses: unknown[], fetchPage: (url: string) => Promise<{ url: string; title: string | null; text: string; kind?: "html" | "text" | "pdf" }>) {
  vi.resetModules();
  vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-test");
  vi.stubEnv("OPENAI_API_KEY", "");
  vi.stubEnv("GEMINI_API_KEY", "");
  const queue = [...responses];
  const api = vi.fn(async () => {
    const next = queue.shift();
    if (!next) throw new Error("onverwachte aanroep");
    return new Response(JSON.stringify(next), { status: 200, headers: { "content-type": "application/json" } });
  });
  vi.stubGlobal("fetch", api);
  const research = await import("@/lib/ai/research");
  const r = await research.searchQuestion(idea, QUESTION, 3, "anthropic", { fetchPage });
  return { r, api };
}

const statuses = (log: { urls: { url: string; status: string }[] }[]) => Object.fromEntries(log.flatMap((e) => e.urls.map((u) => [u.url, u.status])));

describe("zoekstap met Claude: bronnen raken niet kwijt en het logboek zegt waarom", () => {
  it("(1) citaten aanwezig: de geciteerde passage wordt bewaard en de zoekterm gelogd", async () => {
    const fetchPage = vi.fn(async (url: string) => ({ url, title: "x", text: "" }));
    const { r } = await claudeSearch(
      [
        message([
          searchUse("s1", "aantal evenementenbureaus Nederland"),
          results("s1", ["https://cbs.nl/a"]),
          fetchUse("f1", "https://cbs.nl/a"),
          textDoc("f1", "https://cbs.nl/a", `Kop\n${LONG_PARA}\n${filler}`),
          { type: "text", text: "Er zijn 4.100 bureaus.", citations: [{ type: "web_search_result_location", url: "https://cbs.nl/a", title: "CBS", cited_text: "steeg in 2025 naar 4.100 bedrijven", encrypted_index: "e" }] },
        ]),
      ],
      fetchPage,
    );
    expect(r.sources).toHaveLength(1);
    expect(r.sources[0].excerpts).toEqual([LONG_PARA]);
    expect(fetchPage).not.toHaveBeenCalled();
    expect(r.log).toHaveLength(1);
    expect(r.log[0]).toMatchObject({ query: "aantal evenementenbureaus Nederland", passages: 1 });
    expect(r.log[0].urls[0]).toMatchObject({ url: "https://cbs.nl/a", status: "bewaard" });
  });

  it("(2) alleen gelezen pagina's zonder citaten: relevante alinea's uit tekst en PDF, lege pagina met reden", async () => {
    const fetchPage = vi.fn(async (url: string) => ({ url, title: "x", text: "" }));
    const { r } = await claudeSearch(
      [
        // Eerste ronde pauzeert (pause_turn), de tweede ronde leest nog een pagina; geen citaten in de tekst.
        message(
          [
            searchUse("s1", "evenementenbureaus aantal 2025"),
            results("s1", ["https://branche.nl/telling", "https://rapport.nl/jaar.pdf"]),
            fetchUse("f1", "https://branche.nl/telling"),
            textDoc("f1", "https://branche.nl/telling", `${filler}\n${LONG_PARA}\n${filler}`),
            fetchUse("f2", "https://rapport.nl/jaar.pdf"),
            pdfDoc("f2", "https://rapport.nl/jaar.pdf", makePdf([PDF_LINE])),
          ],
          { stop_reason: "pause_turn" },
        ),
        message([
          searchUse("s2", "evenementenbureaus app"),
          results("s2", ["https://app.example.nl/"]),
          fetchUse("f3", "https://app.example.nl/"),
          textDoc("f3", "https://app.example.nl/", "Laden…"),
          fetchUse("f4", "https://dicht.example.nl/"),
          { type: "web_fetch_tool_result", tool_use_id: "f4", content: { type: "web_fetch_tool_result_error", error_code: "url_not_accessible" } },
          { type: "text", text: "Ik heb niet genoeg kunnen vinden." },
        ]),
      ],
      fetchPage,
    );
    const urls = r.sources.map((s) => s.url).sort();
    expect(urls).toEqual(["https://branche.nl/telling", "https://rapport.nl/jaar.pdf"]);
    expect(r.sources.find((s) => s.url.endsWith(".pdf"))!.excerpts[0]).toContain("4100 evenementenbureaus");
    expect(r.log.map((e) => e.query)).toEqual(["evenementenbureaus aantal 2025", "evenementenbureaus app"]);
    expect(r.log[0].passages).toBeGreaterThanOrEqual(2);
    const st = statuses(r.log);
    expect(st["https://branche.nl/telling"]).toBe("bewaard");
    expect(st["https://rapport.nl/jaar.pdf"]).toBe("bewaard");
    expect(st["https://app.example.nl/"]).toBe("lege_pagina");
    // Een URL die Claude zelf opende maar die niet in de zoekresultaten stond, komt bij de laatste zoekterm.
    expect(r.log[1].urls.find((u) => u.url === "https://dicht.example.nl/")).toMatchObject({ status: "geblokkeerd" });
    expect(fetchPage).not.toHaveBeenCalled();
  });

  it("(3) alleen zoekresultaten: ProofLab opent ze zelf, met PDF, lege pagina, geblokkeerde en niet-relevante pagina", async () => {
    const { PageFetchError } = await import("@/lib/fetch-page");
    const pages: Record<string, () => Promise<{ url: string; title: string | null; text: string; kind?: "html" | "text" | "pdf" }>> = {
      "https://cbs.nl/tabel": async () => ({ url: "https://cbs.nl/tabel", title: "CBS tabel", text: `${filler}\n${LONG_PARA}`, kind: "html" }),
      "https://kvk.nl/rapport.pdf": async () => ({ url: "https://kvk.nl/rapport.pdf", title: "rapport.pdf", text: PDF_LINE, kind: "pdf" }),
      "https://scan.nl/scan.pdf": async () => ({ url: "https://scan.nl/scan.pdf", title: "scan.pdf", text: "", kind: "pdf" }),
      "https://spa.nl/": async () => ({ url: "https://spa.nl/", title: "App", text: "Even geduld", kind: "html" }),
      "https://weer.nl/": async () => ({ url: "https://weer.nl/", title: "Weer", text: `${filler}\n${filler}\n${filler}`, kind: "html" }),
      "https://intern.nl/": async () => {
        throw new PageFetchError("geblokkeerd", "Dit adres is niet publiek bereikbaar.");
      },
    };
    const fetchPage = vi.fn(async (url: string) => pages[url]());
    const { r } = await claudeSearch(
      [
        message([
          searchUse("s1", "evenementenbureaus Nederland aantal"),
          results("s1", Object.keys(pages).slice(0, 3)),
          searchUse("s2", "evenementenbureaus statistiek"),
          results("s2", [...Object.keys(pages).slice(3), "https://cbs.nl/tabel", "https://extra-1.nl/", "https://extra-2.nl/"]),
          { type: "text", text: "Zie de zoekresultaten." },
        ]),
      ],
      fetchPage,
    );
    expect(r.sources.map((s) => s.url).sort()).toEqual(["https://cbs.nl/tabel", "https://kvk.nl/rapport.pdf"]);
    expect(r.sources.every((s) => s.excerpts.length > 0)).toBe(true);
    const st = statuses(r.log);
    expect(st).toMatchObject({
      "https://cbs.nl/tabel": "bewaard",
      "https://kvk.nl/rapport.pdf": "bewaard",
      "https://scan.nl/scan.pdf": "pdf_geen_tekst",
      "https://spa.nl/": "lege_pagina",
      "https://weer.nl/": "geen_relevante_alinea",
      "https://intern.nl/": "geblokkeerd",
    });
    // Maximaal zes pagina's opent ProofLab zelf; de rest blijft "niet_opgehaald".
    expect(fetchPage).toHaveBeenCalledTimes(6);
    expect(st["https://extra-2.nl/"]).toBe("niet_opgehaald");
    // De passages tellen één keer, bij de eerste zoekterm die de URL opleverde.
    expect(r.log[0].passages + r.log[1].passages).toBe(r.sources.reduce((s, x) => s + x.excerpts.length, 0));
    expect(r.log[1].urls.filter((u) => u.url === "https://cbs.nl/tabel")).toHaveLength(1);
  });
});

describe("zoekstap met ChatGPT: citaat dat niet letterlijk op de pagina staat", () => {
  it("logt per zoekterm citaat_niet_letterlijk en niet_opgehaald", async () => {
    vi.resetModules();
    vi.stubEnv("OPENAI_API_KEY", "sk-test");
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.stubEnv("GEMINI_API_KEY", "");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            model: "gpt-x",
            output: [
              { type: "web_search_call", action: { type: "search", query: "bureaus nederland", sources: [{ url: "https://a.nl/" }, { url: "https://b.nl/" }, { url: "https://c.nl/" }] } },
              { type: "message", content: [{ type: "output_text", text: "BRON: https://a.nl/\nCITAAT: Er zijn 4.100 bureaus actief.\nBRON: https://b.nl/\nCITAAT: Een verzonnen zin over bureaus.", annotations: [] }] },
            ],
            usage: { input_tokens: 100, output_tokens: 10 },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      ),
    );
    const research = await import("@/lib/ai/research");
    const fetchPage = vi.fn(async (url: string) => ({ url, title: url, text: url === "https://a.nl/" ? `Er zijn 4.100 bureaus actief.\n${filler}\n${filler}` : `${filler}\n${filler}`, kind: "html" as const }));
    const r = await research.searchQuestion(idea, QUESTION, 3, "openai", { fetchPage });
    expect(r.log).toHaveLength(1);
    expect(r.log[0]).toMatchObject({ query: "bureaus nederland", passages: 1 });
    expect(statuses(r.log)).toEqual({ "https://a.nl/": "bewaard", "https://b.nl/": "citaat_niet_letterlijk", "https://c.nl/": "niet_opgehaald" });
  });
});

describe("pagina-classificatie en logboek", () => {
  it("herkent lege HTML-pagina's en PDF's zonder tekst", () => {
    expect(pageProblem({ text: "Laden…", kind: "html" })).toBe("lege_pagina");
    expect(pageProblem({ text: "x".repeat(250), kind: "html" })).toBeNull();
    expect(pageProblem({ text: " ", kind: "pdf" })).toBe("pdf_geen_tekst");
    expect(pageProblem({ text: PDF_LINE, kind: "pdf" })).toBeNull();
  });

  it("zet de onderzoeksvraag als zoekterm als de aanbieder geen termen meldt, en overschrijft 'bewaard' niet", () => {
    const l = new UrlLedger();
    l.set("https://a.nl/x", "bewaard", { passages: 2 });
    l.set("https://a.nl/x/", "geblokkeerd");
    const log = l.build([], QUESTION);
    expect(log).toEqual([{ query: QUESTION, passages: 2, urls: [{ url: "https://a.nl/x", title: null, status: "bewaard", reason: "Letterlijke passages bewaard" }] }]);
  });
});

describe("PDF naar tekst", () => {
  it("haalt de tekstlaag uit een PDF", async () => {
    const { pdfToText } = await import("@/lib/pdf-text");
    expect(await pdfToText(makePdf([PDF_LINE, "Tweede regel."]))).toBe(`${PDF_LINE}\nTweede regel.`);
    expect(await pdfToText(Buffer.from("geen pdf"))).toBe("");
  });
});
