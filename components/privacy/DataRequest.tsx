"use client";

import { useState } from "react";
import { eraseSubject, searchSubject } from "@/app/app/privacy/actions";
import { dsrLines, exportFilename, suppressionReason, type DsrResult } from "@/lib/domain/privacy";
import { FormPendingOverlay } from "@/components/ui/SavingOverlay";

const nlDate = (s: string | null | undefined) => (s ? new Date(s).toLocaleDateString("nl-NL") : "—");

function downloadJson(name: string, data: unknown) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// Search one address, show what was found per category, export as JSON, erase with a typed confirmation.
export function DataRequest({ hashReady, saltVersions }: { hashReady: boolean; saltVersions: string[] }) {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [result, setResult] = useState<DsrResult | null>(null);
  const [confirm, setConfirm] = useState("");
  const [suppress, setSuppress] = useState(true);

  async function search(e?: React.FormEvent) {
    e?.preventDefault();
    setBusy(true);
    setError(null);
    setOk(null);
    try {
      const out = await searchSubject(email);
      if (out.error) setError(out.error);
      setResult(out.result ?? null);
      setConfirm("");
    } catch {
      setError("Zoeken is mislukt. Probeer het opnieuw.");
    } finally {
      setBusy(false);
    }
  }

  async function erase() {
    if (!result) return;
    setBusy(true);
    setError(null);
    setOk(null);
    try {
      const out = await eraseSubject(result.email, { suppress: suppress && hashReady, confirm });
      if (out.error) setError(out.error);
      else {
        setOk(out.ok ?? "Verwijderd.");
        const again = await searchSubject(result.email);
        setResult(again.result ?? null);
        setConfirm("");
      }
    } catch {
      setError("Verwijderen is mislukt. Er is niets gewijzigd.");
    } finally {
      setBusy(false);
    }
  }

  const lines = result ? dsrLines(result) : [];
  const total = lines.reduce((s, l) => s + l.count, 0);
  const erasable = lines.filter((l) => l.erasable).reduce((s, l) => s + l.count, 0);

  return (
    <>
      <form className="card" onSubmit={search} aria-labelledby="dsr-h">
        <h2 className="as-h3" id="dsr-h">Zoek een e-mailadres</h2>
        <div className="copy-url">
          <label className="sr-only" htmlFor="dsr-email">E-mailadres</label>
          <input id="dsr-email" className="field" type="email" required maxLength={254} value={email} onChange={(e) => setEmail(e.target.value)} placeholder="naam@voorbeeld.nl" autoComplete="off" />
          <button className="btn primary" disabled={busy || !email.trim()}>{busy ? "Bezig…" : "Zoeken"}</button>
        </div>
        <p className="field-hint">
          {hashReady
            ? `Er wordt ook gezocht op de versleutelde adrescode onder ${saltVersions.length === 1 ? "sleutelversie" : "sleutelversies"} ${saltVersions.join(", ")}.`
            : "TRACKING_SALT(S) ontbreekt: er wordt alleen op het letterlijke adres gezocht, niet op de afmeldlijst."}
        </p>
        <FormPendingOverlay />
      </form>

      <div aria-live="polite">
        {error && <div className="form-error mt-12" role="alert">{error}</div>}
        {ok && <div className="form-ok mt-12">{ok}</div>}
      </div>

      {result && (
        <div className="card mt-18">
          <div className="section-title">
            <div>
              <h2 className="as-h3">Resultaat voor {result.email}</h2>
              <p className="tiny">Gezocht op {new Date(result.searched_at).toLocaleString("nl-NL")}. {total === 0 ? "Niets gevonden in deze werkruimte." : `${total} gegeven(s) gevonden.`}</p>
            </div>
            <button type="button" className="btn white sm" onClick={() => downloadJson(exportFilename(result.email, result.searched_at.slice(0, 10)), result)}>
              Download als JSON
            </button>
          </div>
          <table className="table mt-12">
            <thead><tr><th>Gegevens</th><th>Gevonden</th><th>Toelichting</th></tr></thead>
            <tbody>
              {lines.map((l) => (
                <tr key={l.key}><td>{l.label}</td><td className="num">{l.count}</td><td style={{ fontSize: 14 }}>{l.explain}</td></tr>
              ))}
            </tbody>
          </table>

          {result.survey_invitations.length > 0 && (
            <details className="mt-12">
              <summary className="text-link">Uitnodigingen bekijken</summary>
              <ul className="tiny" style={{ marginLeft: 18 }}>
                {result.survey_invitations.map((i) => (
                  <li key={i.id}>{i.idea} · {i.experiment} · {i.status}{i.delivery_issue ? ` (${i.delivery_issue === "bounced" ? "onbestelbaar" : "spam gemeld"})` : ""} · uitgenodigd {nlDate(i.created_at)}{i.response ? ` · antwoorden van ${nlDate(i.response.created_at)}` : ""}</li>
                ))}
              </ul>
            </details>
          )}
          {result.email_suppressions.length > 0 && (
            <p className="tiny mt-8">Op de afmeldlijst sinds {result.email_suppressions.map((s) => `${nlDate(s.created_at)} (${suppressionReason(s.reason)})`).join(", ")}.</p>
          )}
          {(result.ai_interviews?.length ?? 0) > 0 && (
            <p className="tiny mt-8">AI-gemodereerde gesprekken: {result.ai_interviews!.map((i) => `gesprekscode ${i.code} (${i.idea}, ${i.experiment}, ${nlDate(i.started_at)})`).join("; ")}.</p>
          )}
          {result.interviews.length > 0 && (
            <p className="tiny mt-8">Interviews: {result.interviews.map((i) => `${i.participant_label} (${i.idea}, ${nlDate(i.held_on)})`).join("; ")}.</p>
          )}

          <div className="mt-18" style={{ borderTop: "1px solid var(--color-border)", paddingTop: 16 }}>
            <h3>Verwijderen</h3>
            {erasable === 0 ? (
              <p className="sub" style={{ fontSize: 13 }}>Er is niets dat dit formulier kan verwijderen. Zie de toelichting hierboven voor interviews en accounts.</p>
            ) : (
              <>
                <p className="sub" style={{ fontSize: 13 }}>
                  Anonimiseert {result.survey_invitations.length} uitnodiging(en), wist {result.survey_invitations.filter((i) => i.response).length} enquêteantwoord(en)
                  en maakt {result.test_submissions.length} aanmelding(en) leeg. Dit kan niet ongedaan worden gemaakt. Verwijderde antwoorden tellen daarna niet meer mee in de
                  resultaten van de enquête; eerder vastgelegde leerkaarten en rapporten worden niet aangepast.
                </p>
                <label className="check-row">
                  <input type="checkbox" checked={suppress && hashReady} disabled={!hashReady} onChange={(e) => setSuppress(e.target.checked)} />
                  <span>Zet het adres (als versleutelde code) op de afmeldlijst, zodat deze persoon niet opnieuw wordt uitgenodigd.</span>
                </label>
                <div className="form-line">
                  <label htmlFor="dsr-confirm">Typ het e-mailadres ter bevestiging</label>
                  <input id="dsr-confirm" className="field" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="off" />
                </div>
                <button type="button" className="btn dark" disabled={busy || confirm.trim().toLowerCase() !== result.email} onClick={erase}>
                  {busy ? "Bezig…" : "Verwijder deze gegevens"}
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
