"use server";

import { revalidatePath } from "next/cache";
import { getWorkspace } from "@/lib/data";
import { supabaseServer } from "@/lib/supabase/server";
import type { FormState } from "@/components/ui/ActionForm";

// Switches learned evidence weights on or off for the whole workspace. Every consultant may do this; the
// database stamps who and when, and every new report states which factors it used.
export async function setLearnedWeights(on: boolean, _: FormState): Promise<FormState> {
  const ws = await getWorkspace();
  if (!ws.org) return { error: "Alleen consultants van een werkruimte kunnen dit instellen." };
  const supabase = await supabaseServer();
  const { error } = await supabase.rpc("set_learned_weights", { p_org: ws.org.id, p_on: on });
  if (error) return { error: "De instelling kon niet worden bewaard. Probeer het opnieuw." };
  revalidatePath("/app", "layout");
  return {
    error: null,
    ok: on
      ? "Geleerde factoren staan aan. Kansen per aanname worden vanaf nu met de geleerde factoren berekend; nieuwe rapportversies vermelden dat."
      : "Geleerde factoren staan uit. Alle kansen gebruiken weer de vaste standaardfactoren.",
  };
}
