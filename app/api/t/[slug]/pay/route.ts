import { NextResponse } from "next/server";
import { z } from "zod";
import { supabaseAnon } from "@/lib/supabase/server";
import { env, trackingConfigured } from "@/lib/env";
import { isSameOriginJson, visitorFromRequest } from "@/lib/public-test";
import { personKey } from "@/lib/domain/action-counts";
import { startDeposit } from "@/lib/integrations/mollie-flow";
import { mollieEnvironment, mollieRpc, realFetch } from "@/lib/integrations/mollie-server";
import { log } from "@/lib/log";

const Body = z.object({
  email: z.string().trim().email().max(254),
  agree: z.literal(true), // de eerlijke tekst over terugbetalen is gelezen
  website: z.string().max(0).optional(), // honeypot
});

// Fase 2 · punt 4: een terugbetaalbare aanbetaling starten vanaf de publieke testpagina. Alleen same-origin JSON,
// alleen na een klik op de knop (database), en het bedrag komt uit de goedgekeurde configuratie, nooit uit het verzoek.
// Het e-mailadres wordt alleen een persoonssleutel (HMAC) en gaat niet naar Mollie of de database.
export async function POST(request: Request, ctx: RouteContext<"/api/t/[slug]/pay">) {
  const { slug } = await ctx.params;
  if (!/^[a-f0-9]{14}$/.test(slug)) return NextResponse.json({ ok: false }, { status: 404 });
  const mollie = mollieEnvironment();
  if (!trackingConfigured() || !mollie.ready) return NextResponse.json({ ok: false, reason: "not_configured", message: "Betalen is op dit moment niet ingesteld." }, { status: 503 });
  if (!isSameOriginJson(request)) return NextResponse.json({ ok: false }, { status: 403 });
  const raw = await request.text();
  if (raw.length > 2000) return NextResponse.json({ ok: false }, { status: 413 });
  let json: unknown = null;
  try {
    json = JSON.parse(raw);
  } catch {}
  const parsed = Body.safeParse(json);
  if (!parsed.success) return NextResponse.json({ ok: false, message: "Vul een geldig e-mailadres in en bevestig dat je de uitleg hebt gelezen." }, { status: 400 });
  const visitor = await visitorFromRequest(slug);
  if (visitor.bot) return NextResponse.json({ ok: false }, { status: 400 });
  const key = personKey(env.trackingSalt, parsed.data.email);
  if (!key) return NextResponse.json({ ok: false, message: "Vul een geldig e-mailadres in." }, { status: 400 });
  const out = await startDeposit({
    rpc: mollieRpc(supabaseAnon()),
    fetch: realFetch,
    encryptionKey: mollie.key,
    slug,
    visitor: visitor.hash,
    personKey: key,
    rateBucket: visitor.bucket,
    appUrl: env.appUrl,
  });
  if (!out.ok) {
    if (out.reason === "mollie" || out.reason === "error") await log.warn("deposit_failed", { reason: out.reason });
    return NextResponse.json({ ok: false, reason: out.reason, message: out.message }, { status: out.reason === "rate" ? 429 : 400 });
  }
  return NextResponse.json({ ok: true, checkoutUrl: out.checkoutUrl });
}
