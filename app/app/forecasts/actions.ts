"use server";

import { revalidatePath } from "next/cache";
import { getWorkspace } from "@/lib/data";
import { supabaseServer } from "@/lib/supabase/server";
import type { FormState } from "@/components/ui/ActionForm";

// Switches learned evidence weights on or off for the whole workspace. Every consultant may do this; the
// database stamps who and when, and every new report states which factors it used.
// Plafonds per bewijsniveau (methode 2026-11-b) voor de hele werkruimte. Alleen eigenaren; de database
// controleert dat ook (rijbeveiliging) en legt elke wijziging vast in het auditspoor.
const CAP_KEYS = ["opinion", "problem", "small_action", "quote", "deposit"] as const;

export async function setEvidenceCaps(_: FormState, form: FormData): Promise<FormState> {
  const ws = await getWorkspace();
  if (!ws.org || ws.org.role !== "owner") return { error: "Alleen de eigenaar van de werkruimte kan de plafonds wijzigen." };
  const supabase = await supabaseServer();
  if (form.get("reset") === "1") {
    const { error } = await supabase.from("org_evidence_caps").delete().eq("org_id", ws.org.id);
    if (error) return { error: "De standaardwaarden konden niet worden teruggezet." };
    revalidatePath("/app", "layout");
    return { error: null, ok: "De standaardplafonds gelden weer." };
  }
  const values: Record<(typeof CAP_KEYS)[number], number> = { opinion: 0, problem: 0, small_action: 0, quote: 0, deposit: 0 };
  for (const k of CAP_KEYS) {
    const pctValue = Number(String(form.get(k) ?? "").replace(",", "."));
    if (!Number.isFinite(pctValue) || pctValue < 5 || pctValue > 99) return { error: "Elk plafond ligt tussen 5% en 99%." };
    values[k] = Math.round(pctValue * 10) / 1000;
  }
  for (let i = 1; i < CAP_KEYS.length; i++) {
    if (values[CAP_KEYS[i]] < values[CAP_KEYS[i - 1]]) return { error: "Een hoger bewijsniveau mag geen lager plafond hebben." };
  }
  const { error } = await supabase.from("org_evidence_caps").upsert({ org_id: ws.org.id, ...values });
  if (error) return { error: "De plafonds konden niet worden bewaard. Probeer het opnieuw." };
  revalidatePath("/app", "layout");
  return { error: null, ok: "Plafonds bewaard. Dossiers met methode 2026-11-b rekenen vanaf nu hiermee; nieuwe rapportversies vermelden ze." };
}

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
