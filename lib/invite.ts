import "server-only";
import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { env, emailConfigured } from "@/lib/env";
import { sendEmail } from "@/lib/email";
import { log } from "@/lib/log";
import { buildInvitationEmail, confirmLink, loginPageLink, type InviteLinkKind, type InviteRole } from "@/lib/invite-mail";

// Uitnodigingen aan opdrachtgevers gaan als eigen e-mail via Resend (lib/email.ts), niet meer via de standaardmail
// van Supabase Auth. Zie docs/OPERATIONS.md, "Uitnodigingen aan opdrachtgevers".

export type InviteResult =
  | { sent: true; kind: InviteLinkKind }
  | { sent: false; reason: "email_not_configured" | "send_failed"; link: string; kind: InviteLinkKind; detail?: string };

// De inloglink. Met een service-rol-sleutel een eenmalige link uit Supabase admin generateLink (magiclink voor een
// bestaand account, anders invite); zonder die sleutel, of als generateLink faalt, de inlogpagina met het adres
// ingevuld, waar de opdrachtgever zelf een magic link aanvraagt.
export async function invitationLink(email: string): Promise<{ link: string; kind: InviteLinkKind }> {
  const fallback = { link: loginPageLink(env.appUrl, email), kind: "login" as const };
  if (!env.supabaseServiceKey || !env.supabaseUrl) return fallback;
  try {
    const admin = createClient(env.supabaseUrl, env.supabaseServiceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    for (const type of ["magiclink", "invite"] as const) {
      const { data, error } = await admin.auth.admin.generateLink({ type, email, options: { redirectTo: `${env.appUrl}/app` } });
      const hash = data?.properties?.hashed_token;
      if (!error && hash) return { link: confirmLink(env.appUrl, hash, type), kind: "direct" };
    }
  } catch (e) {
    await log.warn("invite_generate_link_failed", { reason: "exception" }, e);
  }
  return fallback;
}

export async function sendInvitation(input: { email: string; ideaId: string; ideaTitle: string; workspaceName: string; role: InviteRole }): Promise<InviteResult> {
  const { link, kind } = await invitationLink(input.email);
  if (!emailConfigured()) return { sent: false, reason: "email_not_configured", link, kind };
  const mail = buildInvitationEmail({ ideaTitle: input.ideaTitle, workspaceName: input.workspaceName, role: input.role, link, kind });
  // Eén uitnodiging per adres, dossier en minuut: een dubbele klik verstuurt geen tweede e-mail.
  const minute = new Date().toISOString().slice(0, 16);
  const key = `invite-${createHash("sha256").update(`${input.ideaId}|${input.email}|${minute}`).digest("hex").slice(0, 40)}`;
  const res = await sendEmail({ to: input.email, subject: mail.subject, text: mail.text, html: mail.html, idempotencyKey: key });
  if (res.ok) return { sent: true, kind };
  return { sent: false, reason: "send_failed", link, kind, detail: res.error };
}
