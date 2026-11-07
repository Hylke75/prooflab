import { NextResponse } from "next/server";
import { trackingConfigured } from "@/lib/env";
import { isSameOriginJson, visitorFromRequest } from "@/lib/public-test";
import { channelFrom } from "@/lib/domain/tracking";
import { answerConversation, endConversation, isSessionToken, resumeConversation, startConversation, type ChatResult } from "@/lib/ai-interview-public";
import { SCREENED_OUT_TEXT } from "@/lib/domain/ai-interview";
import { log } from "@/lib/log";

// De publieke chat met de AI-interviewer (/i/<slug>). Zelfde regels als /api/t en /api/s: alleen JSON van de eigen
// pagina, een groottegrens, een botfilter en een honeypot, een bezoekerscode (HMAC per gesprek) en de ingest-sleutel
// voor de databasefuncties. De database bewaakt daarnaast de volgorde van de beurten, het maximum aantal antwoorden,
// de maximale duur, één gesprek per bezoeker en de rate limit.

const MAX_BODY = 8_000;
const SLUG = /^[a-f0-9]{14}$/;

type Body = { action?: unknown; token?: unknown; text?: unknown; consent?: unknown; screener?: unknown; website?: unknown; utm_source?: unknown };

function reply(r: ChatResult & { token?: string }) {
  if (!r.ok) {
    if (r.screenedOut) return NextResponse.json({ ok: true, done: true, screenedOut: true, title: SCREENED_OUT_TEXT.title, message: SCREENED_OUT_TEXT.text });
    return NextResponse.json({ ok: false, message: r.message }, { status: r.status });
  }
  return NextResponse.json(r);
}

export async function POST(request: Request, ctx: RouteContext<"/api/i/[slug]">) {
  const { slug } = await ctx.params;
  if (!SLUG.test(slug)) return NextResponse.json({ ok: false }, { status: 404 });
  if (!trackingConfigured()) return NextResponse.json({ ok: false, message: "Dit gesprek is nu niet beschikbaar." }, { status: 503 });
  if (!isSameOriginJson(request)) return NextResponse.json({ ok: false }, { status: 403 });
  const raw = await request.text();
  if (raw.length > MAX_BODY) return NextResponse.json({ ok: false, message: "Je bericht is te lang." }, { status: 413 });
  let b: Body;
  try {
    b = JSON.parse(raw) as Body;
  } catch {
    return NextResponse.json({ ok: false, message: "Je bericht kon niet worden gelezen." }, { status: 400 });
  }
  if (!b || typeof b !== "object") return NextResponse.json({ ok: false, message: "Je bericht kon niet worden gelezen." }, { status: 400 });
  const visitor = await visitorFromRequest(`ai:${slug}`);
  // Bots en de honeypot krijgen een neutraal antwoord; er wordt niets opgeslagen en geen model aangeroepen.
  if (visitor.bot || (typeof b.website === "string" && b.website.trim())) return NextResponse.json({ ok: true, done: true, messages: [] });

  try {
    if (b.action === "start") {
      return reply(
        await startConversation({
          slug,
          visitor: visitor.hash,
          bucket: visitor.bucket,
          channel: channelFrom(typeof b.utm_source === "string" ? b.utm_source : null),
          consent: b.consent === true,
          screener: b.screener && typeof b.screener === "object" ? (b.screener as Record<string, unknown>) : {},
        }),
      );
    }
    if (!isSessionToken(b.token)) return NextResponse.json({ ok: false, message: "Dit gesprek is niet gevonden." }, { status: 404 });
    if (b.action === "message") return reply(await answerConversation({ token: b.token, text: b.text, bucket: visitor.bucket }));
    if (b.action === "end") return reply(await endConversation(b.token));
    if (b.action === "resume") return reply(await resumeConversation(b.token));
    return NextResponse.json({ ok: false, message: "Onbekende actie." }, { status: 400 });
  } catch (e) {
    await log.error("ai_interview_route_failed", { action: typeof b.action === "string" ? b.action : null }, e);
    return NextResponse.json({ ok: false, message: "Er ging iets mis. Probeer het opnieuw." }, { status: 500 });
  }
}
