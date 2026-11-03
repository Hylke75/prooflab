import "server-only";
import { cache } from "react";
import { supabaseServer } from "@/lib/supabase/server";
import { DEFAULT_CAPS, evidenceSourceKey, normaliseCaps, type EvidenceCaps } from "@/lib/domain/evidence";
import { asMethodVersion, type MethodVersion } from "@/lib/domain/method";

// De methodeversie waarmee een dossier rekent. Database zonder methodekolom: de oude rekenwijze.
export const ideaMethodVersion = cache(async (ideaId: string): Promise<MethodVersion> => {
  const supabase = await supabaseServer();
  const { data, error } = await supabase.from("ideas").select("method_version").eq("id", ideaId).maybeSingle();
  return asMethodVersion(error ? null : data?.method_version);
});

export type CapsInUse = { caps: EvidenceCaps; custom: boolean };

// De plafonds per bewijsniveau voor één dossier (instelling van de werkruimte, anders de standaardwaarden).
// Dezelfde voor consultant en opdrachtgever; standaardwaarden als het schema er nog niet is.
export const loadIdeaCaps = cache(async (ideaId: string): Promise<CapsInUse> => {
  const supabase = await supabaseServer();
  const { data, error } = await supabase.rpc("evidence_caps_for_idea", { p_idea: ideaId });
  const row = !error ? data?.[0] : undefined;
  return row ? { caps: normaliseCaps(row), custom: true } : { caps: DEFAULT_CAPS, custom: false };
});

export async function loadOrgCaps(orgId: string): Promise<CapsInUse & { updatedAt: string | null }> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase.from("org_evidence_caps").select("*").eq("org_id", orgId).maybeSingle();
  if (error || !data) return { caps: DEFAULT_CAPS, custom: false, updatedAt: null };
  return { caps: normaliseCaps(data), custom: true, updatedAt: data.updated_at };
}

export type SourceRef = { key: string; label: string };

// Per bevinding ("claim:<id>") en observatie ("observation:<id>") de bron waarmee methode 2026-11-b
// signalen samenvoegt. Leeg als het schema er nog niet is: dan is elk signaal zijn eigen bron.
export const loadSourceRefs = cache(async (ideaId: string): Promise<Map<string, SourceRef>> => {
  const supabase = await supabaseServer();
  const { data, error } = await supabase.rpc("evidence_source_refs", { p_idea: ideaId });
  const out = new Map<string, SourceRef>();
  if (error) return out;
  for (const r of data ?? []) {
    const itemType = r.item_type === "claim" ? "claim" : "observation";
    out.set(
      `${itemType}:${r.item_id}`,
      evidenceSourceKey({
        itemType,
        itemId: r.item_id,
        sourceId: r.source_id,
        sourceType: r.source_type,
        sourceTitle: r.source_title,
        campaign: r.campaign,
        surveyExperimentId: r.survey_experiment_id,
        experimentId: r.experiment_id,
        experimentTitle: r.experiment_title,
        interviewId: r.interview_id,
        interviewLabel: r.interview_label,
      }),
    );
  }
  return out;
});
