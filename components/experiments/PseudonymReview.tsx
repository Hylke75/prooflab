"use client";

import { useId, useState } from "react";
import {
  applyPseudonyms,
  PII_KINDS,
  proposePseudonyms,
  PSEUDONYMIZE_NOTICE,
  type PiiKind,
  type PseudonymDecision,
  type PseudonymItem,
} from "@/lib/domain/pseudonymize";
import { renderTranscript, type Segment } from "@/lib/domain/transcript-parse";
import "./interviews.css";

// Fase 1 · punt 3: het controlescherm voor pseudonimiseren. Per gevonden naam, club, adres of nummer een regel met
// aan/uit (vergrendelde soorten blijven aan), het label (aanpasbaar) en het aantal keren; vrije tekst kan als extra
// naam worden gemarkeerd. Rechts (op smalle schermen eronder) het voorbeeld van de gepseudonimiseerde tekst.
// Alles gebeurt in de browser; de server stelt bij opslaan het voorstel opnieuw op en controleert het resultaat.
// De keuzes gaan als JSON mee in het formulier (verborgen velden "decisions" en "extra_names").

const PREVIEW_SEGMENTS = 60;
const EXTRA_KINDS: PiiKind[] = ["person", "club", "organisation"];

type Extra = { term: string; kind: PiiKind; label: string };

export function PseudonymReview({ segments, initial }: { segments: Segment[]; initial: PseudonymItem[] }) {
  const uid = useId();
  // Keuzes per groep (aan/uit en label), zodat varianten van één persoon samen veranderen.
  const [groups, setGroups] = useState<Record<string, { enabled: boolean; label: string }>>({});
  const [extras, setExtras] = useState<Extra[]>([]);
  const [draft, setDraft] = useState("");
  const [draftKind, setDraftKind] = useState<PiiKind>("person");
  const [note, setNote] = useState<string | null>(null);

  // Extra personen gaan door het voorstel (met varianten en telling); clubs en organisaties als losse term.
  const personExtras = extras.filter((e) => e.kind === "person").map((e) => e.term);
  const items = personExtras.length ? proposePseudonyms(segments, personExtras) : initial;

  const decisions: PseudonymDecision[] = [
    ...items.map((it) => {
      const g = groups[it.group];
      return { term: it.term, kind: it.kind, label: g?.label ?? it.label, enabled: it.locked ? true : (g?.enabled ?? it.enabled) };
    }),
    ...extras.filter((e) => e.kind !== "person").map((e) => ({ term: e.term, kind: e.kind, label: e.label, enabled: true })),
  ];

  const preview = renderTranscript(applyPseudonyms(segments.slice(0, PREVIEW_SEGMENTS), decisions)).text;

  // Eén rij per groep, met alle varianten erin.
  const byGroup = new Map<string, PseudonymItem[]>();
  for (const it of items) byGroup.set(it.group, [...(byGroup.get(it.group) ?? []), it]);
  const rows = [...byGroup.entries()].map(([group, list]) => ({ group, list, kind: list[0].kind, locked: list[0].locked, label: list[0].label, count: list.reduce((n, x) => n + x.count, 0) }));

  const addExtra = () => {
    const term = draft.replace(/\s+/g, " ").trim();
    setNote(null);
    if (term.length < 2) return setNote("Typ of plak de naam die ProofLab heeft gemist (minstens 2 tekens).");
    const inText = segments.some((s) => s.text.includes(term) || s.speaker === term);
    if (!inText) return setNote(`"${term.slice(0, 40)}" staat niet letterlijk in het transcript. Let op hoofdletters en spaties.`);
    if (items.some((i) => i.term === term) || extras.some((e) => e.term === term)) return setNote("Deze term staat al in de lijst.");
    const n = extras.filter((e) => e.kind === draftKind).length + rows.filter((r) => r.kind === draftKind).length + 1;
    setExtras([...extras, { term, kind: draftKind, label: `${PII_KINDS[draftKind].prefix} ${n}` }]);
    setDraft("");
  };

  const takeSelection = () => {
    const sel = typeof window !== "undefined" ? window.getSelection()?.toString() ?? "" : "";
    if (sel.trim()) setDraft(sel.trim().slice(0, 80));
  };

  return (
    <div className="pseudonym-review">
      <div className="note" role="note" style={{ marginTop: 0 }}>
        <strong>Controleer de pseudonimisering.</strong> {PSEUDONYMIZE_NOTICE} De originele namen en het bestand worden niet bewaard.
      </div>
      <div className="grid-2 mt-12" style={{ alignItems: "start" }}>
        <div>
          <h3 id={`${uid}-list`}>Gevonden ({rows.length})</h3>
          {rows.length === 0 && <p className="sub">ProofLab vond geen namen, clubs of contactgegevens. Lees het voorbeeld toch na.</p>}
          <ul className="pseudonym-list" aria-labelledby={`${uid}-list`}>
            {rows.map((r) => {
              const g = groups[r.group];
              const enabled = r.locked ? true : (g?.enabled ?? true);
              const label = g?.label ?? r.label;
              const id = `${uid}-${r.group.replace(/[^a-z0-9]/gi, "")}-${r.list[0].term.length}`;
              return (
                <li key={r.group} className="pseudonym-row">
                  <label className="check-row" style={{ margin: 0 }}>
                    <input
                      type="checkbox"
                      checked={enabled}
                      disabled={r.locked}
                      onChange={(e) => setGroups({ ...groups, [r.group]: { enabled: e.target.checked, label } })}
                      aria-describedby={r.locked ? `${id}-lock` : undefined}
                    />
                    <span>
                      <strong>{r.list.map((x) => x.term).join(" · ")}</strong>
                      <span className="tiny" style={{ display: "block" }}>
                        {PII_KINDS[r.kind].label} · {r.count}× {r.locked && <span id={`${id}-lock`}>(altijd vervangen)</span>}
                      </span>
                    </span>
                  </label>
                  <label className="sr-only" htmlFor={`${id}-label`}>Label voor {r.list[0].term}</label>
                  <input
                    id={`${id}-label`}
                    className="field"
                    value={label}
                    maxLength={40}
                    disabled={!enabled}
                    onChange={(e) => setGroups({ ...groups, [r.group]: { enabled, label: e.target.value } })}
                  />
                </li>
              );
            })}
            {extras
              .filter((e) => e.kind !== "person")
              .map((e) => (
                <li key={e.term} className="pseudonym-row">
                  <span>
                    <strong>{e.term}</strong>
                    <span className="tiny" style={{ display: "block" }}>{PII_KINDS[e.kind].label} · door jou gemarkeerd</span>
                  </span>
                  <button type="button" className="text-link" onClick={() => setExtras(extras.filter((x) => x.term !== e.term))}>Verwijder</button>
                </li>
              ))}
          </ul>
          <div className="form-line mt-12">
            <label htmlFor={`${uid}-extra`}>Mist ProofLab een naam? Markeer hem hier</label>
            <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
              <input id={`${uid}-extra`} className="field" style={{ flex: "1 1 180px" }} value={draft} maxLength={80} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addExtra())} />
              <label className="sr-only" htmlFor={`${uid}-kind`}>Soort</label>
              <select id={`${uid}-kind`} className="field" style={{ flex: "0 1 170px" }} value={draftKind} onChange={(e) => setDraftKind(e.target.value as PiiKind)}>
                {EXTRA_KINDS.map((k) => <option key={k} value={k}>{PII_KINDS[k].label}</option>)}
              </select>
              <button type="button" className="btn white sm" onClick={addExtra}>Markeer</button>
            </div>
            <p className="field-hint">Of selecteer de naam in het voorbeeld en kies <button type="button" className="text-link" onMouseDown={(e) => e.preventDefault()} onClick={takeSelection}>gebruik selectie</button>.</p>
            {note && <p className="field-error" role="alert">{note}</p>}
          </div>
        </div>
        <div>
          <h3 id={`${uid}-prev`}>Voorbeeld na pseudonimiseren</h3>
          <pre className="quote transcript-preview" aria-labelledby={`${uid}-prev`} tabIndex={0}>{preview}</pre>
          {segments.length > PREVIEW_SEGMENTS && <p className="tiny">De eerste {PREVIEW_SEGMENTS} van {segments.length} fragmenten. Bij opslaan wordt het hele transcript op dezelfde manier vervangen.</p>}
        </div>
      </div>
      <input type="hidden" name="decisions" value={JSON.stringify(decisions)} />
      <input type="hidden" name="extra_names" value={JSON.stringify(personExtras)} />
    </div>
  );
}
