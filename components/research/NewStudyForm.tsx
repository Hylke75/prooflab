"use client";

import { useId, useState } from "react";
import { ActionForm, Field, type FormState } from "@/components/ui/ActionForm";
import { RECRUITMENT_GROUPS, RECRUITMENT_KEYS } from "@/lib/domain/recruitment";
import { DEFAULT_DAYS, DEFAULT_TARGET, STUDY_FORMATS, type StudyFormat } from "@/lib/domain/customer-research";

type Question = { id: string; position: number; question: string };

// "Nieuwe enquête" / "Nieuw online interview" op het tabblad Klantonderzoek: de korte start van een verkennend
// onderzoek (onderzoeksvraag, titel, doel, begin). Daarna opent de onderzoekspagina met de editor.
export function NewStudyForm({
  format,
  action,
  questions,
  audience,
  aiConnected,
  openLabel,
}: {
  format: StudyFormat;
  action: (state: FormState, form: FormData) => Promise<FormState>;
  questions: Question[];
  audience: string;
  aiConnected: boolean;
  openLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const uid = useId().replace(/:/g, "");
  const p = `ns-${format}-${uid}`;
  const interview = format === "interview";
  return (
    <div className="mt-12">
      <button type="button" className={open ? "btn white sm" : "btn primary sm"} aria-expanded={open} aria-controls={`${p}-form`} onClick={() => setOpen((x) => !x)}>
        {open ? "Sluiten" : openLabel}
      </button>
      <div id={`${p}-form`} hidden={!open}>
        {open && (
          <ActionForm action={action} submitLabel="Maak concept en open de editor" pendingLabel={interview ? "Concept maken…" : "Concept maken… (een AI-voorstel kan even duren)"} noValidate>
            <input type="hidden" name="format" value={format} />
            <p className="tiny mt-12">{STUDY_FORMATS[format].explain}</p>
            <Field name="question_id" id={`${p}-q`} label="Bij welke onderzoeksvraag hoort dit?" required hint="Elk klantonderzoek hangt aan één onderzoeksvraag van de onderzoekskaart.">
              <select className="field" defaultValue={questions.length === 1 ? questions[0].id : ""}>
                <option value="" disabled>Kies een onderzoeksvraag</option>
                {questions.map((q) => (
                  <option key={q.id} value={q.id}>Vraag {q.position}: {q.question.length > 90 ? `${q.question.slice(0, 89)}…` : q.question}</option>
                ))}
              </select>
            </Field>
            <Field name="title" id={`${p}-title`} label="Titel" required hint="Respondenten zien deze titel boven de vragen.">
              <input className="field" maxLength={120} placeholder={interview ? "Bijv. Hoe pakt de doelgroep dit nu aan?" : "Bijv. Hoe vaak speelt dit probleem?"} />
            </Field>
            <Field name="goal" id={`${p}-goal`} label="Wat wil je leren?" required hint="Eén of twee zinnen. Dit staat bij het onderzoek, niet in de vragen.">
              <textarea className="field" rows={2} maxLength={600} style={{ minHeight: 80 }} />
            </Field>
            <Field name="audience" id={`${p}-aud`} label="Doelgroep" required>
              <input className="field" maxLength={300} defaultValue={audience} />
            </Field>
            {interview ? (
              <div className="note">
                Je begint met de interviewleidraad van ProofLab: bovenaan de vraag om toestemming, daarna open vragen over de laatste keer dat het probleem
                speelde. Geen sturende of hypothetische vragen. Je past de vragen daarna aan in de editor.
              </div>
            ) : (
              <fieldset style={{ border: 0, padding: 0, margin: "18px 0 0", minWidth: 0 }}>
                <legend style={{ fontSize: 14, fontWeight: 600 }}>Hoe wil je beginnen?</legend>
                <label className="check-row">
                  <input type="radio" name="start" value="ai" defaultChecked={aiConnected} disabled={!aiConnected} aria-describedby={`${p}-ai-hint`} />
                  <span>
                    Laat de AI een eerste versie voorstellen
                    <span className="tiny" id={`${p}-ai-hint`} style={{ display: "block" }}>
                      {aiConnected
                        ? "Vragen over recent gedrag bij de onderzoeksvraag. ProofLab haalt sturende en hypothetische vragen eruit; jij beslist."
                        : "AI is niet verbonden. Kies het sjabloon of begin leeg."}
                    </span>
                  </span>
                </label>
                <label className="check-row">
                  <input type="radio" name="start" value="template" defaultChecked={!aiConnected} />
                  <span>Begin met het sjabloon (vragen over recent gedrag, huidige aanpak en uitgaven)</span>
                </label>
                <label className="check-row">
                  <input type="radio" name="start" value="empty" />
                  <span>Begin leeg (één open vraag)</span>
                </label>
              </fieldset>
            )}
            <div className="double-field">
              <Field name="target_n" id={`${p}-n`} label={interview ? "Streefaantal interviews" : "Streefaantal antwoorden"} required hint="Planning, geen drempel.">
                <input className="field num" type="number" inputMode="numeric" min={1} max={5000} defaultValue={DEFAULT_TARGET[format]} />
              </Field>
              <Field name="max_days" id={`${p}-days`} label="Looptijd (dagen)" required>
                <input className="field num" type="number" inputMode="numeric" min={1} max={180} defaultValue={DEFAULT_DAYS} />
              </Field>
            </div>
            <Field name="recruitment_group" id={`${p}-rg`} label="Wie nodig je uit?" hint="Helpt later bij het lezen van de antwoorden: bekenden antwoorden vaak vriendelijker.">
              <select className="field" defaultValue="">
                <option value="">Nog niet bekend</option>
                {RECRUITMENT_KEYS.filter((k) => k !== "unknown").map((k) => (
                  <option key={k} value={k}>{RECRUITMENT_GROUPS[k].label}</option>
                ))}
              </select>
            </Field>
          </ActionForm>
        )}
      </div>
    </div>
  );
}
