"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { supabaseAnon, supabaseServer } from "@/lib/supabase/server";
import { env } from "@/lib/env";

export type LoginState = { error: string | null; info: string | null };

const Creds = z.object({
  email: z.string().trim().toLowerCase().email("Vul een geldig e-mailadres in."),
  password: z.string().min(8, "Een wachtwoord heeft minimaal 8 tekens."),
  next: z.string().optional(),
});

function safeNext(next: string | undefined): string {
  return next && next.startsWith("/app") && !next.startsWith("//") ? next : "/app";
}

export async function signIn(_: LoginState, form: FormData): Promise<LoginState> {
  const parsed = Creds.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: parsed.error.issues[0].message, info: null };
  const supabase = await supabaseServer();
  const { error } = await supabase.auth.signInWithPassword({ email: parsed.data.email, password: parsed.data.password });
  if (error) return { error: "Inloggen mislukt. Controleer je e-mailadres en wachtwoord.", info: null };
  await supabase.rpc("claim_invitations");
  redirect(safeNext(parsed.data.next));
}

export async function sendMagicLink(_: LoginState, form: FormData): Promise<LoginState> {
  const email = z.string().trim().toLowerCase().email().safeParse(form.get("email"));
  if (!email.success) return { error: "Vul een geldig e-mailadres in.", info: null };
  const next = safeNext(String(form.get("next") ?? ""));
  const supabase = await supabaseServer();
  // ProofLab works by invitation: a new account is only created for invited or allowlisted addresses.
  // The answer is the same either way, so the form cannot be used to find out who is invited.
  const { data: mayCreate } = await supabaseAnon().rpc("may_create_account", { p_key: env.ingestSecret, p_email: email.data });
  await supabase.auth.signInWithOtp({
    email: email.data,
    options: { emailRedirectTo: `${env.appUrl}/auth/callback?next=${encodeURIComponent(next)}`, shouldCreateUser: mayCreate === true },
  });
  return { error: null, info: `Als ${email.data} toegang heeft tot ProofLab, staat er binnen een minuut een inloglink in je mailbox.` };
}
