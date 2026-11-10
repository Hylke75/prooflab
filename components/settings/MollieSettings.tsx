"use client";

import { ActionForm, Field } from "@/components/ui/ActionForm";
import { saveMollieKey } from "@/app/app/status/mollie-actions";

// Fase 2 · punt 4: Mollie koppelen per werkruimte (eigenaren). Zonder MOLLIE_ENABLED=1 en een geldige
// SECRETS_ENCRYPTION_KEY staat de koppeling eerlijk op "niet ingesteld" en is de betaalstap in een testkaart niet te kiezen.
export function MollieSettings({
  ready,
  reason,
  connected,
  mode,
  hint,
  schemaReady,
}: {
  ready: boolean;
  reason: string | null;
  connected: boolean;
  mode: string | null;
  hint: string | null;
  schemaReady: boolean;
}) {
  const status = !ready ? "Mollie niet ingesteld" : connected ? (mode === "live" ? "Verbonden · live" : "Verbonden · testmodus") : "Niet verbonden";
  return (
    <div className="card" style={{ marginTop: 22 }} id="mollie">
      <div className="section-title">
        <h3>Mollie (terugbetaalbare aanbetalingen)</h3>
        <span className={`pill ${ready && connected ? (mode === "live" ? "green" : "orange") : "gray"}`}>{status}</span>
      </div>
      <p className="sub">
        Met een Mollie-sleutel kan een landing- of prijstest een stap &ldquo;Reserveer met een terugbetaalbare aanbetaling&rdquo; krijgen. Een betaling telt
        als Geverifieerde betaling zodra Mollie hem als betaald meldt, en telt niet meer na terugbetalen. ProofLab bewaart per betaling alleen het
        Mollie-nummer, bedrag, status, modus en een versleutelde code van het e-mailadres. Zonder koppeling meet een test aanmeldingen of toezeggingen.
      </p>
      {!ready && <p className="tiny">{reason} Zie docs/OPERATIONS.md.</p>}
      {mode === "test" && connected && (
        <p className="note" style={{ marginTop: 0 }}>
          <strong>Testmodus.</strong> Betalingen met een test_-sleutel zijn nep-betalingen van Mollie en tellen nooit als bewijs. Vervang de sleutel door een live_-sleutel voor een echte test.
        </p>
      )}
      {!schemaReady ? (
        <p className="tiny">Vraagt eerst de database-update (migratie 20261116090000_fase2_testen).</p>
      ) : (
        <>
          {connected && <p className="tiny">Opgeslagen {mode === "live" ? "livesleutel" : "testsleutel"} eindigt op <code>…{hint}</code>.</p>}
          {ready && (
            <ActionForm action={saveMollieKey} submitLabel={connected ? "Vervang sleutel" : "Sla sleutel op"} submitClass="btn white sm" resetOnSuccess noValidate>
              <Field name="mollie_api_key" id="mollie-key" label="Mollie-API-sleutel" hint="Mollie: Dashboard → Developers → API-keys (test_… of live_…). Wordt versleuteld opgeslagen voor de hele werkruimte en is daarna niet meer zichtbaar.">
                <input className="field" type="password" autoComplete="off" maxLength={80} />
              </Field>
            </ActionForm>
          )}
          {connected && (
            <ActionForm action={saveMollieKey} submitLabel="Verwijder sleutel" submitClass="text-link" pendingLabel="Verwijderen…">
              <input type="hidden" name="remove" value="1" />
            </ActionForm>
          )}
        </>
      )}
    </div>
  );
}
