"use client";

import { useId, useState, useTransition } from "react";
import { ActionForm, Field } from "@/components/ui/ActionForm";
import { InterviewIntakeFields } from "@/components/experiments/PracticeChoice";
import { PseudonymReview } from "@/components/experiments/PseudonymReview";
import { parseInterviewFile, saveImportedInterview, type ParsedPreview } from "@/app/app/ideas/[id]/experiments/interview-import-actions";
import { DMU_ROLES } from "@/lib/domain/labels";
import { MAX_TRANSCRIPT_BYTES, TRANSCRIPT_ACCEPT, TRANSCRIPT_FILE_LABEL } from "@/lib/domain/transcript-parse";
import { DUPLICATE_IMPORT, EXPLORATORY_INTERVIEW_NOTE } from "@/lib/domain/interview-import";
import "./interviews.css";

// Fase 1 · punt 3: een transcript importeren. Eén formulier in twee stappen:
// 1. kies een bestand (TXT, MD, DOCX, VTT, SRT) of plak de tekst, en laat ProofLab het inlezen: segmenten en een
//    voorstel voor pseudonimisering, zonder iets op te slaan;
// 2. controleer de pseudonimisering, vul de gegevens van het gesprek in en sla op. Het bestand gaat opnieuw mee, zodat
//    de server alles zelf opnieuw leest en controleert. Het origineel wordt nergens bewaard.
// Met expId: in de lopende interviewtest. Zonder: een verkennend interview (Markt), dat nooit over de kans beslist.

export function InterviewImport({ ideaId, expId, testGroup, fathom }: { ideaId: string; expId: string | null; testGroup: string | null; fathom?: React.ReactNode }) {
  const uid = useId();
  const [preview, setPreview] = useState<ParsedPreview | null>(null);
  const [error, setError] = useState<{ text: string; field?: string } | null>(null);
  const [reading, start] = useTransition();
  const [version, setVersion] = useState(0);

  const read = (form: HTMLFormElement | null) => {
    if (!form) return;
    setError(null);
    const fd = new FormData(form);
    start(async () => {
      const res = await parseInterviewFile(ideaId, expId, fd);
      if (res.error || !res.preview) {
        setPreview(null);
        setError({ text: res.error ?? "Het transcript kon niet worden gelezen.", field: res.field });
        return;
      }
      setPreview(res.preview);
      setVersion((v) => v + 1);
    });
  };
  const reset = () => {
    setPreview(null);
    setError(null);
  };

  return (
    <ActionForm
      action={saveImportedInterview.bind(null, ideaId, expId)}
      submitLabel={expId ? "Interview opslaan" : "Verkennend interview opslaan"}
      pendingLabel="Pseudonimiseren en opslaan…"
      noValidate
      disabled={!preview || reading}
      describedBy={!preview ? `${uid}-first` : undefined}
    >
      {!expId && <div className="note" style={{ marginTop: 0 }}>{EXPLORATORY_INTERVIEW_NOTE}</div>}
      <fieldset className="form-line" style={{ border: 0, padding: 0, margin: "0 0 12px" }}>
        <legend style={{ fontSize: 14, fontWeight: 600, color: "var(--color-heading)", marginBottom: 8 }}>1. Transcript</legend>
        <div className="form-line">
          <label htmlFor={`${uid}-file`}>Bestand ({TRANSCRIPT_FILE_LABEL}, tot {MAX_TRANSCRIPT_BYTES / 1024 / 1024} MB)</label>
          <input
            id={`${uid}-file`}
            className="field"
            type="file"
            name="file"
            accept={TRANSCRIPT_ACCEPT}
            onChange={reset}
            aria-invalid={error?.field === "file" || undefined}
            aria-describedby={`${uid}-file-hint`}
          />
          <p className="field-hint" id={`${uid}-file-hint`}>
            Teams (VTT of DOCX), Zoom (VTT), ondertitels (SRT), Otter of Fathom (TXT) of eigen notities. Het bestand wordt alleen gelezen, niet bewaard.
          </p>
        </div>
        <details>
          <summary className="text-link">Of plak de tekst</summary>
          <div className="form-line mt-8">
            <label htmlFor={`${uid}-paste`}>Geplakt transcript</label>
            <textarea id={`${uid}-paste`} className="field" name="pasted" rows={6} onChange={reset} aria-invalid={error?.field === "pasted" || undefined} />
          </div>
        </details>
        {fathom}
        <div className="row mt-8" style={{ gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <button type="button" className="btn white sm" disabled={reading} aria-busy={reading || undefined} onClick={(e) => read(e.currentTarget.form)}>
            {reading ? "Inlezen…" : preview ? "Opnieuw inlezen" : "Lees het transcript in"}
          </button>
          {!preview && <span className="tiny" id={`${uid}-first`}>Eerst inlezen; daarna controleer je de pseudonimisering. Er gaat niets naar een AI-dienst.</span>}
        </div>
        {error && <p className="field-error" role="alert">{error.text}</p>}
      </fieldset>

      {preview && (
        <>
          <div className="data-row">
            <span>Ingelezen</span>
            <strong style={{ textAlign: "right" }}>
              {preview.formatLabel} · {preview.segments.length} fragmenten · {preview.speakers} {preview.speakers === 1 ? "spreker" : "sprekers"}
              {preview.hasTimestamps ? " · met tijden" : ""} · {preview.chars.toLocaleString("nl-NL")} tekens
            </strong>
          </div>
          {preview.duplicate && <div className="form-error" role="status">{DUPLICATE_IMPORT}</div>}
          {preview.warnings.map((w) => <div className="note" key={w}>{w}</div>)}
          <fieldset className="form-line mt-12" style={{ border: 0, padding: 0, margin: "12px 0" }}>
            <legend style={{ fontSize: 14, fontWeight: 600, color: "var(--color-heading)", marginBottom: 8 }}>2. Pseudonimiseren</legend>
            <PseudonymReview key={version} segments={preview.segments} initial={preview.proposal} />
          </fieldset>
          <fieldset className="form-line" style={{ border: 0, padding: 0, margin: "12px 0 0" }}>
            <legend style={{ fontSize: 14, fontWeight: 600, color: "var(--color-heading)", marginBottom: 8 }}>3. Het gesprek</legend>
            <div className="double-field">
              <Field name="participant_label" id={`${uid}-l`} label="Pseudoniem van de deelnemer" required hint="Geen naam: bijv. 'Deelnemer A' of 'Penningmeester club 2'.">
                <input className="field" placeholder="Bijv. Deelnemer A" maxLength={80} />
              </Field>
              <Field name="held_on" id={`${uid}-d`} label="Datum gesprek" required hint="De bewaartermijn (12 maanden) telt vanaf deze datum.">
                <input className="field" type="date" />
              </Field>
            </div>
            <div className="double-field">
              <Field name="dmu_role" id={`${uid}-r`} label="Rol in het koopproces" required>
                <select className="field" defaultValue="user">{Object.entries(DMU_ROLES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
              </Field>
              <Field name="segment" id={`${uid}-s`} label="Segment (optioneel)"><input className="field" maxLength={160} /></Field>
            </div>
            <InterviewIntakeFields testGroup={testGroup} idPrefix={`${uid}-iv`} />
          </fieldset>
        </>
      )}
    </ActionForm>
  );
}
