import "server-only";
import { env } from "@/lib/env";
import { encryptionKey } from "@/lib/domain/secret-box";
import type { FetchLike } from "./mollie";
import type { MollieRpc } from "./mollie-flow";
import { supabaseServer, type supabaseAnon } from "@/lib/supabase/server";

type Client = ReturnType<typeof supabaseAnon>;

// Fase 2 · punt 4: is Mollie in deze omgeving bruikbaar? Alleen met MOLLIE_ENABLED=1 én een geldige
// SECRETS_ENCRYPTION_KEY (32 bytes, base64). Anders toont de app eerlijk "Mollie niet ingesteld" en is de betaalstap
// niet te kiezen.
export function mollieEnvironment(): { ready: boolean; reason: string | null; key: Buffer | null } {
  const key = encryptionKey(env.secretsEncryptionKey);
  if (!env.mollieEnabled) return { ready: false, reason: "Mollie staat in deze omgeving uit (MOLLIE_ENABLED=1 ontbreekt).", key };
  if (!key) return { ready: false, reason: "SECRETS_ENCRYPTION_KEY ontbreekt of is geen 32 bytes (base64); zonder kan ProofLab de sleutel niet veilig bewaren.", key: null };
  if (!env.ingestSecret) return { ready: false, reason: "INGEST_SECRET ontbreekt; zonder kunnen betalingen niet worden vastgelegd.", key };
  return { ready: true, reason: null, key };
}

export type DepositAvailability = { available: boolean; reason: string | null; mode: "test" | "live" | null };

// Kan een nieuwe Test Card in deze werkruimte een betaalstap krijgen? Omgeving klaar én een sleutel van de werkruimte.
export async function depositAvailability(orgId: string | null | undefined): Promise<DepositAvailability> {
  const envState = mollieEnvironment();
  if (!envState.ready) return { available: false, reason: `Mollie niet ingesteld: ${envState.reason}`, mode: null };
  if (!orgId) return { available: false, reason: "Mollie niet ingesteld voor deze werkruimte.", mode: null };
  const supabase = await supabaseServer();
  const { data, error } = await supabase.rpc("payment_settings_status", { p_org: orgId });
  if (error) return { available: false, reason: "Mollie niet ingesteld: de database moet nog worden bijgewerkt (migratie 20261116090000_fase2_testen).", mode: null };
  const row = (data ?? [])[0];
  if (!row?.mollie_connected) return { available: false, reason: "Mollie niet ingesteld: een eigenaar koppelt Mollie op de statuspagina.", mode: null };
  return { available: true, reason: null, mode: row.mollie_mode === "live" ? "live" : "test" };
}

export const realFetch: FetchLike = async (url, init) => {
  const res = await fetch(url, { ...init, cache: "no-store", signal: AbortSignal.timeout(15_000) });
  return { ok: res.ok, status: res.status, json: () => res.json() };
};

// De database-functies met de ingest-sleutel (alleen op de server).
export function mollieRpc(supabase: Client): MollieRpc {
  const k = env.ingestSecret;
  return {
    depositCheckout: async (a) => {
      const { data, error } = await supabase.rpc("deposit_checkout", { p_key: k, p_slug: a.slug, p_visitor: a.visitor, p_person_key: a.personKey, p_rate_bucket: a.rateBucket });
      return { data, error };
    },
    registerPayment: async (a) => {
      const { data, error } = await supabase.rpc("register_test_payment", {
        p_key: k,
        p_slug: a.slug,
        p_person_key: a.personKey,
        p_mollie_id: a.mollieId,
        p_amount: a.amount,
        p_currency: a.currency,
        p_mode: a.mode,
        p_status: a.status,
      });
      return { data, error };
    },
    webhookLookup: async (a) => {
      const { data, error } = await supabase.rpc("mollie_webhook_lookup", { p_key: k, p_slug: a.slug, p_mollie_id: a.mollieId });
      return { data, error };
    },
    recordStatus: async (a) => {
      const { data, error } = await supabase.rpc("record_mollie_status", { p_key: k, p_mollie_id: a.mollieId, p_status: a.status, p_mode: a.mode });
      return { data, error };
    },
  };
}
