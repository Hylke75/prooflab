// Cookieless measurement for public test pages. The visitor code is an HMAC of (test page, IP, user agent)
// under a server secret: stable for the whole test, so a returning visitor counts once and keeps the same
// price; different for every test, so visitors cannot be followed across tests; never reversible.

import { createHmac } from "node:crypto";

export function visitorHash(input: { salt: string; ip: string; userAgent: string; slug: string }): string {
  return createHmac("sha256", input.salt).update(`visitor|${input.slug}|${input.ip}|${input.userAgent}`).digest("hex").slice(0, 32);
}

// Pseudonymous network bucket for rate limiting; says nothing about the person.
export function rateBucket(salt: string, ip: string): string {
  return createHmac("sha256", salt).update(`rate|${ip}`).digest("hex").slice(0, 24);
}

// The client IP as set by the hosting platform. A browser can send its own X-Forwarded-For; proxies
// append to it, so only the right-most entry (added by our own edge) is trusted.
export function clientIp(get: (name: string) => string | null): string {
  const platform = get("x-vercel-forwarded-for") ?? get("x-real-ip");
  if (platform) return platform.split(",")[0].trim();
  const chain = (get("x-forwarded-for") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  return chain[chain.length - 1] ?? "0.0.0.0";
}

const BOT_PATTERN =
  /bot|crawl|spider|slurp|preview|facebookexternalhit|linkedinbot|whatsapp|telegram|discord|headless|lighthouse|pingdom|uptime|curl|wget|python-requests|httpclient|go-http/i;

export function isLikelyBot(userAgent: string | null | undefined): boolean {
  if (!userAgent || userAgent.length < 20) return true;
  return BOT_PATTERN.test(userAgent);
}

export const CHANNELS = {
  network: "Eigen netwerk",
  linkedin: "LinkedIn (organisch)",
  linkedin_ads: "LinkedIn-advertentie",
  meta_ads: "Meta-advertentie",
  google_ads: "Google-advertentie",
  outreach: "Outreach (e-mail/DM)",
  newsletter: "Nieuwsbrief",
  other: "Overig",
  direct: "Direct / onbekend",
} as const;
export type Channel = keyof typeof CHANNELS;

export function channelFrom(utmSource: string | null | undefined): Channel {
  const s = (utmSource ?? "").toLowerCase().trim();
  return (s in CHANNELS ? s : s ? "other" : "direct") as Channel;
}

// Variant assignment for price tests: stable per visitor without storing anything client-side.
export function assignVariant(hash: string, variants: number): number {
  if (variants <= 1) return 0;
  return parseInt(hash.slice(0, 8), 16) % variants;
}
