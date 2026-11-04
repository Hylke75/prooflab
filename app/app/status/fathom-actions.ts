"use server";

import { revalidatePath } from "next/cache";
import { getWorkspace } from "@/lib/data";
import { supabaseServer } from "@/lib/supabase/server";
import type { FormState } from "@/components/ui/ActionForm";

// Fase 1 · punt 3: de Fathom-API-sleutel van de werkruimte opslaan of verwijderen (alleen eigenaren, via de statuspagina).
// De sleutel gaat via set_fathom_api_key de database in; hij is daarna niet meer te lezen in de app (alleen de laatste
// vier tekens) en komt niet in het auditspoor.
export async function saveFathomKey(_: FormState, form: FormData): Promise<FormState> {
  const ws = await getWorkspace();
  if (!ws.org || ws.org.role !== "owner") return { error: "Alleen eigenaren van de werkruimte stellen Fathom in." };
  const remove = form.get("remove") === "1";
  const key = remove ? null : String(form.get("fathom_api_key") ?? "").trim();
  if (!remove && (!key || key.length < 16 || /\s/.test(key))) return { error: "Plak de API-sleutel uit Fathom (Instellingen → API).", fieldErrors: { fathom_api_key: "Dit lijkt geen Fathom-API-sleutel." } };
  const supabase = await supabaseServer();
  const { error } = await supabase.rpc("set_fathom_api_key", { p_org: ws.org.id, p_key: key });
  if (error) {
    if (/function|schema cache|does not exist/i.test(error.message)) return { error: "Fathom vraagt een database-update (migratie 20261115090000_interviews_import)." };
    return { error: error.message.includes("INVALID_KEY") ? "Dit lijkt geen Fathom-API-sleutel." : "De sleutel kon niet worden opgeslagen." };
  }
  revalidatePath("/app/status");
  return { error: null, ok: remove ? "Fathom-sleutel verwijderd. Importeren via een bestand blijft werken." : "Fathom-sleutel opgeslagen voor deze werkruimte." };
}
