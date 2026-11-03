import "server-only";

// Central place for configuration so that missing integrations degrade honestly.
export const env = {
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
  supabaseKey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "",
  appUrl: process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
  ingestSecret: process.env.INGEST_SECRET ?? "",
  trackingSalt: process.env.TRACKING_SALT ?? "",
  anthropicKey: process.env.ANTHROPIC_API_KEY ?? "",
  // Optional: personal survey invitations are sent through the Resend HTTP API.
  resendKey: process.env.RESEND_API_KEY ?? "",
  emailFrom: process.env.EMAIL_FROM ?? "",
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
