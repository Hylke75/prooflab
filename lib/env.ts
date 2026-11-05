import "server-only";
import { parseTrackingSalts, saltFor } from "@/lib/domain/survey-tokens";
import { PROVIDERS, type ProviderId } from "@/lib/ai/providers/config";
import { resolveAppUrl } from "@/lib/domain/app-url";

// TRACKING_SALTS (versioned, first = current) with TRACKING_SALT as the "v1" fallback. See survey-tokens.ts.
export const trackingSalts = parseTrackingSalts(process.env.TRACKING_SALTS, process.env.TRACKING_SALT);
if (trackingSalts.problems.length) console.warn(`TRACKING_SALTS: ${trackingSalts.problems.join(" ")}`);

// Central place for configuration so that missing integrations degrade honestly.
export const env = {
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
  supabaseKey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "",
  // Publiek basisadres voor links (zie lib/domain/app-url.ts): volgt het eigen productiedomein van Vercel.
  appUrl: resolveAppUrl({
    APP_URL: process.env.APP_URL,
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
    VERCEL_ENV: process.env.VERCEL_ENV,
    VERCEL_PROJECT_PRODUCTION_URL: process.env.VERCEL_PROJECT_PRODUCTION_URL,
  }),
  ingestSecret: process.env.INGEST_SECRET ?? "",
  // Optioneel en alleen op de server: de service-rol-sleutel, uitsluitend gebruikt voor Supabase admin generateLink
  // bij uitnodigingen (lib/invite.ts). Zonder deze sleutel bevat de uitnodiging een link naar de inlogpagina.
  supabaseServiceKey: process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
  // The current salt (visitor codes, rate buckets, new invitations). Older versions: trackingSalts.all.
  trackingSalt: trackingSalts.current?.secret ?? "",
  trackingSaltVersion: trackingSalts.current?.version ?? "v1",
  // AI providers: at least one key turns AI on. Model IDs: lib/ai/providers/config.ts (overridable per provider
  // with ANTHROPIC_MODEL, OPENAI_MODEL, GEMINI_MODEL).
  anthropicKey: process.env.ANTHROPIC_API_KEY ?? "",
  openaiKey: process.env.OPENAI_API_KEY ?? "",
  geminiKey: process.env.GEMINI_API_KEY ?? "",
  // Optional: personal survey invitations are sent through the Resend HTTP API.
  resendKey: process.env.RESEND_API_KEY ?? "",
  emailFrom: process.env.EMAIL_FROM ?? "",
  // Optional: signing secret of the Resend webhook ("whsec_..."), for bounces and spam complaints.
  resendWebhookSecret: process.env.RESEND_WEBHOOK_SECRET ?? "",
  researchBudgetUsd: Number(process.env.RESEARCH_BUDGET_USD ?? "3") || 3,
  // Fase 2 · punt 4: 32 bytes (base64) om geheimen per werkruimte te versleutelen (AES-256-GCM), zoals de Mollie-sleutel.
  secretsEncryptionKey: process.env.SECRETS_ENCRYPTION_KEY ?? "",
  // Fase 2 · punt 4: betaalde intentie via Mollie staat alleen aan met MOLLIE_ENABLED=1.
  mollieEnabled: process.env.MOLLIE_ENABLED === "1",
};

export function providerKey(p: ProviderId): string {
  return p === "anthropic" ? env.anthropicKey : p === "openai" ? env.openaiKey : env.geminiKey;
}

// Providers with an API key in this environment, in the fixed order Claude, ChatGPT, Gemini.
export function configuredProviders(): ProviderId[] {
  return PROVIDERS.filter((p) => providerKey(p).trim().length > 0);
}

export function aiConfigured(): boolean {
  return configuredProviders().length > 0;
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
