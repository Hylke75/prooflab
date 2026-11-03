import "server-only";
import { lookup } from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import { BlockList, isIP } from "node:net";

// Fetches a public web page as plain text so that a pasted excerpt can be checked against the
// live page. Guards against SSRF: http(s) only, no private or link-local addresses, manual
// redirects (each hop re-checked), timeout and size cap.

const MAX_BYTES = 2_000_000;

// Every special-purpose range from the IANA registries: private, loopback, link-local, CGNAT,
// benchmarking, documentation, multicast, reserved, and the IPv6 forms that can carry an IPv4 address.
const BLOCKED = new BlockList();
for (const [net, prefix] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12],
  ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.88.99.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15],
  ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4],
] as const) BLOCKED.addSubnet(net, prefix, "ipv4");
for (const [net, prefix] of [
  ["::", 128], ["::1", 128], ["100::", 64], ["2001::", 23], ["2001:db8::", 32], ["fc00::", 7], ["fe80::", 10], ["fec0::", 10], ["ff00::", 8],
] as const) BLOCKED.addSubnet(net, prefix, "ipv6");

function expandV6(ip: string): number[] | null {
  let s = ip.toLowerCase().split("%")[0];
  // Trailing dotted IPv4 (e.g. ::ffff:10.0.0.1) becomes two hextets.
  const dotted = s.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (dotted) {
    const p = dotted[1].split(".").map(Number);
    s = s.slice(0, -dotted[1].length) + ((p[0] << 8) | p[1]).toString(16) + ":" + ((p[2] << 8) | p[3]).toString(16);
  }
  const [head, tail] = s.split("::");
  const h = head ? head.split(":") : [];
  const t = tail !== undefined ? (tail ? tail.split(":") : []) : [];
  const missing = 8 - h.length - t.length;
  if (tail === undefined ? h.length !== 8 : missing < 0) return null;
  const parts = [...h, ...Array(tail === undefined ? 0 : missing).fill("0"), ...t].map((x) => parseInt(x, 16));
  return parts.length === 8 && parts.every((x) => Number.isFinite(x) && x >= 0 && x <= 0xffff) ? parts : null;
}

const v4From = (hi: number, lo: number) => `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;

// True for any address that is not a normal public unicast address.
export function isBlockedAddress(ip: string): boolean {
  const family = isIP(ip);
  if (family === 4) return BLOCKED.check(ip, "ipv4");
  if (family !== 6) return true;
  if (BLOCKED.check(ip, "ipv6")) return true;
  const p = expandV6(ip);
  if (!p) return true;
  const zeros = (n: number) => p.slice(0, n).every((x) => x === 0);
  // IPv4-mapped (::ffff:a.b.c.d) and IPv4-compatible (::a.b.c.d)
  if ((zeros(5) && p[5] === 0xffff) || zeros(6)) return isBlockedAddress(v4From(p[6], p[7]));
  // NAT64 (64:ff9b::/96 and 64:ff9b:1::/48)
  if (p[0] === 0x64 && p[1] === 0xff9b) return isBlockedAddress(v4From(p[6], p[7]));
  // 6to4 (2002:AABB:CCDD::/48 carries AA.BB.CC.DD)
  if (p[0] === 0x2002) return isBlockedAddress(v4From(p[1], p[2]));
  return false;
}

// Resolves once and returns the address the connection must use, so the name cannot be re-resolved
// to an internal address between the check and the request (DNS rebinding).
async function resolvePublic(url: URL): Promise<{ address: string; family: number }> {
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("Alleen http(s)-adressen zijn toegestaan.");
  if (url.username || url.password) throw new Error("Adressen met inloggegevens zijn niet toegestaan.");
  if (url.port && !["80", "443", "8080", "8443"].includes(url.port)) throw new Error("Deze poort is niet toegestaan.");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const addrs = isIP(host) ? [{ address: host, family: isIP(host) }] : await lookup(host, { all: true, verbatim: true });
  if (addrs.length === 0 || addrs.some((a) => isBlockedAddress(a.address))) throw new Error("Dit adres is niet publiek bereikbaar.");
  return addrs[0];
}

type RawResponse = { status: number; headers: http.IncomingHttpHeaders; body: http.IncomingMessage };

function requestPinned(url: URL, pin: { address: string; family: number }): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    const mod = url.protocol === "https:" ? https : http;
    const req = mod.request(
      url,
      {
        method: "GET",
        headers: { "user-agent": "ProofLab-bronchecker/1.0 (+bronverificatie)", accept: "text/html,text/plain", "accept-encoding": "identity" },
        // Connect to the address that was checked, never to a fresh lookup.
        lookup: ((_host: string, opts: { all?: boolean }, cb: (...args: unknown[]) => void) =>
          opts?.all ? cb(null, [{ address: pin.address, family: pin.family }]) : cb(null, pin.address, pin.family)) as unknown as http.RequestOptions["lookup"],
        servername: isIP(url.hostname) ? undefined : url.hostname,
        timeout: 10_000,
      },
      (res) => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: res }),
    );
    req.on("timeout", () => req.destroy(new Error("De pagina reageerde niet op tijd.")));
    req.on("error", reject);
    req.end();
  });
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
    const pin = await resolvePublic(url);
    const res = await requestPinned(url, pin);
    if (res.status >= 300 && res.status < 400 && res.headers.location) {
      res.body.resume();
      url = new URL(res.headers.location, url);
      continue;
    }
    if (res.status < 200 || res.status >= 300) {
      res.body.resume();
      throw new Error("De pagina kon niet worden opgehaald.");
    }
    const type = String(res.headers["content-type"] ?? "");
    if (!/text\/html|text\/plain|application\/xhtml/.test(type)) {
      res.body.destroy();
      throw new Error("Alleen HTML- of tekstpagina's kunnen worden gecontroleerd.");
    }
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of res.body) {
      size += (chunk as Buffer).byteLength;
      if (size > MAX_BYTES) {
        res.body.destroy();
        break;
      }
      chunks.push(chunk as Buffer);
    }
    const body = Buffer.concat(chunks).toString("utf8");
    const title = body.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim() ?? null;
    return { url: url.toString(), title: title ? htmlToText(title) : null, text: type.includes("html") ? htmlToText(body) : body };
  }
  throw new Error("Te veel doorverwijzingen.");
}
