import { NextResponse } from "next/server";
import { z } from "zod";
import { supabaseAnon } from "@/lib/supabase/server";
import { env, trackingConfigured } from "@/lib/env";
import { consentText, isSameOriginJson, variantFor, visitorFromRequest } from "@/lib/public-test";
import { channelFrom } from "@/lib/domain/tracking";

const Body = z.object({
  event: z.enum(["view", "cta_click", "submit"]),
  utm_source: z.string().max(40).optional(),
  email: z.string().trim().email().max(254).optional().or(z.literal("")),
  consent: z.boolean().optional(),
  website: z.string().max(0).optional(), // honeypot: real people leave it empty
});

// Cookieless event ingest for public test pages. The visitor code and price variant are computed here on
// the server; the client cannot choose them. The database counts a click only after a view and a
// submission only after a click, and limits each network to 30 actions per minute per page.
export async function POST(request: Request, ctx: RouteContext<"/api/t/[slug]">) {
  const { slug } = await ctx.params;
  if (!/^[a-f0-9]{14}$/.test(slug)) return NextResponse.json({ ok: false }, { status: 404 });
  if (!trackingConfigured()) return NextResponse.json({ ok: false, reason: "not_configured" }, { status: 503 });
  if (!isSameOriginJson(request)) return NextResponse.json({ ok: false }, { status: 403 });
  const raw = await request.text();
  if (raw.length > 4000) return NextResponse.json({ ok: false }, { status: 413 });
  let json: unknown = null;
  try {
    json = JSON.parse(raw);
  } catch {}
  const parsed = Body.safeParse(json);
  if (!parsed.success) return NextResponse.json({ ok: false }, { status: 400 });
  const b = parsed.data;
  const visitor = await visitorFromRequest(slug);
  if (visitor.bot) return NextResponse.json({ ok: true, counted: false });

  const supabase = supabaseAnon();
  const { data: test } = await supabase.rpc("get_public_test", { p_slug: slug });
  if (!test) return NextResponse.json({ ok: false }, { status: 404 });
  const t = test as { type: string; config: { price_points?: unknown[]; researcher?: string } };
  const variant = String(t.type === "pricing" ? variantFor(visitor.hash, t.config.price_points?.length ?? 1) : 0);
  const channel = channelFrom(b.utm_source);

  if (b.event === "submit") {
    const email = b.email ? b.email : null;
    if (email && !b.consent) return NextResponse.json({ ok: false, reason: "consent" }, { status: 400 });
    const { data, error } = await supabase.rpc("submit_test_form", {
      p_key: env.ingestSecret,
      p_slug: slug,
      p_visitor: visitor.hash,
      p_variant: variant,
      p_channel: channel,
      p_email: email,
      p_answers: {},
      p_consent: !!b.consent,
      p_consent_text: consentText(t.config.researcher ?? "de onderzoeker"),
      p_rate_bucket: visitor.bucket,
    });
    if (error) return NextResponse.json({ ok: false }, { status: 400 });
    return NextResponse.json({ ok: true, counted: data });
  }
  const { data, error } = await supabase.rpc("record_test_event", {
    p_key: env.ingestSecret,
    p_slug: slug,
    p_visitor: visitor.hash,
    p_event: b.event,
    p_variant: variant,
    p_channel: channel,
    p_rate_bucket: visitor.bucket,
  });
  if (error) return NextResponse.json({ ok: false }, { status: 400 });
  return NextResponse.json({ ok: true, counted: data });
}
