"use server";

import { revalidatePath } from "next/cache";
import { getWorkspace } from "@/lib/data";
import { supabaseServer } from "@/lib/supabase/server";
import { encryptSecret } from "@/lib/domain/secret-box";
import { mollieKeyMode } from "@/lib/integrations/mollie";
import { mollieEnvironment } from "@/lib/integrations/mollie-server";
import { schemaMissing } from "@/lib/action-counts-data";
import type { FormState } from "@/components/ui/ActionForm";

// Fase 2 · punt 4: de Mollie-API-sleutel van de werkruimte opslaan of verwijderen (alleen eigenaren). De app versleutelt
// de sleutel (AES-256-GCM met SECRETS_ENCRYPTION_KEY) vóór hij de database in gaat; daarna is hij nergens meer te lezen,
// alleen de modus (test of live) en de laatste vier tekens.
export async function saveMollieKey(_: FormState, form: FormData): Promise<FormState> {
  const ws = await getWorkspace();
  if (!ws.org || ws.org.role !== "owner") return { error: "Alleen eigenaren van de werkruimte stellen Mollie in." };
  const remove = form.get("remove") === "1";
  const supabase = await supabaseServer();
  if (remove) {
    const { error } = await supabase.rpc("set_mollie_key", { p_org: ws.org.id, p_cipher: null, p_mode: null, p_hint: null });
    if (error) return { error: schemaMissing(error) ? "Mollie vraagt een database-update (migratie 20261116090000_fase2_testen)." : "De sleutel kon niet worden verwijderd." };
    revalidatePath("/app/status");
    return { error: null, ok: "Mollie-sleutel verwijderd. Nieuwe betalingen zijn niet meer mogelijk; terugbetalen vraagt de sleutel opnieuw." };
  }
  const env = mollieEnvironment();
  if (!env.key) return { error: "SECRETS_ENCRYPTION_KEY ontbreekt of is ongeldig: zonder kan ProofLab de sleutel niet veilig bewaren. Zie docs/OPERATIONS.md." };
  const key = String(form.get("mollie_api_key") ?? "").trim();
  const mode = mollieKeyMode(key);
  if (!mode) return { error: "Plak de API-sleutel uit Mollie (Dashboard → Developers → API-keys).", fieldErrors: { mollie_api_key: "Een Mollie-sleutel begint met test_ of live_." } };
  const { error } = await supabase.rpc("set_mollie_key", { p_org: ws.org.id, p_cipher: encryptSecret(key, env.key), p_mode: mode, p_hint: key.slice(-4) });
  if (error) {
    if (schemaMissing(error)) return { error: "Mollie vraagt een database-update (migratie 20261116090000_fase2_testen)." };
    return { error: error.message.includes("FORBIDDEN") ? "Alleen eigenaren van de werkruimte stellen Mollie in." : "De sleutel kon niet worden opgeslagen." };
  }
  revalidatePath("/app/status");
  return {
    error: null,
    ok: mode === "test" ? "Mollie-testsleutel opgeslagen. Testbetalingen tellen niet als bewijs." : "Mollie-livesleutel opgeslagen. Echte aanbetalingen tellen als Geverifieerde betaling.",
  };
}
