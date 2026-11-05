"use server";

// Fase 2 · punt 4: toezeggingen vastleggen. Alleen het onderzoeksteam (requireWritableIdea en RLS can_write_idea). Het
// e-mailadres van de ondertekenaar wordt alleen een persoonssleutel (HMAC); het adres zelf wordt niet bewaard.

import { revalidatePath } from "next/cache";
import { requireWritableIdea } from "@/lib/data";
import { supabaseServer } from "@/lib/supabase/server";
import { env } from "@/lib/env";
import { personKey } from "@/lib/domain/action-counts";
import { schemaMissing } from "@/lib/action-counts-data";
import {
  COMMITMENT_BUCKET,
  COMMITMENT_MAX_BYTES,
  COMMITMENT_MIME,
  commitmentFieldErrors,
  commitmentPath,
  commitmentTokenHash,
  newCommitmentToken,
  sniffMime,
} from "@/lib/domain/commitments";
import type { FormState } from "@/components/ui/ActionForm";

const isUuid = (s: string) => /^[0-9a-f-]{36}$/i.test(s);
const MIGRATION = "Toezeggingen vragen een database-update (migratie 20261116090000_fase2_testen).";
const refresh = (ideaId: string, expId: string) => revalidatePath(`/app/ideas/${ideaId}/experiments/${expId}`);

function dbMessage(error: { message: string; code?: string }): string {
  if (schemaMissing(error)) return MIGRATION;
  if (error.message.includes("COMMITMENT_CLOSED")) return "Toezeggingen leg je vast terwijl de test loopt of gepauzeerd is.";
  if (error.message.includes("COMMITMENT_DOCUMENT")) return "Zonder geüpload document telt een toezegging niet. Upload het bestand opnieuw.";
  if (error.message.includes("COMMITMENT_LOCKED")) return "Een toezegging ligt vast; alleen intrekken is mogelijk.";
  return "De toezegging kon niet worden opgeslagen.";
}

export async function uploadCommitment(ideaId: string, expId: string, _: FormState, form: FormData): Promise<FormState> {
  await requireWritableIdea(ideaId);
  if (!isUuid(expId)) return { error: "Experiment niet gevonden." };
  const name = String(form.get("signer_name") ?? "").trim();
  const org = String(form.get("signer_org") ?? "").trim();
  const email = String(form.get("signer_email") ?? "").trim();
  const fieldErrors = commitmentFieldErrors({ name, org, email });
  const file = form.get("document");
  if (!(file instanceof File) || file.size === 0) fieldErrors.document = "Kies het getekende document (pdf of afbeelding).";
  else if (file.size > COMMITMENT_MAX_BYTES) fieldErrors.document = "Het bestand is groter dan 4 MB.";
  if (Object.keys(fieldErrors).length) return { error: "De toezegging is nog niet opgeslagen: controleer de gemarkeerde velden.", fieldErrors };
  const doc = file as File;
  const bytes = new Uint8Array(await doc.arrayBuffer());
  const mime = sniffMime(bytes.subarray(0, 16));
  if (!mime) return { error: "Alleen een pdf of afbeelding (png, jpeg, webp) telt als getekend document.", fieldErrors: { document: "Onbekend bestandstype." } };
  const key = personKey(env.trackingSalt, email);
  if (!key) return { error: "Meting is niet geconfigureerd (TRACKING_SALT ontbreekt): een toezegging kan dan niet per persoon worden geteld." };
  const supabase = await supabaseServer();
  const path = commitmentPath(ideaId, expId, crypto.randomUUID(), doc.name || `toezegging.${mime === "application/pdf" ? "pdf" : "png"}`);
  const up = await supabase.storage.from(COMMITMENT_BUCKET).upload(path, bytes, { contentType: mime, upsert: false });
  if (up.error) return { error: "Uploaden kan nu niet. Is de bucket commitment-documents aangemaakt (migratie 20261116090000_fase2_testen)? Probeer het later opnieuw." };
  const { error } = await supabase.from("test_commitments").insert({
    experiment_id: expId,
    idea_id: ideaId,
    method: "upload",
    status: "signed",
    person_key: key,
    signer_name: name.slice(0, 200),
    signer_org: org.slice(0, 200),
    document_path: path,
    document_mime: mime,
    document_size: bytes.length,
  });
  if (error) {
    await supabase.storage.from(COMMITMENT_BUCKET).remove([path]);
    return { error: dbMessage(error) };
  }
  refresh(ideaId, expId);
  return { error: null, ok: `Toezegging van ${org} vastgelegd (${COMMITMENT_MIME[mime]}). Telt als Geverifieerde toezegging; dezelfde persoon telt één keer.` };
}

export async function inviteCommitment(ideaId: string, expId: string, _: FormState, form: FormData): Promise<FormState> {
  await requireWritableIdea(ideaId);
  if (!isUuid(expId)) return { error: "Experiment niet gevonden." };
  const email = String(form.get("invite_email") ?? "").trim();
  const key = personKey(env.trackingSalt, email);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { error: "Vul een geldig e-mailadres in.", fieldErrors: { invite_email: "Vul een geldig e-mailadres in: daarmee telt dezelfde persoon één keer." } };
  if (!key || !env.ingestSecret) return { error: "Meting is niet geconfigureerd (INGEST_SECRET en TRACKING_SALT ontbreken): de persoonlijke link werkt dan niet." };
  const token = newCommitmentToken();
  const supabase = await supabaseServer();
  const { error } = await supabase.from("test_commitments").insert({ experiment_id: expId, idea_id: ideaId, method: "link", person_key: key, token_hash: commitmentTokenHash(token) });
  if (error) return { error: dbMessage(error) };
  refresh(ideaId, expId);
  const link = `${env.appUrl.replace(/\/$/, "")}/c/${token}`;
  return {
    error: null,
    ok: "Persoonlijke link gemaakt (14 dagen geldig, één keer te gebruiken). Stuur hem zelf naar deze persoon; ProofLab bewaart de link niet en kan hem niet opnieuw tonen.",
    copy: { label: "Persoonlijke link", value: link },
  };
}

export async function revokeCommitment(ideaId: string, expId: string, commitmentId: string, _: FormState): Promise<FormState> {
  await requireWritableIdea(ideaId);
  if (!isUuid(commitmentId)) return { error: "Toezegging niet gevonden." };
  const supabase = await supabaseServer();
  const { error } = await supabase.from("test_commitments").update({ status: "revoked" }).eq("id", commitmentId).eq("idea_id", ideaId);
  if (error) return { error: dbMessage(error) };
  refresh(ideaId, expId);
  return { error: null, ok: "Ingetrokken. Deze toezegging telt niet meer; het bewijs blijft in het auditspoor." };
}

// Na de bewaartermijn wist de dagelijkse opschoning de namen; het bestand zelf verwijdert het team hier via de
// Storage-API (de storage-policy staat dat pas toe als de toezegging is opgeschoond). De telling blijft.
export async function removeExpiredCommitmentDocuments(ideaId: string, expId: string, _: FormState): Promise<FormState> {
  await requireWritableIdea(ideaId);
  const supabase = await supabaseServer();
  const { data, error } = await supabase
    .from("test_commitments")
    .select("document_path")
    .eq("experiment_id", expId)
    .eq("idea_id", ideaId)
    .not("purged_at", "is", null)
    .not("document_path", "is", null);
  if (error) return { error: dbMessage(error) };
  const paths = (data ?? []).map((r) => r.document_path).filter((p): p is string => !!p);
  if (!paths.length) return { error: null, ok: "Er zijn geen verlopen documenten." };
  const { error: rmError } = await supabase.storage.from(COMMITMENT_BUCKET).remove(paths);
  if (rmError) return { error: "Verwijderen is mislukt. Probeer het later opnieuw." };
  await supabase.from("test_commitments").update({ document_path: null }).eq("experiment_id", expId).eq("idea_id", ideaId).not("purged_at", "is", null).in("document_path", paths);
  refresh(ideaId, expId);
  return { error: null, ok: `${paths.length} verlopen ${paths.length === 1 ? "document" : "documenten"} verwijderd.` };
}
