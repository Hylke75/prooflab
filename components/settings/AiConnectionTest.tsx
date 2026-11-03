"use client";

import { useActionState } from "react";
import { testAiConnections, type ConnectionTestState } from "@/app/app/status/ai-settings-actions";
import { SavingOverlay } from "@/components/ui/SavingOverlay";

// "Test verbinding": asks every connected AI provider one tiny question and shows per provider whether it works.
export function AiConnectionTest() {
  const [state, action, pending] = useActionState<ConnectionTestState, FormData>(() => testAiConnections(), { error: null });
  return (
    <form action={action} className="mt-18">
      <div className="row">
        <button className="btn soft" disabled={pending}>{pending ? "Bezig met testen…" : "Test verbinding"}</button>
        <span className="tiny">Stelt elke gekoppelde AI één korte vraag (kost een fractie van een cent).</span>
      </div>
      {state.error && <div className="form-error mt-12" role="alert">{state.error}</div>}
      {state.results && (
        <table className="table mt-12">
          <thead><tr><th>Aanbieder</th><th>Model</th><th>Resultaat</th></tr></thead>
          <tbody>
            {state.results.map((r) => (
              <tr key={r.provider}>
                <td><strong>{r.name}</strong></td>
                <td className="mono tiny">{r.model}</td>
                <td>
                  <span className={`pill ${r.ok ? "green" : "orange"}`}>{r.ok ? "Werkt" : "Werkt niet"}</span>{" "}
                  <span className="tiny">{r.message}{r.ok ? ` · ${(r.ms / 1000).toFixed(1)} s` : ""}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <SavingOverlay active={pending} label="AI-verbindingen testen…" />
    </form>
  );
}
