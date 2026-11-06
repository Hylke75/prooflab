"use server";

// Fase 2 · punt 4: aanbetalingen terugbetalen en de status opnieuw ophalen bij Mollie. Alleen voor wie het dossier mag
// bewerken (requireWritableIdea en mollie_key_for_idea). De status komt altijd van Mollie zelf; niemand kan hem hier
// met de hand zetten.

import { revalidatePath } from "next/cache";
import { requireWritableIdea } from "@/lib/data";
import { supabaseServer } from "@/lib/supabase/server";
import { decryptSecret } from "@/lib/domain/secret-box";
import { mollieClient } from "@/lib/integrations/mollie";
import { refundPayment, syncPayment } from "@/lib/integrations/mollie-flow";
import { mollieEnvironment, mollieRpc, realFetch } from "@/lib/integrations/mollie-server";
import type { FormState } from "@/components/ui/ActionForm";

const isUuid = (s: string) => /^[0-9a-f-]{36}$/i.test(s);

async function setup(ideaId: string, expId: string) {
  await requireWritableIdea(ideaId);
  if (!isUuid(expId)) throw new Error("Experiment niet gevonden.");
  const env = mollieEnvironment();
  if (!env.ready || !env.key) throw new Error(`Mollie niet ingesteld: ${env.reason ?? ""}`.trim());
  const supabase = await supabaseServer();
  const { data: keys, error } = await supabase.rpc("mollie_key_for_idea", { p_idea: ideaId });
  const apiKey = !error && keys?.[0] ? decryptSecret(keys[0].cipher, env.key) : null;
  if (!apiKey) throw new Error("De Mollie-sleutel van de werkruimte ontbreekt of kan niet worden gelezen. Een eigenaar stelt hem in op de statuspagina.");
  return { supabase, client: mollieClient({ apiKey, fetch: realFetch }), rpc: mollieRpc(supabase) };
}

const done = (ideaId: string, expId: string) => revalidatePath(`/app/ideas/${ideaId}/experiments/${expId}`);

export async function refundDeposit(ideaId: string, expId: string, paymentId: string, _: FormState): Promise<FormState> {
  try {
    const { supabase, client, rpc } = await setup(ideaId, expId);
    const { data: p } = await supabase.from("test_payments").select("id, mollie_id, amount, status").eq("id", paymentId).eq("experiment_id", expId).maybeSingle();
    if (!p) return { error: "Betaling niet gevonden." };
    await supabase.rpc("mark_refund_requested", { p_payment: p.id });
    const r = await refundPayment({ rpc, client, payment: { mollie_id: p.mollie_id, amount: Number(p.amount), status: p.status } });
    done(ideaId, expId);
    return r.ok ? { error: null, ok: r.message } : { error: r.message };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Terugbetalen is mislukt." };
  }
}

export async function refundAllDeposits(ideaId: string, expId: string, _: FormState): Promise<FormState> {
  try {
    const { supabase, client, rpc } = await setup(ideaId, expId);
    const { data: rows } = await supabase.from("test_payments").select("id, mollie_id, amount, status").eq("experiment_id", expId).eq("status", "paid").limit(500);
    let ok = 0;
    const failed: string[] = [];
    for (const p of rows ?? []) {
      await supabase.rpc("mark_refund_requested", { p_payment: p.id });
      const r = await refundPayment({ rpc, client, payment: { mollie_id: p.mollie_id, amount: Number(p.amount), status: p.status } });
      if (r.ok) ok++;
      else failed.push(`${p.mollie_id}: ${r.message}`);
    }
    done(ideaId, expId);
    if (!rows?.length) return { error: null, ok: "Er zijn geen betaalde aanbetalingen om terug te betalen." };
    return failed.length
      ? { error: `${ok} terugbetaald of aangevraagd; ${failed.length} mislukt: ${failed.slice(0, 3).join("; ")}` }
      : { error: null, ok: `${ok} ${ok === 1 ? "aanbetaling" : "aanbetalingen"} terugbetaald of aangevraagd bij Mollie.` };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Terugbetalen is mislukt." };
  }
}

// Handig zonder webhook (lokaal) of als Mollie een melding miste: alle niet-afgeronde betalingen opnieuw ophalen.
export async function refreshDeposits(ideaId: string, expId: string, _: FormState): Promise<FormState> {
  try {
    const { supabase, client, rpc } = await setup(ideaId, expId);
    const { data: rows } = await supabase.from("test_payments").select("mollie_id").eq("experiment_id", expId).not("status", "in", "(refunded,charged_back)").limit(500);
    let changed = 0;
    for (const p of rows ?? []) if ((await syncPayment({ rpc, client, id: p.mollie_id })) === "ok") changed++;
    done(ideaId, expId);
    return { error: null, ok: `${rows?.length ?? 0} ${rows?.length === 1 ? "betaling" : "betalingen"} gecontroleerd bij Mollie; ${changed} bijgewerkt.` };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Verversen is mislukt." };
  }
}
