"use client";

import { useState } from "react";
import { ActionForm, type FormState } from "@/components/ui/ActionForm";
import { againstCount, type AgainstSummary } from "@/lib/domain/against";

function Section({ title, empty, items }: { title: string; empty: string; items: string[] }) {
  return (
    <div className="mt-12">
      <strong style={{ fontSize: 14 }}>
        {title} ({items.length})
      </strong>
      {items.length === 0 ? (
        <p className="tiny">{empty}</p>
      ) : (
        <ul style={{ margin: "6px 0 0 18px", fontSize: 14, lineHeight: 1.7 }}>
          {items.map((t, i) => <li key={i}>{t}</li>)}
        </ul>
      )}
    </div>
  );
}

// Golf B, punt 18: de opdrachtgever bevestigt pas na de samenvatting "Wat ging tegen". De knop werkt pas nadat de
// samenvatting is geopend of het vinkje is gezet; de database eist dat de samenvatting is meegegeven.
export function ConfirmDecision({ summary, action }: { summary: AgainstSummary; action: (s: FormState, f: FormData) => Promise<FormState> }) {
  const [opened, setOpened] = useState(false);
  const [checked, setChecked] = useState(false);
  const reviewed = opened || checked;
  const n = againstCount(summary);
  return (
    <ActionForm action={action} submitLabel="Ik bevestig dit besluit" submitClass="btn primary sm hidden">
      <details className="card tight mt-12" onToggle={(e) => e.currentTarget.open && setOpened(true)} style={{ background: "var(--color-warning-soft)" }}>
        <summary className="text-link">
          <strong>Wat ging tegen</strong> · {n === 0 ? "niets gevonden" : `${n} punt${n === 1 ? "" : "en"}`} · lees dit vóór het bevestigen
        </summary>
        <Section title="Mislukte tests" empty="Geen test is als niet geslaagd beoordeeld." items={summary.failed_tests.map((t) => t.title)} />
        <Section title="Tegenbewijs" empty="Geen tegenbewijs vastgelegd." items={summary.counter_evidence.map((c) => c.text)} />
        <Section title="Begrensde aannames (plafond actief)" empty="Geen aanname wordt door het bewijsniveau begrensd." items={summary.capped_assumptions.map((a) => `${a.statement} (${a.reason})`)} />
        <Section title="Afwijkingen van de beslisregel" empty="Het besluit volgt de beslisregel, of het dossier heeft geen regel." items={summary.rule_deviations.map((r) => `${r.label}. Motivering: ${r.reason}`)} />
      </details>
      <label className="check-row">
        <input type="checkbox" name="reviewed" checked={checked} onChange={(e) => setChecked(e.target.checked)} /> Ik heb gelezen wat tegen ging.
      </label>
      {reviewed && !checked && <input type="hidden" name="reviewed" value="on" />}
      <input className="field mt-8" name="comment" placeholder="Opmerking (optioneel)" aria-label="Opmerking" />
      <button className="btn primary sm mt-12" disabled={!reviewed}>
        Ik bevestig dit besluit
      </button>
      {!reviewed && <p className="tiny mt-8">Open eerst de samenvatting &ldquo;Wat ging tegen&rdquo; of vink aan dat je die hebt gelezen.</p>}
    </ActionForm>
  );
}
