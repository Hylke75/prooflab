"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { supabaseServer } from "@/lib/supabase/server";
import { requireWritableIdea } from "@/lib/data";
import { ruleProblem } from "@/lib/domain/decision-rule";
import { parseDutchNumber } from "@/lib/forecast-schemas";
import type { Json } from "@/lib/database.types";

export type ActionState = { error: string | null; ok?: string | null };

const LOCKED = "De beslisregel ligt vast sinds de eerste goedgekeurde test. Zo kan niemand de regel achteraf op de uitkomsten afstemmen.";

// Golf B, punt 6: de beslisregel vastleggen of aanpassen zolang er nog geen test is goedgekeurd. Formulier: per aanname
// een vinkje cond_<id> met een minimale kans min_<id> (in procenten), een hoofdtest en een toelichting. De database legt
// regel en voorwaarden in één keer vast (save_decision_rule) en bewaakt de vergrendeling.
export async function saveDecisionRule(ideaId: string, _: ActionState, form: FormData): Promise<ActionState> {
  await requireWritableIdea(ideaId);
  const supabase = await supabaseServer();
  const { data: assumptions } = await supabase.from("assumptions").select("id").eq("idea_id", ideaId);
  const conditions: { assumption_id: string; min_probability: number }[] = [];
  for (const a of assumptions ?? []) {
    if (form.get(`cond_${a.id}`) !== "on") continue;
    const pct = parseDutchNumber(String(form.get(`min_${a.id}`) ?? "").replace("%", "").trim());
    if (pct == null || !Number.isFinite(pct)) return { error: "Vul bij elke gekozen aanname een minimale kans in procenten in." };
    conditions.push({ assumption_id: a.id, min_probability: Math.round(pct) / 100 });
  }
  const primary = z.string().uuid().safeParse(form.get("primary_experiment_id"));
  const primaryId = primary.success ? primary.data : null;
  const note = String(form.get("note") ?? "").trim().slice(0, 600);
  const problem = ruleProblem({ conditions: conditions.map((c) => ({ minProbability: c.min_probability })), primaryExperimentId: primaryId });
  if (problem) return { error: problem };

  const { data, error } = await supabase.rpc("save_decision_rule", { p_idea: ideaId, p_primary: primaryId, p_note: note, p_conditions: conditions as unknown as Json });
  if (error) {
    if (error.message.includes("DECISION_RULE_LOCKED")) return { error: LOCKED };
    if (error.message.includes("IDEA_MISMATCH")) return { error: "Kies aannames en een hoofdtest van dit dossier." };
    return { error: "De beslisregel kon niet worden opgeslagen. Werk zo nodig het databaseschema bij." };
  }
  revalidatePath(`/app/ideas/${ideaId}`, "layout");
  if (data === "locked_late") return { error: null, ok: "Beslisregel vastgelegd. Er was al een test goedgekeurd: de regel ligt meteen vast en staat als 'achteraf vastgelegd' in het rapport." };
  return { error: null, ok: "Beslisregel vastgelegd. Hij ligt vast zodra de eerste test is goedgekeurd." };
}
