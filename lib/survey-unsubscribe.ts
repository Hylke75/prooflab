import "server-only";
import { supabaseAnon } from "@/lib/supabase/server";
import { env, trackingConfigured } from "@/lib/env";
import { isEmailHash, isToken } from "@/lib/domain/survey-distribution";
import { tokenHash } from "@/lib/domain/survey-tokens";

export type UnsubscribeOutcome = "ok" | "invalid" | "unavailable";

// Unsubscribe link: /s/afmelden?u=<token>&e=<HMAC(TRACKING_SALT, e-mail)>.
// Neither the anonymous visitor nor this server can read the invitation's address, so the suppression hash is
// computed when the mail is sent and travels in the link. The token proves which invitation is stopped; the hash
// puts the address on the organisation's do-not-mail list. Forging `e` gains nothing: without TRACKING_SALT nobody
// can compute the hash of another real address, and an unknown hash suppresses nobody.
export async function unsubscribe(token: unknown, e: unknown): Promise<UnsubscribeOutcome> {
  if (!isToken(token) || !isEmailHash(e)) return "invalid";
  if (!trackingConfigured()) return "unavailable";
  const { data, error } = await supabaseAnon().rpc("unsubscribe_invitation", {
    p_key: env.ingestSecret,
    p_token_hash: tokenHash(token),
    p_email_hash: e,
  });
  if (error) return "unavailable";
  return data ? "ok" : "invalid";
}
