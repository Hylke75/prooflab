import { NextResponse } from "next/server";
import { supabaseAnon } from "@/lib/supabase/server";
import { env, trackingConfigured } from "@/lib/env";
import { log } from "@/lib/log";
import { personKey } from "@/lib/domain/action-counts";
import { handleBookingWebhook } from "@/lib/integrations/bookings";

const MAX_BYTES = 64 * 1024;

// Fase 2 · punt 4: webhook voor geboekte afspraken (Calendly of Cal.com). Server-naar-server: geen same-origin. Eerst de
// handtekening (met de sleutel die bij deze code hoort) en het tijdsvenster; pas daarna de database. Een vervalste of
// oude melding → 401 en telt niets. Het e-mailadres van de booker wordt alleen een persoonssleutel.
export async function POST(request: Request, ctx: RouteContext<"/api/webhooks/bookings/[provider]/[token]">) {
  const { provider, token } = await ctx.params;
  if (Number(request.headers.get("content-length") ?? "0") > MAX_BYTES) return NextResponse.json({ ok: false }, { status: 413 });
  const raw = await request.text();
  if (raw.length > MAX_BYTES) return NextResponse.json({ ok: false }, { status: 413 });
  if (!trackingConfigured()) return NextResponse.json({ ok: false, reason: "not_configured" }, { status: 503 });
  const supabase = supabaseAnon();
  const out = await handleBookingWebhook({
    provider,
    token,
    headers: (n) => request.headers.get(n),
    rawBody: raw,
    salt: env.trackingSalt,
    nowMs: Date.now(),
    personKey: (email) => personKey(env.trackingSalt, email),
    record: async (a) => {
      const { data, error } = await supabase.rpc("record_test_booking", {
        p_key: env.ingestSecret,
        p_token_hash: a.tokenHash,
        p_provider: a.provider,
        p_external_id: a.externalId,
        p_person_key: a.personKey,
        p_status: a.status,
        p_booked_at: a.bookedAt,
        p_scheduled_for: a.scheduledFor,
      });
      return { data, error };
    },
  });
  if (out.status !== 200 || !["ok", "duplicate", "ignored"].includes(out.result)) {
    // Alleen de reden en status; nooit de code, de body of het e-mailadres.
    await log.warn("webhook_rejected", { source: `booking:${provider === "calendly" || provider === "calcom" ? provider : "unknown"}`, reason: out.result, status: out.status });
  }
  return NextResponse.json({ ok: out.status === 200, result: out.result }, { status: out.status });
}
