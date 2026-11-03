import "server-only";
import { parseTrackingSalts, saltFor } from "@/lib/domain/survey-tokens";

// TRACKING_SALTS (versioned, first = current) with TRACKING_SALT as the "v1" fallback. See survey-tokens.ts.
export const trackingSalts = parseTrackingSalts(process.env.TRACKING_SALTS, process.env.TRACKING_SALT);
if (trackingSalts.problems.length) console.warn(`TRACKING_SALTS: ${trackingSalts.problems.join(" ")}`);

// Central place for configuration so that missing integrations degrade honestly.
export const env = {
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
  supabaseKey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "",
  appUrl: process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
  ingestSecret: process.env.INGEST_SECRET ?? "",
  // The current salt (visitor codes, rate buckets, new invitations). Older versions: trackingSalts.all.
  trackingSalt: trackingSalts.current?.secret ?? "",
  trackingSaltVersion: trackingSalts.current?.version ?? "v1",
  anthropicKey: process.env.ANTHROPIC_API_KEY ?? "",
  // Optional: personal survey invitations are sent through the Resend HTTP API.
  resendKey: process.env.RESEND_API_KEY ?? "",
  emailFrom: process.env.EMAIL_FROM ?? "",
  // Optional: signing secret of the Resend webhook ("whsec_..."), for bounces and spam complaints.
  resendWebhookSecret: process.env.RESEND_WEBHOOK_SECRET ?? "",
  researchBudgetUsd: Number(process.env.RESEARCH_BUDGET_USD ?? "3") || 3,
};

export function aiConfigured(): boolean {
  return env.anthropicKey.length > 0;
}

export function trackingConfigured(): boolean {
  return env.ingestSecret.length > 0 && env.trackingSalt.length > 0;
}

export function emailConfigured(): boolean {
  return env.resendKey.length > 0 && env.emailFrom.length > 0;
}

// The secret for an invitation's stored salt version, or null when that version is no longer configured.
export function trackingSaltFor(version: string | null | undefined): string | null {
  return saltFor(trackingSalts, version);
}
