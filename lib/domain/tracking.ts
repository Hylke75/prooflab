// Cookieless measurement for public test pages. The visitor hash rotates daily, is computed
// server-side from salt + date + IP + user agent + slug, and is never reversible to a person.

import { createHash } from "node:crypto";

export function visitorHash(input: { salt: string; ip: string; userAgent: string; slug: string; day?: string }): string {
  const day = input.day ?? new Date().toISOString().slice(0, 10);
  return createHash("sha256")
    .update(`${input.salt}|${day}|${input.ip}|${input.userAgent}|${input.slug}`)
    .digest("hex")
    .slice(0, 32);
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
