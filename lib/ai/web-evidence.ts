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

export type PageFetcher = (url: string) => Promise<{ url: string; title: string | null; text: string }>;

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
): Promise<{ sources: FoundSource[]; quotes: number; rejected: number; pagesFetched: number; pagesFailed: number }> {
  const urls = [...new Set([...claimed.map((c) => c.url), ...citationUrls])].slice(0, maxPages);
  const quotes = [...new Set(claimed.flatMap((c) => c.quotes))];
  const pages = await Promise.allSettled(urls.map((u) => fetchPage(u)));
  const bySource = new Map<string, FoundSource>();
  const kept = new Set<string>();
  let fetchedOk = 0;
  for (const p of pages) {
    if (p.status !== "fulfilled") continue;
    fetchedOk++;
    const page = p.value;
    for (const q of quotes) {
      const passage = passageFor(page.text, q);
      if (!passage) continue;
      kept.add(q);
      const key = sourceKey(page.url);
      const src = bySource.get(key) ?? { url: page.url, title: page.title?.trim() || page.url, pageAge: null, excerpts: [], foundBy: [provider] };
      if (!src.excerpts.includes(passage)) src.excerpts.push(passage);
      bySource.set(key, src);
    }
  }
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
