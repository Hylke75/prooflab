"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  MAX_INVITES,
  REMINDER_AFTER_DAYS,
  checkTemplate,
  guessEmailColumn,
  guessNameColumn,
  parseAddressList,
  parseCsv,
  recipientsFromCsv,
  renderInvitationEmail,
  type InvitationCounts,
  type InvitationTemplate,
  type ParsedList,
} from "@/lib/domain/survey-distribution";
import type { StartJobResult, SurveyJob } from "@/lib/survey-jobs";
import {
  cancelSurveyJob,
  createInvitations,
  exportInvitationLinks,
  startInvitationSend,
  startReminderSend,
  surveyJobStatus,
} from "@/app/app/ideas/[id]/experiments/[expId]/survey-actions";

type Props = {
  ideaId: string;
  expId: string;
  live: boolean;
  stateNote: string | null;
  emailReady: boolean;
  trackingReady: boolean;
  surveyUrl: string;
  researcher: string;
  invite: InvitationTemplate;
  reminder: InvitationTemplate;
  counts: InvitationCounts;
  job: SurveyJob | null;
};

const ACTIVE = new Set(["queued", "running"]);
const POLL_MS = 3000;

function jobLabel(job: SurveyJob): string {
  const what = job.kind === "survey_reminder" ? "Herinneringen versturen" : "Uitnodigingen versturen";
  switch (job.status) {
    case "queued":
      return job.attempts > 0 ? `${what}: wacht op een nieuwe poging` : `${what}: in de wachtrij`;
    case "running":
      return `${what}: bezig`;
    case "done":
      return `${what}: klaar`;
    case "cancelled":
      return `${what}: gestopt`;
    default:
      return `${what}: mislukt`;
  }
}

function download(name: string, csv: string) {
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// Bulk e-mail invitations: paste or upload addresses, confirm the legal basis, edit and preview the mail, then send
// in batches with visible progress. Without a mail connection: create the invitations and download the personal links.
export function Invitations(p: Props) {
  const [mode, setMode] = useState<"paste" | "csv">("paste");
  const [pasted, setPasted] = useState("");
  const [csvRows, setCsvRows] = useState<string[][] | null>(null);
  const [csvName, setCsvName] = useState("");
  const [emailCol, setEmailCol] = useState(-1);
  const [nameCol, setNameCol] = useState(-1);
  const [basis, setBasis] = useState(false);
  const [template, setTemplate] = useState<InvitationTemplate>(p.invite);
  const [reminder, setReminder] = useState<InvitationTemplate>(p.reminder);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [job, setJob] = useState<SurveyJob | null>(p.job);
  const [busy, setBusy] = useState(false);
  const [stopping, setStopping] = useState(false);
  const router = useRouter();
  const active = !!job && ACTIVE.has(job.status);

  // While a send job is queued or running: poll its progress (the poll also wakes the worker when no cron
  // picked it up yet) and refresh the counts once it ends. Sending continues when this tab is closed.
  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    const timer = setInterval(async () => {
      const res = await surveyJobStatus(p.ideaId, p.expId);
      if (cancelled || res.error || !res.job) return;
      setJob(res.job);
      if (!ACTIVE.has(res.job.status)) router.refresh();
    }, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [active, p.ideaId, p.expId, router]);

  const list: ParsedList = useMemo(() => {
    if (mode === "paste") return parseAddressList(pasted);
    if (!csvRows) return { recipients: [], invalid: [], duplicates: 0 };
    return recipientsFromCsv(csvRows, emailCol, nameCol);
  }, [mode, pasted, csvRows, emailCol, nameCol]);
  const tooMany = list.recipients.length > MAX_INVITES;
  const templateProblem = checkTemplate(template);
  const sample = list.recipients[0] ?? { email: "voorbeeld@example.com", name: "Sanne" };
  const preview = renderInvitationEmail({
    template,
    name: sample.name,
    link: `${p.surveyUrl}?u=persoonlijke-code`,
    unsubscribeUrl: `${p.surveyUrl.replace(/\/s\/[^/]+$/, "")}/s/afmelden?u=persoonlijke-code`,
    researcher: p.researcher,
  });
  const disabled = !p.live || !p.trackingReady || active;

  function started(res: StartJobResult): boolean {
    if (res.error) {
      setError(res.error);
      return false;
    }
    if (res.job) setJob(res.job);
    if (res.existing) setNotice("Er loopt al een verzending voor deze enquête; die wordt eerst afgemaakt.");
    return true;
  }

  async function stopJob() {
    if (!job) return;
    setStopping(true);
    try {
      const res = await cancelSurveyJob(p.ideaId, p.expId, job.id);
      if (res.error) setError(res.error);
      else if (res.job) setJob(res.job);
      router.refresh();
    } finally {
      setStopping(false);
    }
  }

  async function submit() {
    setError(null);
    setNotice(null);
    if (!basis) return setError("Bevestig dat je een grondslag hebt om deze mensen te mailen.");
    if (list.recipients.length === 0) return setError("Voeg minstens één geldig e-mailadres toe.");
    if (tooMany) return setError(`Maximaal ${MAX_INVITES.toLocaleString("nl-NL")} adressen per keer.`);
    if (p.emailReady && templateProblem) return setError(templateProblem);
    setBusy(true);
    try {
      const res = await createInvitations(p.ideaId, p.expId, { recipients: list.recipients, basis });
      if (res.error) return setError(res.error);
      const skipped = [
        res.existing ? `${res.existing} al eerder uitgenodigd` : null,
        res.suppressed ? `${res.suppressed} afgemeld (worden nooit meer gemaild)` : null,
        res.invalid ? `${res.invalid} ongeldig` : null,
      ].filter(Boolean);
      setNotice(`${res.created?.length ?? 0} nieuwe uitnodigingen aangemaakt${skipped.length ? `; overgeslagen: ${skipped.join(", ")}` : ""}.`);
      const created = new Set(res.created ?? []);
      if (created.size === 0) return;
      if (p.emailReady) {
        const recipients = list.recipients.filter((r) => created.has(r.email));
        if (!started(await startInvitationSend(p.ideaId, p.expId, { scope: "new", recipients, template, basis }))) return;
      } else {
        const out = await exportInvitationLinks(p.ideaId, p.expId);
        if (out.error || !out.csv) return setError(out.error ?? "De links konden niet worden gemaakt.");
        download("persoonlijke-enquetelinks.csv", out.csv);
      }
      setPasted("");
      setCsvRows(null);
    } finally {
      setBusy(false);
    }
  }

  async function sendOpen() {
    setError(null);
    setNotice(null);
    if (!basis) return setError("Bevestig eerst dat je een grondslag hebt om deze mensen te mailen.");
    if (templateProblem) return setError(templateProblem);
    setBusy(true);
    try {
      started(await startInvitationSend(p.ideaId, p.expId, { scope: "open", template, basis }));
    } finally {
      setBusy(false);
    }
  }

  async function exportOpen() {
    setError(null);
    setBusy(true);
    try {
      const out = await exportInvitationLinks(p.ideaId, p.expId);
      if (out.error || !out.csv) return setError(out.error ?? "De links konden niet worden gemaakt.");
      download("persoonlijke-enquetelinks.csv", out.csv);
      setNotice(`${out.count} persoonlijke links gedownload.`);
    } finally {
      setBusy(false);
    }
  }

  async function remind() {
    setError(null);
    setNotice(null);
    const problem = checkTemplate(reminder);
    if (problem) return setError(problem);
    setBusy(true);
    try {
      started(await startReminderSend(p.ideaId, p.expId, { template: reminder }));
    } finally {
      setBusy(false);
    }
  }

  const c = p.counts;
  const unsent = c.pending + c.failed;

  return (
    <div className="card mt-18">
      <div className="section-title">
        <div>
          <h3 id="inv-h">Persoonlijke uitnodigingen per e-mail</h3>
          <p className="sub" style={{ fontSize: 13 }}>Antwoorden via een persoonlijke link komen van bekende mensen en tellen apart van de open link.</p>
        </div>
        <span className={`pill ${p.emailReady ? "green" : "orange"}`}>{p.emailReady ? "E-mail gekoppeld" : "E-mail niet gekoppeld"}</span>
      </div>

      <div className="grid-3" role="list" aria-label="Stand van de uitnodigingen" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(110px,1fr))" }}>
        {[
          ["Uitgenodigd", c.invited],
          ["Verstuurd", c.sent],
          ["Mislukt", c.failed],
          ["Ingevuld", c.responded],
          ["Afgemeld", c.unsubscribed],
          ["Onbestelbaar", c.bounced],
          ["Spam gemeld", c.complained],
        ].map(([label, n]) => (
          <div className="live-stat" role="listitem" key={label}>
            <small>{label}</small>
            <strong className="num">{n}</strong>
          </div>
        ))}
      </div>
      {c.pending > 0 && <p className="tiny mt-8">{c.pending} uitnodiging(en) nog niet via ProofLab verstuurd{p.emailReady ? "" : " (persoonlijke links gedownload of nog te downloaden)"}.</p>}

      {!p.emailReady && (
        <div className="note">
          <strong>E-mail niet gekoppeld.</strong> ProofLab kan nu zelf niet mailen (RESEND_API_KEY en EMAIL_FROM ontbreken). Maak de
          uitnodigingen wel aan: je downloadt dan een CSV met per adres een persoonlijke link en een afmeldlink, die je vanuit je eigen
          e-mailprogramma verstuurt. De links werken gewoon; ProofLab weet dan alleen niet of de mail is aangekomen, dus herinneringen
          verstuur je ook zelf.
        </div>
      )}
      {p.stateNote && <div className="note">{p.stateNote}</div>}
      {p.live && !p.trackingReady && <div className="form-error">Persoonlijke links zijn niet geconfigureerd (INGEST_SECRET en TRACKING_SALT ontbreken).</div>}

      <fieldset disabled={disabled || busy} style={{ border: 0, padding: 0, margin: "18px 0 0", minWidth: 0 }}>
        <legend className="eyebrow" style={{ padding: 0 }}>1. Adressen</legend>
        <div className="filter-strip" role="group" aria-label="Manier van toevoegen">
          <button type="button" className={`filter-btn${mode === "paste" ? " active" : ""}`} aria-pressed={mode === "paste"} onClick={() => setMode("paste")}>Plakken</button>
          <button type="button" className={`filter-btn${mode === "csv" ? " active" : ""}`} aria-pressed={mode === "csv"} onClick={() => setMode("csv")}>CSV uploaden</button>
        </div>
        {mode === "paste" ? (
          <div className="form-line">
            <label htmlFor="inv-list">E-mailadressen</label>
            <textarea
              id="inv-list"
              className="field mono"
              rows={6}
              value={pasted}
              onChange={(e) => setPasted(e.target.value)}
              placeholder={"sanne@voorbeeld.nl\nJan de Vries <jan@voorbeeld.nl>"}
              aria-describedby="inv-list-hint"
            />
            <p id="inv-list-hint" className="field-hint">Eén adres per regel, of &quot;Naam &lt;adres&gt;&quot;. Een lijst met puntkomma&apos;s uit Outlook werkt ook. Maximaal {MAX_INVITES.toLocaleString("nl-NL")} per keer.</p>
          </div>
        ) : (
          <div className="form-line">
            <label htmlFor="inv-csv">CSV-bestand</label>
            <input
              id="inv-csv"
              className="field"
              type="file"
              accept=".csv,text/csv"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                if (f.size > 5_000_000) return setError("Dit bestand is groter dan 5 MB.");
                const rows = parseCsv(await f.text());
                setCsvRows(rows);
                setCsvName(f.name);
                setEmailCol(guessEmailColumn(rows));
                setNameCol(guessNameColumn(rows));
              }}
            />
            {csvRows && csvRows.length > 0 && (
              <div className="double-field mt-12">
                <div className="form-line">
                  <label htmlFor="inv-col">Kolom met e-mailadres</label>
                  <select id="inv-col" className="field" value={emailCol} onChange={(e) => setEmailCol(Number(e.target.value))}>
                    <option value={-1}>Kies een kolom</option>
                    {csvRows[0].map((h, i) => <option key={i} value={i}>{h.trim() || `Kolom ${i + 1}`}</option>)}
                  </select>
                </div>
                <div className="form-line">
                  <label htmlFor="inv-name">Kolom met naam (optioneel)</label>
                  <select id="inv-name" className="field" value={nameCol} onChange={(e) => setNameCol(Number(e.target.value))}>
                    <option value={-1}>Geen</option>
                    {csvRows[0].map((h, i) => <option key={i} value={i}>{h.trim() || `Kolom ${i + 1}`}</option>)}
                  </select>
                </div>
              </div>
            )}
            {csvName && <p className="field-hint">{csvName}: {csvRows?.length ?? 0} regels. Namen worden alleen in de aanhef gebruikt en niet opgeslagen.</p>}
          </div>
        )}
        <p className="tiny mt-8" role="status">
          {list.recipients.length} geldige adressen
          {list.duplicates ? ` · ${list.duplicates} dubbel (overgeslagen)` : ""}
          {list.invalid.length ? ` · ${list.invalid.length} ongeldig` : ""}
          {tooMany ? ` · te veel: maximaal ${MAX_INVITES.toLocaleString("nl-NL")}` : ""}
        </p>
        {list.invalid.length > 0 && (
          <details className="mt-8">
            <summary className="text-link">Ongeldige regels bekijken</summary>
            <ul className="reply-list">{list.invalid.slice(0, 20).map((x, i) => <li key={i}>{x}</li>)}</ul>
          </details>
        )}
        <p className="field-hint">Adressen die zich eerder afmeldden bij jouw organisatie en mensen die al zijn uitgenodigd, worden automatisch overgeslagen.</p>

        <label className="check-row mt-12">
          <input type="checkbox" checked={basis} onChange={(e) => setBasis(e.target.checked)} required />
          <span><strong>Ik heb een grondslag om deze mensen te mailen (bestaande relatie of toestemming).</strong> Koop of scrape geen adressenlijsten.</span>
        </label>

        {p.emailReady && (
          <>
            <div className="eyebrow mt-18">2. Bericht</div>
            <div className="grid-2">
              <div>
                <div className="form-line">
                  <label htmlFor="inv-subject">Onderwerp</label>
                  <input id="inv-subject" className="field" maxLength={150} value={template.subject} onChange={(e) => setTemplate({ ...template, subject: e.target.value })} />
                </div>
                <div className="form-line">
                  <label htmlFor="inv-body">Tekst</label>
                  <textarea id="inv-body" className="field" rows={12} value={template.body} onChange={(e) => setTemplate({ ...template, body: e.target.value })} aria-describedby="inv-body-hint" />
                  <p id="inv-body-hint" className="field-hint">{"{naam}"} wordt de naam (of weggelaten als die er niet is), {"{link}"} de persoonlijke link. De privacyregel en afmeldlink worden altijd toegevoegd.</p>
                </div>
                {templateProblem && <p className="field-error">{templateProblem}</p>}
              </div>
              <div>
                <div className="eyebrow">Voorbeeld{sample.name ? ` · aan ${sample.name}` : ""}</div>
                <div className="quote" style={{ whiteSpace: "pre-wrap", fontSize: 14, maxHeight: 420, overflow: "auto" }} aria-label="Voorbeeld van de e-mail">
                  <strong>Onderwerp: {preview.subject}</strong>
                  {"\n\n"}
                  {preview.text}
                </div>
                <p className="tiny">Platte tekst met een eenvoudige HTML-versie. Geen afbeeldingen, trackingpixels of trackinglinks.</p>
              </div>
            </div>
          </>
        )}

        <div className="row mt-12">
          <button type="button" className="btn primary" onClick={submit} disabled={disabled || busy || list.recipients.length === 0 || tooMany}>
            {busy ? "Bezig…" : p.emailReady ? `Verstuur uitnodigingen (${list.recipients.length})` : `Maak persoonlijke links (${list.recipients.length}) en download CSV`}
          </button>
          {unsent > 0 && (p.emailReady ? (
            <button type="button" className="btn white" onClick={sendOpen} disabled={disabled || busy}>Verstuur openstaande ({unsent})</button>
          ) : (
            <button type="button" className="btn white" onClick={exportOpen} disabled={disabled || busy}>Download persoonlijke links ({unsent})</button>
          ))}
        </div>
      </fieldset>

      {error && <div className="form-error mt-12" role="alert">{error}</div>}
      {notice && <div className="form-ok mt-12" role="status">{notice}</div>}

      {job && (
        <div className="mt-12" role="status" aria-live="polite">
          <label htmlFor="inv-progress" className="field-label" style={{ marginTop: 0 }}>
            {jobLabel(job)} · {job.progress.done} van {job.progress.total} verwerkt · {job.progress.sent} verstuurd
            {job.progress.failed ? ` · ${job.progress.failed} mislukt` : ""}
            {job.progress.skipped ? ` · ${job.progress.skipped} overgeslagen` : ""}
          </label>
          <progress id="inv-progress" max={Math.max(1, job.progress.total)} value={job.progress.done} style={{ width: "100%", accentColor: "var(--blue)" }} />
          {active && (
            <p className="tiny mt-8">
              ProofLab verstuurt op de achtergrond; je kunt dit tabblad sluiten.{" "}
              <button type="button" className="text-link" onClick={stopJob} disabled={stopping}>
                {stopping ? "Stoppen…" : "Stop verzending"}
              </button>
            </p>
          )}
          {job.status === "cancelled" && <p className="tiny mt-8">Gestopt. Wie nog niet gemaild is, staat bij &quot;Verstuur openstaande&quot;.</p>}
          {job.lastError && job.status !== "done" && <p className="field-error">{job.lastError}</p>}
          {job.progress.errors.length > 0 && <ul className="field-error" style={{ margin: "6px 0 0 18px" }}>{job.progress.errors.map((e) => <li key={e}>{e}</li>)}</ul>}
        </div>
      )}

      <div className="divider" />
      <div className="eyebrow">Herinnering</div>
      {!p.emailReady ? (
        <p className="sub" style={{ fontSize: 13 }}>Herinneringen kan ProofLab alleen versturen met een e-mailkoppeling.</p>
      ) : c.remindable === 0 ? (
        <p className="sub" style={{ fontSize: 13 }}>
          Eén herinnering is mogelijk, op zijn vroegst {REMINDER_AFTER_DAYS} dagen na de eerste e-mail, alleen aan wie nog niet reageerde of zich afmeldde.
          Er is nu niemand aan wie een herinnering kan.
        </p>
      ) : (
        <details>
          <summary className="text-link">Herinnering sturen aan {c.remindable} {c.remindable === 1 ? "persoon" : "mensen"} die nog niet reageerden</summary>
          <div className="form-line mt-8">
            <label htmlFor="rem-subject">Onderwerp</label>
            <input id="rem-subject" className="field" maxLength={150} value={reminder.subject} onChange={(e) => setReminder({ ...reminder, subject: e.target.value })} />
          </div>
          <div className="form-line">
            <label htmlFor="rem-body">Tekst</label>
            <textarea id="rem-body" className="field" rows={8} value={reminder.body} onChange={(e) => setReminder({ ...reminder, body: e.target.value })} />
            <p className="field-hint">Dezelfde persoonlijke link als in de eerste e-mail. Iedereen krijgt maximaal één herinnering.</p>
          </div>
          <button type="button" className="btn dark" onClick={remind} disabled={disabled || busy}>Verstuur {c.remindable} herinnering{c.remindable === 1 ? "" : "en"}</button>
        </details>
      )}
    </div>
  );
}
