import "server-only";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

// Fetches a public web page as plain text so that a pasted excerpt can be checked against the
// live page. Guards against SSRF: http(s) only, no private or link-local addresses, manual
// redirects (each hop re-checked), timeout and size cap.

const MAX_BYTES = 2_000_000;

function isPrivate(ip: string): boolean {
  if (isIP(ip) === 6) {
    const v = ip.toLowerCase();
    return v === "::1" || v.startsWith("fc") || v.startsWith("fd") || v.startsWith("fe80") || v.startsWith("::ffff:127.") || v === "::";
  }
  const [a, b] = ip.split(".").map(Number);
  return (
    a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224
  );
}

async function assertPublic(url: URL) {
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("Alleen http(s)-adressen zijn toegestaan.");
  if (url.username || url.password) throw new Error("Adressen met inloggegevens zijn niet toegestaan.");
  const host = url.hostname;
  const addrs = isIP(host) ? [{ address: host }] : await lookup(host, { all: true });
  if (addrs.length === 0 || addrs.some((a) => isPrivate(a.address))) throw new Error("Dit adres is niet publiek bereikbaar.");
}

export function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s+/g, "\n")
    .trim();
}

export async function fetchPageText(raw: string): Promise<{ url: string; title: string | null; text: string }> {
  let url = new URL(raw);
  for (let hop = 0; hop < 4; hop++) {
    await assertPublic(url);
    const res = await fetch(url, {
      redirect: "manual",
      signal: AbortSignal.timeout(10_000),
      headers: { "user-agent": "ProofLab-bronchecker/1.0 (+bronverificatie)", accept: "text/html,text/plain" },
    });
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      url = new URL(res.headers.get("location")!, url);
      continue;
    }
    if (!res.ok) throw new Error(`De pagina gaf status ${res.status}.`);
    const type = res.headers.get("content-type") ?? "";
    if (!/text\/html|text\/plain|application\/xhtml/.test(type)) throw new Error("Alleen HTML- of tekstpagina's kunnen worden gecontroleerd.");
    const reader = res.body?.getReader();
    if (!reader) throw new Error("Lege pagina.");
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BYTES) {
        await reader.cancel();
        break;
      }
      chunks.push(value);
    }
    const body = new TextDecoder().decode(Buffer.concat(chunks.map((c) => Buffer.from(c))));
    const title = body.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim() ?? null;
    return { url: url.toString(), title: title ? htmlToText(title) : null, text: type.includes("html") ? htmlToText(body) : body };
  }
  throw new Error("Te veel doorverwijzingen.");
}
