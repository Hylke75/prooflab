import type { Metadata } from "next";
import Link from "next/link";
import { Icon } from "@/components/Icon";
import { PageFrame } from "@/components/shell/PageFrame";
import { Stepper } from "@/components/ui/Stepper";
import { ActionForm } from "@/components/ui/ActionForm";
import { RiskBoard, type BoardAssumption } from "@/components/assumptions/RiskBoard";
import { RedTeamButton } from "@/components/assumptions/RedTeamButton";
import { getIdea } from "@/lib/data";
import { supabaseServer } from "@/lib/supabase/server";
import { loadInformationValue, loadProgress } from "@/lib/progress";
import { AI_UNREVIEWED_WEIGHT, CLAIM_LR, fmtLr, OBSERVATION_LR, type LrEntry } from "@/lib/domain/evidence";
import { DECISION_BOUNDARY, EUR_PER_COST_UNIT, TEST_LR } from "@/lib/domain/recommend";
import { stepsDone } from "@/lib/steps";
import { loadIdeaWeights } from "@/lib/learning-data";
import { describeWeights, type WeightsInUse } from "@/lib/domain/calibration";
import { aiConfigured } from "@/lib/env";
import { ASSUMPTION_CATEGORIES, type AssumptionCategory, type AssumptionStatus } from "@/lib/domain/labels";
import { addAssumption, deleteAssumption, linkClaim, seedAssumptions, setImportance, setPrior, unlinkClaim } from "./actions";

export const metadata: Metadata = { title: "Aannames" };

const lrText = (e: LrEntry) => (e.lr === 1 ? "telt niet mee" : e.against ? `÷ ${fmtLr(e.lr)} (tegenbewijs)` : `× ${fmtLr(e.lr)} (tegen: ÷ ${fmtLr(e.lr)})`);

// The factors behind the probabilities and the ranking, visible as they are used in code.
function HowWeCalculate({ weights }: { weights: WeightsInUse }) {
  const rows = [...Object.values(OBSERVATION_LR), ...Object.values(CLAIM_LR)];
  return (
    <details className="card mt-18">
      <summary className="text-link">Hoe rekent ProofLab de kans en de informatiewaarde uit?</summary>
      <p className="sub mt-12">
        Elke aanname begint op 50%. Elk stuk bewijs vermenigvuldigt de kansverhouding (odds) met een vaste factor; tegenbewijs deelt erdoor.
        Meer van hetzelfde telt afnemend mee: n stuks tellen als log₂(1 + n) stuks, dus 20 dezelfde meningen brengen 50% maar naar ongeveer 60%.
        AI-gecodeerde observaties tellen voor {AI_UNREVIEWED_WEIGHT * 100}% zolang niemand ze heeft beoordeeld, volledig na akkoord en niet na afkeuren. Synthetische data telt nooit mee.
        De kans blijft altijd tussen 1% en 99%.
      </p>
      <div style={{ overflowX: "auto" }}>
        <table className="table mt-12">
          <caption className="sr-only">Factor per soort bewijs</caption>
          <thead><tr><th scope="col">Soort bewijs</th><th scope="col">Factor op de kansverhouding</th><th scope="col">Waarom</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.label}><td>{r.label}</td><td className="num">{lrText(r)}</td><td>{r.why}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="sub mt-12">
        Informatiewaarde = belang × onzekerheid × hoeveel de goedkoopste geschikte test de kans kan verschuiven ÷ kosten van die test.
        Een test is geschikt als een duidelijke uitkomst de kans over de beslisgrens van {DECISION_BOUNDARY * 100}% kan duwen. Kosten = weken doorlooptijd + € / {EUR_PER_COST_UNIT}.
        Factor van één duidelijke testuitkomst: interviews × {fmtLr(TEST_LR.interview)}, landingpage × {fmtLr(TEST_LR.landing)}, prijs-/aanbodtest × {fmtLr(TEST_LR.pricing)}.
      </p>
      <p className="tiny mt-8">
        Deze factoren zijn startaannames. Een werkruimte kan geleerde factoren aanzetten op de pagina Voorspelkwaliteit; die worden geschat uit eigen
        afgeronde dossiers, per soort bewijs pas vanaf voldoende dossiers. {describeWeights(weights)}
      </p>
    </details>
  );
}

export default async function AssumptionsPage({ params }: PageProps<"/app/ideas/[id]/assumptions">) {
  const { id } = await params;
  const { idea, canWrite } = await getIdea(id);
  const supabase = await supabaseServer();
  const [ranked, progress, { data: claims }, { data: links }, weights] = await Promise.all([
    loadInformationValue(id),
    loadProgress(id),
    supabase.from("claims").select("id, statement, status").eq("idea_id", id).order("created_at"),
    supabase.from("assumption_claims").select("assumption_id, claim_id, relation, claims(statement, status)").eq("idea_id", id),
    loadIdeaWeights(id),
  ]);
  const board: BoardAssumption[] = ranked.map((a) => ({
    ...a,
    category: a.category as AssumptionCategory,
    status: a.status as AssumptionStatus,
    claims: (links ?? []).filter((l) => l.assumption_id === a.id).map((l) => ({ id: l.claim_id, relation: l.relation, statement: l.claims?.statement ?? "", status: l.claims?.status ?? "" })),
  }));
  const missing = (Object.keys(ASSUMPTION_CATEGORIES) as AssumptionCategory[]).filter((c) => !board.some((a) => a.category === c));
  const usable = (claims ?? []).filter((c) => c.status !== "insufficient");

  return (
    <PageFrame crumbs={["Werkruimte", idea.title, "Aannames"]} coach="assumptions" ideaId={id}>
      <div className="section-row">
        <div>
          <div className="eyebrow">Stap 3 van 5 · Risico&apos;s</div>
          <h1>Wat moet waar zijn?</h1>
          <p className="sub">Een idee is een verzameling aannames. Begin bij de aannames die het belangrijkst zijn en waarover je nog het minst weet.</p>
        </div>
        <Link className="btn primary" href={`/app/ideas/${id}/experiments${board[0] ? `?assumption=${board[0].id}` : ""}`}>
          Ontwerp een test <Icon name="arrow" size="sm" />
        </Link>
      </div>
      <Stepper current="assumptions" ideaId={id} done={stepsDone(progress)} />

      {board.length === 0 ? (
        <div className="empty-state">
          <h2 className="as-h3">Nog geen aannames</h2>
          <p>
            {aiConfigured()
              ? "Laat ProofLab aannames voorstellen op basis van je idee en de gevonden bevindingen, of voeg ze zelf toe."
              : "Begin met de standaardset (wenselijkheid, haalbaarheid, levensvatbaarheid, context) en maak die specifiek, of voeg ze zelf toe."}
          </p>
          {canWrite && (
            <ActionForm action={seedAssumptions.bind(null, id)} submitLabel={aiConfigured() ? "Stel aannames voor" : "Begin met de standaardset"} pendingLabel="Bezig…">
              <span />
            </ActionForm>
          )}
        </div>
      ) : (
        <RiskBoard
          ideaId={id}
          assumptions={board}
          claims={usable}
          canWrite={canWrite}
          linkActions={Object.fromEntries(board.map((a) => [a.id, linkClaim.bind(null, id, a.id)]))}
          unlinkActions={Object.fromEntries(board.map((a) => [a.id, Object.fromEntries(a.claims.map((c) => [c.id, unlinkClaim.bind(null, id, a.id, c.id)]))]))}
          importanceActions={Object.fromEntries(board.map((a) => [a.id, setImportance.bind(null, id, a.id)]))}
          priorActions={Object.fromEntries(board.map((a) => [a.id, setPrior.bind(null, id, a.id)]))}
          deleteActions={Object.fromEntries(board.map((a) => [a.id, deleteAssumption.bind(null, id, a.id)]))}
        />
      )}

      {board.length > 0 && missing.length > 0 && (
        <div className="note">
          Blinde vlek: er is nog geen aanname over {missing.map((m) => ASSUMPTION_CATEGORIES[m].toLowerCase()).join(", ")}. Denk aan
          koopgedrag, prijs, kanaal, uitvoering en schaalbaarheid.
        </div>
      )}

      <RedTeamButton ideaId={id} assumptions={board} canWrite={canWrite} />
      {board.length > 0 && <HowWeCalculate weights={weights.inUse} />}

      {canWrite && (
        <div className="card mt-18">
          <h2 className="as-h3" id="nieuwe-aanname">Aanname toevoegen</h2>
          <ActionForm action={addAssumption.bind(null, id)} submitLabel="Toevoegen" resetOnSuccess>
            <div className="form-line mt-12">
              <label htmlFor="as-st">Wat moet waar zijn?</label>
              <input className="field" id="as-st" name="statement" placeholder="Bijv. Eventmanagers vertrouwen een AI-selectie genoeg om een aanvraag te doen." />
            </div>
            <div className="double-field">
              <div className="form-line">
                <label htmlFor="as-cat">Soort</label>
                <select className="field" id="as-cat" name="category" defaultValue="desirability">
                  {Object.entries(ASSUMPTION_CATEGORIES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </div>
              <div className="form-line">
                <label htmlFor="as-imp">Belangrijkheid (5 = idee valt om)</label>
                <select className="field" id="as-imp" name="importance" defaultValue="4">
                  {[5, 4, 3, 2, 1].map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
              </div>
            </div>
          </ActionForm>
        </div>
      )}
    </PageFrame>
  );
}
