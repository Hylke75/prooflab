import { ActionForm } from "@/components/ui/ActionForm";
import { FormPendingOverlay } from "@/components/ui/SavingOverlay";
import { CLAIM_STATUS, type ClaimStatus } from "@/lib/domain/labels";
import { EFFECT_LABEL, MAX_PICKS, ORIGIN_LABEL, type UncertaintyEffect } from "@/lib/research-uncertainty";
import { addUncertaintyPick, proposeUncertaintyNow, removeUncertaintyPick, setUncertaintyEffect } from "@/app/app/ideas/[id]/research/actions";

// Fase B2, punt 6: bovenaan de Marktverkenning. Hooguit drie bevindingen die de grootste onzekerheid het sterkst
// ondersteunen of ondermijnen; een ondermijnende bevinding krijgt een opvallend label "Risico". De AI stelt voor,
// de consultant past aan. Alleen bevindingen met een gecontroleerd citaat: de selectie zelf is geen bewijs.

export type UncertaintyPickView = {
  claimId: string;
  effect: UncertaintyEffect;
  reason: string;
  origin: string;
  statement: string;
  status: string;
  sources: string[];
};

export function UncertaintyCard({
  ideaId,
  uncertainty,
  picks,
  candidates,
  canWrite,
  editable,
  aiConnected,
}: {
  ideaId: string;
  uncertainty: string | null;
  picks: UncertaintyPickView[];
  // Bevindingen die nog kunnen worden toegevoegd (met gecontroleerd citaat).
  candidates: { id: string; statement: string }[];
  canWrite: boolean;
  // Zonder de B2-migratie: alleen het voorstel uit de laatste run, niet aan te passen.
  editable: boolean;
  aiConnected: boolean;
}) {
  const origins = [...new Set(picks.map((p) => ORIGIN_LABEL[p.origin] ?? p.origin))];
  return (
    <section className="card" aria-labelledby="uncertainty-title" style={{ marginBottom: 18 }}>
      <div className="section-title">
        <div>
          <h3 id="uncertainty-title">Wat dit betekent voor je grootste onzekerheid</h3>
          <p className="sub" style={{ margin: "4px 0 0" }}>{uncertainty ? `“${uncertainty}”` : "Er is nog geen grootste onzekerheid vastgelegd in de intake."}</p>
        </div>
        {origins.length > 0 && <span className="pill gray">{origins.join(" · ")}</span>}
      </div>

      {picks.length === 0 ? (
        <p className="tiny" style={{ margin: 0 }}>
          Nog geen bevinding gekozen. Na een onderzoeksrun stelt ProofLab hier hooguit drie bevindingen voor die de onzekerheid het sterkst ondersteunen
          of ondermijnen; je kunt ze ook zelf kiezen.
        </p>
      ) : (
        <ol style={{ listStyle: "none", padding: 0, margin: 0 }}>
          {picks.map((p) => {
            const status = CLAIM_STATUS[p.status as ClaimStatus];
            const label = EFFECT_LABEL[p.effect];
            return (
              <li key={p.claimId} className="quickline" style={{ alignItems: "flex-start" }}>
                <span className={`pill ${label.pill}`} style={p.effect === "undermines" ? { fontWeight: 800, textTransform: "uppercase", letterSpacing: ".06em" } : undefined}>
                  {label.label}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <strong>{p.statement}</strong>
                  <span className="tiny" style={{ display: "block" }}>
                    {p.reason}
                    {p.sources.length ? ` · Bron: ${p.sources.slice(0, 2).join("; ")}${p.sources.length > 2 ? ` en ${p.sources.length - 2} meer` : ""}` : ""}
                    {status ? ` · ${status.label}` : ""}
                  </span>
                  {canWrite && editable && (
                    <div className="row" style={{ gap: 12, marginTop: 4, flexWrap: "wrap" }}>
                      <form action={setUncertaintyEffect.bind(null, ideaId, p.claimId, p.effect === "undermines" ? "supports" : "undermines")}>
                        <button className="text-link">{p.effect === "undermines" ? "Markeer als steunend" : "Markeer als risico"}</button>
                        <FormPendingOverlay />
                      </form>
                      <form action={removeUncertaintyPick.bind(null, ideaId, p.claimId)}>
                        <button className="text-link">Haal weg</button>
                        <FormPendingOverlay />
                      </form>
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      )}

      {canWrite && editable && (
        <div className="row mt-12" style={{ gap: 12, flexWrap: "wrap", alignItems: "flex-start" }}>
          {aiConnected && (
            <ActionForm action={proposeUncertaintyNow.bind(null, ideaId)} submitLabel="Laat AI opnieuw voorstellen" submitClass="btn ai sm" pendingLabel="Bezig…">
              <span />
            </ActionForm>
          )}
          {picks.length < MAX_PICKS && candidates.length > 0 && (
            <details>
              <summary className="text-link">+ Zelf een bevinding kiezen</summary>
              <ActionForm action={addUncertaintyPick.bind(null, ideaId)} submitLabel="Toevoegen" submitClass="btn white sm" resetOnSuccess>
                <label className="field-label" htmlFor="unc-claim">Bevinding</label>
                <select className="field" id="unc-claim" name="claim_id" defaultValue="">
                  <option value="" disabled>
                    Kies een bevinding met bron
                  </option>
                  {candidates.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.statement.slice(0, 140)}
                    </option>
                  ))}
                </select>
                <label className="field-label" htmlFor="unc-effect">Effect op de onzekerheid</label>
                <select className="field" id="unc-effect" name="effect" defaultValue="undermines">
                  <option value="undermines">Risico: ondermijnt</option>
                  <option value="supports">Steunt</option>
                </select>
                <label className="field-label" htmlFor="unc-reason">Waarom (optioneel)</label>
                <input className="field" id="unc-reason" name="reason" maxLength={300} />
              </ActionForm>
            </details>
          )}
        </div>
      )}
      {canWrite && !editable && picks.length > 0 && <p className="tiny mt-8">Aanpassen kan zodra de B2-migratie live staat.</p>}
    </section>
  );
}
