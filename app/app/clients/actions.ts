"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { supabaseServer } from "@/lib/supabase/server";
import { getWorkspace, requireWritableIdea } from "@/lib/data";
import { env } from "@/lib/env";

export type ActionState = { error: string | null; ok?: string | null };

const ClientSchema = z.object({
  name: z.string().trim().min(1, "Vul een naam in.").max(160),
  sector: z.enum(["generic", "smb", "events", "media_culture"]),
  contact_name: z.string().trim().max(160).optional(),
  contact_email: z.string().trim().email("Ongeldig e-mailadres.").max(254).optional().or(z.literal("")),
  notes: z.string().trim().max(1000).optional(),
});

export async function addClient(_: ActionState, form: FormData): Promise<ActionState> {
  const ws = await getWorkspace();
  if (!ws.org) return { error: "Geen werkruimte." };
  const p = ClientSchema.safeParse(Object.fromEntries(form));
  if (!p.success) return { error: p.error.issues[0].message };
  const supabase = await supabaseServer();
  const { error } = await supabase.from("clients").insert({
    org_id: ws.org.id,
    name: p.data.name,
    sector: p.data.sector,
    contact_name: p.data.contact_name || null,
    contact_email: p.data.contact_email || null,
    notes: p.data.notes || null,
  });
  if (error) return { error: "Opslaan mislukt." };
  revalidatePath("/app/clients");
  return { error: null, ok: "Klant toegevoegd." };
}

const InviteSchema = z.object({
  email: z.string().trim().toLowerCase().email("Vul een geldig e-mailadres in."),
  role: z.enum(["client_decider", "client_viewer"]),
});

// Invites a client stakeholder to one idea. They sign in with this e-mail address; the
// invitation is linked to their account on first login (claim_invitations).
export async function inviteStakeholder(ideaId: string, _: ActionState, form: FormData): Promise<ActionState> {
  await requireWritableIdea(ideaId);
  const p = InviteSchema.safeParse(Object.fromEntries(form));
  if (!p.success) return { error: p.error.issues[0].message };
  const supabase = await supabaseServer();
  const { error } = await supabase.from("idea_members").upsert({ idea_id: ideaId, email: p.data.email, role: p.data.role });
  if (error) return { error: "Uitnodigen mislukt." };
  let mail = "";
  if (form.get("send_link") === "on") {
    const { error: otp } = await supabase.auth.signInWithOtp({
      email: p.data.email,
      options: { emailRedirectTo: `${env.appUrl}/auth/callback?next=/app/ideas/${ideaId}/report` },
    });
    mail = otp ? " De inloglink kon niet worden verstuurd; deel de app-link zelf." : " Er is een inloglink verstuurd.";
  }
  revalidatePath("/app/clients");
  return { error: null, ok: `${p.data.email} kan meekijken${p.data.role === "client_decider" ? " en besluiten bevestigen" : ""}.${mail}` };
}

export async function removeStakeholder(ideaId: string, email: string) {
  await requireWritableIdea(ideaId);
  const supabase = await supabaseServer();
  await supabase.from("idea_members").delete().eq("idea_id", ideaId).eq("email", email);
  revalidatePath("/app/clients");
}
