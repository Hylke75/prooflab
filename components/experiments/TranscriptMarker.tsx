"use client";

import { useId, useRef, useState } from "react";
import { ActionForm, Field, type FormState } from "@/components/ui/ActionForm";
import { DirectionField } from "@/components/ui/DirectionField";
import { OBSERVATION_KINDS } from "@/lib/domain/labels";
import { formatTimestamp, type StoredSegment } from "@/lib/domain/transcript-parse";
import { LINK_CHANGES_PROBABILITY } from "@/lib/domain/quote-marking";
import "./interviews.css";

// Fase 1 · punt 3: markeren om te citeren. Selecteer een stuk van een uitspraak; ProofLab neemt het letterlijk over met
// begin en einde in het transcript, en de server controleert beide. Zonder muis: typ of plak het citaat (ProofLab
// zoekt het op als het precies één keer voorkomt). Koppelen aan een aanname is een aparte, expliciete keuze.

const KINDS = ["problem_confirmed", "problem_absent", "current_behaviour", "current_spend", "counter_example", "objection", "opinion", "other"] as const;

export type Mark = { id: string; start: number; end: number };
export type CodeOption = { id: string; label: string };

// Offset in het transcript voor een punt in de DOM: het tekstblok (data-start) plus de tekens ervoor.
function offsetOf(node: Node, offset: number): number | null {
  const el = (node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement)?.closest("[data-start]");
  if (!el) return null;
  const r = document.createRange();
  r.setStart(el, 0);
  r.setEnd(node, offset);
  return Number(el.getAttribute("data-start")) + r.toString().length;
}

function pieces(text: string, base: number, marks: Mark[]) {
  const inside = marks.filter((m) => m.end > base && m.start < base + text.length).sort((a, b) => a.start - b.start);
  const out: { text: string; marked: boolean; key: string }[] = [];
  let pos = base;
  for (const m of inside) {
    const s = Math.max(m.start, pos);
    if (s > pos) out.push({ text: text.slice(pos - base, s - base), marked: false, key: `t${pos}` });
    const e = Math.min(m.end, base + text.length);
    if (e > s) out.push({ text: text.slice(s - base, e - base), marked: true, key: `m${m.id}${s}` });
    pos = Math.max(pos, e);
  }
  if (pos < base + text.length) out.push({ text: text.slice(pos - base), marked: false, key: `t${pos}` });
  return out;
}

export function TranscriptMarker({
  transcript,
  segments,
  marks,
  action,
  canMark,
  isTest,
  assumptions,
  defaultAssumption,
  codes = [],
}: {
  transcript: string;
  segments: StoredSegment[];
  marks: Mark[];
  action: (state: FormState, form: FormData) => Promise<FormState>;
  canMark: boolean;
  isTest: boolean;
  assumptions: { id: string; statement: string }[];
  defaultAssumption: string | null;
  codes?: CodeOption[];
}) {
  const uid = useId();
  const box = useRef<HTMLDivElement>(null);
  const [quote, setQuote] = useState("");
  const [pos, setPos] = useState<{ start: number; end: number } | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const take = () => {
    setNote(null);
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return setNote("Selecteer eerst een stuk tekst in het transcript.");
    const range = sel.getRangeAt(0);
    if (!box.current?.contains(range.commonAncestorContainer)) return setNote("Selecteer tekst in het transcript hierboven.");
    let start = offsetOf(range.startContainer, range.startOffset);
    let end = offsetOf(range.endContainer, range.endOffset);
    if (start == null || end == null) return setNote("Selecteer alleen de tekst van een uitspraak, zonder de tijd en de spreker.");
    // Spaties aan de randen horen niet bij het citaat.
    while (start < end && /\s/.test(transcript[start])) start++;
    while (end > start && /\s/.test(transcript[end - 1])) end--;
    if (!segments.some((s) => start! >= s.a && end! <= s.b)) return setNote("Markeer binnen één uitspraak.");
    setPos({ start, end });
    setQuote(transcript.slice(start, end));
  };

  return (
    <div>
      <div
        ref={box}
        className="transcript-body"
        tabIndex={0}
        role="document"
        aria-label="Transcript (gepseudonimiseerd)"
        // Automatisch overnemen alleen als er echt iets geselecteerd is (een klik zonder selectie geeft geen melding).
        onMouseUp={canMark ? () => !window.getSelection()?.isCollapsed && take() : undefined}
        onKeyUp={canMark ? (e) => e.shiftKey && !window.getSelection()?.isCollapsed && take() : undefined}
      >
        {segments.map((s, i) => {
          const lineStart = i === 0 ? 0 : segments[i - 1].b + 1;
          const head = transcript.slice(Math.min(lineStart, s.a), s.a);
          const text = transcript.slice(s.a, s.b);
          return (
            <p className="transcript-line" key={s.a} id={`seg-${i}`}>
              {head && <span className="seg-head" title={s.t0 != null ? formatTimestamp(s.t0) : undefined}>{head}</span>}
              <span className="seg-text" data-start={s.a}>
                {pieces(text, s.a, marks).map((p) => (p.marked ? <mark key={p.key}>{p.text}</mark> : <span key={p.key}>{p.text}</span>))}
              </span>
            </p>
          );
        })}
      </div>
      <p className="tiny mt-8">Gemarkeerde stukken zijn al als observatie vastgelegd. Tijden en sprekers zijn geen onderdeel van een citaat.</p>

      {canMark && (
        <div className="marker-bar" aria-labelledby={`${uid}-h`}>
          <h3 id={`${uid}-h`} style={{ fontSize: 15, margin: 0 }}>Maak observatie</h3>
          <ActionForm action={action} submitLabel="Leg observatie vast" pendingLabel="Controleren en vastleggen…" noValidate>
            <Field name="quote" id={`${uid}-q`} label="Citaat (letterlijk uit het transcript)" required hint="Selecteer tekst hierboven, of typ of plak het citaat: ProofLab zoekt het op.">
              <textarea
                className="field"
                rows={3}
                value={quote}
                onChange={(e) => {
                  setQuote(e.target.value);
                  setPos(null);
                }}
              />
            </Field>
            <div className="row" style={{ gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <button type="button" className="btn white sm" onMouseDown={(e) => e.preventDefault()} onClick={take}>Gebruik selectie</button>
              {pos && <span className="tiny">Positie {pos.start}–{pos.end} in het transcript</span>}
            </div>
            {note && <p className="field-error" role="alert">{note}</p>}
            <input type="hidden" name="quote_start" value={pos?.start ?? ""} />
            <input type="hidden" name="quote_end" value={pos?.end ?? ""} />
            <div className="double-field mt-8">
              <Field name="kind" id={`${uid}-k`} label="Soort observatie" required>
                <select className="field" defaultValue="current_behaviour">
                  {KINDS.map((k) => <option key={k} value={k}>{OBSERVATION_KINDS[k]}</option>)}
                </select>
              </Field>
              <Field name="summary" id={`${uid}-s`} label="Korte samenvatting" required>
                <input className="field" maxLength={400} />
              </Field>
            </div>
            {codes.length > 0 && (
              <fieldset className="form-line" style={{ border: 0, padding: 0 }}>
                <legend style={{ fontSize: 14, fontWeight: 600, marginBottom: 6 }}>Thema&apos;s (optioneel, tellen nooit mee in de kans)</legend>
                <div className="row" style={{ gap: "4px 14px", flexWrap: "wrap" }}>
                  {codes.map((c) => (
                    <label className="check-row" key={c.id} style={{ margin: 0 }}>
                      <input type="checkbox" name="code_ids" value={c.id} /> {c.label}
                    </label>
                  ))}
                </div>
              </fieldset>
            )}
            {isTest ? (
              <>
                <Field name="assumption_id" id={`${uid}-a`} label="Koppel aan aanname" hint={LINK_CHANGES_PROBABILITY}>
                  {/* Expliciet: standaard niet gekoppeld. De aanname van deze test staat bovenaan. */}
                  <select className="field" defaultValue="">
                    <option value="">Niet koppelen (de kans verandert niet)</option>
                    {[...assumptions].sort((x, y) => Number(y.id === defaultAssumption) - Number(x.id === defaultAssumption)).map((a) => (
                      <option key={a.id} value={a.id}>{a.id === defaultAssumption ? `${a.statement} (deze test)` : a.statement}</option>
                    ))}
                  </select>
                </Field>
                <DirectionField kind="statement" id={`${uid}-rel`} name="relation" neutral defaultValue="neutral" />
              </>
            ) : (
              <p className="tiny">Verkennend interview: dit citaat telt mee in thema&apos;s, maar wordt niet aan een aanname gekoppeld en verandert geen kans.</p>
            )}
          </ActionForm>
        </div>
      )}
    </div>
  );
}
