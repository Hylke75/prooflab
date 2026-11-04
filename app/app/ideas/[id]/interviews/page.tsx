import type { Metadata } from "next";
import Link from "next/link";
import { PageFrame } from "@/components/shell/PageFrame";
import { InterviewImport } from "@/components/experiments/InterviewImport";
import { getIdea } from "@/lib/data";
import { supabaseServer } from "@/lib/supabase/server";
import { DMU_ROLES } from "@/lib/domain/labels";
import { PRACTICE_LABELS, practiceStatus } from "@/lib/domain/practice";
import { TRANSCRIPT_FORMATS, type TranscriptFormat } from "@/lib/domain/transcript-parse";
import { EXPLORATORY_INTERVIEW_NOTE, IMPORT_SCHEMA_MISSING, missingImportSchema } from "@/lib/domain/interview-import";
import { ThemeCrossTable } from "@/components/experiments/ThemeCrossTable";
import { FathomField } from "@/components/experiments/FathomField";
import { loadThemeCountsForClient, loadThemeCountsForConsultant } from "@/lib/theme-counts-data";

export const metadata: Metadata = { title: "Interviews" };

// Fase 1 · punt 3: alle interviews van een dossier op één plek (Markt › Klantonderzoek). Verkennende interviews
// importeer je hier; gesprekken uit een interviewtest staan erbij met een link naar de test. Opdrachtgevers zien geen
// transcripten of citaten.
export default async function InterviewsPage({ params }: PageProps<"/app/ideas/[id]/interviews">) {
  const { id } = await params;
  const { idea, canWrite } = await getIdea(id);
  const supabase = await supabaseServer();
  const [{ data: interviews, error }, { data: experiments }] = canWrite
    ? await Promise.all([
        supabase
          .from("interviews")
          .select("id, experiment_id, participant_label, dmu_role, held_on, is_practice, consent_recorded, source_format, pseudonymized_at")
          .eq("idea_id", id)
          .order("held_on", { ascending: false }),
        supabase.from("experiments").select("id, title").eq("idea_id", id).eq("type", "interview"),
      ])
    : [{ data: [], error: null }, { data: [] }];
  const schemaMissing = canWrite && missingImportSchema(error);
  // Consultant: aantallen met citaten; opdrachtgever: alleen aantallen (interview_theme_counts).
  const consultantCounts = canWrite && !schemaMissing ? await loadThemeCountsForConsultant(id) : null;
  const counts = canWrite ? consultantCounts : await loadThemeCountsForClient(id);
  const title = new Map((experiments ?? []).map((e) => [e.id, e.title]));
  const list = schemaMissing ? [] : (interviews ?? []);

  return (
    <PageFrame crumbs={["Werkruimte", idea.title, "Markt", "Interviews"]} coach="research" ideaId={id} section="/interviews">
      <div className="section-row">
        <div>
          <div className="eyebrow">Markt · Klantonderzoek</div>
          <h1>Interviews</h1>
          <p className="sub">Alle gesprekken van dit dossier, met thema&apos;s over de interviews heen.</p>
        </div>
        <Link className="btn white sm" href={`/app/ideas/${id}/research?tab=klantonderzoek`}>← Klantonderzoek</Link>
      </div>
      {!canWrite && <p className="sub">Je kijkt mee. Transcripten en citaten ziet alleen het onderzoeksteam; de aantallen per thema staan in het rapport.</p>}
      {schemaMissing && <div className="form-error" role="status">{IMPORT_SCHEMA_MISSING}</div>}

      {counts ? (
        <ThemeCrossTable counts={counts} ideaId={id} quotes={consultantCounts?.quotes} />
      ) : (
        !schemaMissing && <div className="note">Thema&apos;s over interviews heen zijn beschikbaar na de database-update (migratie 20261115090000_interviews_import).</div>
      )}

      {canWrite && (
        <section className="card mt-18" aria-labelledby="iv-lijst">
          <div className="section-title">
            <h2 className="as-h3" id="iv-lijst">Gesprekken</h2>
            <span className="pill gray">{list.length}</span>
          </div>
          {list.length === 0 ? (
            <p className="sub">Nog geen interviews. Importeer hieronder een verkennend gesprek, of leg gesprekken vast in een interviewronde in stap 3.</p>
          ) : (
            <ul className="study-list">
              {list.map((iv) => {
                const practice = PRACTICE_LABELS[practiceStatus(iv.is_practice)];
                const href = iv.experiment_id ? `/app/ideas/${id}/experiments/${iv.experiment_id}/interviews/${iv.id}` : `/app/ideas/${id}/interviews/${iv.id}`;
                return (
                  <li key={iv.id}>
                    <Link className="study-link" href={href}>
                      <strong>{iv.participant_label}</strong>
                      <span className="study-meta">
                        <span className={`pill ${iv.experiment_id ? "blue" : "gray"}`}>{iv.experiment_id ? `Test: ${title.get(iv.experiment_id) ?? "interviewronde"}` : "Verkennend"}</span>
                        <span className={`pill ${practice.pill}`}>{practice.label}</span>
                        <span>{DMU_ROLES[iv.dmu_role as keyof typeof DMU_ROLES] ?? iv.dmu_role}</span>
                        <span>{new Date(iv.held_on).toLocaleDateString("nl-NL")}</span>
                        <span>{TRANSCRIPT_FORMATS[(iv.source_format ?? "paste") as TranscriptFormat] ?? iv.source_format}{iv.pseudonymized_at ? " · gepseudonimiseerd" : ""}</span>
                        {!iv.consent_recorded && iv.is_practice === false && <span>zonder toestemming</span>}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      )}

      {canWrite && !schemaMissing && (
        <section className="card mt-18" id="importeren" aria-labelledby="iv-import">
          <h2 className="as-h3" id="iv-import">Verkennend interview importeren</h2>
          <p className="sub">{EXPLORATORY_INTERVIEW_NOTE} Wil je een aanname toetsen, importeer het gesprek dan in een lopende interviewronde in stap 3.</p>
          <div className="mt-12">
            <InterviewImport ideaId={id} expId={null} testGroup={null} fathom={<FathomField ideaId={id} />} />
          </div>
        </section>
      )}
    </PageFrame>
  );
}
