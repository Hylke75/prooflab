"use server";

import { revalidatePath } from "next/cache";
import { supabaseServer } from "@/lib/supabase/server";
import { requireWritableIdea } from "@/lib/data";
import { asMethodVersion, CURRENT_METHOD } from "@/lib/domain/method";
import { methodPreview, previewForAudit } from "@/lib/method-preview";
import type { FormState } from "@/components/ui/ActionForm";
import type { Json } from "@/lib/database.types";

// Overstappen naar de nieuwste methodeversie na bevestiging. Het overzicht wordt op de server opnieuw berekend en met
// de overstap in het auditspoor bewaard. Goedgekeurde Learning Cards blijven ongewijzigd.
export async function switchMethod(ideaId: string, _: FormState, form: FormData): Promise<FormState> {
  const { idea } = await requireWritableIdea(ideaId);
  if (form.get("confirm") !== "on") return { error: "Bevestig dat je het overzicht hebt bekeken." };
  const from = asMethodVersion(idea.method_version);
  if (from === CURRENT_METHOD) return { error: null, ok: `Dit dossier rekent al met methode ${CURRENT_METHOD}.` };
  const preview = await methodPreview(ideaId, from, CURRENT_METHOD);
  const supabase = await supabaseServer();
  const { error } = await supabase.rpc("switch_method_version", { p_idea: ideaId, p_to: CURRENT_METHOD, p_preview: previewForAudit(preview) as unknown as Json });
  if (error) return { error: "De overstap kon niet worden bewaard. Probeer het opnieuw." };
  revalidatePath(`/app/ideas/${ideaId}`, "layout");
  return {
    error: null,
    ok: `Dit dossier rekent nu met methode ${CURRENT_METHOD}. Bestaande rapportversies en goedgekeurde Learning Cards blijven zoals ze waren; maak een nieuwe rapportversie om de nieuwe uitkomsten vast te leggen.`,
  };
}
