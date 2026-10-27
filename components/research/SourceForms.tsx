"use client";

import { useMemo, useState } from "react";
import { ActionForm, type FormState } from "@/components/ui/ActionForm";
import { checkQuote } from "@/lib/domain/verify";
import { EVIDENCE_TYPES, SOURCE_TYPES } from "@/lib/domain/labels";

type Action = (s: FormState, f: FormData) => Promise<FormState>;

export function AddSourceForm({ action }: { action: Action }) {
  return (
    <ActionForm action={action} submitLabel="Bron opslaan" resetOnSuccess>
      <div className="double-field">
        <div className="form-line">
          <label htmlFor="src-title">Titel van de bron</label>
          <input className="field" id="src-title" name="title" required placeholder="Bijv. Vestigingen van bedrijven; bedrijfstak, regio" />
        </div>
        <div className="form-line">
          <label htmlFor="src-type">Type bron</label>
          <select className="field" id="src-type" name="source_type" defaultValue="official_statistic">
            {Object.entries(SOURCE_TYPES).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
        </div>
      </div>
      <div className="form-line">
        <label htmlFor="src-url">URL of dataset-ID</label>
        <input className="field" id="src-url" name="url" type="url" placeholder="https://www.cbs.nl/…" />
      </div>
      <div className="double-field">
        <div className="form-line">
          <label htmlFor="src-pub">Uitgever / instelling</label>
          <input className="field" id="src-pub" name="publisher" placeholder="Bijv. CBS" />
        </div>
        <div className="form-line">
          <label htmlFor="src-date">Publicatie- of peildatum</label>
          <input className="field" id="src-date" name="published_on" type="date" />
        </div>
      </div>
      <div className="form-line">
        <label htmlFor="src-excerpt">Relevant fragment (letterlijk overgenomen)</label>
        <textarea className="field" id="src-excerpt" name="excerpt" required minLength={20} maxLength={6000} placeholder="Plak hier de passage of tabelregel waar je bevinding op steunt. Alleen dit fragment wordt bewaard, niet het hele document." />
      </div>
      <div className="double-field">
        <div className="form-line">
          <label htmlFor="src-loc">Vindplaats</label>
          <input className="field" id="src-loc" name="location" placeholder="Bijv. tabel 2, p. 14, of filter SBI 82.3" />
        </div>
        <div className="form-line" style={{ alignSelf: "end" }}>
          <label className="check-row"><input type="checkbox" name="is_primary" /> Primaire bron (eerste publicatie, niet overgenomen)</label>
          <label className="check-row"><input type="checkbox" name="check_live" defaultChecked /> Controleer het fragment op de live pagina</label>
        </div>
      </div>
    </ActionForm>
  );
}

type Excerpt = { id: string; text: string; sourceTitle: string };
type Question = { id: string; position: number; question: string };

export function AddClaimForm({ action, excerpts, questions }: { action: Action; excerpts: Excerpt[]; questions: Question[] }) {
  const [excerptId, setExcerptId] = useState(excerpts[0]?.id ?? "");
  const [quote, setQuote] = useState("");
  const [statement, setStatement] = useState("");
  const [stance, setStance] = useState<"supports" | "contradicts">("supports");
  const excerpt = excerpts.find((e) => e.id === excerptId);
  const check = useMemo(() => {
    if (!excerpt || quote.trim().length < 8) return null;
    return checkQuote(quote, excerpt.text, stance === "supports" && statement ? statement : undefined);
  }, [excerpt, quote, statement, stance]);

  if (excerpts.length === 0) {
    return <div className="note" style={{ marginTop: 0 }}>Voeg eerst een bron met fragment toe. Een bevinding zonder bron is een aanname.</div>;
  }
  return (
    <ActionForm action={action} submitLabel="Bevinding toetsen en opslaan" resetOnSuccess>
      <div className="form-line">
        <label htmlFor="cl-ex">Bronfragment</label>
        <select className="field" id="cl-ex" name="excerpt_id" value={excerptId} onChange={(e) => setExcerptId(e.target.value)}>
          {excerpts.map((e) => (
            <option key={e.id} value={e.id}>{e.sourceTitle}: “{e.text.slice(0, 70)}…”</option>
          ))}
        </select>
        {excerpt && <div className="quote" style={{ maxHeight: 130, overflow: "auto" }}>{excerpt.text}</div>}
      </div>
      <div className="form-line">
        <label htmlFor="cl-st">Bevinding (één zin)</label>
        <input className="field" id="cl-st" name="statement" value={statement} onChange={(e) => setStatement(e.target.value)} required placeholder="Bijv. In Nederland zijn 41.230 vestigingen actief in congres- en beursorganisatie (2026)." />
      </div>
      <div className="form-line">
        <label htmlFor="cl-q">Letterlijk citaat uit het fragment</label>
        <textarea className="field" id="cl-q" name="quote" value={quote} onChange={(e) => setQuote(e.target.value)} style={{ minHeight: 70 }} required />
        {check && (
          <div className={check === "exact" ? "form-ok" : "form-error"} style={{ marginTop: 8, marginBottom: 0 }}>
            {check === "exact"
              ? "✓ Citaat staat letterlijk in het fragment."
              : check === "numbers_mismatch"
                ? "De getallen uit je bewering staan niet in het citaat."
                : "Dit citaat staat niet letterlijk in het fragment."}
          </div>
        )}
      </div>
      <div className="double-field">
        <div className="form-line">
          <label htmlFor="cl-et">Soort informatie</label>
          <select className="field" id="cl-et" name="evidence_type" defaultValue="official_statistic">
            {Object.entries(EVIDENCE_TYPES)
              .filter(([k]) => !["ai_inference", "synthetic_simulation"].includes(k))
              .map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
          </select>
        </div>
        <div className="form-line">
          <label htmlFor="cl-stance">Richting</label>
          <select className="field" id="cl-stance" name="stance" value={stance} onChange={(e) => setStance(e.target.value as "supports" | "contradicts")}>
            <option value="supports">Ondersteunt de bevinding</option>
            <option value="contradicts">Spreekt de bevinding tegen</option>
          </select>
        </div>
      </div>
      <div className="double-field">
        <div className="form-line">
          <label htmlFor="cl-q-id">Hoort bij onderzoeksvraag</label>
          <select className="field" id="cl-q-id" name="question_id" defaultValue={questions[0]?.id ?? ""}>
            {questions.map((q) => (
              <option key={q.id} value={q.id}>{q.position}. {q.question.slice(0, 60)}</option>
            ))}
            <option value="">Geen specifieke vraag</option>
          </select>
        </div>
        <div className="form-line">
          <label htmlFor="cl-sec">Onderdeel</label>
          <select className="field" id="cl-sec" name="section" defaultValue="market">
            <option value="market">Markt en trends</option>
            <option value="customers">Klant en probleem</option>
            <option value="competition">Concurrentie</option>
            <option value="pricing">Prijs en koopproces</option>
            <option value="sizing">Marktomvang</option>
            <option value="regulation">Regels en context</option>
            <option value="other">Overig</option>
          </select>
        </div>
      </div>
      <div className="double-field">
        <div className="form-line">
          <label htmlFor="cl-reg">Regio</label>
          <input className="field" id="cl-reg" name="region" placeholder="Bijv. Nederland" />
        </div>
        <div className="form-line">
          <label htmlFor="cl-per">Peilperiode</label>
          <input className="field" id="cl-per" name="period" placeholder="Bijv. 2026 (voorlopig)" />
        </div>
      </div>
      <div className="double-field">
        <div className="form-line">
          <label htmlFor="cl-val">Getal (optioneel)</label>
          <input className="field" id="cl-val" name="numeric_value" inputMode="decimal" />
        </div>
        <div className="form-line">
          <label htmlFor="cl-unit">Eenheid</label>
          <input className="field" id="cl-unit" name="unit" placeholder="Bijv. vestigingen, €, %" />
        </div>
      </div>
      <div className="form-line">
        <label htmlFor="cl-fr">Hoe snel veroudert dit?</label>
        <select className="field" id="cl-fr" name="freshness_kind" defaultValue="statistic">
          <option value="statistic">Statistiek (3 jaar)</option>
          <option value="price">Prijs (1 jaar)</option>
          <option value="product">Productfuncties (1 jaar)</option>
          <option value="regulation">Wet- en regelgeving (1,5 jaar)</option>
          <option value="general">Algemeen (3 jaar)</option>
        </select>
      </div>
      <div className="form-line">
        <label htmlFor="cl-sup">Wat ondersteunt dit?</label>
        <input className="field" id="cl-sup" name="supports" placeholder="Bijv. de omvang van de zakelijke doelgroep" />
      </div>
      <div className="form-line">
        <label htmlFor="cl-dnp">Wat bewijst dit nog níét?</label>
        <input className="field" id="cl-dnp" name="does_not_prove" required placeholder="Bijv. dat deze bedrijven het probleem hebben of willen betalen" />
      </div>
      <div className="form-line">
        <label htmlFor="cl-def">Definitie en beperkingen</label>
        <input className="field" id="cl-def" name="definition" placeholder="Bijv. vestigingen, niet ondernemingen; inclusief eenmanszaken" />
      </div>
    </ActionForm>
  );
}
