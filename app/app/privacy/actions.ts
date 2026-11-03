"use server";

// Data-subject requests (AVG art. 15 inzage, art. 17 verwijdering) for one e-mail address. Owners of the
// workspace only; the database functions check this again (is_org_owner) and only touch rows of this organisation.

import { revalidatePath } from "next/cache";
import { supabaseServer } from "@/lib/supabase/server";
import { getWorkspace } from "@/lib/data";
import { trackingSalts } from "@/lib/env";
import { isEmail, normalizeEmail } from "@/lib/domain/survey-distribution";
import { emailHashes } from "@/lib/domain/survey-tokens";
import type { DsrResult } from "@/lib/domain/privacy";

export type SearchState = { error?: string; result?: DsrResult };
export type EraseState = { error?: string; ok?: string };

async function owner() {
  const ws = await getWorkspace();
  if (!ws.org) throw new Error("Geen werkruimte.");
  if (ws.org.role !== "owner") throw new Error("Alleen een eigenaar van de werkruimte kan privacyverzoeken behandelen.");
  return ws.org.id;
}

function subject(raw: unknown): { email: string; hashes: string[] } {
  const email = normalizeEmail(typeof raw === "string" ? raw : "");
  if (!isEmail(email)) throw new Error("Vul één geldig e-mailadres in.");
  // The address under every known salt version: suppressions and invitation hashes from before a rotation.
  return { email, hashes: Object.keys(trackingSalts.all).length ? emailHashes(trackingSalts, email) : [] };
}

export async function searchSubject(raw: unknown): Promise<SearchState> {
  try {
    const org = await owner();
    const { email, hashes } = subject(raw);
    const supabase = await supabaseServer();
    const { data, error } = await supabase.rpc("dsr_search", { p_org: org, p_email: email, p_hashes: hashes });
    if (error) return { error: "Zoeken is mislukt. Probeer het opnieuw." };
    return { result: data as unknown as DsrResult };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Er ging iets mis." };
  }
}

export async function eraseSubject(raw: unknown, opts: { suppress: unknown; confirm: unknown }): Promise<EraseState> {
  try {
    const org = await owner();
    const { email, hashes } = subject(raw);
    if (typeof opts.confirm !== "string" || normalizeEmail(opts.confirm) !== email) return { error: "Typ het e-mailadres nog een keer om de verwijdering te bevestigen." };
    const suppress = opts.suppress === true;
    if (suppress && hashes.length === 0) return { error: "Op de afmeldlijst zetten kan niet: TRACKING_SALT(S) ontbreekt." };
    const supabase = await supabaseServer();
    const { data, error } = await supabase.rpc("dsr_erase", { p_org: org, p_email: email, p_hashes: hashes, p_suppress: suppress });
    if (error) return { error: "Verwijderen is mislukt. Er is niets gewijzigd." };
    const r = data as { invitations: number; responses: number; submissions: number; suppressed: boolean };
    revalidatePath("/app", "layout");
    return {
      ok: `Verwijderd: ${r.invitations} uitnodiging(en) geanonimiseerd, ${r.responses} enquêteantwoord(en) verwijderd, ${r.submissions} aanmelding(en) van testpagina's leeggemaakt.${suppress ? (r.suppressed ? " Het adres staat nu op de afmeldlijst." : " Het adres stond al op de afmeldlijst.") : ""} Vastgelegd in de audittrail (zonder het adres).`,
    };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Er ging iets mis." };
  }
}
