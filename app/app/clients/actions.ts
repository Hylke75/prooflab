"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { supabaseServer } from "@/lib/supabase/server";
import { getWorkspace, requireWritableIdea } from "@/lib/data";
import { sendInvitation, type InviteResult } from "@/lib/invite";

// copy: een link die de consultant zelf kan delen als e-mail niet gekoppeld is of het versturen mislukte.
export type ActionState = { error: string | null; ok?: string | null; copy?: { label: string; value: string } | null };

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

// Nodigt een opdrachtgever uit voor één dossier. Die logt in met dit e-mailadres; de uitnodiging wordt bij de
// eerste login aan het account gekoppeld (claim_invitations). De e-mail gaat via Resend (lib/invite.ts).
export async function inviteStakeholder(ideaId: string, _: ActionState, form: FormData): Promise<ActionState> {
  const p = InviteSchema.safeParse(Object.fromEntries(form));
  if (!p.success) return { error: p.error.issues[0].message };
  const { idea } = await requireWritableIdea(ideaId);
  const supabase = await supabaseServer();
  const { error } = await supabase.from("idea_members").upsert({ idea_id: ideaId, email: p.data.email, role: p.data.role });
  if (error) return { error: "Uitnodigen mislukt." };
  revalidatePath("/app/clients");
  const who = `${p.data.email} kan meekijken${p.data.role === "client_decider" ? " en besluiten bevestigen" : ""}.`;
  if (form.get("send_link") !== "on") return { error: null, ok: who };
  const r = await sendInvitation({ email: p.data.email, ideaId, ideaTitle: idea.title, workspaceName: (await getWorkspace()).org?.name ?? "Je adviseur", role: p.data.role });
  return { error: null, ...inviteMessage(r, who) };
}

// Stuurt de uitnodiging met inloglink opnieuw (voor een eerste login, of als de vorige link verliep).
export async function resendLoginLink(ideaId: string, email: string, _: ActionState): Promise<ActionState> {
  const { idea } = await requireWritableIdea(ideaId);
  const supabase = await supabaseServer();
  const { data: member } = await supabase.from("idea_members").select("email, role").eq("idea_id", ideaId).eq("email", email).maybeSingle();
  if (!member) return { error: "Deze persoon is niet (meer) uitgenodigd voor dit dossier." };
  const role = member.role === "client_decider" ? "client_decider" : "client_viewer";
  const r = await sendInvitation({ email: member.email, ideaId, ideaTitle: idea.title, workspaceName: (await getWorkspace()).org?.name ?? "Je adviseur", role });
  if (r.sent) return { error: null, ok: `Nieuwe uitnodiging met inloglink verstuurd naar ${member.email}.` };
  return { error: null, ...inviteMessage(r, "") };
}

export async function removeStakeholder(ideaId: string, email: string) {
  await requireWritableIdea(ideaId);
  const supabase = await supabaseServer();
  await supabase.from("idea_members").delete().eq("idea_id", ideaId).eq("email", email);
  revalidatePath("/app/clients");
}

// Eerlijke melding per uitkomst. Zonder RESEND_API_KEY: "e-mail niet gekoppeld" met een kopieerbare link.
function inviteMessage(r: InviteResult, who: string): Pick<ActionState, "ok" | "copy"> {
  const prefix = who ? `${who} ` : "";
  if (r.sent) return { ok: `${prefix}De uitnodiging met inloglink is per e-mail verstuurd.` };
  const how = r.kind === "direct" ? "Deze link logt eenmalig in." : "Via deze link logt de opdrachtgever in met een magic link.";
  const copy = { label: "Link voor de opdrachtgever", value: r.link };
  if (r.reason === "email_not_configured") return { ok: `${prefix}E-mail niet gekoppeld: deel de link hieronder zelf. ${how}`, copy };
  return { ok: `${prefix}De e-mail kon niet worden verstuurd (${r.detail ?? "onbekende fout"}). Deel de link hieronder zelf. ${how}`, copy };
}
