"use client";

import "./report-import.css";
import { useEffect, useId, useRef, useState } from "react";
import { ActionForm, Field, type FormState } from "@/components/ui/ActionForm";
import { SavingOverlay } from "@/components/ui/SavingOverlay";
import { DirectionField } from "@/components/ui/DirectionField";
import { EVIDENCE_TYPES, SOURCE_TYPES, type EvidenceType } from "@/lib/domain/labels";
import { defaultsForSource, deviationHint } from "@/lib/domain/source-defaults";
import { checkImportFile, defaultTitle, IMPORT_ACCEPT, IMPORT_LABEL, IMPORT_SOURCE_TYPES, MAX_IMPORT_BYTES, MAX_PDF_PAGES } from "@/lib/domain/report-import";
import { formatBytes, NOTE_STEP_LABELS, validateFile, type NoteStep } from "@/lib/domain/step-files";
import { prepareStepUpload, recordStepDocument } from "@/app/app/ideas/[id]/step-notes-actions";
import { importReport, proposeFindingsFromReport, saveReportFinding, type ReportProposalView } from "@/app/app/ideas/[id]/research/import-actions";
import { REPORT_IMPORT_ANCHOR, REPORT_IMPORT_EVENT, REPORT_IMPORT_PARAM } from "./report-import-event";

// Bestaand onderzoek importeren (tab Bronnen). Stap 1: een rapport uploaden of een al geüpload document kiezen; de
// server leest de tekst uit en bewaart die als bron met letterlijke blokken. Stap 2: bevindingen vastleggen met een
// letterlijk citaat, zelf of uit AI-voorstellen die de consultant per stuk accepteert of verwerpt.

export type ImportableDoc = { id: string; fileName: string; size: number; description: string | null; step: NoteStep };
// sourceType (gebruikerstest B2): bepaalt de standaard soort informatie en versheid van een bevinding uit het rapport.
export type ImportedReport = { id: string; title: string; blocks: number; findings: number; sourceType?: string };
type Question = { id: string; position: number; question: string };

const stem = (name: string) => defaultTitle(name);

export function ReportImport({
  ideaId,
  supabaseUrl,
  supabaseKey,
  documents,
  reports,
  questions,
  aiAvailable,
}: {
  ideaId: string;
  supabaseUrl: string;
  supabaseKey: string;
  documents: ImportableDoc[];
  reports: ImportedReport[];
  questions: Question[];
  aiAvailable: boolean;
}) {
  const [activeReport, setActiveReport] = useState<string | null>(reports[0]?.id ?? null);
  const current = reports.find((r) => r.id === activeReport) ?? reports[0] ?? null;
  return (
    <section className="card mt-18" id={REPORT_IMPORT_ANCHOR} aria-labelledby={`${REPORT_IMPORT_ANCHOR}-kop`}>
      <h3 id={`${REPORT_IMPORT_ANCHOR}-kop`}>Bestaand onderzoek importeren</h3>
      <p className="sub" style={{ margin: "6px 0 12px" }}>
        Heb je al een marktrapport, brancheonderzoek of eigen analyse? Importeer het bestand: ProofLab leest de tekst uit en bewaart die als bron. Een
        bevinding telt pas als het citaat woord voor woord in het rapport staat.
      </p>
      <ImportForm ideaId={ideaId} supabaseUrl={supabaseUrl} supabaseKey={supabaseKey} documents={documents} onImported={(id) => setActiveReport(id)} />
      {current && (
        <div className="report-work mt-24">
          <h4 className="report-work-title">Bevindingen uit een geïmporteerd rapport</h4>
          {reports.length > 1 && (
            <div className="form-line">
              <label htmlFor="ri-report">Rapport</label>
              <select className="field" id="ri-report" value={current.id} onChange={(e) => setActiveReport(e.target.value)}>
                {reports.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.title} ({r.blocks} blokken, {r.findings} {r.findings === 1 ? "bevinding" : "bevindingen"})
                  </option>
                ))}
              </select>
            </div>
          )}
          {reports.length === 1 && (
            <p className="tiny">
              <strong>{current.title}</strong> · {current.blocks} {current.blocks === 1 ? "tekstblok" : "tekstblokken"} · {current.findings}{" "}
              {current.findings === 1 ? "bevinding" : "bevindingen"}
            </p>
          )}
          <ReportFindings key={current.id} ideaId={ideaId} report={current} questions={questions} aiAvailable={aiAvailable} />
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Stap 1: importeren
// ---------------------------------------------------------------------------

type Phase = "idle" | "uploading" | "reading";

function ImportForm({
  ideaId,
  supabaseUrl,
  supabaseKey,
  documents,
  onImported,
}: {
  ideaId: string;
  supabaseUrl: string;
  supabaseKey: string;
  documents: ImportableDoc[];
  onImported: (sourceId: string) => void;
}) {
  const ids = useId();
  const formRef = useRef<HTMLFormElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<"upload" | "document">("upload");
  const [docId, setDocId] = useState(documents[0]?.id ?? "");
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [ok, setOk] = useState<string | null>(null);
  const busy = phase !== "idle";
  const urlHandled = useRef(false);

  // Vanuit "Notities en documenten": het gekozen document voorselecteren (event op deze pagina, of ?importeer=…).
  useEffect(() => {
    const choose = (id: string) => {
      const doc = documents.find((d) => d.id === id);
      if (!doc) return;
      setMode("document");
      setDocId(doc.id);
      if (titleRef.current) titleRef.current.value = (doc.description?.trim() || stem(doc.fileName)).slice(0, 300);
      requestAnimationFrame(() => {
        const el = document.getElementById(REPORT_IMPORT_ANCHOR);
        el?.scrollIntoView({ behavior: "smooth", block: "start" });
        titleRef.current?.focus({ preventScroll: true });
      });
    };
    const onEvent = (e: Event) => {
      const id = (e as CustomEvent<{ documentId?: string }>).detail?.documentId;
      if (id) choose(id);
    };
    window.addEventListener(REPORT_IMPORT_EVENT, onEvent);
    // De parameter uit de link één keer toepassen en daarna uit de adresbalk halen (anders kiest elke verversing opnieuw).
    if (!urlHandled.current) {
      urlHandled.current = true;
      const url = new URL(window.location.href);
      const fromUrl = url.searchParams.get(REPORT_IMPORT_PARAM);
      if (fromUrl) {
        choose(fromUrl);
        url.searchParams.delete(REPORT_IMPORT_PARAM);
        window.history.replaceState(null, "", url);
      }
    }
    return () => window.removeEventListener(REPORT_IMPORT_EVENT, onEvent);
  }, [documents]);

  const fe = (name: string) => fieldErrors[name];
  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    setOk(null);
    setFieldErrors({});
    const form = e.currentTarget;
    const data = new FormData(form);
    const meta = {
      title: String(data.get("title") ?? ""),
      publisher: String(data.get("publisher") ?? ""),
      published: String(data.get("published") ?? ""),
      sourceType: String(data.get("source_type") ?? "research_report") as (typeof IMPORT_SOURCE_TYPES)[number],
      isPrimary: data.get("is_primary") === "on",
      url: String(data.get("url") ?? ""),
    };
    let target: { documentId?: string; storagePath?: string };
    try {
      if (mode === "upload") {
        const input = form.elements.namedItem("file") as HTMLInputElement;
        const file = input.files?.[0];
        if (!file) {
          setFieldErrors({ file: "Kies eerst een bestand." });
          input.focus();
          return;
        }
        const importable = checkImportFile(file);
        const storable = validateFile(file);
        if (!importable.ok || !storable.ok) {
          setFieldErrors({ file: !importable.ok ? importable.error : storable.ok ? "" : storable.error });
          input.focus();
          return;
        }
        // Het origineel komt bij Notities en documenten (stap Markt), zodat het rapport zelf altijd terug te vinden is.
        setPhase("uploading");
        const ticket = await prepareStepUpload(ideaId, "market", { name: file.name, size: file.size, type: file.type });
        if (ticket.error !== null) {
          setError(ticket.error);
          return;
        }
        const { createClient } = await import("@supabase/supabase-js");
        const storage = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } }).storage;
        const body = new File([file], file.name, { type: ticket.mime });
        const { error: upError } = await storage.from("step-documents").uploadToSignedUrl(ticket.path, ticket.token, body, { contentType: ticket.mime, upsert: false });
        if (upError) {
          setError("Uploaden mislukt. Controleer je verbinding en probeer het opnieuw.");
          return;
        }
        const recorded = await recordStepDocument(ideaId, "market", ticket.path, file.name, meta.title ? `Geïmporteerd onderzoek: ${meta.title}`.slice(0, 500) : "Geïmporteerd onderzoek");
        if (recorded.error) {
          setError(recorded.error);
          return;
        }
        target = { storagePath: ticket.path };
      } else {
        if (!docId) {
          setFieldErrors({ document: "Kies een document." });
          return;
        }
        target = { documentId: docId };
      }
      setPhase("reading");
      const res = await importReport(ideaId, { ...target, ...meta });
      if (res.error !== null) {
        setError(target.storagePath ? `${res.error} Het bestand zelf staat wel bij Notities en documenten; verwijder het daar als je het niet wilt bewaren.` : res.error);
        if (res.fieldErrors) setFieldErrors(res.fieldErrors);
        return;
      }
      setOk(res.ok);
      formRef.current?.reset();
      setMode("upload");
      onImported(res.sourceId);
    } catch {
      setError("Importeren mislukt. Probeer het opnieuw.");
    } finally {
      setPhase("idle");
    }
  };

  const id = (n: string) => `${ids}-${n}`;
  const described = (n: string, hint = false) => [fe(n) ? `${id(n)}-err` : null, hint ? `${id(n)}-hint` : null].filter(Boolean).join(" ") || undefined;
  const errorOf = (n: string) =>
    fe(n) ? (
      <p className="field-error" id={`${id(n)}-err`} role="alert">
        {fe(n)}
      </p>
    ) : null;

  return (
    <form ref={formRef} onSubmit={submit} noValidate aria-label="Bestaand onderzoek importeren" aria-busy={busy || undefined}>
      {documents.length > 0 && (
        <fieldset className="report-mode">
          <legend className="field-label">Welk bestand?</legend>
          <label className="check-row">
            <input type="radio" name="mode" value="upload" checked={mode === "upload"} onChange={() => setMode("upload")} /> Nieuw bestand uploaden
          </label>
          <label className="check-row">
            <input type="radio" name="mode" value="document" checked={mode === "document"} onChange={() => setMode("document")} /> Een document uit Notities en documenten
          </label>
        </fieldset>
      )}
      {mode === "upload" ? (
        <div className="form-line">
          <label htmlFor={id("file")}>
            Rapport<span className="req"> (verplicht)</span>
          </label>
          <input
            id={id("file")}
            name="file"
            type="file"
            className="field"
            accept={IMPORT_ACCEPT}
            aria-required
            aria-invalid={fe("file") ? true : undefined}
            aria-describedby={described("file", true)}
            onChange={(e) => {
              setFieldErrors((f) => ({ ...f, file: "" }));
              const f = e.currentTarget.files?.[0];
              if (f && titleRef.current && !titleRef.current.value.trim()) titleRef.current.value = stem(f.name);
            }}
          />
          {errorOf("file")}
          <p className="field-hint" id={`${id("file")}-hint`}>
            {IMPORT_LABEL}; maximaal {formatBytes(MAX_IMPORT_BYTES)} en {MAX_PDF_PAGES} pagina&apos;s. Een gescande PDF zonder tekstlaag kan ProofLab niet lezen. Het bestand komt ook bij
            Notities en documenten, zodat het origineel terug te vinden is.
          </p>
        </div>
      ) : (
        <div className="form-line">
          <label htmlFor={id("document")}>
            Document<span className="req"> (verplicht)</span>
          </label>
          <select
            id={id("document")}
            className="field"
            value={docId}
            aria-invalid={fe("document") ? true : undefined}
            aria-describedby={described("document")}
            onChange={(e) => {
              setDocId(e.target.value);
              const doc = documents.find((d) => d.id === e.target.value);
              if (doc && titleRef.current) titleRef.current.value = (doc.description?.trim() || stem(doc.fileName)).slice(0, 300);
            }}
          >
            {documents.map((d) => (
              <option key={d.id} value={d.id}>
                {d.fileName} ({formatBytes(d.size)}, {NOTE_STEP_LABELS[d.step]})
              </option>
            ))}
          </select>
          {errorOf("document")}
        </div>
      )}
      <div className="double-field">
        <div className="form-line">
          <label htmlFor={id("title")}>Titel van het rapport</label>
          <input ref={titleRef} id={id("title")} name="title" className="field" maxLength={300} autoComplete="off" placeholder="Bijv. Marktmonitor evenementenbranche 2025" />
        </div>
        <div className="form-line">
          <label htmlFor={id("type")}>Type bron</label>
          <select id={id("type")} name="source_type" className="field" defaultValue="research_report" aria-describedby={`${id("type")}-hint`}>
            {IMPORT_SOURCE_TYPES.map((k) => (
              <option key={k} value={k}>
                {SOURCE_TYPES[k]}
              </option>
            ))}
          </select>
          <p className="field-hint" id={`${id("type")}-hint`}>
            Kies &quot;Officiële statistiek&quot; alleen voor een publicatie van bijvoorbeeld CBS of Eurostat.
          </p>
        </div>
      </div>
      <div className="double-field">
        <div className="form-line">
          <label htmlFor={id("publisher")}>Uitgever of auteur</label>
          <input id={id("publisher")} name="publisher" className="field" maxLength={200} autoComplete="off" placeholder="Bijv. branchevereniging, onderzoeksbureau" />
        </div>
        <div className="form-line">
          <label htmlFor={id("published")}>Jaar of peildatum</label>
          <input
            id={id("published")}
            name="published"
            className="field"
            maxLength={40}
            inputMode="numeric"
            autoComplete="off"
            placeholder="Bijv. 2025 of 2025-03"
            aria-invalid={fe("published") ? true : undefined}
            aria-describedby={described("published", true)}
          />
          {errorOf("published")}
          <p className="field-hint" id={`${id("published")}-hint`}>
            Leeg als je het niet weet: dan staat de datum als onbekend.
          </p>
        </div>
      </div>
      <div className="form-line">
        <label htmlFor={id("url")}>Webadres van het rapport (optioneel)</label>
        <input id={id("url")} name="url" type="url" className="field" maxLength={2000} placeholder="https://…" aria-invalid={fe("url") ? true : undefined} aria-describedby={described("url")} />
        {errorOf("url")}
      </div>
      <label className="check-row">
        <input type="checkbox" name="is_primary" /> Primaire bron (de eerste publicatie van deze cijfers, niet overgenomen)
      </label>
      <div className="form-feedback" aria-live="polite">
        {busy && (
          <div className="note" role="status" style={{ marginTop: 0 }}>
            {phase === "uploading" ? "Bestand uploaden…" : "Tekst uitlezen en opslaan… Bij een groot rapport kan dit een halve minuut duren."}
          </div>
        )}
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
          {phase === "uploading" ? "Uploaden…" : phase === "reading" ? "Uitlezen…" : "Rapport importeren"}
        </button>
      </div>
      <SavingOverlay active={busy} label={phase === "uploading" ? "Bestand uploaden…" : "Tekst uitlezen…"} />
    </form>
  );
}

// ---------------------------------------------------------------------------
// Stap 2: bevindingen vastleggen (zelf, of uit AI-voorstellen)
// ---------------------------------------------------------------------------

function ReportFindings({ ideaId, report, questions, aiAvailable }: { ideaId: string; report: ImportedReport; questions: Question[]; aiAvailable: boolean }) {
  const [proposals, setProposals] = useState<ReportProposalView[]>([]);
  const [read, setRead] = useState<{ from: number; to: number; total: number } | null>(null);
  const [dropped, setDropped] = useState<{ notFound: number; numbersMismatch: number }>({ notFound: 0, numbersMismatch: 0 });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [openKey, setOpenKey] = useState<string | null>(null);

  const ask = async (from: number) => {
    setLoading(true);
    setError(null);
    setSaved(null);
    try {
      const res = await proposeFindingsFromReport(ideaId, report.id, from);
      if (res.error !== null) {
        setError(res.error);
        return;
      }
      setProposals(res.proposals);
      setRead(res.read);
      setDropped(res.dropped);
      setOpenKey(null);
    } catch {
      setError("De AI kon het rapport nu niet lezen. Probeer het later opnieuw.");
    } finally {
      setLoading(false);
    }
  };
  const remove = (key: string) => setProposals((list) => list.filter((p) => p.key !== key));
  const droppedTotal = dropped.notFound + dropped.numbersMismatch;
  const more = read && read.to < read.total;

  return (
    <>
      {aiAvailable ? (
        <div className="report-ai">
          <p className="sub" style={{ margin: "0 0 10px" }}>
            De AI leest het rapport en stelt bevindingen voor, elk met een letterlijk citaat. ProofLab laat alleen voorstellen zien waarvan het citaat woord voor woord in
            het rapport staat. Jij beslist per voorstel; pas na accepteren wordt het een bevinding. Voorstellen worden niet bewaard tot je ze accepteert.
          </p>
          <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
            <button type="button" className="btn primary" onClick={() => ask(0)} disabled={loading} aria-busy={loading || undefined}>
              {loading ? "AI leest het rapport…" : read ? "Opnieuw vanaf het begin" : "Laat de AI bevindingen voorstellen"}
            </button>
            {more && (
              <button type="button" className="btn white" onClick={() => ask(read.to)} disabled={loading}>
                Lees het volgende deel (vanaf blok {read.to + 1})
              </button>
            )}
          </div>
          <div aria-live="polite">
            {loading && (
              <p className="note" role="status">
                De AI leest een deel van het rapport. Dit kan een minuut duren en kost een klein deel van het AI-budget.
              </p>
            )}
            {error && (
              <div className="form-error" role="alert">
                {error}
              </div>
            )}
            {saved && (
              <div className="form-ok" role="status">
                {saved}
              </div>
            )}
            {read && !loading && (
              <p className="tiny mt-8">
                Gelezen: blok {read.from + 1} tot en met {read.to} van {read.total}. {proposals.length} {proposals.length === 1 ? "voorstel" : "voorstellen"} over
                {droppedTotal > 0 && (
                  <>
                    ; {droppedTotal} weggelaten omdat het citaat niet letterlijk in het rapport stond{dropped.numbersMismatch ? " of de getallen niet klopten" : ""}
                  </>
                )}
                .
              </p>
            )}
          </div>
          {proposals.length > 0 && (
            <ul className="report-proposals">
              {proposals.map((p) => (
                <li key={p.key} className="report-proposal">
                  <div className="row" style={{ gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                    <span className="pill blue">AI-voorstel</span>
                    <span className={`pill ${p.stance === "supports" ? "green" : "coral"}`}>{p.stance === "supports" ? "ondersteunt" : "spreekt tegen"}</span>
                    {p.location && <span className="tiny">{p.location}</span>}
                  </div>
                  <p className="report-proposal-statement">{p.statement}</p>
                  <blockquote className="quote">{p.quote}</blockquote>
                  {openKey === p.key ? (
                    <FindingForm
                      ideaId={ideaId}
                      sourceId={report.id}
                      sourceType={report.sourceType}
                      questions={questions}
                      proposal={p}
                      onCancel={() => setOpenKey(null)}
                      onSaved={(msg) => {
                        remove(p.key);
                        setOpenKey(null);
                        setSaved(msg);
                      }}
                    />
                  ) : (
                    <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                      <button type="button" className="btn primary sm" onClick={() => setOpenKey(p.key)} aria-label={`Accepteren en controleren: ${p.statement.slice(0, 80)}`}>
                        Accepteren…
                      </button>
                      <button type="button" className="btn clear sm" onClick={() => remove(p.key)} aria-label={`Verwerpen: ${p.statement.slice(0, 80)}`}>
                        Verwerpen
                      </button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <p className="note" style={{ marginTop: 0 }}>
          AI is niet verbonden. Leg de bevindingen zelf vast: kopieer een passage letterlijk uit het rapport, ProofLab zoekt het tekstblok en controleert het citaat.
        </p>
      )}
      <details className="mt-18 report-manual" open={!aiAvailable || undefined}>
        <summary className="btn white sm">Zelf een bevinding vastleggen</summary>
        <div className="mt-12">
          <FindingForm ideaId={ideaId} sourceId={report.id} sourceType={report.sourceType} questions={questions} proposal={null} />
        </div>
      </details>
    </>
  );
}

const SECTIONS = {
  market: "Markt en trends",
  customers: "Klant en probleem",
  competition: "Concurrentie",
  pricing: "Prijs en koopproces",
  sizing: "Marktomvang",
  regulation: "Regels en context",
  other: "Overig",
} as const;

const FRESHNESS = {
  statistic: "Statistiek (3 jaar)",
  price: "Prijs (1 jaar)",
  product: "Productfuncties (1 jaar)",
  regulation: "Wet- en regelgeving (1,5 jaar)",
  general: "Algemeen (3 jaar)",
} as const;

function FindingForm({
  ideaId,
  sourceId,
  sourceType,
  questions,
  proposal,
  onCancel,
  onSaved,
}: {
  ideaId: string;
  sourceId: string;
  sourceType?: string;
  questions: Question[];
  proposal: ReportProposalView | null;
  onCancel?: () => void;
  onSaved?: (message: string) => void;
}) {
  const ids = useId();
  const id = (n: string) => `${ids}-${n}`;
  const p = proposal;
  // Gebruikerstest B2: soort informatie en versheid volgen het brontype van het rapport (of het AI-voorstel), tot de
  // gebruiker ze zelf wijzigt; een afwijking van de standaard staat bij het veld.
  const defaults = defaultsForSource(sourceType);
  const [evidenceType, setEvidenceType] = useState<string>(p?.evidenceType ?? defaults.evidenceType);
  const [freshness, setFreshness] = useState<string>(p?.freshnessKind ?? defaults.freshness);
  const action = async (s: FormState, f: FormData): Promise<FormState> => {
    const r = await saveReportFinding(ideaId, sourceId, s, f);
    if (r.ok && !r.error && onSaved) onSaved(r.ok);
    return r;
  };
  return (
    <ActionForm
      action={action}
      submitLabel={p ? "Bevinding accepteren en opslaan" : "Bevinding toetsen en opslaan"}
      pendingLabel="Citaat controleren…"
      resetOnSuccess={!p}
      noValidate
      footer={
        onCancel ? (
          <button type="button" className="btn clear sm" onClick={onCancel}>
            Annuleren
          </button>
        ) : undefined
      }
    >
      {p && <input type="hidden" name="from_ai" value="1" />}
      {p && (
        <p className="explain" style={{ marginTop: 0 }}>
          Controleer het voorstel en pas aan wat niet klopt. Populatie, regio en peildatum alleen als het rapport ze noemt, anders &quot;onbekend&quot;.
        </p>
      )}
      <Field name="statement" id={id("statement")} label="Bevinding (één zin)" required>
        <input className="field" defaultValue={p?.statement ?? ""} maxLength={600} />
      </Field>
      <Field
        name="quote"
        id={id("quote")}
        label="Letterlijk citaat uit het rapport"
        required
        hint="Kopieer de tekst precies zoals hij in het rapport staat. ProofLab zoekt zelf het tekstblok en controleert ook de getallen."
      >
        <textarea className="field" defaultValue={p?.quote ?? ""} maxLength={1500} style={{ minHeight: 70 }} />
      </Field>
      <div className="double-field">
        <Field name="question_id" id={id("question")} label="Hoort bij onderzoeksvraag">
          <select className="field" defaultValue={p ? (p.questionId ?? "") : (questions[0]?.id ?? "")}>
            {questions.map((q) => (
              <option key={q.id} value={q.id}>
                {q.position}. {q.question.slice(0, 60)}
              </option>
            ))}
            <option value="">Geen specifieke vraag</option>
          </select>
        </Field>
        {/* Gebruikerstest C1: hetzelfde richting-veld als bij een gewone bron. */}
        <DirectionField kind="quote" id={id("stance")} name="stance" defaultValue={p?.stance ?? "supports"} />
      </div>
      <div className="double-field">
        <Field
          name="evidence_type"
          id={id("et")}
          label="Soort informatie"
          hint={evidenceType !== defaults.evidenceType ? `${deviationHint(sourceType)} (${EVIDENCE_TYPES[defaults.evidenceType].toLowerCase()}).` : undefined}
        >
          <select className="field" value={evidenceType} onChange={(e) => setEvidenceType(e.target.value as EvidenceType)}>
            {Object.entries(EVIDENCE_TYPES)
              .filter(([k]) => !["ai_inference", "synthetic_simulation"].includes(k))
              .map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
          </select>
        </Field>
        <Field name="section" id={id("section")} label="Onderdeel">
          <select className="field" defaultValue={p?.section ?? "market"}>
            {Object.entries(SECTIONS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <Field name="population" id={id("pop")} label="Populatie" required>
        <input className="field" defaultValue={p?.population ?? ""} maxLength={200} placeholder="Bijv. mkb-bedrijven met 10-50 werknemers, of onbekend" />
      </Field>
      <div className="double-field">
        <Field name="region" id={id("region")} label="Regio" required>
          <input className="field" defaultValue={p?.region ?? ""} maxLength={120} placeholder="Bijv. Nederland, of onbekend" />
        </Field>
        <Field name="reference_date" id={id("ref")} label="Peildatum" required>
          <input className="field" defaultValue={p?.referenceDate ?? ""} maxLength={40} placeholder="Bijv. 2025, 2025-06 of onbekend" />
        </Field>
      </div>
      <div className="double-field">
        <Field name="numeric_value" id={id("num")} label="Getal (optioneel)">
          <input className="field" defaultValue={p?.numericValue ?? ""} inputMode="decimal" />
        </Field>
        <Field name="unit" id={id("unit")} label="Eenheid">
          <input className="field" defaultValue={p?.unit ?? ""} maxLength={40} placeholder="Bijv. bedrijven, €, %" />
        </Field>
      </div>
      <Field name="freshness_kind" id={id("fr")} label="Hoe snel veroudert dit?" hint={freshness !== defaults.freshness ? `${deviationHint(sourceType)}.` : undefined}>
        <select className="field" value={freshness} onChange={(e) => setFreshness(e.target.value)}>
          {Object.entries(FRESHNESS).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
      </Field>
      <Field name="does_not_prove" id={id("dnp")} label="Wat bewijst dit nog níét?" required>
        <input className="field" defaultValue={p?.doesNotProve ?? ""} maxLength={400} placeholder="Bijv. dat deze bedrijven willen betalen" />
      </Field>
    </ActionForm>
  );
}
