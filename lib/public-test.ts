import "server-only";
import { headers } from "next/headers";
import { env } from "@/lib/env";
import { assignVariant, clientIp, isLikelyBot, rateBucket, visitorHash } from "@/lib/domain/tracking";

export async function visitorFromRequest(slug: string) {
  const h = await headers();
  const ip = clientIp((n) => h.get(n));
  const ua = h.get("user-agent") ?? "";
  const salt = env.trackingSalt || "dev-salt";
  return { hash: visitorHash({ salt, ip, userAgent: ua, slug }), bucket: rateBucket(salt, ip), bot: isLikelyBot(ua) };
}

// Events may only come from our own test page: same origin, JSON body. Blocks silent cross-site posts.
export function isSameOriginJson(request: Request): boolean {
  const type = request.headers.get("content-type") ?? "";
  if (!type.toLowerCase().startsWith("application/json")) return false;
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
    return new URL(origin).host === host || new URL(origin).origin === new URL(env.appUrl).origin;
  } catch {
    return false;
  }
}

export function variantFor(hash: string, count: number): number {
  return assignVariant(hash, count);
}

export function consentText(researcher: string): string {
  return `Ik geef ${researcher} toestemming om mijn e-mailadres te gebruiken om mij over dit aanbod te informeren. Het adres wordt maximaal 180 dagen bewaard en niet gedeeld. Intrekken kan altijd door te reageren op de e-mail.`;
}
