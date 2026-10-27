"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { supabaseServer } from "@/lib/supabase/server";
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

export async function signUp(_: LoginState, form: FormData): Promise<LoginState> {
  const parsed = Creds.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: parsed.error.issues[0].message, info: null };
  const supabase = await supabaseServer();
  const { data, error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: { emailRedirectTo: `${env.appUrl}/auth/callback` },
  });
  if (error) return { error: "Account aanmaken lukte niet. Probeer het later opnieuw of log in.", info: null };
  if (data.session) {
    await supabase.rpc("claim_invitations");
    redirect("/app");
  }
  return { error: null, info: "Bevestig je e-mailadres via de link die we je stuurden. Daarna kun je inloggen." };
}

export async function sendMagicLink(_: LoginState, form: FormData): Promise<LoginState> {
  const email = z.string().trim().toLowerCase().email().safeParse(form.get("email"));
  if (!email.success) return { error: "Vul een geldig e-mailadres in.", info: null };
  const next = safeNext(String(form.get("next") ?? ""));
  const supabase = await supabaseServer();
  const { error } = await supabase.auth.signInWithOtp({
    email: email.data,
    options: { emailRedirectTo: `${env.appUrl}/auth/callback?next=${encodeURIComponent(next)}` },
  });
  if (error) return { error: "De inloglink kon niet worden verstuurd. Probeer het zo opnieuw.", info: null };
  return { error: null, info: `We hebben een inloglink gestuurd naar ${email.data}.` };
}
