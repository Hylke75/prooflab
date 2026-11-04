import "./step-notes.css";
import { getIdea, getWorkspace } from "@/lib/data";
import { supabaseServer } from "@/lib/supabase/server";
import { env } from "@/lib/env";
import { NOTE_STEP_LABELS, type NoteStep } from "@/lib/domain/step-files";
import { deleteStepDocument, deleteStepNote, saveStepNote } from "@/app/app/ideas/[id]/step-notes-actions";
import { ActionForm, Field } from "@/components/ui/ActionForm";
import { NoteItem, DocumentItem, UploadDocumentForm, type DocView, type NoteView } from "./StepNotesClient";

// Blok "Notities en documenten" onderaan elke stappagina en het overzicht van een idee. Zelfstandig: het laadt zijn
// eigen gegevens en raakt de logica van de stap zelf niet. Ingeklapt als er nog niets is, met een teller in de kop.
// Consultants voegen toe, bewerken en verwijderen (eigen items, of alles als eigenaar van de werkruimte);
// opdrachtgevers lezen en downloaden.
export async function StepNotes({ ideaId, step }: { ideaId: string; step: NoteStep }) {
  const [{ canWrite }, ws, supabase] = await Promise.all([getIdea(ideaId), getWorkspace(), supabaseServer()]);
  const [notesRes, docsRes] = await Promise.all([
    supabase.from("step_notes").select("id, title, body, author_name, created_by, created_at, updated_at").eq("idea_id", ideaId).eq("step", step).order("created_at", { ascending: false }),
    supabase.from("step_documents").select("id, file_name, mime_type, size_bytes, description, author_name, created_by, created_at").eq("idea_id", ideaId).eq("step", step).order("created_at", { ascending: false }),
  ]);
  // Zonder de migratie (of bij een storing) blijft de pagina gewoon werken; het blok zegt eerlijk wat er mis is.
  const unavailable = !!(notesRes.error || docsRes.error);
  const isOwner = ws.org?.role === "owner";
  const mayEdit = (createdBy: string | null) => canWrite && (isOwner || createdBy === ws.user.id);
  const notes: NoteView[] = (notesRes.data ?? []).map((n) => ({
    id: n.id,
    title: n.title,
    body: n.body,
    author: n.author_name || "Onbekend",
    createdAt: n.created_at,
    updatedAt: n.updated_at,
    canEdit: mayEdit(n.created_by),
    saveAction: saveStepNote.bind(null, ideaId, step, n.id),
    deleteAction: deleteStepNote.bind(null, ideaId, n.id),
  }));
  const docs: DocView[] = (docsRes.data ?? []).map((d) => ({
    id: d.id,
    fileName: d.file_name,
    mime: d.mime_type,
    size: d.size_bytes,
    description: d.description,
    author: d.author_name || "Onbekend",
    createdAt: d.created_at,
    href: `/app/ideas/${ideaId}/documenten/${d.id}`,
    canDelete: mayEdit(d.created_by),
    deleteAction: deleteStepDocument.bind(null, ideaId, d.id),
  }));
  const count = notes.length + docs.length;
  const label = NOTE_STEP_LABELS[step];
  const headingId = `notities-${step}`;

  return (
    <section className="card step-notes mt-24 no-print" aria-labelledby={headingId}>
      <details className="quickline" open={count > 0 || undefined}>
        <summary>
          <h2 id={headingId} className="step-notes-title">Notities en documenten</h2>
          <span className={`pill ${count ? "blue" : "gray"}`} aria-label={`${notes.length} ${notes.length === 1 ? "notitie" : "notities"}, ${docs.length} ${docs.length === 1 ? "document" : "documenten"}`}>
            {count}
          </span>
          <span className="tiny step-notes-step">{step === "overview" ? "bij dit idee" : `stap ${label}`}</span>
        </summary>

        <p className="note step-notes-hint">
          Eigen werkmateriaal van het team: gespreksverslagen, ideeën, bestanden. Notities zijn intern en komen niet in het rapport. Een document is
          geen bron of bewijs vanzelf{step === "market" ? <>: met <strong>Importeer als onderzoek</strong> leest ProofLab een rapport in als bron met letterlijke tekstblokken; met <strong>Gebruik als bron</strong> plak je zelf een fragment. In beide gevallen controleert ProofLab het citaat zoals bij elke bron.</> : "."}
          {!canWrite && " Je kijkt mee als opdrachtgever: je kunt lezen en downloaden."}
        </p>

        {unavailable ? (
          <div className="form-error" role="alert">Notities en documenten zijn nog niet beschikbaar (de database is nog niet bijgewerkt). Probeer het later opnieuw.</div>
        ) : (
          <div className="step-notes-grid">
            <div>
              <h3 className="step-notes-sub">Notities <span className="step-notes-count">({notes.length})</span></h3>
              {notes.length === 0 && <p className="tiny">Nog geen notities{canWrite ? "." : " van het team."}</p>}
              <ul className="step-notes-list">
                {notes.map((n) => (
                  <NoteItem key={n.id} note={n} />
                ))}
              </ul>
              {canWrite && (
                <details className="step-notes-add">
                  <summary className="btn white sm">Notitie toevoegen</summary>
                  <ActionForm action={saveStepNote.bind(null, ideaId, step, null)} submitLabel="Notitie opslaan" pendingLabel="Opslaan…" resetOnSuccess noValidate className="mt-12">
                    <Field name="title" id={`note-title-${step}`} label="Titel" hint="Optioneel, bijv. 'Gesprek met de branchevereniging'.">
                      <input className="field" maxLength={200} autoComplete="off" />
                    </Field>
                    <Field name="body" id={`note-body-${step}`} label="Notitie" required hint="Platte tekst of eenvoudige opmaak: # kop, - lijst, **vet**, [tekst](https://…). Maximaal 20.000 tekens.">
                      <textarea className="field" rows={6} maxLength={20000} />
                    </Field>
                  </ActionForm>
                </details>
              )}
            </div>
            <div>
              <h3 className="step-notes-sub">Documenten <span className="step-notes-count">({docs.length})</span></h3>
              {docs.length === 0 && <p className="tiny">Nog geen documenten{canWrite ? "." : " van het team."}</p>}
              <ul className="step-notes-list">
                {docs.map((d) => (
                  <DocumentItem key={d.id} doc={d} ideaId={ideaId} useAsSource={canWrite && step === "market"} />
                ))}
              </ul>
              {canWrite && <UploadDocumentForm ideaId={ideaId} step={step} supabaseUrl={env.supabaseUrl} supabaseKey={env.supabaseKey} />}
            </div>
          </div>
        )}
      </details>
    </section>
  );
}
