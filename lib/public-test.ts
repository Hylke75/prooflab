import "server-only";
import { headers } from "next/headers";
import { env } from "@/lib/env";
import { assignVariant, isLikelyBot, visitorHash } from "@/lib/domain/tracking";

export async function visitorFromRequest(slug: string) {
  const h = await headers();
  const ip = (h.get("x-forwarded-for") ?? "").split(",")[0].trim() || h.get("x-real-ip") || "0.0.0.0";
  const ua = h.get("user-agent") ?? "";
  return { hash: visitorHash({ salt: env.trackingSalt || "dev-salt", ip, userAgent: ua, slug }), bot: isLikelyBot(ua) };
}

export function variantFor(hash: string, count: number): number {
  return assignVariant(hash, count);
}

export function consentText(researcher: string): string {
  return `Ik geef ${researcher} toestemming om mijn e-mailadres te gebruiken om mij over dit aanbod te informeren. Het adres wordt maximaal 180 dagen bewaard en niet gedeeld. Intrekken kan altijd door te reageren op de e-mail.`;
}
