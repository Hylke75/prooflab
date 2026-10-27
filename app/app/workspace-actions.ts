"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { supabaseServer } from "@/lib/supabase/server";
import { requireUser } from "@/lib/data";

export type SimpleState = { error: string | null };

export async function createWorkspace(_: SimpleState, form: FormData): Promise<SimpleState> {
  await requireUser();
  const name = z.string().trim().min(2).max(120).safeParse(form.get("name"));
  if (!name.success) return { error: "Geef je werkruimte een naam van minimaal 2 tekens." };
  const supabase = await supabaseServer();
  const { error } = await supabase.rpc("create_organization", { p_name: name.data });
  if (error) return { error: "De werkruimte kon niet worden aangemaakt." };
  revalidatePath("/app", "layout");
  return { error: null };
}
