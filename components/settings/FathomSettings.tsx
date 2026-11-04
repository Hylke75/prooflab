"use client";

import { ActionForm, Field } from "@/components/ui/ActionForm";
import { saveFathomKey } from "@/app/app/status/fathom-actions";

// Fase 1 · punt 3: Fathom koppelen per werkruimte. De koppeling werkt alleen als FATHOM_ENABLED in deze omgeving aan
// staat; zonder sleutel of flag blijft importeren via een bestand werken.
export function FathomSettings({ enabled, connected, hint, schemaReady }: { enabled: boolean; connected: boolean; hint: string | null; schemaReady: boolean }) {
  return (
    <div className="card" style={{ marginTop: 22 }}>
      <div className="section-title">
        <h3>Fathom (interviewtranscripten)</h3>
        <span className={`pill ${enabled && connected ? "green" : "gray"}`}>{enabled && connected ? "Verbonden" : "Niet verbonden"}</span>
      </div>
      <p className="sub">
        Met een Fathom-API-sleutel kiest het team bij het importeren van een interview een opname uit Fathom. ProofLab haalt het transcript pas op bij
        het inlezen en pseudonimiseert het vóór opslag; zonder koppeling exporteert het team het transcript uit Fathom en importeert het als bestand.
      </p>
      {!enabled && <p className="tiny">De koppeling staat in deze omgeving uit (zet <code>FATHOM_ENABLED=1</code>, zie docs/OPERATIONS.md). Je kunt de sleutel al wel opslaan.</p>}
      {!schemaReady ? (
        <p className="tiny">Vraagt eerst de database-update (migratie 20261115090000_interviews_import).</p>
      ) : (
        <>
          {connected && <p className="tiny">Opgeslagen sleutel eindigt op <code>…{hint}</code>.</p>}
          <ActionForm action={saveFathomKey} submitLabel={connected ? "Vervang sleutel" : "Sla sleutel op"} submitClass="btn white sm" resetOnSuccess noValidate>
            <Field name="fathom_api_key" id="fathom-key" label="Fathom-API-sleutel" hint="Fathom: Settings → API Access. Wordt opgeslagen voor de hele werkruimte en is daarna niet meer zichtbaar.">
              <input className="field" type="password" autoComplete="off" maxLength={400} />
            </Field>
          </ActionForm>
          {connected && (
            <ActionForm action={saveFathomKey} submitLabel="Verwijder sleutel" submitClass="text-link" pendingLabel="Verwijderen…">
              <input type="hidden" name="remove" value="1" />
            </ActionForm>
          )}
        </>
      )}
    </div>
  );
}
