"use client";

import { Fragment, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ActionForm, Field, type FormState } from "@/components/ui/ActionForm";
import { ConfirmDialogForm } from "@/components/ui/ConfirmDialog";
import { SavingOverlay } from "@/components/ui/SavingOverlay";
import { openSourceForm } from "@/components/research/source-prefill";
import { parseMarkdown, type Inline } from "@/lib/domain/simple-markdown";
import { ACCEPT_ATTR, ALLOWED_LABEL, DOC_DESCRIPTION_MAX, MAX_DOC_BYTES, formatBytes, validateFile, type NoteStep } from "@/lib/domain/step-files";
import { prepareStepUpload, recordStepDocument } from "@/app/app/ideas/[id]/step-notes-actions";

type Action = (state: FormState, form: FormData) => Promise<FormState>;

export type NoteView = {
  id: string;
  title: string;
  body: string;
  author: string;
  createdAt: string;
  updatedAt: string;
  canEdit: boolean;
  saveAction: Action;
  deleteAction: Action;
};

export type DocView = {
  id: string;
  fileName: string;
  mime: string;
  size: number;
  description: string | null;
  author: string;
  createdAt: string;
  href: string;
  canDelete: boolean;
  deleteAction: Action;
};

const when = (iso: string) =>
  new Intl.DateTimeFormat("nl-NL", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Amsterdam" }).format(new Date(iso));

// ---------------------------------------------------------------------------
// Weergave van een notitie: eenvoudige markdown als React-elementen, nooit als HTML.
// ---------------------------------------------------------------------------

function InlineView({ nodes }: { nodes: Inline[] }) {
  return (
    <>
      {nodes.map((n, i) =>
        n.kind === "text" ? (
          <Fragment key={i}>{n.text}</Fragment>
        ) : n.kind === "bold" ? (
          <strong key={i}>
            <InlineView nodes={n.children} />
          </strong>
        ) : (
          <a key={i} href={n.href} target="_blank" rel="noopener noreferrer nofollow" className="text-link">
            <InlineView nodes={n.children} />
          </a>
        ),
      )}
    </>
  );
}

export function NoteBody({ text }: { text: string }) {
  const blocks = parseMarkdown(text);
  return (
    <div className="note-body">
      {blocks.map((b, i) => {
        if (b.kind === "heading") {
          const H = b.level === 1 ? "h4" : b.level === 2 ? "h5" : "h6";
          return (
            <H key={i} className={`note-h note-h${b.level}`}>
              <InlineView nodes={b.children} />
            </H>
          );
        }
        if (b.kind === "list") {
          const L = b.ordered ? "ol" : "ul";
          return (
            <L key={i}>
              {b.items.map((item, j) => (
                <li key={j}>
                  <InlineView nodes={item} />
                </li>
              ))}
            </L>
          );
        }
        return (
          <p key={i}>
            {b.lines.map((line, j) => (
              <Fragment key={j}>
                {j > 0 && <br />}
                <InlineView nodes={line} />
              </Fragment>
            ))}
          </p>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Eén notitie, met bewerken en verwijderen
// ---------------------------------------------------------------------------

export function NoteItem({ note }: { note: NoteView }) {
  const [editing, setEditing] = useState(false);
  const editRef = useRef<HTMLButtonElement>(null);
  const ids = useId();
  const edited = new Date(note.updatedAt).getTime() - new Date(note.createdAt).getTime() > 1000;
  // Na opslaan klapt het formulier dicht en gaat de focus terug naar de knop Bewerken.
  const save: Action = async (s, f) => {
    const r = await note.saveAction(s, f);
    if (r.ok && !r.error) {
      setEditing(false);
      requestAnimationFrame(() => editRef.current?.focus());
    }
    return r;
  };
  return (
    <li className="step-note">
      {note.title && <h4 className="step-note-title">{note.title}</h4>}
      <p className="tiny step-note-meta">
        {note.author} · {when(note.createdAt)}
        {edited && <> · bewerkt {when(note.updatedAt)}</>}
      </p>
      {editing ? (
        <ActionForm action={save} submitLabel="Wijziging opslaan" pendingLabel="Opslaan…" noValidate footer={<button type="button" className="btn clear sm" onClick={() => setEditing(false)}>Annuleren</button>}>
          <Field name="title" id={`${ids}-title`} label="Titel van de notitie">
            <input className="field" defaultValue={note.title} maxLength={200} autoComplete="off" />
          </Field>
          <Field name="body" id={`${ids}-body`} label="Tekst van de notitie" required>
            <textarea className="field" rows={6} defaultValue={note.body} maxLength={20000} autoFocus />
          </Field>
        </ActionForm>
      ) : (
        <NoteBody text={note.body} />
      )}
      {note.canEdit && !editing && (
        <div className="row step-note-actions">
          <button ref={editRef} type="button" className="btn white sm" onClick={() => setEditing(true)} aria-label={`Bewerk notitie${note.title ? ` "${note.title}"` : ""}`}>
            Bewerken
          </button>
          <ConfirmDialogForm action={note.deleteAction} triggerLabel="Verwijderen" triggerClass="btn clear sm" title="Notitie verwijderen?" confirmLabel="Ja, verwijderen" pendingLabel="Verwijderen…">
            <p className="sub">De notitie verdwijnt voor iedereen in dit dossier. Het auditspoor bewaart dat jij haar hebt verwijderd.</p>
          </ConfirmDialogForm>
        </div>
      )}
    </li>
  );
}

// ---------------------------------------------------------------------------
// Eén document: downloaden, gebruiken als bron (stap Markt), verwijderen
// ---------------------------------------------------------------------------

const stem = (name: string) => name.replace(/\.[A-Za-z0-9]{1,10}$/, "");

export function DocumentItem({ doc, ideaId, useAsSource }: { doc: DocView; ideaId: string; useAsSource: boolean }) {
  const router = useRouter();
  const ext = (/\.([A-Za-z0-9]{1,10})$/.exec(doc.fileName)?.[1] ?? "").toUpperCase();
  // Een document wordt pas bron via het gewone bronformulier: titel vooringevuld, het letterlijke fragment plakt de
  // gebruiker zelf en ProofLab controleert het citaat. Op de pagina Marktverkenning zonder herladen, elders via een link.
  const asSource = () => {
    const title = (doc.description?.trim() || stem(doc.fileName)).slice(0, 300);
    if (document.getElementById("src-title")) {
      openSourceForm({ url: "", title, origin: "document" });
      return;
    }
    router.push(`/app/ideas/${ideaId}/research?tab=sources&bron_titel=${encodeURIComponent(title)}`);
  };
  return (
    <li className="step-doc">
      <div className="step-doc-main">
        <span className="step-doc-ext" aria-hidden="true">{ext || "DOC"}</span>
        <div style={{ minWidth: 0 }}>
          <a className="text-link step-doc-name" href={doc.href} download={doc.fileName}>
            {doc.fileName}
            <span className="sr-only"> downloaden</span>
          </a>
          <p className="tiny">
            {formatBytes(doc.size)} · {doc.author} · {when(doc.createdAt)}
          </p>
          {doc.description && <p className="step-doc-desc">{doc.description}</p>}
        </div>
      </div>
      {(useAsSource || doc.canDelete) && (
        <div className="row step-note-actions">
          {useAsSource && (
            <button type="button" className="btn white sm" onClick={asSource}>
              Gebruik als bron
            </button>
          )}
          {doc.canDelete && (
            <ConfirmDialogForm action={doc.deleteAction} triggerLabel="Verwijderen" triggerClass="btn clear sm" title="Document verwijderen?" confirmLabel="Ja, verwijderen" pendingLabel="Verwijderen…">
              <p className="sub">
                &ldquo;{doc.fileName}&rdquo; wordt uit het dossier en uit de opslag verwijderd. Het auditspoor bewaart dat jij het hebt verwijderd. Bronnen die je eerder op basis van dit
                document vastlegde, blijven staan.
              </p>
            </ConfirmDialogForm>
          )}
        </div>
      )}
    </li>
  );
}

// ---------------------------------------------------------------------------
// Uploaden: de browser stuurt het bestand rechtstreeks naar Storage (eenmalige link van de server, gemaakt met de
// sessie van de gebruiker); daarna legt de server de gegevens vast en controleert grootte en type opnieuw.
// ---------------------------------------------------------------------------

export function UploadDocumentForm({ ideaId, step, supabaseUrl, supabaseKey }: { ideaId: string; step: NoteStep; supabaseUrl: string; supabaseKey: string }) {
  const ids = useId();
  const formRef = useRef<HTMLFormElement>(null);
  const [busy, setBusy] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const [descError, setDescError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const fileId = `${ids}-file`;
  const descId = `${ids}-desc`;

  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    setOk(null);
    setFileError(null);
    setDescError(null);
    const form = e.currentTarget;
    const input = form.elements.namedItem("file") as HTMLInputElement;
    const description = String(new FormData(form).get("description") ?? "");
    const file = input.files?.[0];
    if (!file) {
      setFileError("Kies eerst een bestand.");
      input.focus();
      return;
    }
    const check = validateFile(file);
    if (!check.ok) {
      setFileError(check.error);
      input.focus();
      return;
    }
    if (description.trim().length > DOC_DESCRIPTION_MAX) {
      setDescError(`De omschrijving is te lang (maximaal ${DOC_DESCRIPTION_MAX} tekens).`);
      return;
    }
    setBusy(true);
    try {
      const ticket = await prepareStepUpload(ideaId, step, { name: file.name, size: file.size, type: file.type });
      if (ticket.error !== null) {
        setError(ticket.error);
        return;
      }
      const { createClient } = await import("@supabase/supabase-js");
      const storage = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } }).storage;
      // Opslaan met het type dat bij de extensie hoort, ook als de browser een algemeen type opgaf.
      const body = new File([file], file.name, { type: ticket.mime });
      const { error: upError } = await storage.from("step-documents").uploadToSignedUrl(ticket.path, ticket.token, body, { contentType: ticket.mime, upsert: false });
      if (upError) {
        setError("Uploaden mislukt. Controleer je verbinding en probeer het opnieuw.");
        return;
      }
      const result = await recordStepDocument(ideaId, step, ticket.path, file.name, description);
      if (result.error) {
        if (result.fieldErrors?.description) setDescError(result.fieldErrors.description);
        setError(result.error);
        return;
      }
      setOk(result.ok ?? "Document toegevoegd.");
      formRef.current?.reset();
    } catch {
      setError("Uploaden mislukt. Probeer het opnieuw.");
    } finally {
      setBusy(false);
    }
  };

  const fileDescribedBy = [fileError ? `${fileId}-err` : null, `${fileId}-hint`].filter(Boolean).join(" ");
  return (
    <details className="step-notes-add">
      <summary className="btn white sm">Document uploaden</summary>
      <form ref={formRef} onSubmit={submit} className="mt-12" noValidate aria-label="Document uploaden">
        <div className="form-line">
          <label htmlFor={fileId}>
            Bestand<span className="req"> (verplicht)</span>
          </label>
          <input id={fileId} name="file" type="file" className="field" accept={ACCEPT_ATTR} aria-required aria-invalid={fileError ? true : undefined} aria-describedby={fileDescribedBy} onChange={() => setFileError(null)} />
          {fileError && (
            <p className="field-error" id={`${fileId}-err`} role="alert">
              {fileError}
            </p>
          )}
          <p className="field-hint" id={`${fileId}-hint`}>
            {ALLOWED_LABEL}; maximaal {formatBytes(MAX_DOC_BYTES)}. Alleen het team en de opdrachtgever van dit idee kunnen het openen.
          </p>
        </div>
        <div className="form-line">
          <label htmlFor={descId}>Omschrijving</label>
          <input id={descId} name="description" className="field" maxLength={DOC_DESCRIPTION_MAX} autoComplete="off" aria-invalid={descError ? true : undefined} aria-describedby={descError ? `${descId}-err` : undefined} />
          {descError && (
            <p className="field-error" id={`${descId}-err`} role="alert">
              {descError}
            </p>
          )}
        </div>
        <div className="form-feedback">
          {error && (
            <div className="form-error" role="alert">
              {error}
            </div>
          )}
          {ok && !error && (
            <div className="form-ok" role="status">
              {ok}
            </div>
          )}
        </div>
        <div className="row mt-12">
          <button className="btn primary" disabled={busy} aria-busy={busy || undefined}>
            {busy ? "Uploaden…" : "Bestand uploaden"}
          </button>
        </div>
        <SavingOverlay active={busy} label="Document uploaden…" />
      </form>
    </details>
  );
}
