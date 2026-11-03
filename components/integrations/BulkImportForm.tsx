"use client";

import { useMemo, useState } from "react";
import { ActionForm, type FormState } from "@/components/ui/ActionForm";
import { csvColumn, dedupeFragments, guessTextColumn, MAX_FRAGMENTS, MAX_IMPORT_BYTES, parseCsv, splitFragments, type SplitMode } from "@/lib/signals/import";

type Action = (s: FormState, f: FormData) => Promise<FormState>;

export const SIGNAL_SOURCE_TYPES: [string, string][] = [
  ["review_site", "Reviews (bijv. reviewsite, app store)"],
  ["forum", "Forum / community"],
  ["other", "Enquête-antwoorden of overig"],
  ["blog", "Blog / opinie"],
  ["news", "Nieuws"],
  ["outreach", "Outreach-antwoorden"],
];

export function SourceMetaFields({ prefix, titleRequired = true }: { prefix: string; titleRequired?: boolean }) {
  return (
    <>
      <div className="double-field">
        <div className="form-line">
          <label htmlFor={`${prefix}-type`}>Soort bron</label>
          <select className="field" id={`${prefix}-type`} name="source_type" defaultValue="review_site">
            {SIGNAL_SOURCE_TYPES.map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
        </div>
        <div className="form-line">
          <label htmlFor={`${prefix}-title`}>Titel{titleRequired ? "" : " (optioneel)"}</label>
          <input
            className="field"
            id={`${prefix}-title`}
            name="title"
            required={titleRequired}
            maxLength={300}
            placeholder={titleRequired ? "Bijv. Reviews van concurrent X, oktober 2026" : "Standaard: de paginatitel"}
          />
        </div>
      </div>
      <div className="double-field">
        <div className="form-line">
          <label htmlFor={`${prefix}-pub`}>Platform of uitgever</label>
          <input className="field" id={`${prefix}-pub`} name="publisher" maxLength={200} placeholder="Bijv. Trustpilot, Reddit, eigen enquête" />
        </div>
        <div className="form-line">
          <label htmlFor={`${prefix}-date`}>Datum (publicatie of export)</label>
          <input className="field" id={`${prefix}-date`} name="published_on" type="date" />
        </div>
      </div>
    </>
  );
}

// Paste many fragments or upload a CSV and pick the text column. The browser shows a preview; the server
// splits, checks and deduplicates again.
export function BulkImportForm({ action }: { action: Action }) {
  const [mode, setMode] = useState<"paste" | "csv">("paste");
  const [text, setText] = useState("");
  const [split, setSplit] = useState<SplitMode>("auto");
  const [rows, setRows] = useState<string[][] | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [hasHeader, setHasHeader] = useState(true);
  const [column, setColumn] = useState(0);

  const fragments = useMemo(() => {
    if (mode === "paste") return splitFragments(text, split);
    return rows ? csvColumn(rows, column, hasHeader) : [];
  }, [mode, text, split, rows, column, hasHeader]);
  const preview = useMemo(() => dedupeFragments(fragments, { max: Number.MAX_SAFE_INTEGER }), [fragments]);
  const tooMany = fragments.length > MAX_FRAGMENTS;
  const header = rows?.[0] ?? [];

  const onFile = async (file: File | undefined) => {
    setRows(null);
    setFileError(null);
    if (!file) return;
    if (file.size > MAX_IMPORT_BYTES) {
      setFileError("Het bestand is groter dan 1 MB. Splits het op of exporteer alleen de kolom met de tekst.");
      return;
    }
    const parsed = parseCsv(await file.text());
    if (parsed.length === 0) {
      setFileError("Dit bestand bevat geen rijen.");
      return;
    }
    setRows(parsed);
    setColumn(guessTextColumn(parsed, true));
  };

  return (
    <ActionForm action={action} submitLabel="Importeer als klantsignalen" pendingLabel="Importeren…" resetOnSuccess>
      <fieldset className="form-line" style={{ border: 0, padding: 0, margin: 0 }}>
        <legend className="field-label">Wat wil je importeren?</legend>
        <div className="row" style={{ gap: 14 }}>
          <label className="check-row"><input type="radio" name="mode" value="paste" checked={mode === "paste"} onChange={() => setMode("paste")} /> Tekst plakken</label>
          <label className="check-row"><input type="radio" name="mode" value="csv" checked={mode === "csv"} onChange={() => setMode("csv")} /> CSV-bestand</label>
        </div>
      </fieldset>
      <SourceMetaFields prefix="imp" />
      <div className="form-line">
        <label htmlFor="imp-url">URL (optioneel)</label>
        <input className="field" id="imp-url" name="url" type="url" maxLength={2000} placeholder="https://…" />
      </div>
      {mode === "paste" ? (
        <>
          <div className="form-line">
            <label htmlFor="imp-text">Fragmenten</label>
            <textarea
              className="field"
              id="imp-text"
              name="text"
              value={text}
              onChange={(e) => setText(e.target.value)}
              style={{ minHeight: 170 }}
              placeholder={"Eén review of antwoord per regel,\nof meerdere regels per fragment met een lege regel ertussen."}
              aria-describedby="imp-count"
            />
          </div>
          <div className="form-line">
            <label htmlFor="imp-split">Scheiding</label>
            <select className="field" id="imp-split" name="split" value={split} onChange={(e) => setSplit(e.target.value as SplitMode)}>
              <option value="auto">Automatisch (lege regel als die er is, anders per regel)</option>
              <option value="line">Eén fragment per regel</option>
              <option value="blank">Fragmenten gescheiden door een lege regel</option>
            </select>
          </div>
        </>
      ) : (
        <>
          <div className="form-line">
            <label htmlFor="imp-file">CSV-bestand (max. 1 MB, {MAX_FRAGMENTS.toLocaleString("nl-NL")} rijen)</label>
            <input className="field" id="imp-file" type="file" accept=".csv,.tsv,.txt,text/csv,text/plain" onChange={(e) => onFile(e.target.files?.[0])} aria-describedby="imp-count" />
            {fileError && <div className="form-error" role="alert" style={{ marginTop: 8 }}>{fileError}</div>}
          </div>
          {rows && (
            <div className="double-field">
              <div className="form-line">
                <label htmlFor="imp-col">Kolom met de tekst</label>
                <select className="field" id="imp-col" value={column} onChange={(e) => setColumn(Number(e.target.value))}>
                  {Array.from({ length: Math.max(...rows.slice(0, 50).map((r) => r.length)) }, (_, i) => (
                    <option key={i} value={i}>
                      {hasHeader && header[i] ? header[i].slice(0, 60) : `Kolom ${i + 1}`} — “{(rows[hasHeader ? 1 : 0]?.[i] ?? "").slice(0, 40)}”
                    </option>
                  ))}
                </select>
              </div>
              <div className="form-line" style={{ alignSelf: "end" }}>
                <label className="check-row"><input type="checkbox" checked={hasHeader} onChange={(e) => setHasHeader(e.target.checked)} /> De eerste rij bevat kolomnamen</label>
              </div>
            </div>
          )}
          <input type="hidden" name="fragments_json" value={JSON.stringify(fragments.slice(0, MAX_FRAGMENTS + 1))} />
        </>
      )}
      <p id="imp-count" className="tiny" role="status" aria-live="polite">
        {fragments.length === 0
          ? "Nog geen fragmenten."
          : `${preview.fragments.length.toLocaleString("nl-NL")} unieke fragmenten${preview.duplicates ? `, ${preview.duplicates} dubbel` : ""}${preview.tooShort ? `, ${preview.tooShort} te kort` : ""}${preview.truncated ? `, ${preview.truncated} worden ingekort tot 6.000 tekens` : ""}.`}
        {tooMany && ` Te veel: maximaal ${MAX_FRAGMENTS.toLocaleString("nl-NL")} per import.`}
      </p>
      {preview.fragments.length > 0 && (
        <details>
          <summary className="tiny" style={{ cursor: "pointer" }}>Bekijk de eerste fragmenten</summary>
          <ul className="reply-list">
            {preview.fragments.slice(0, 5).map((f, i) => (
              <li key={i}>{f.length > 300 ? `${f.slice(0, 300)}…` : f}</li>
            ))}
          </ul>
        </details>
      )}
      <label className="check-row mt-12">
        <input type="checkbox" name="no_personal_data" required /> Ik heb namen, e-mailadressen en andere persoonsgegevens uit deze tekst verwijderd.
      </label>
    </ActionForm>
  );
}
