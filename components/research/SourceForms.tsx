"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { SOURCE_PREFILL_EVENT, SOURCE_TITLE_PARAM, type SourcePrefill } from "./source-prefill";
import { ActionForm, type FormState } from "@/components/ui/ActionForm";
import { checkQuote } from "@/lib/domain/verify";
import { EVIDENCE_TYPES, SOURCE_TYPES } from "@/lib/domain/labels";

type Action = (s: FormState, f: FormData) => Promise<FormState>;

export function AddSourceForm({ action }: { action: Action }) {
  const titleRef = useRef<HTMLInputElement>(null);
  const urlRef = useRef<HTMLInputElement>(null);
  const typeRef = useRef<HTMLSelectElement>(null);
  const excerptRef = useRef<HTMLTextAreaElement>(null);
  const [prefilled, setPrefilled] = useState<string | null>(null);
  const [fromDocument, setFromDocument] = useState(false);
  // Een kandidaat-bron uit het zoeklogboek: URL en titel invullen, het citaat plakt de gebruiker zelf.
  // Een eigen document (stap Markt, "Gebruik als bron"): alleen de titel; ook dan plakt de gebruiker het fragment zelf.
  useEffect(() => {
    const apply = (d: SourcePrefill) => {
      if (titleRef.current) titleRef.current.value = d.title.slice(0, 300);
      if (d.origin === "document") {
        setFromDocument(true);
        setPrefilled(null);
        requestAnimationFrame(() => {
          titleRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
          titleRef.current?.focus({ preventScroll: true });
        });
        return;
      }
      if (urlRef.current) urlRef.current.value = d.url;
      if (typeRef.current) typeRef.current.value = "other";
      setFromDocument(false);
      setPrefilled(d.url);
      requestAnimationFrame(() => {
        excerptRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
        excerptRef.current?.focus({ preventScroll: true });
      });
    };
    const onPrefill = (e: Event) => {
      const d = (e as CustomEvent<SourcePrefill>).detail;
      if (d?.url || (d?.origin === "document" && d.title)) apply(d);
    };
    window.addEventListener(SOURCE_PREFILL_EVENT, onPrefill);
    // Vanaf een andere pagina (bijv. Bronnen & koppelingen) komt de titel via de querystring.
    const fromUrl = new URL(window.location.href).searchParams.get(SOURCE_TITLE_PARAM);
    if (fromUrl) apply({ url: "", title: fromUrl, origin: "document" });
    return () => window.removeEventListener(SOURCE_PREFILL_EVENT, onPrefill);
  }, []);
  return (
    <ActionForm action={action} submitLabel="Bron opslaan" resetOnSuccess>
      {fromDocument && (
        <div className="note" role="status" style={{ marginTop: 0 }}>
          Titel overgenomen uit je document. Een document is geen bron vanzelf: kies het type bron, vul eventueel de URL of
          vindplaats in en plak het relevante fragment letterlijk uit het document. ProofLab controleert daarna het citaat zoals bij elke bron.
        </div>
      )}
      {prefilled && (
        <div className="note" role="status" style={{ marginTop: 0 }}>
          Kandidaat-bron overgenomen. Open de pagina, kies het type bron en plak hieronder het relevante fragment letterlijk. Pas daarna kan een
          bevinding met citaat meetellen.
        </div>
      )}
      <div className="double-field">
        <div className="form-line">
          <label htmlFor="src-title">Titel van de bron</label>
          <input ref={titleRef} className="field" id="src-title" name="title" required placeholder="Bijv. Vestigingen van bedrijven; bedrijfstak, regio" />
        </div>
        <div className="form-line">
          <label htmlFor="src-type">Type bron</label>
          <select ref={typeRef} className="field" id="src-type" name="source_type" defaultValue="official_statistic">
            {Object.entries(SOURCE_TYPES).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
          <p className="field-hint">Reviews, forumdraden en reacties van klanten: kies Reviewsite of Forum. Ze verschijnen dan bij Doelgroepen → Klantsignalen.</p>
        </div>
      </div>
      <div className="form-line">
        <label htmlFor="src-url">URL of dataset-ID</label>
        <input ref={urlRef} className="field" id="src-url" name="url" type="url" placeholder="https://www.cbs.nl/…" />
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
        <textarea ref={excerptRef} className="field" id="src-excerpt" name="excerpt" required minLength={20} maxLength={6000} placeholder="Plak hier de passage of tabelregel waar je bevinding op steunt. Alleen dit fragment wordt bewaard, niet het hele document." />
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
  const [chosen, setExcerptId] = useState(excerpts[0]?.id ?? "");
  // New sources arrive via revalidation; fall back to the newest one when nothing valid is chosen.
  const excerptId = excerpts.some((e) => e.id === chosen) ? chosen : (excerpts[0]?.id ?? "");
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
        <p className="field-hint">
          Letterlijk is nog niet genoeg: na opslaan beoordeel je bij de bevinding of het citaat de bewering ook inhoudelijk draagt (zelf, of met een
          AI-voorstel). Een citaat dat de bewering niet draagt, telt niet als bewijs.
        </p>
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
      <p className="explain">
        Populatie, regio en peildatum zijn verplicht. Staat iets niet in de bron, schrijf dan &quot;onbekend&quot;. Wijkt een veld af van de intake, dan telt de bevinding als indirect.
      </p>
      <div className="form-line">
        <label htmlFor="cl-pop">Populatie</label>
        <input className="field" id="cl-pop" name="population" required maxLength={200} placeholder="Bijv. mkb-bedrijven met 10-50 werknemers, of onbekend" />
      </div>
      <div className="double-field">
        <div className="form-line">
          <label htmlFor="cl-reg">Regio</label>
          <input className="field" id="cl-reg" name="region" required maxLength={120} placeholder="Bijv. Nederland, of onbekend" />
        </div>
        <div className="form-line">
          <label htmlFor="cl-ref">Peildatum</label>
          <input className="field" id="cl-ref" name="reference_date" required maxLength={40} placeholder="Bijv. 2025, 2025-06 of onbekend" />
        </div>
      </div>
      <div className="form-line">
        <label htmlFor="cl-per">Peilperiode (optioneel)</label>
        <input className="field" id="cl-per" name="period" placeholder="Bijv. 2026 (voorlopig)" />
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
