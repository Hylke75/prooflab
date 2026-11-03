import { ActionForm } from "@/components/ui/ActionForm";
import { aiConfigured } from "@/lib/env";
import { redTeamAssumption } from "@/app/app/ideas/[id]/assumptions/actions";

type Assumption = { id: string; statement: string; importance: number; evidence: number };

// The most critical assumptions: most important first, then least evidence (same order as the board).
export function criticalAssumptions<T extends Assumption>(list: T[], n = 3): T[] {
  return list
    .filter((a) => a.importance >= 4)
    .sort((a, b) => b.importance * (1 - b.evidence) - a.importance * (1 - a.evidence))
    .slice(0, n);
}

// Red team (research 7.8): a search that only looks for evidence against a critical assumption.
export function RedTeamButton({ ideaId, assumptions, canWrite }: { ideaId: string; assumptions: Assumption[]; canWrite: boolean }) {
  if (!canWrite) return null;
  const critical = criticalAssumptions(assumptions);
  if (critical.length === 0) return null;
  const connected = aiConfigured();
  return (
    <div className="card mt-18">
      <div className="section-title">
        <div>
          <h2 className="as-h3">Rode team: zoek tegenbewijs</h2>
          <p className="sub" style={{ marginTop: 4 }}>
            Een zoekronde die alleen zoekt naar bewijs tégen je belangrijkste aannames. Elke vondst moet een letterlijk citaat hebben dat de
            tegenbevinding ook inhoudelijk draagt.
          </p>
        </div>
        <span className="pill coral">Tegenspraak</span>
      </div>
      {critical.map((a) => (
        <div key={a.id} className="quickline" style={{ alignItems: "center" }}>
          <span className="num" aria-label={`Belangrijkheid ${a.importance}`}>{a.importance}</span>
          <div style={{ flex: 1 }}>
            <strong>{a.statement}</strong>
          </div>
          {connected && (
            <ActionForm action={redTeamAssumption.bind(null, ideaId, a.id)} submitLabel="Zoek tegenbewijs" submitClass="btn ai sm" pendingLabel="Zoeken… (kan een minuut duren)">
              <span />
            </ActionForm>
          )}
        </div>
      ))}
      <div className="note">
        {connected
          ? "Gevonden tegenbevindingen worden als 'spreekt tegen' aan de aanname gekoppeld en komen bij Marktverkenning → Bronnen te staan. Geen vondst betekent niet dat de aanname klopt."
          : "AI niet verbonden. Zoek zelf naar tegenbewijs (bijv. mislukte vergelijkbare initiatieven), leg het vast onder Marktverkenning → Bronnen en koppel de bevinding hierboven als 'spreekt tegen'."}
      </div>
    </div>
  );
}
