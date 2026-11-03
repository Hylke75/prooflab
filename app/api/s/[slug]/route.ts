import { NextResponse } from "next/server";
import { supabaseAnon } from "@/lib/supabase/server";
import { env, trackingConfigured } from "@/lib/env";
import { isSameOriginJson, visitorFromRequest } from "@/lib/public-test";
import { channelFrom } from "@/lib/domain/tracking";
import { assessResponse, SurveyConfigSchema, validateAnswers, type Answers, type Quality } from "@/lib/domain/survey";
import { isSlug, parseSubmitBody, SCREENED_OUT, submitMessage } from "@/lib/domain/survey-distribution";
import { tokenHash } from "@/lib/domain/survey-tokens";

// Survey answers from the public page. Same rules as /api/t: same-origin JSON only, size limit, bot filter and
// honeypot, a server-side visitor code (HMAC per survey) and the ingest secret for the RPC. Answers are validated
// against the stored, locked survey; the database enforces one response per visitor and per invitation.
// Believability (screening, duration, attention check, straightlining) is decided here with assessResponse() and
// stored with the response, so the database counts with exactly the same rule.
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
  // The complete survey (with the qualifying screening answers and attention checks), for the server only.
  const { data: raw, error: cfgError } = await supabase.rpc("get_survey_config", { p_key: env.ingestSecret, p_slug: slug });
  if (cfgError) return NextResponse.json({ ok: false, message: "Er ging iets mis bij het opslaan. Probeer het opnieuw." }, { status: 500 });
  if (!raw) return NextResponse.json({ ok: false, message: "Deze enquête bestaat niet (meer)." }, { status: 404 });
  const config = SurveyConfigSchema.safeParse(raw);
  if (!config.success) return NextResponse.json({ ok: false, message: "Deze enquête is niet beschikbaar." }, { status: 409 });
  const c = config.data;

  let answers: Answers;
  let assessed: { qualified: boolean; quality: Quality };
  if (b.stage === "screen") {
    // First step of a survey with a screening question: only that question is checked.
    const sq = c.questions.find((q) => q.id === c.screening?.question);
    if (!sq || !c.screening) return NextResponse.json({ ok: false, message: "Je antwoorden konden niet worden gelezen." }, { status: 400 });
    const checked = validateAnswers({ questions: [sq], screening: c.screening }, { [sq.id]: b.answers[sq.id] });
    if (!checked.ok) return NextResponse.json({ ok: false, done: false, message: checked.error }, { status: 400 });
    // Inside the target group: continue with the other questions; nothing is stored yet.
    if (!checked.screenedOut) return NextResponse.json({ ok: true, done: false, qualified: true });
    answers = checked.answers;
    assessed = { qualified: false, quality: "ok" };
  } else {
    const checked = validateAnswers(c, b.answers);
    if (!checked.ok) return NextResponse.json({ ok: false, done: false, message: checked.error }, { status: 400 });
    answers = checked.answers;
    assessed = assessResponse(c, answers, b.duration_ms ?? 0);
  }

  const { data, error } = await supabase.rpc("submit_survey", {
    p_key: env.ingestSecret,
    p_slug: slug,
    p_visitor: visitor.hash,
    // Invitations are recorded as channel "email" by the database; open links by their utm_source.
    p_channel: b.token ? "" : channelFrom(b.utm_source),
    p_answers: answers,
    p_consent: b.consent,
    p_duration_ms: b.duration_ms ?? 0,
    p_token_hash,
    p_rate_bucket: visitor.bucket,
    p_qualified: assessed.qualified,
    p_quality: assessed.quality,
  });
  if (error) return NextResponse.json({ ok: false, message: "Er ging iets mis bij het opslaan. Probeer het opnieuw." }, { status: 500 });
  const result = String(data);
  const outcome = submitMessage(result, !!b.token);
  const screenedOut = result === "ok" && !assessed.qualified;
  return NextResponse.json(
    { ok: result === "ok", done: outcome.done, result, screenedOut, message: screenedOut ? SCREENED_OUT.text : outcome.message },
    { status: result === "rate" ? 429 : 200 },
  );
}
