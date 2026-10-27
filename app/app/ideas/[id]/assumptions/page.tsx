import type { Metadata } from "next";
import Link from "next/link";
import { Icon } from "@/components/Icon";
import { PageFrame } from "@/components/shell/PageFrame";
import { Stepper } from "@/components/ui/Stepper";
import { ActionForm } from "@/components/ui/ActionForm";
import { RiskBoard, type BoardAssumption } from "@/components/assumptions/RiskBoard";
import { getIdea } from "@/lib/data";
import { supabaseServer } from "@/lib/supabase/server";
import { loadAssumptions, loadProgress, rankAssumptions } from "@/lib/progress";
import { stepsDone } from "@/lib/steps";
import { aiConfigured } from "@/lib/env";
import { ASSUMPTION_CATEGORIES, type AssumptionCategory, type AssumptionStatus } from "@/lib/domain/labels";
import { addAssumption, deleteAssumption, linkClaim, seedAssumptions, setImportance, unlinkClaim } from "./actions";

export const metadata: Metadata = { title: "Aannames" };

export default async function AssumptionsPage({ params }: PageProps<"/app/ideas/[id]/assumptions">) {
  const { id } = await params;
  const { idea, canWrite } = await getIdea(id);
  const supabase = await supabaseServer();
  const [ranked, progress, { data: claims }, { data: links }] = await Promise.all([
    loadAssumptions(id).then(rankAssumptions),
    loadProgress(id),
    supabase.from("claims").select("id, statement, status").eq("idea_id", id).order("created_at"),
    supabase.from("assumption_claims").select("assumption_id, claim_id, relation, claims(statement, status)").eq("idea_id", id),
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
          <div className="eyebrow">STAP 3 VAN 5 · RISICO&apos;S</div>
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
          <h3>Nog geen aannames</h3>
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
          deleteActions={Object.fromEntries(board.map((a) => [a.id, deleteAssumption.bind(null, id, a.id)]))}
        />
      )}

      {board.length > 0 && missing.length > 0 && (
        <div className="note">
          Blinde vlek: er is nog geen aanname over {missing.map((m) => ASSUMPTION_CATEGORIES[m].toLowerCase()).join(", ")}. Denk aan
          koopgedrag, prijs, kanaal, uitvoering en schaalbaarheid.
        </div>
      )}

      {canWrite && (
        <div className="card mt-18">
          <h3>Aanname toevoegen</h3>
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
