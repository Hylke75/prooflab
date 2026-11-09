"use client";

import { useActionState, useState } from "react";
import { keepValuesOnSubmit } from "@/components/ui/ActionForm";
import type { EndpointState } from "@/app/app/ideas/[id]/integrations/actions";
import { FormPendingOverlay } from "@/components/ui/SavingOverlay";

type Action = (s: EndpointState, f: FormData) => Promise<EndpointState>;

// "Koppel Expandi": creates a webhook endpoint and shows its URL exactly once, with the setup steps.
export function ExpandiConnect({ action, configured }: { action: Action; configured: boolean }) {
  const [state, formAction, pending] = useActionState<EndpointState, FormData>(action, { error: null, ok: null, url: null });
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    if (!state.url) return;
    try {
      await navigator.clipboard.writeText(state.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div>
      <form action={formAction} onSubmit={(e) => keepValuesOnSubmit(e, formAction)}>
        {state.error && <div className="form-error" role="alert">{state.error}</div>}
        <div className="form-line">
          <label htmlFor="exp-label">Naam van de koppeling</label>
          <input className="field" id="exp-label" name="label" required minLength={2} maxLength={120} defaultValue="LinkedIn-outreach" />
        </div>
        <div className="row mt-12">
          <button className="btn primary" disabled={pending}>{pending ? "Koppelen…" : "Koppel outreachtool"}</button>
        </div>
        <FormPendingOverlay />
      </form>
      {state.url && (
        <div className="insight-card" role="status">
          <strong>{state.ok}</strong>
          <div className="copy-url">
            <label className="sr-only" htmlFor="exp-url">Webhook-URL</label>
            <input className="field" id="exp-url" readOnly value={state.url} onFocus={(e) => e.currentTarget.select()} />
            <button type="button" className="btn dark sm" onClick={copy}>{copied ? "Gekopieerd ✓" : "Kopieer URL"}</button>
          </div>
          <ol className="signal-steps">
            <li>Open je outreachtool en ga naar <strong>Webhooks</strong> (bij de instellingen van je LinkedIn-account).</li>
            <li>Maak per campagne een webhook voor de gebeurtenissen <strong>reply</strong>, <strong>connection accepted</strong> en <strong>message sent</strong>.</li>
            <li>Plak de URL hierboven als bestemming en sla op. Gebruik de testknop van de outreachtool als die er is.</li>
            <li>Binnengekomen gebeurtenissen verschijnen hieronder. Namen en profiel-URL&apos;s worden niet bewaard.</li>
          </ol>
          {!configured && (
            <p className="form-error" style={{ marginTop: 10 }}>
              Let op: INGEST_SECRET en TRACKING_SALT ontbreken in deze omgeving. Tot ze zijn ingesteld worden gebeurtenissen niet opgeslagen.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
