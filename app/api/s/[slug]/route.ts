import { NextResponse } from "next/server";
import { supabaseAnon } from "@/lib/supabase/server";
import { env, trackingConfigured } from "@/lib/env";
import { isSameOriginJson, visitorFromRequest } from "@/lib/public-test";
import { channelFrom, contentFrom } from "@/lib/domain/tracking";
import { SurveyConfigSchema, validateAnswers } from "@/lib/domain/survey";
import { isSlug, parseSubmitBody, submitMessage } from "@/lib/domain/survey-distribution";
import { tokenHash } from "@/lib/domain/survey-tokens";

// Survey answers from the public page. Same rules as /api/t: same-origin JSON only, size limit, bot filter and
// honeypot, a server-side visitor code (HMAC per survey) and the ingest secret for the RPC. Answers are validated
// against the stored, locked survey; the database enforces one response per visitor and per invitation.
export async function POST(request: Request, ctx: RouteContext<"/api/s/[slug]">) {
  const { slug } = await ctx.params;
  if (!isSlug(slug)) return NextResponse.json({ ok: false }, { status: 404 });
  if (!trackingConfigured()) return NextResponse.json({ ok: false, message: "Deze enquête kan nog geen antwoorden ontvangen." }, { status: 503 });
  if (!isSameOriginJson(request)) return NextResponse.json({ ok: false }, { status: 403 });
  const parsed = parseSubmitBody(await request.text());
  if (!parsed.ok) {
    return NextResponse.json(
      { ok: false, message: parsed.status === 413 ? "Je antwoorden zijn te lang. Maak de open antwoorden korter." : "Je antwoorden konden niet worden gelezen." },
      { status: parsed.status },
    );
  }
  const b = parsed.body;
  const visitor = await visitorFromRequest(slug);
  // Bots and the honeypot get a neutral answer and nothing is stored.
  if (visitor.bot || b.website) return NextResponse.json({ ok: true, done: true, result: "ok", counted: false });

  const supabase = supabaseAnon();
  const p_token_hash = b.token ? tokenHash(b.token) : null;
  const { data: survey } = await supabase.rpc("get_public_survey", { p_slug: slug, p_token_hash });
  if (!survey) return NextResponse.json({ ok: false, message: "Deze enquête bestaat niet (meer)." }, { status: 404 });
  const config = SurveyConfigSchema.safeParse((survey as { config?: unknown }).config);
  if (!config.success) return NextResponse.json({ ok: false, message: "Deze enquête is niet beschikbaar." }, { status: 409 });
  const checked = validateAnswers(config.data, b.answers);
  if (!checked.ok) return NextResponse.json({ ok: false, done: false, message: checked.error }, { status: 400 });

  const { data, error } = await supabase.rpc("submit_survey", {
    p_key: env.ingestSecret,
    p_slug: slug,
    p_visitor: visitor.hash,
    // Invitations are recorded as channel "email" by the database; open links by their utm_source.
    p_channel: b.token ? "" : channelFrom(b.utm_source),
    p_answers: checked.answers,
    p_consent: b.consent,
    p_duration_ms: b.duration_ms ?? 0,
    p_token_hash,
    p_rate_bucket: visitor.bucket,
    // The post code of an open link (utm_content); invitations have none.
    p_content: b.token ? null : contentFrom(b.utm_content),
  });
  if (error) return NextResponse.json({ ok: false, message: "Er ging iets mis bij het opslaan. Probeer het opnieuw." }, { status: 500 });
  const result = String(data);
  const outcome = submitMessage(result, !!b.token);
  return NextResponse.json({ ok: result === "ok", done: outcome.done, result, message: outcome.message }, { status: result === "rate" ? 429 : 200 });
}
