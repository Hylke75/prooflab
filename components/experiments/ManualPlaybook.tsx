import { LEVEL_SHORT, KIND_LEVEL } from "@/lib/domain/evidence";
import { OBSERVATION_KINDS, type ObservationKind } from "@/lib/domain/labels";
import type { CatalogSteps } from "@/lib/domain/experiment-catalog";
import "./catalog.css";

// Experimentencatalogus: het draaiboek van een handmatig sjabloon (vooraf, tijdens, afronden). Zonder hooks, zodat het
// in de testkaart (client), op de testpagina en in de catalogus (server) hetzelfde is.
export function ManualPlaybook({
  name,
  summary,
  steps,
  extra = [],
  numerator,
  denominator,
  kind,
  compact = false,
}: {
  name?: string;
  summary?: string;
  steps: CatalogSteps;
  extra?: string[];
  numerator?: string;
  denominator?: string;
  kind?: ObservationKind | null;
  compact?: boolean;
}) {
  const groups: { key: keyof CatalogSteps | "extra"; title: string; items: string[] }[] = [
    { key: "before", title: "Vooraf vastleggen en voorbereiden", items: steps.before },
    { key: "during", title: "Tijdens de test bijhouden", items: steps.during },
    { key: "after", title: "Afronden en invoeren", items: steps.after },
    { key: "extra", title: "Eigen aanvullingen", items: extra },
  ];
  return (
    <div className="playbook" aria-label="Draaiboek">
      {!compact && (
        <>
          <div className="preview-tag">HANDMATIG SJABLOON</div>
          {name && <h3 className="as-h3" style={{ margin: "8px 0 4px" }}>{name}</h3>}
          {summary && <p className="sub" style={{ marginTop: 0 }}>{summary}</p>}
        </>
      )}
      {groups
        .filter((g) => g.items.length > 0)
        .map((g) => (
          <section key={g.key} className="playbook-group">
            <h4>{g.title}</h4>
            <ol>
              {g.items.map((s, i) => (
                <li key={`${g.key}-${i}`}>{s}</li>
              ))}
            </ol>
          </section>
        ))}
      {!compact && (numerator || denominator) && (
        <div className="note" style={{ marginBottom: 0 }}>
          <strong>Zo voer je resultaten in.</strong> Per waarneming of telling: een datum, een aantal ({denominator || "noemer"}), hoeveel daarvan meetellen ({numerator || "teller"}), een notitie zonder namen en eventueel een bewijsbestand. Ze staan als &ldquo;handmatig ingevoerd&rdquo; in het bewijs
          {kind ? <> en tellen als {OBSERVATION_KINDS[kind].toLowerCase()} (niveau {LEVEL_SHORT[KIND_LEVEL[kind]]})</> : null}.
        </div>
      )}
    </div>
  );
}
