import { NextResponse } from "next/server";
import { supabaseAnon } from "@/lib/supabase/server";
import { handleMollieWebhook } from "@/lib/integrations/mollie-flow";
import { mollieEnvironment, mollieRpc, realFetch } from "@/lib/integrations/mollie-server";
import { log } from "@/lib/log";

// Fase 2 · punt 4: Mollie-webhook. Mollie stuurt alleen "id=tr_…" (form-encoded). ProofLab vertrouwt niets uit het
// verzoek: het zoekt de betaling op bij deze test en haalt de status zelf op bij Mollie met de sleutel van die
// werkruimte. Altijd 200 (ook bij een onbekend id), zodat Mollie niet blijft proberen en niemand kan aftasten welke
// betaalnummers bestaan. Alleen bij een tijdelijke fout aan onze kant 503, dan probeert Mollie het later opnieuw.
export async function POST(request: Request, ctx: RouteContext<"/api/webhooks/mollie/[slug]">) {
  const { slug } = await ctx.params;
  const raw = (await request.text()).slice(0, 2000);
  const id = new URLSearchParams(raw).get("id") ?? "";
  const mollie = mollieEnvironment();
  if (!mollie.ready) {
    await log.warn("webhook_rejected", { source: "mollie", reason: "not_configured" });
    return NextResponse.json({ ok: true });
  }
  const outcome = await handleMollieWebhook({ rpc: mollieRpc(supabaseAnon()), fetch: realFetch, encryptionKey: mollie.key, slug, id });
  if (outcome !== "ok" && outcome !== "unchanged") await log.warn("webhook_rejected", { source: "mollie", reason: outcome });
  if (outcome === "error" || outcome === "mollie_error") return NextResponse.json({ ok: false }, { status: 503 });
  return NextResponse.json({ ok: true });
}
