"use server";

// Fase 2 · punt 4: een webhookadres voor afspraken (Calendly of Cal.com) maken of vervangen. Alleen het onderzoeksteam
// (requireWritableIdea en RLS can_write_idea). Adres en geheime sleutel worden één keer getoond; ProofLab bewaart alleen
// de sha256 van de code in het adres en leidt de sleutel bij elke melding opnieuw af.

import { revalidatePath } from "next/cache";
import { randomBytes } from "node:crypto";
import { requireWritableIdea } from "@/lib/data";
import { supabaseServer } from "@/lib/supabase/server";
import { env, trackingConfigured } from "@/lib/env";
import { schemaMissing } from "@/lib/action-counts-data";
import { BOOKING_PROVIDERS, bookingSecret, bookingTokenHash, isBookingProvider } from "@/lib/integrations/bookings";
import type { FormState } from "@/components/ui/ActionForm";

const isUuid = (s: string) => /^[0-9a-f-]{36}$/i.test(s);

export async function createBookingHook(ideaId: string, expId: string, provider: string, _: FormState): Promise<FormState> {
  await requireWritableIdea(ideaId);
  if (!isUuid(expId) || !isBookingProvider(provider)) return { error: "Onbekende koppeling." };
  if (!trackingConfigured()) return { error: "Meting is niet geconfigureerd (INGEST_SECRET en TRACKING_SALT ontbreken): afspraken kunnen dan niet worden vastgelegd." };
  const supabase = await supabaseServer();
  const token = randomBytes(32).toString("base64url");
  const del = await supabase.from("test_booking_hooks").delete().eq("experiment_id", expId).eq("provider", provider);
  if (del.error) return { error: schemaMissing(del.error) ? "Afspraken vragen een database-update (migratie 20261116090000_fase2_testen)." : "Het webhookadres kon niet worden gemaakt." };
  const { error } = await supabase.from("test_booking_hooks").insert({ experiment_id: expId, idea_id: ideaId, provider, token_hash: bookingTokenHash(token) });
  if (error) return { error: schemaMissing(error) ? "Afspraken vragen een database-update (migratie 20261116090000_fase2_testen)." : "Het webhookadres kon niet worden gemaakt." };
  revalidatePath(`/app/ideas/${ideaId}/experiments/${expId}`);
  const url = `${env.appUrl.replace(/\/$/, "")}/api/webhooks/bookings/${provider}/${token}`;
  const secret = bookingSecret(env.trackingSalt, provider, token);
  return {
    error: null,
    ok: `${BOOKING_PROVIDERS[provider].label}-webhook gemaakt. Kopieer adres en geheime sleutel nu: ProofLab toont ze niet opnieuw (maak anders een nieuwe). Geheime sleutel: ${secret}`,
    copy: { label: "Webhookadres", value: url },
  };
}

export async function removeBookingHook(ideaId: string, expId: string, provider: string, _: FormState): Promise<FormState> {
  await requireWritableIdea(ideaId);
  if (!isUuid(expId) || !isBookingProvider(provider)) return { error: "Onbekende koppeling." };
  const supabase = await supabaseServer();
  const { error } = await supabase.from("test_booking_hooks").delete().eq("experiment_id", expId).eq("provider", provider);
  if (error) return { error: "Verwijderen is mislukt." };
  revalidatePath(`/app/ideas/${ideaId}/experiments/${expId}`);
  return { error: null, ok: "Webhook verwijderd. Nieuwe meldingen van deze aanbieder worden geweigerd; vastgelegde afspraken blijven." };
}
