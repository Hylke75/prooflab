import { setEvidenceCaps } from "@/app/app/forecasts/actions";
import { ActionForm } from "@/components/ui/ActionForm";
import { DEFAULT_CAPS, EVIDENCE_LEVELS, KIND_LEVEL, type EvidenceCaps, type EvidenceLevel } from "@/lib/domain/evidence";
import { OBSERVATION_KINDS, type ObservationKind } from "@/lib/domain/labels";

const pctR = (x: number) => `${Math.round(x * 1000) / 10}%`.replace(".", ",");

// Plafonds per bewijsniveau (methode 2026-11-b): leden zien ze, eigenaren passen ze aan.
export function EvidenceCapsCard({ caps, custom, canEdit }: { caps: EvidenceCaps; custom: boolean; canEdit: boolean }) {
  const kindsOf = (level: EvidenceLevel) =>
    (Object.keys(KIND_LEVEL) as ObservationKind[])
      .filter((k) => KIND_LEVEL[k] === level && !["objection", "problem_absent", "counter_example", "other"].includes(k))
      .map((k) => OBSERVATION_KINDS[k])
      .join(", ");
  return (
    <div className="card mt-24" id="plafonds">
      <div className="section-title">
        <h3>Plafonds per bewijsniveau</h3>
        <span className={`pill ${custom ? "blue" : "gray"}`}>{custom ? "Aangepast voor deze werkruimte" : "Standaardwaarden"}</span>
      </div>
      <p className="sub">
        Methode 2026-11-b begrenst de kans per aanname op het hoogste bewijsniveau dat er is. Wie alleen meningen, enquêtes en bureauonderzoek heeft, komt
        niet boven het eerste plafond, hoeveel van dat bewijs er ook is. Een herhaalaankoop heeft geen plafond.
      </p>
      {canEdit ? (
        <ActionForm action={setEvidenceCaps} submitLabel="Plafonds bewaren">
          <div style={{ overflowX: "auto" }}>
            <table className="table mt-12">
              <caption className="sr-only">Plafond per bewijsniveau</caption>
              <thead>
                <tr><th scope="col">Bewijsniveau</th><th scope="col">Soorten bewijs</th><th scope="col">Plafond (%)</th><th scope="col">Standaard</th></tr>
              </thead>
              <tbody>
                {EVIDENCE_LEVELS.map((l) => (
                  <tr key={l.level}>
                    <td>{l.label}</td>
                    <td className="tiny">{l.level === "opinion" ? `${kindsOf(l.level)}, bevindingen uit bronnen` : kindsOf(l.level)}</td>
                    <td>
                      {l.level === "repeat" ? (
                        "geen plafond"
                      ) : (
                        <input
                          className="field num"
                          style={{ width: 90 }}
                          type="number"
                          min={5}
                          max={99}
                          step="0.1"
                          name={l.level}
                          aria-label={`Plafond voor ${l.label} in procent`}
                          defaultValue={Math.round(caps[l.level as keyof EvidenceCaps] * 1000) / 10}
                        />
                      )}
                    </td>
                    <td className="num">{l.level === "repeat" ? "—" : pctR(DEFAULT_CAPS[l.level as keyof EvidenceCaps])}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="explain">Een hoger niveau heeft altijd een gelijk of hoger plafond. Elke wijziging komt in het auditspoor.</p>
        </ActionForm>
      ) : (
        <ul style={{ margin: "8px 0 0 18px", fontSize: 14, lineHeight: 1.7 }}>
          {EVIDENCE_LEVELS.map((l) => (
            <li key={l.level}>{l.label}: {l.level === "repeat" ? "geen plafond" : pctR(caps[l.level as keyof EvidenceCaps])}</li>
          ))}
          <li className="tiny" style={{ listStyle: "none", marginLeft: -18 }}>Alleen de eigenaar van de werkruimte kan dit aanpassen.</li>
        </ul>
      )}
      {canEdit && custom && (
        <ActionForm action={setEvidenceCaps} submitLabel="Terug naar de standaardwaarden" submitClass="btn white sm">
          <input type="hidden" name="reset" value="1" />
        </ActionForm>
      )}
    </div>
  );
}
