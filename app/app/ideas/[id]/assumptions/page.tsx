import type { Metadata } from "next";
import Link from "next/link";
import { Why } from "@/components/ui/Why";
import { AssumptionProposals } from "@/components/assumptions/AssumptionProposals";
import { ideaTasks, taskAfter } from "@/lib/domain/tasks";
import { TaskFooter, TaskHeader } from "@/components/tasks/TaskHeader";
import { Icon } from "@/components/Icon";
import { PageFrame } from "@/components/shell/PageFrame";
import { ActionForm } from "@/components/ui/ActionForm";
import { RiskBoard, type BoardAssumption } from "@/components/assumptions/RiskBoard";
import { RedTeamButton } from "@/components/assumptions/RedTeamButton";
import { getIdea, getViewMode } from "@/lib/data";
import { Detail } from "@/components/shell/ViewMode";
import { audienceExample } from "@/lib/research-questions";
import { supabaseServer } from "@/lib/supabase/server";
import { loadInformationValue, loadProgress } from "@/lib/progress";
import { AI_UNREVIEWED_WEIGHT, CLAIM_LR, fmtLr, OBSERVATION_LR, REFUTED_LR, type LrEntry } from "@/lib/domain/evidence";
import { DECISION_BOUNDARY, EUR_PER_COST_UNIT, TEST_LR } from "@/lib/domain/recommend";
import { loadIdeaWeights } from "@/lib/learning-data";
import { describeWeights, type WeightsInUse } from "@/lib/domain/calibration";
import { aiConfigured } from "@/lib/env";
import { ASSUMPTION_CATEGORIES, type AssumptionCategory, type AssumptionStatus } from "@/lib/domain/labels";
import { asMethodVersion, CURRENT_METHOD, METHODS, type MethodVersion } from "@/lib/domain/method";
import { EVIDENCE_LEVELS, type EvidenceCaps } from "@/lib/domain/evidence";
import { loadCalibration, loadIdeaCaps } from "@/lib/method-data";
import { addAssumption, confirmAllAssumptions, confirmAssumption, deleteAssumption, reviseAssumption, linkClaim, seedAssumptions, setImportance, setKind, setPrior, setSelectedForTest, unlinkClaim } from "./actions";
import { assumptionKind, ASSUMPTION_KINDS } from "@/lib/domain/assumption-kind";
import { DecisionRuleCard } from "@/components/decision/DecisionRule";
import { loadDecisionRule } from "@/lib/decision-rule-data";
import { forecastFirstLock } from "@/lib/domain/forecast";
import { ForecastFirstLock } from "@/components/forecast/ForecastFirstLock";

export const metadata: Metadata = { title: "Aannames" };

const lrText = (e: LrEntry) => (e.lr === 1 ? "telt niet mee" : e.against ? `÷ ${fmtLr(e.lr)} (tegenbewijs)` : `× ${fmtLr(e.lr)} (tegen: ÷ ${fmtLr(e.lr)})`);

// The factors behind the probabilities and the ranking, visible as they are used in code.
function HowWeCalculate({ weights, method, caps }: { weights: WeightsInUse; method: MethodVersion; caps: EvidenceCaps }) {
  // Methode 2026-11-e: een weerlegde bevinding telt als tegenbewijs (in plaats van "telt niet mee").
  const claimRows = Object.entries(CLAIM_LR).map(([k, e]) => (k === "refuted" && METHODS[method].refutedCounts ? { ...REFUTED_LR, against: true } : e));
  const rows = [...Object.values(OBSERVATION_LR), ...claimRows];
  return (
    <details className="card mt-18">
      <summary className="text-link">Hoe rekent ProofLab de kans en de informatiewaarde uit?</summary>
      <p className="sub mt-12">
        Elke aanname begint op 50%. Elk stuk bewijs vermenigvuldigt de kansverhouding (odds) met een vaste factor; tegenbewijs deelt erdoor.
        Meer van hetzelfde telt afnemend mee: n stuks tellen als log₂(1 + n) stuks, dus 20 dezelfde meningen brengen 50% maar naar ongeveer 60%.
        {METHODS[method].primaryDecides
          ? "AI-gecodeerde observaties tellen pas mee na akkoord van een consultant, niet zolang niemand ze heeft beoordeeld en niet na afkeuren."
          : `AI-gecodeerde observaties tellen voor ${AI_UNREVIEWED_WEIGHT * 100}% zolang niemand ze heeft beoordeeld, volledig na akkoord en niet na afkeuren.`}{" "}
        Synthetische data telt nooit mee.
        De kans blijft altijd tussen 1% en 99%.
      </p>
      {METHODS[method].usesCaps ? (
        <p className="sub mt-12">
          {METHODS[method].label}: ondersteunend bewijs uit dezelfde bron (dezelfde enquête of test, hetzelfde interview, dezelfde bron of outreach-campagne) telt
          één keer, met de sterkste factor; tegenbewijs telt per signaal. De kans is begrensd door het hoogste bewijsniveau:{" "}
          {EVIDENCE_LEVELS.map((l) => `${l.label.toLowerCase()} ${l.level === "repeat" ? "geen plafond" : `${Math.round(caps[l.level as keyof EvidenceCaps] * 100)}%`}`).join("; ")}.
        </p>
      ) : (
        <p className="sub mt-12">{METHODS[method].label}: geen samenvoegen per bron en geen plafond per bewijsniveau.</p>
      )}
      {METHODS[method].primaryDecides && (
        <p className="sub mt-12">
          {METHODS[method].label}: ondersteunend bewijs uit dezelfde wervingsgroep (eigen netwerk, warm contact, koud, betaald panel of onbekend) telt over
          verschillende bronnen heen afnemend mee: n bronnen uit één groep tellen als log₂(1 + n). Per aanname beslist alleen de vooraf aangewezen hoofdtest over de
          status; andere tests zijn verkennend.
        </p>
      )}
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

const STAPPEN = ["opschrijven", "kiezen", "regel"] as const;
type Stap = (typeof STAPPEN)[number];
const STAP_TASK = { opschrijven: "assumptions-write", kiezen: "assumptions-primary", regel: "assumptions-rule" } as const;
const STAP_LABELS: Record<Stap, string> = { opschrijven: "Aannames opschrijven", kiezen: "Risicokaart", regel: "Beslisregel" };

export default async function AssumptionsPage({ params, searchParams }: PageProps<"/app/ideas/[id]/assumptions">) {
  const { id } = await params;
  // ?select=<aanname> (vanuit het zoeken binnen een dossier): die aanname staat geselecteerd op de risicokaart.
  const selectParam = (await searchParams).select;
  const select = typeof selectParam === "string" && /^[0-9a-f-]{36}$/i.test(selectParam) ? selectParam : null;
  const { idea, canWrite } = await getIdea(id);
  // Fase 1 · punt 1: in Snel geen rekenuitleg, red team of soortkeuze; de kansen en de rangorde zijn gelijk.
  const quick = (await getViewMode(id)) === "quick";
  // Gebruikerstest D11: voorbeeld met de korte doelgroep van dit dossier, anders neutraal.
  const who = audienceExample(idea);
  const supabase = await supabaseServer();
  const method = asMethodVersion(idea.method_version);
  const [ranked, progress, { data: claims }, { data: links }, weights, caps, calibration, rule, { data: experiments }, selectionColumn] = await Promise.all([
    loadInformationValue(id),
    loadProgress(id),
    supabase.from("claims").select("id, statement, status").eq("idea_id", id).order("created_at"),
    supabase.from("assumption_claims").select("assumption_id, claim_id, relation, claims(statement, status)").eq("idea_id", id),
    loadIdeaWeights(id),
    loadIdeaCaps(id),
    loadCalibration(id),
    loadDecisionRule(id),
    supabase.from("experiments").select("id, title").eq("idea_id", id).order("created_at"),
    // Fase B4: kiezen kan pas als de kolom selected_for_test bestaat (migratie 20261110140000).
    supabase.from("assumptions").select("selected_for_test").eq("idea_id", id).limit(1),
  ]);
  // Voorstel "ProofLab eenvoudiger": voorgestelde aannames (AI of standaardset) zijn voorstellen tot je ze overneemt.
  const { data: originRows } = await supabase.from("assumptions").select("id, origin").eq("idea_id", id);
  const originOf = new Map((originRows ?? []).map((r) => [r.id, r.origin as string]));
  const board: BoardAssumption[] = ranked.map((a) => ({
    ...a,
    category: a.category as AssumptionCategory,
    status: a.status as AssumptionStatus,
    kind: assumptionKind(a),
    kindStored: !!a.kind && a.kind in ASSUMPTION_KINDS,
    selectedForTest: !!a.selectedForTest,
    claims: (links ?? []).filter((l) => l.assumption_id === a.id).map((l) => ({ id: l.claim_id, relation: l.relation, statement: l.claims?.statement ?? "", status: l.claims?.status ?? "" })),
  }));
  const lock = forecastFirstLock(progress);
  // De knop bovenaan opent de eerste gekozen aanname, anders de hoogste in de rangorde.
  const first = board.find((a) => a.selectedForTest) ?? board[0];
  const missing = (Object.keys(ASSUMPTION_CATEGORIES) as AssumptionCategory[]).filter((c) => !board.some((a) => a.category === c));
  const usable = (claims ?? []).filter((c) => c.status !== "insufficient");

  // Voorstel "ProofLab eenvoudiger": Aannames is drie taken, elk op een eigen scherm: opschrijven → de belangrijkste
  // kiezen (risicokaart) → vastleggen wanneer je doorgaat (beslisregel).
  const list = ideaTasks(progress);
  const phaseTasks = list.phases.find((ph) => ph.key === "assumptions")!.tasks;
  const askedStap = (await searchParams).stap;
  const firstOpen = phaseTasks.find((t) => t.status === "busy" || t.status === "todo")?.key;
  const stap: Stap =
    typeof askedStap === "string" && (STAPPEN as readonly string[]).includes(askedStap)
      ? (askedStap as Stap)
      : select
        ? "kiezen"
        : board.length === 0
          ? "opschrijven"
          : firstOpen === "assumptions-rule"
            ? "regel"
            : "kiezen";
  const taskKey = STAP_TASK[stap];
  const proposals = board
    .filter((a) => originOf.get(a.id) === "ai" || originOf.get(a.id) === "template")
    .map((a) => ({ id: a.id, statement: a.statement, importance: a.importance, origin: originOf.get(a.id) as "ai" | "template" }));
  // Zonder schrijfrecht (opdrachtgever) zijn er geen voorstellen om te kiezen: dan staat alles in de lijst.
  const own = canWrite ? board.filter((a) => !proposals.some((p) => p.id === a.id)) : board;
  const header = (title: string, why: string) => (
    <TaskHeader ideaId={id} list={list} taskKey={taskKey} title={title} why={why} aiConnected={aiConfigured()} />
  );

  return (
    <PageFrame crumbs={["Werkruimte", idea.title, STAP_LABELS[stap]]} coach="assumptions" ideaId={id} section="/assumptions">
      <div className="task-page">
      {method !== CURRENT_METHOD && (
        <div className="note">
          Dit dossier rekent met methode {method}. <Link className="text-link" href={`/app/ideas/${id}/method`}>Bekijk wat overstappen naar methode {CURRENT_METHOD} verandert →</Link>
        </div>
      )}


      {stap === "opschrijven" && (
        <>
          {header("Wat moet waar zijn?", "Een idee is een verzameling aannames. Schrijf op wat waar moet zijn voordat dit idee kan slagen: over de klant, de prijs, het kanaal en de uitvoering.")}
          {board.length === 0 ? (
            <div className="empty-state">
              <h2 className="as-h3">Nog geen aannames</h2>
              <p>
                {aiConfigured()
                  ? "Laat ProofLab aannames voorstellen op basis van je idee en de gevonden bevindingen, of voeg ze zelf toe."
                  : "Begin met de standaardset (wenselijkheid, haalbaarheid, levensvatbaarheid, context) en maak die specifiek, of voeg ze zelf toe."}
              </p>
              {canWrite && !lock && (
            <ActionForm action={seedAssumptions.bind(null, id)} submitLabel={aiConfigured() ? "Stel aannames voor" : "Begin met de standaardset"} pendingLabel="Bezig…">
              <span />
            </ActionForm>
              )}
            </div>
          ) : (
            <>
            {canWrite && (
              <AssumptionProposals
                items={proposals}
                confirmActions={Object.fromEntries(proposals.map((a) => [a.id, confirmAssumption.bind(null, id, a.id)]))}
                reviseActions={Object.fromEntries(proposals.map((a) => [a.id, reviseAssumption.bind(null, id, a.id)]))}
                deleteActions={Object.fromEntries(proposals.map((a) => [a.id, deleteAssumption.bind(null, id, a.id)]))}
                confirmAll={confirmAllAssumptions.bind(null, id)}
              />
            )}
            {own.length > 0 && (
            <div className="card mt-18" role="region" aria-labelledby="aannames-lijst">
              <div className="section-title">
                <h2 className="as-h3" id="aannames-lijst">Je aannames ({own.length})</h2>
                <span className="pill gray">Op belang</span>
              </div>
              <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
                {[...own]
                  .sort((a, b) => b.importance - a.importance || a.statement.localeCompare(b.statement, "nl"))
                  .map((a) => (
                    <li key={a.id} className="assumption-item" style={{ cursor: "default" }}>
                      <span className="count" title="Belang (1–5)">{a.importance}</span>
                      <span>{a.statement}</span>
                      <small>{ASSUMPTION_KINDS[a.kind].label}</small>
                    </li>
                  ))}
              </ul>
            </div>
            )}
            </>
          )}
      {board.length > 0 && missing.length > 0 && (
        <div className="note">
          Blinde vlek: er is nog geen aanname over {missing.map((m) => ASSUMPTION_CATEGORIES[m].toLowerCase()).join(", ")}. Denk aan
          koopgedrag, prijs, kanaal, uitvoering en schaalbaarheid.
        </div>
      )}

      {!lock && (
        <Detail>
          <RedTeamButton ideaId={id} assumptions={board} canWrite={canWrite} />
        </Detail>
      )}
      {canWrite && (
        <div className="card mt-18">
          <h2 className="as-h3" id="nieuwe-aanname">Aanname toevoegen</h2>
          <ActionForm action={addAssumption.bind(null, id)} submitLabel="Toevoegen" resetOnSuccess draftKey="aanname">
            <div className="form-line mt-12">
              <label htmlFor="as-st">Wat moet waar zijn?</label>
              <Why>Een idee slaagt alleen als een paar dingen kloppen: klanten hebben het probleem, betalen deze prijs, zijn te bereiken. Door ze op te schrijven, zie je wat je moet testen.</Why>
              <input className="field" id="as-st" name="statement" placeholder={who ? `Bijv. ${who} stappen over van hun huidige werkwijze, omdat …` : "Bijv. De doelgroep stapt over van de huidige werkwijze, omdat …"} />
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
                <Why>Begin met wat het idee onderuit haalt als het niet klopt. Belang 4 of 5 betekent: dit test je eerst.</Why>
                <select className="field" id="as-imp" name="importance" defaultValue="4">
                  {[5, 4, 3, 2, 1].map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
              </div>
            </div>
          </ActionForm>
        </div>
      )}
          <TaskFooter ideaId={id} next={taskAfter(list, "assumptions-write")} />
        </>
      )}

      {stap === "kiezen" && (
        <>
          {header("Begin met je grootste risico", "Welke aanname haalt het hele idee onderuit als hij niet klopt? Kies er hooguit drie om nu te testen en wijs bij de belangrijkste een hoofdtest aan.")}
          {canWrite && proposals.length > 0 && (
            <p className="note" role="status">
              <strong>{proposals.length === 1 ? "1 voorgestelde aanname wacht" : `${proposals.length} voorgestelde aannames wachten`} op je keuze.</strong> Ze staan al op de
              risicokaart.{" "}
              <Link className="text-link" href={`/app/ideas/${id}/assumptions?stap=opschrijven#voorstellen-titel`}>
                Neem over, pas aan of gooi weg →
              </Link>
            </p>
          )}
          {lock ? (
            // Golf B, punt 15: eerst de eigen voorspelling, dan de berekende kansen op de risicokaart.
        <>
          <ForecastFirstLock ideaId={id} moment={lock} what="de risicokaart met de berekende kans per aanname" client={!canWrite} />
          {/* Systeemcontrole: de aannames zelf zijn wel zichtbaar (op belang, niet op berekende rangorde), zodat de pagina
              niet leeg lijkt. Verborgen tot de voorspelling: de berekende kansen, de rangorde en de risicokaart. */}
          {board.length > 0 && (
            <div className="card mt-18" role="region" aria-labelledby="aannames-lijst">
              <div className="section-title">
                <h2 className="as-h3" id="aannames-lijst">Je aannames ({board.length})</h2>
                <span className="pill gray">Op belang</span>
              </div>
              <p className="tiny" style={{ marginTop: -8 }}>Kansen en rangorde zie je na je voorspelling.</p>
              <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
                {[...board]
                  .sort((a, b) => b.importance - a.importance || a.statement.localeCompare(b.statement, "nl"))
                  .map((a) => (
                    <li key={a.id} className="assumption-item" style={{ cursor: "default" }}>
                      <span className="count" title="Belang (1–5)">{a.importance}</span>
                      <span>{a.statement}</span>
                      <small>{ASSUMPTION_KINDS[a.kind].label}</small>
                    </li>
                  ))}
              </ul>
            </div>
          )}
        </>
          ) : board.length === 0 ? (
            <div className="empty-state">
              <h2 className="as-h3">Nog geen aannames</h2>
              <p>Schrijf eerst op wat waar moet zijn; daarna kies je hier de belangrijkste.</p>
              <Link className="btn primary" href={`/app/ideas/${id}/assumptions?stap=opschrijven`}>Naar aannames opschrijven →</Link>
            </div>
          ) : (
        <RiskBoard
          key={select ?? "rangorde"}
          ideaId={id}
          initialId={select}
          assumptions={board}
          claims={usable}
          canWrite={canWrite}
          calibrated={calibration.calibrated}
          linkActions={Object.fromEntries(board.map((a) => [a.id, linkClaim.bind(null, id, a.id)]))}
          unlinkActions={Object.fromEntries(board.map((a) => [a.id, Object.fromEntries(a.claims.map((c) => [c.id, unlinkClaim.bind(null, id, a.id, c.id)]))]))}
          importanceActions={Object.fromEntries(board.map((a) => [a.id, setImportance.bind(null, id, a.id)]))}
          priorActions={Object.fromEntries(board.map((a) => [a.id, setPrior.bind(null, id, a.id)]))}
          deleteActions={Object.fromEntries(board.map((a) => [a.id, deleteAssumption.bind(null, id, a.id)]))}
          kindActions={Object.fromEntries(board.map((a) => [a.id, setKind.bind(null, id, a.id)]))}
          selectActions={Object.fromEntries(board.map((a) => [a.id, setSelectedForTest.bind(null, id, a.id, !a.selectedForTest)]))}
          selectionAvailable={!selectionColumn.error}
          refutedCounts={METHODS[method].refutedCounts}
        />
          )}
      {board.length > 0 && !lock && (
        <Detail hint={false}>
          <HowWeCalculate weights={weights.inUse} method={method} caps={caps.caps} />
        </Detail>
      )}
      {board.length > 0 && !lock && quick && (
        <p className="tiny mt-18">
          <Link className="text-link" href={`/app/ideas/${id}/method`}>Hoe rekent ProofLab de kans uit? →</Link>
        </p>
      )}

          {board.length > 0 && (
            <p className="mt-18">
              <Link className="btn white" href={`/app/ideas/${id}/experiments?nieuw=1${first ? `&assumption=${first.id}` : ""}`}>
                Ontwerp een test voor de belangrijkste aanname <Icon name="arrow" size="sm" />
              </Link>
            </p>
          )}
          <TaskFooter ideaId={id} next={taskAfter(list, "assumptions-primary")} />
        </>
      )}

      {stap === "regel" && (
        <>
          {header("Leg vast wanneer je doorgaat", "Spreek vóór de test af bij welke uitslag je doorgaat. Zo kun je jezelf achteraf niet voor de gek houden.")}
      {rule !== undefined && (
        <DecisionRuleCard
          ideaId={id}
          rule={rule}
          assumptions={ranked.map((a) => ({ id: a.id, statement: a.statement, importance: a.importance, primaryExperimentId: a.primaryExperimentId, selectedForTest: !!a.selectedForTest }))}
          experiments={experiments ?? []}
          canWrite={canWrite}
          compact={quick}
        />
      )}
          {rule === undefined && <p className="sub">De beslisregel is in deze database nog niet beschikbaar.</p>}
          <TaskFooter ideaId={id} next={taskAfter(list, "assumptions-rule")} />
        </>
      )}
      </div>
    </PageFrame>
  );
}
