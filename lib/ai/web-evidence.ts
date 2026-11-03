import { normalizeText } from "@/lib/domain/verify";
import { PROVIDERS, type ProviderId } from "./providers/config";

// Provider-independent handling of web research results. Whatever provider searched, a passage is only kept when
// it is a verbatim slice of a page: either the page text the provider fetched itself (Claude's web_fetch, with
// its citations) or the page ProofLab fetched (ChatGPT, Gemini). Later, a finding still only counts when its
// quote is literally in such a stored passage (lib/domain/verify.ts checkQuote). Pure, apart from the injected
// page fetcher.

export type FoundSource = {
  url: string;
  title: string;
  pageAge: string | null;
  excerpts: string[]; // verbatim passages, stored instead of the full document
  foundBy: ProviderId[]; // which providers led to this page (information, never extra evidence weight)
};

export type PageFetcher = (url: string) => Promise<{ url: string; title: string | null; text: string; kind?: "html" | "text" | "pdf" }>;

// ---------------------------------------------------------------------------
// Zoeklogboek: per zoekterm welke URL's gevonden zijn en wat ProofLab ermee deed (research_search_log).
// ---------------------------------------------------------------------------

export const URL_STATUS = {
  bewaard: "Letterlijke passages bewaard",
  pdf_geen_tekst: "PDF zonder leesbare tekst (bijvoorbeeld een scan) of te groot",
  lege_pagina: "Pagina vrijwel leeg; de inhoud wordt vermoedelijk pas in de browser geladen",
  geblokkeerd: "Pagina niet bereikbaar of geweigerd",
  geen_relevante_alinea: "Geen alinea die bij de vraag past",
  citaat_niet_letterlijk: "Citaat van het model staat niet letterlijk op de pagina",
  niet_opgehaald: "Niet geopend",
} as const;
export type UrlStatus = keyof typeof URL_STATUS;
export const isUrlStatus = (v: unknown): v is UrlStatus => typeof v === "string" && v in URL_STATUS;

export type UrlLog = { url: string; title: string | null; status: UrlStatus; reason: string };
export type QueryLog = { query: string; urls: UrlLog[]; passages: number };

// Pages that never yield a citable passage: video, social media and log-in walls.
const UNUSABLE_HOSTS = /(^|\.)(youtube\.com|youtu\.be|facebook\.com|instagram\.com|tiktok\.com|x\.com|twitter\.com|pinterest\.[a-z]+|accounts\.google\.com)$/i;

// A URL that is worth opening: http(s) and not on a host that never has readable text.
export function isUsableUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return (u.protocol === "https:" || u.protocol === "http:") && !UNUSABLE_HOSTS.test(u.hostname);
  } catch {
    return false;
  }
}

// Below this many characters of cleaned text an HTML page is treated as empty (content loaded by scripts).
export const EMPTY_PAGE_CHARS = 200;
const EMPTY_PDF_CHARS = 50;

// Why a fetched page cannot yield passages, or null when its text is usable.
export function pageProblem(page: { text: string; kind?: "html" | "text" | "pdf" }): "pdf_geen_tekst" | "lege_pagina" | null {
  const n = page.text.trim().length;
  if (page.kind === "pdf") return n < EMPTY_PDF_CHARS ? "pdf_geen_tekst" : null;
  return n < EMPTY_PAGE_CHARS ? "lege_pagina" : null;
}

// Collects what happened to each URL during one search, then lays it out per search query. A URL keeps its best
// outcome ("bewaard" is never overwritten). URLs a query returned that were never touched are "niet_opgehaald".
export class UrlLedger {
  private entries = new Map<string, UrlLog & { passages: number }>();

  set(url: string, status: UrlStatus, opts: { title?: string | null; reason?: string; passages?: number } = {}) {
    const key = sourceKey(url);
    const prev = this.entries.get(key);
    if (prev?.status === "bewaard" && status !== "bewaard") return;
    this.entries.set(key, {
      url,
      title: opts.title ?? prev?.title ?? null,
      status,
      reason: (opts.reason ?? URL_STATUS[status]).slice(0, 300),
      passages: status === "bewaard" ? (opts.passages ?? 0) : 0,
    });
  }

  has(url: string): boolean {
    return this.entries.has(sourceKey(url));
  }

  // One entry per query (in order). URLs the ledger knows but no query returned (pages the model fetched or cited
  // directly) are added to the last query; without any query the fallback (the research question) is used.
  build(queries: { query: string; urls: string[] }[], fallbackQuery: string, titles: Map<string, string> = new Map()): QueryLog[] {
    const rows = (queries.length ? queries : [{ query: fallbackQuery, urls: [] }]).map((q) => ({ query: q.query.slice(0, 500), urls: [...q.urls] }));
    const listed = new Set(rows.flatMap((r) => r.urls.map(sourceKey)));
    for (const e of this.entries.values()) if (!listed.has(sourceKey(e.url))) rows[rows.length - 1].urls.push(e.url);
    const counted = new Set<string>();
    return rows.map((r) => {
      const seen = new Set<string>();
      const urls: UrlLog[] = [];
      let passages = 0;
      for (const url of r.urls) {
        const key = sourceKey(url);
        if (seen.has(key)) continue;
        seen.add(key);
        const e = this.entries.get(key);
        urls.push(
          e
            ? { url: e.url, title: e.title ?? titles.get(url) ?? null, status: e.status, reason: e.reason }
            : { url, title: titles.get(url) ?? null, status: "niet_opgehaald", reason: URL_STATUS.niet_opgehaald },
        );
        if (e && !counted.has(key)) {
          counted.add(key);
          passages += e.passages;
        }
      }
      return { query: r.query, urls: urls.slice(0, 40), passages };
    });
  }
}

const MAX_PASSAGE = 1500;

// The paragraph around a cited passage, so later extraction has context. Always a verbatim slice of the page.
export function widen(page: string, citedText: string): string {
  const idx = page.indexOf(citedText);
  if (idx < 0) return citedText;
  const start = Math.max(0, page.lastIndexOf("\n", idx) + 1);
  const endNl = page.indexOf("\n", idx + citedText.length);
  const end = endNl < 0 ? page.length : endNl;
  const para = page.slice(start, end).trim();
  return para.length <= MAX_PASSAGE ? para : citedText;
}

// The verbatim passage of the page that contains the quote (compared after normalising whitespace, quote marks
// and case), or null when the quote is not on the page.
export function passageFor(page: string, quote: string): string | null {
  const exact = passageForExact(page, quote);
  if (exact) return exact;
  // A copied sentence often gets a closing full stop the page does not have at that point.
  const trimmed = quote.trim().replace(/[.…;:,!?]+$/, "");
  return trimmed !== quote.trim() ? passageForExact(page, trimmed) : null;
}

function passageForExact(page: string, quote: string): string | null {
  const q = normalizeText(quote);
  if (q.length < 8) return null;
  for (const para of page.split("\n")) {
    if (!normalizeText(para).includes(q)) continue;
    const p = para.trim();
    if (p.length <= MAX_PASSAGE) return p;
    const idx = p.indexOf(quote.trim());
    if (idx < 0) return null;
    const from = Math.max(0, idx - 300);
    return p.slice(from, Math.min(p.length, from + MAX_PASSAGE));
  }
  return null;
}

// "BRON: <url>" followed by one or more "CITAAT: <text>" lines, as asked of ChatGPT and Gemini.
export function parseQuotedSources(text: string): { url: string; quotes: string[] }[] {
  const out: { url: string; quotes: string[] }[] = [];
  let current: { url: string; quotes: string[] } | null = null;
  for (const raw of text.split("\n")) {
    const line = raw.trim().replace(/^[-*•\d.)\s]+/, "");
    const bron = line.match(/^(?:\*\*)?BRON(?:\*\*)?\s*:\s*(?:\*\*)?\s*<?(https?:\/\/[^\s>)\]]+)/i);
    if (bron) {
      current = { url: bron[1].replace(/[.,;]+$/, ""), quotes: [] };
      out.push(current);
      continue;
    }
    const cit = line.match(/^(?:\*\*)?CITAAT(?:\*\*)?\s*:\s*(?:\*\*)?\s*(.+)$/i);
    if (cit && current) {
      const q = cit[1].trim().replace(/^["“„'«]+|["”'»]+$/g, "").trim();
      if (q.length >= 8 && q.length <= 1000) current.quotes.push(q);
    }
  }
  return out.filter((s) => s.quotes.length > 0);
}

// Fetches the cited pages and keeps a quote only when it is literally on a fetched page. A quote counts for the
// page it is found on, whichever URL the model attributed it to. Returns the kept sources and how many quotes
// could not be found.
export async function verifyQuotedSources(
  provider: ProviderId,
  claimed: { url: string; quotes: string[] }[],
  citationUrls: string[],
  fetchPage: PageFetcher,
  maxPages = 8,
  ledger?: UrlLedger,
): Promise<{ sources: FoundSource[]; quotes: number; rejected: number; pagesFetched: number; pagesFailed: number }> {
  const urls = [...new Set([...claimed.map((c) => c.url), ...citationUrls])].slice(0, maxPages);
  const quotes = [...new Set(claimed.flatMap((c) => c.quotes))];
  const pages = await Promise.allSettled(urls.map((u) => fetchPage(u)));
  const bySource = new Map<string, FoundSource>();
  const kept = new Set<string>();
  let fetchedOk = 0;
  pages.forEach((p, i) => {
    const asked = urls[i];
    if (p.status !== "fulfilled") {
      const reason = p.reason as { reason?: unknown; message?: unknown } | undefined;
      ledger?.set(asked, reason?.reason === "pdf_geen_tekst" ? "pdf_geen_tekst" : "geblokkeerd", { reason: typeof reason?.message === "string" ? reason.message : undefined });
      return;
    }
    fetchedOk++;
    const page = p.value;
    let here = 0;
    for (const q of quotes) {
      const passage = passageFor(page.text, q);
      if (!passage) continue;
      kept.add(q);
      const key = sourceKey(page.url);
      const src = bySource.get(key) ?? { url: page.url, title: page.title?.trim() || page.url, pageAge: null, excerpts: [], foundBy: [provider] };
      if (!src.excerpts.includes(passage)) {
        src.excerpts.push(passage);
        here++;
      }
      bySource.set(key, src);
    }
    const problem = pageProblem(page);
    if (here > 0) ledger?.set(asked, "bewaard", { title: page.title, passages: here });
    else if (problem) ledger?.set(asked, problem, { title: page.title });
    else if (claimed.some((c) => sourceKey(c.url) === sourceKey(asked) && c.quotes.length > 0)) ledger?.set(asked, "citaat_niet_letterlijk", { title: page.title });
    else ledger?.set(asked, "geen_relevante_alinea", { title: page.title, reason: "Het model gaf geen letterlijk citaat van deze pagina." });
  });
  return { sources: [...bySource.values()], quotes: quotes.length, rejected: quotes.length - kept.size, pagesFetched: fetchedOk, pagesFailed: urls.length - fetchedOk };
}

// Same page whatever the fragment or a trailing slash.
export function sourceKey(url: string): string {
  try {
    const u = new URL(url);
    u.hash = "";
    return `${u.protocol}//${u.host.toLowerCase()}${u.pathname.replace(/\/+$/, "")}${u.search}`;
  } catch {
    return url;
  }
}

// Merges the sources several providers found. Passages are unioned; foundBy records every provider that led to
// the page. Agreement is information for the reader, never extra evidence weight.
export function mergeFoundSources(lists: FoundSource[][]): FoundSource[] {
  const merged = new Map<string, FoundSource>();
  for (const list of lists) {
    for (const s of list) {
      const key = sourceKey(s.url);
      const m = merged.get(key);
      if (!m) {
        merged.set(key, { ...s, excerpts: [...s.excerpts], foundBy: [...s.foundBy] });
        continue;
      }
      for (const e of s.excerpts) if (!m.excerpts.includes(e)) m.excerpts.push(e);
      for (const p of s.foundBy) if (!m.foundBy.includes(p)) m.foundBy.push(p);
      m.pageAge ??= s.pageAge;
    }
  }
  for (const m of merged.values()) m.foundBy.sort((a, b) => PROVIDERS.indexOf(a) - PROVIDERS.indexOf(b));
  return [...merged.values()];
}

// ---------------------------------------------------------------------------
// Fallback passages: when a model searched and read pages but did not cite them in a final answer, ProofLab still
// keeps the most relevant paragraphs of those pages. They stay verbatim slices of the page; the extraction step
// afterwards only accepts claims whose quote appears word for word in such a passage.
// ---------------------------------------------------------------------------

const STOPWORDS = new Set(
  "de het een en van in op te voor met aan door dat die dit is zijn wordt worden of als bij om tot uit over naar hoe wat wie welke waar hoeveel hoe groot er niet ook nog al the a an and of in on to for with by is are what how which who".split(" "),
);

function keywords(question: string): string[] {
  return [...new Set(question.toLowerCase().normalize("NFKD").replace(/[^\p{L}\p{N}\s-]/gu, " ").split(/\s+/))].filter((w) => w.length > 3 && !STOPWORDS.has(w));
}

// The paragraphs of a page that best match the question: word overlap, with a bonus for numbers (sizes, prices,
// percentages). Only paragraphs of 60–MAX_PASSAGE characters; navigation crumbs and cookie banners are too short.
export function relevantPassages(pageText: string, question: string, max = 4): string[] {
  const keys = keywords(question);
  if (keys.length === 0) return [];
  const paras = pageText
    .split(/\n{1,}/)
    .map((p) => p.trim())
    .filter((p) => p.length >= 60 && p.length <= MAX_PASSAGE && !/cookie|javascript|inloggen|log in|subscribe/i.test(p));
  const scored = paras
    .map((p, i) => {
      const low = p.toLowerCase();
      const hits = keys.filter((k) => low.includes(k.slice(0, Math.max(5, k.length - 2)))).length;
      const numbers = /\d[\d.,]*\s*(%|procent|miljoen|mln|miljard|€|eur|bedrijven|ondernemingen|organisaties)/i.test(p) ? 1.5 : /\d/.test(p) ? 0.5 : 0;
      return { p, i, score: hits + numbers };
    })
    .filter((x) => x.score >= 2)
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .slice(0, max)
    .sort((a, b) => a.i - b.i);
  return scored.map((x) => x.p);
}
