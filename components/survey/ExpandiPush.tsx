"use client";

import { useState } from "react";
import { deleteExpandiHook, exportExpandiCsv, pushToExpandi, saveExpandiHook, type ExpandiState } from "@/app/app/ideas/[id]/experiments/[expId]/expandi-actions";
import { LINK_PLACEHOLDER, MAX_PUSH_CONTACTS, MESSAGE_PLACEHOLDER, parseContacts } from "@/lib/integrations/expandi-push";

export type ExpandiHook = { masked: string; pushed: number; lastPush: string | null };

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

// LinkedIn DM via Expandi: contacts (profile URL + first name) go to the campaign's inbound webhook, with the DM
// text and the post link as placeholders; or as a CSV for Expandi's import. Honest about what goes where.
export function ExpandiPush({ ideaId, expId, postId, hook, link, unsaved }: { ideaId: string; expId: string; postId: string; hook: ExpandiHook | null; link: string; unsaved: boolean }) {
  const [url, setUrl] = useState("");
  const [contacts, setContacts] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<ExpandiState | null>(null);
  const parsed = parseContacts(contacts);
  const id = `expandi-${postId}`;

  const run = async (fn: () => Promise<ExpandiState>) => {
    setBusy(true);
    setMsg(null);
    try {
      const out = await fn();
      if (out.csv) download("outreach-contacten.csv", out.csv);
      setMsg(out);
    } catch {
      setMsg({ error: "Er ging iets mis. Probeer het opnieuw." });
    } finally {
      setBusy(false);
    }
  };

  return (
    <details className="mt-12">
      <summary className="text-link">Naar een outreachcampagne sturen</summary>
      <div className="note" role="note">
        <strong>Wat er gebeurt.</strong> ProofLab stuurt per contact het LinkedIn-profiel, de voornaam en twee placeholders naar de
        webhook van één outreachcampagne: <span className="mono">{`{${MESSAGE_PLACEHOLDER}}`}</span> (dit bericht, met de voornaam ingevuld) en{" "}
        <span className="mono">{`{${LINK_PLACEHOLDER}}`}</span> (de link van dit bericht: <span className="mono">{link}</span>). De outreachtool kan via de
        webhook geen berichtsjabloon instellen: zet die placeholders zelf in het campagnebericht in de outreachtool. De outreachtool verstuurt
        connectieverzoeken en berichten volgens de campagne en zijn eigen daglimieten. ProofLab bewaart de profiel-URL&apos;s en namen niet.
      </div>
      {unsaved && <p className="form-error mt-8">Je hebt de tekst aangepast maar nog niet opgeslagen. Naar de outreachcampagne gaat de opgeslagen versie.</p>}

      <div className="form-line">
        <label htmlFor={`${id}-url`}>Webhook-URL van de campagne</label>
        {hook ? (
          <p className="tiny" id={`${id}-url`}>
            Opgeslagen: <span className="mono">{hook.masked}</span> · {hook.pushed} contact(en) doorgezet
            {hook.lastPush ? `, laatst op ${new Date(hook.lastPush).toLocaleDateString("nl-NL")}` : ""}.{" "}
            <button type="button" className="text-link" disabled={busy} onClick={() => run(() => deleteExpandiHook(ideaId, expId))}>Verwijder URL</button>
          </p>
        ) : (
          <>
            <div className="copy-url" style={{ marginTop: 0 }}>
              <input id={`${id}-url`} className="field mono" type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://api.liaufa.com/api/v1/open-api/…" aria-describedby={`${id}-url-hint`} autoComplete="off" />
              <button type="button" className="btn dark sm" disabled={busy || !url.trim()} onClick={() => run(() => saveExpandiHook(ideaId, expId, url))}>Opslaan</button>
            </div>
            <p id={`${id}-url-hint`} className="field-hint">
              In je outreachtool: campagne → Webhooks → &quot;Assign people by using a webhook&quot;. De URL bevat de sleutel van de campagne; alleen consultants zien hem.
            </p>
          </>
        )}
      </div>

      <div className="form-line">
        <label htmlFor={`${id}-list`}>Contacten (één per regel: profiel-URL;voornaam)</label>
        <textarea id={`${id}-list`} className="field mono" rows={4} value={contacts} onChange={(e) => setContacts(e.target.value)} placeholder={"https://www.linkedin.com/in/sanne-de-vries;Sanne"} aria-describedby={`${id}-list-hint`} />
        <p id={`${id}-list-hint`} className="field-hint" aria-live="polite">
          {parsed.contacts.length} geldig{parsed.invalid.length ? ` · ${parsed.invalid.length} zonder geldige profiel-URL` : ""}{parsed.duplicates ? ` · ${parsed.duplicates} dubbel` : ""}. Maximaal {MAX_PUSH_CONTACTS} per keer via de webhook.
        </p>
      </div>
      <label className="check-row">
        <input type="checkbox" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} />
        <span>Deze mensen mogen voor dit onderzoek benaderd worden en de campagne in de outreachtool staat klaar met de placeholders.</span>
      </label>
      <div className="row mt-8">
        <button type="button" className="btn primary sm" disabled={busy || !hook || !confirm || parsed.contacts.length === 0} onClick={() => run(() => pushToExpandi(ideaId, expId, postId, { contacts, confirm }))}>
          {busy ? "Bezig…" : `Stuur ${parsed.contacts.length || ""} naar de outreachcampagne`}
        </button>
        <button type="button" className="btn white sm" disabled={busy || parsed.contacts.length === 0} onClick={() => run(() => exportExpandiCsv(ideaId, expId, postId, contacts))}>
          Download CSV voor import in de outreachtool
        </button>
      </div>
      <div aria-live="polite">
        {msg?.error && <div className="form-error mt-8" role="alert">{msg.error}</div>}
        {msg?.ok && !msg.error && <div className="form-ok mt-8">{msg.ok}</div>}
        {msg?.errors && msg.errors.length > 0 && !msg.error && <ul className="tiny">{msg.errors.map((e) => <li key={e}>{e}</li>)}</ul>}
      </div>
    </details>
  );
}
