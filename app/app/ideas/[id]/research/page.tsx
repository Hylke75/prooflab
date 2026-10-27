import type { Metadata } from "next";
import Link from "next/link";
import { PageFrame } from "@/components/shell/PageFrame";
import { Stepper } from "@/components/ui/Stepper";
import { InsightCard, type ClaimView } from "@/components/ui/InsightCard";
import { ActionForm } from "@/components/ui/ActionForm";
import { Tabs } from "@/components/research/Tabs";
import { ResearchRunPanel } from "@/components/research/ResearchRunPanel";
import { AddClaimForm, AddSourceForm } from "@/components/research/SourceForms";
import { CompetitorPanel, type CompetitorView } from "@/components/research/CompetitorPanel";
import { SizingPanel } from "@/components/research/SizingPanel";
import { UnitEconomicsPanel } from "@/components/research/UnitEconomicsPanel";
import { getIdea } from "@/lib/data";
import { supabaseServer } from "@/lib/supabase/server";
import { loadProgress } from "@/lib/progress";
import { stepsDone } from "@/lib/steps";
import { aiConfigured } from "@/lib/env";
import { CLAIM_STATUS, SOURCE_TYPES, type ClaimStatus, type CompetitorKind, type EvidenceType, type SourceType } from "@/lib/domain/labels";
import type { ScenarioKind, SizingModel } from "@/lib/domain/sizing";
import {
  addClaim, addSource, aiPlan, deleteClaim, deleteCompetitor, deleteQuestion, deleteSegment, deleteSource,
  saveCompetitor, saveQuestion, saveScenario, saveSegment, saveUnitEconomics,
} from "./actions";

export const metadata: Metadata = { title: "Marktverkenning" };

const METHOD = { desk: "Bureauonderzoek", customer: "Klantonderzoek", both: "Bureau- en klantonderzoek" } as const;
const QSTATUS = { open: ["Open", "gray"], answered: ["Beantwoord", "green"], needs_customer_research: ["Vraagt klantonderzoek", "orange"] } as const;
const ROLE = { user: ["Gebruiker", "blue"], buyer: ["Betaler / beslisser", "coral"], supplier: ["Aanbodzijde", "green"], other: ["Overig", "gray"] } as const;

export default async function ResearchPage({ params, searchParams }: PageProps<"/app/ideas/[id]/research">) {
  const { id } = await params;
  const sp = await searchParams;
  const { idea, canWrite } = await getIdea(id);
  const supabase = await supabaseServer();
  const [qs, claimsRes, sourcesRes, compRes, segRes, scenRes, ueRes, runRes] = await Promise.all([
    supabase.from("research_questions").select("*").eq("idea_id", id).order("position"),
    supabase
      .from("claims")
      .select("*, claim_sources(quote, stance, quote_check, sources(title, url, publisher, published_on, source_type, domain))")
      .eq("idea_id", id)
      .order("created_at"),
    supabase.from("sources").select("*, source_excerpts(id, text, location)").eq("idea_id", id).order("created_at", { ascending: false }),
    supabase.from("competitors").select("*, claims(statement, status)").eq("idea_id", id).order("created_at"),
    supabase.from("segments").select("*").eq("idea_id", id).order("created_at"),
    supabase.from("sizing_scenarios").select("*, sizing_factors(*)").eq("idea_id", id),
    supabase.from("unit_economics").select("*").eq("idea_id", id).maybeSingle(),
    supabase.from("research_runs").select("*").eq("idea_id", id).order("created_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  const progress = await loadProgress(id);
  const run = runRes.data;
  const { data: tasks } = run
    ? await supabase.from("research_tasks").select("label, status, detail, kind, output").eq("run_id", run.id).order("position")
    : { data: [] };
  const challenges =
    ((tasks ?? []).find((t) => t.kind === "reality_check" && t.status === "done")?.output as { challenges?: { title: string; detail: string }[] } | null)?.challenges ?? [];

  const questions = qs.data ?? [];
  const claims: (ClaimView & { question_id: string | null; section: string; numeric_value: number | null })[] = (claimsRes.data ?? []).map((c) => ({
    id: c.id,
    statement: c.statement,
    status: c.status as ClaimStatus,
    status_reason: c.status_reason,
    evidence_type: c.evidence_type as EvidenceType,
    supports: c.supports,
    does_not_prove: c.does_not_prove,
    region: c.region,
    period: c.period,
    definition: c.definition,
    limitations: c.limitations,
    origin: c.origin,
    question_id: c.question_id,
    section: c.section,
    numeric_value: c.numeric_value,
    evidence: (c.claim_sources ?? []).map((e) => ({
      quote: e.quote,
      stance: e.stance,
      quote_check: e.quote_check,
      source: e.sources ? { ...e.sources, source_type: e.sources.source_type as SourceType } : null,
    })),
  }));
  const sources = sourcesRes.data ?? [];
  const excerpts = sources.flatMap((s) => (s.source_excerpts ?? []).map((e) => ({ id: e.id, text: e.text, sourceTitle: s.title })));
  const competitors: CompetitorView[] = (compRes.data ?? []).map((c) => ({ ...c, kind: c.kind as CompetitorKind, claim: c.claims ? { statement: c.claims.statement, status: c.claims.status } : null }));
  const verified = claims.filter((c) => c.status === "verified").length;
  const answered = questions.filter((q) => q.status === "answered").length;
  const openQuestion = questions.find((q) => q.status !== "answered");
  const kinds = new Set(competitors.map((c) => c.kind));
  const ue = ueRes.data;
  const sizingClaims = claims
    .filter((c) => c.status !== "insufficient")
    .map((c) => ({ id: c.id, statement: c.statement, status: c.status, numeric_value: c.numeric_value }));

  const tab = typeof sp.tab === "string" ? sp.tab : "overview";
  const claimActions = (cid: string) =>
    canWrite ? (
      <form action={deleteClaim.bind(null, id, cid)}>
        <button className="text-link" style={{ color: "#a43c42" }}>Bevinding verwijderen</button>
      </form>
    ) : null;

  return (
    <PageFrame crumbs={["Werkruimte", idea.title, "Marktverkenning"]} coach="research" ideaId={id} badge={run?.mode === "quick" && run.status === "done" ? "Snelle marktcheck · voorlopig" : undefined}>
      <div className="section-row">
        <div>
          <div className="eyebrow">STAP 2 VAN 5 · ONDERZOEK</div>
          <h1>Begrijp je markt.</h1>
          <p className="sub">Een marktbeeld met zicht op concurrenten, doelgroepen, kansen en onzekerheden. Elke conclusie verwijst naar een controleerbare bron.</p>
        </div>
        <Link className="btn primary" href={`/app/ideas/${id}/assumptions`}>
          Naar aannames →
        </Link>
      </div>
      <Stepper current="market" ideaId={id} done={stepsDone(progress)} />

      <div className="insight-banner">
        <div>
          <span className="pill blue">✳ Beslisvraag</span>
          <h3 style={{ marginTop: 10 }}>{idea.decision_question}</h3>
          <p>
            {idea.target_audience}
            {idea.audience_detail ? ` (${idea.audience_detail})` : ""} · {idea.region}
            {idea.key_uncertainty ? ` · grootste onzekerheid: ${idea.key_uncertainty}` : ""}
          </p>
        </div>
        <span className={`pill ${verified ? "green" : "orange"}`}>{verified} geverifieerde bevinding{verified === 1 ? "" : "en"}</span>
      </div>

      <Tabs
        initial={tab}
        tabs={[
          { key: "overview", label: "Marktbeeld" },
          { key: "competitors", label: "Concurrenten" },
          { key: "customers", label: "Doelgroepen" },
          { key: "sizing", label: "Marktpotentieel" },
          { key: "sources", label: "Bronnen" },
        ]}
      >
        {/* Marktbeeld */}
        <div key="overview">
          <div className="research-kpis">
            <div className="card tight">
              <div className="tiny">Onderzoeksvragen beantwoord</div>
              <div className="mini-kpi num">{answered}/{questions.length}</div>
              <span className="stat-caption">Maximaal vijf beslissende vragen</span>
            </div>
            <div className="card tight">
              <div className="tiny">Bevindingen met bron</div>
              <div className="mini-kpi num">{String(claims.length).padStart(2, "0")}</div>
              <span className="stat-caption">{verified} geverifieerd · {claims.filter((c) => c.status === "insufficient").length} onvoldoende bewijs</span>
            </div>
            <div className="card tight">
              <div className="tiny">Belangrijkste open vraag</div>
              <div style={{ fontSize: 16, fontWeight: 700, lineHeight: 1.3, margin: "12px 0 7px" }}>{openQuestion?.question ?? "Alle vragen beantwoord"}</div>
              <span className={`pill ${openQuestion ? "orange" : "green"}`}>{openQuestion ? "Nog niet beantwoord" : "Klaar"}</span>
            </div>
          </div>

          <div className="grid-2">
            <div className="stack">
              <ResearchRunPanel
                ideaId={id}
                canWrite={canWrite}
                aiConnected={aiConfigured()}
                run={run ? { id: run.id, status: run.status, mode: run.mode, cost: Number(run.cost_usd), budget: Number(run.budget_usd), tasks: (tasks ?? []).map((t) => ({ label: t.label, status: t.status, detail: t.detail })) } : null}
              />
              {challenges.length > 0 && (
                <div className="card">
                  <div className="section-title"><h3>Tegenargumenten</h3><span className="pill coral">Advocaat van de duivel</span></div>
                  {challenges.map((c, i) => (
                    <div className="quickline" key={i}>
                      <span className="num">!</span>
                      <div><strong>{c.title}</strong><span>{c.detail}</span></div>
                    </div>
                  ))}
                  <div className="note">Deze punten zijn kritische vragen van de AI, geen bewijs. Neem ze mee in de Reality Check.</div>
                </div>
              )}
            </div>
            <div className="card">
              <div className="section-title">
                <h3>Onderzoekskaart</h3>
                {canWrite && aiConfigured() && (
                  <ActionForm action={aiPlan.bind(null, id)} submitLabel="Laat AI opnieuw voorstellen" submitClass="text-link" pendingLabel="Bezig…">
                    <span />
                  </ActionForm>
                )}
              </div>
              {questions.map((q) => {
                const qClaims = claims.filter((c) => c.question_id === q.id);
                const [label, pill] = QSTATUS[q.status as keyof typeof QSTATUS];
                return (
                  <details key={q.id} className="quickline" style={{ display: "block" }}>
                    <summary style={{ display: "flex", gap: 11, alignItems: "center", cursor: "pointer", listStyle: "none" }}>
                      <span className="num">{q.position}</span>
                      <div style={{ flex: 1 }}>
                        <strong>{q.question}</strong>
                        <span>{METHOD[q.method as keyof typeof METHOD]} · {qClaims.length} bevinding{qClaims.length === 1 ? "" : "en"}</span>
                      </div>
                      <span className={`pill ${pill}`}>{label}</span>
                    </summary>
                    <div style={{ padding: "10px 0 4px 39px" }}>
                      {q.why_it_matters && <p className="tiny">Waarom: {q.why_it_matters}</p>}
                      <p className="tiny mt-8">Klaar als: {q.done_criterion}</p>
                      {canWrite && (
                        <ActionForm action={saveQuestion.bind(null, id, q.id)} submitLabel="Vraag opslaan" submitClass="btn white sm" footer={<DeleteQuestion ideaId={id} questionId={q.id} />}>
                          <label className="field-label" htmlFor={`q-${q.id}`}>Vraag</label>
                          <input className="field" id={`q-${q.id}`} name="question" defaultValue={q.question} />
                          <label className="field-label" htmlFor={`d-${q.id}`}>Klaar-criterium</label>
                          <input className="field" id={`d-${q.id}`} name="done_criterion" defaultValue={q.done_criterion} />
                          <div className="double-field">
                            <div>
                              <label className="field-label" htmlFor={`m-${q.id}`}>Methode</label>
                              <select className="field" id={`m-${q.id}`} name="method" defaultValue={q.method}>
                                {Object.entries(METHOD).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                              </select>
                            </div>
                            <div>
                              <label className="field-label" htmlFor={`s-${q.id}`}>Status</label>
                              <select className="field" id={`s-${q.id}`} name="status" defaultValue={q.status}>
                                {Object.entries(QSTATUS).map(([k, [v]]) => <option key={k} value={k}>{v}</option>)}
                              </select>
                            </div>
                          </div>
                        </ActionForm>
                      )}
                    </div>
                  </details>
                );
              })}
              {canWrite && questions.length < 5 && (
                <details className="mt-12">
                  <summary className="text-link">+ Vraag toevoegen</summary>
                  <ActionForm action={saveQuestion.bind(null, id, null)} submitLabel="Toevoegen" resetOnSuccess>
                    <label className="field-label" htmlFor="nq">Vraag</label>
                    <input className="field" id="nq" name="question" />
                    <label className="field-label" htmlFor="nd">Klaar-criterium</label>
                    <input className="field" id="nd" name="done_criterion" />
                    <input type="hidden" name="method" value="both" />
                    <input type="hidden" name="status" value="open" />
                  </ActionForm>
                </details>
              )}
            </div>
          </div>

          <div className="section-title mt-24"><h2>Bevindingen per onderzoeksvraag</h2></div>
          {claims.length === 0 ? (
            <div className="empty-state">
              <h3>Nog geen bevindingen</h3>
              <p>{aiConfigured() ? "Start een marktcheck, of voeg zelf een bron met letterlijk citaat toe." : "Voeg een bron toe onder Bronnen en leg er een bevinding met letterlijk citaat bij."}</p>
            </div>
          ) : (
            <div className="stack">
              {questions.map((q) => {
                const list = claims.filter((c) => c.question_id === q.id);
                if (list.length === 0) return null;
                return (
                  <div key={q.id} className="stack">
                    <div className="eyebrow" style={{ marginBottom: 0 }}>VRAAG {q.position} · {q.question}</div>
                    {list.map((c) => <InsightCard key={c.id} claim={c} actions={claimActions(c.id)} />)}
                  </div>
                );
              })}
              {claims.filter((c) => !c.question_id).map((c) => <InsightCard key={c.id} claim={c} actions={claimActions(c.id)} />)}
            </div>
          )}

          <div className="card" style={{ marginTop: 18 }}>
            <div className="section-title"><h3>Concurrentielandschap</h3></div>
            <div className="grid-3">
              <div style={{ padding: 15, background: "#f2f5fe", borderRadius: 14 }}>
                <span className="pill blue">Direct</span>
                <h3 style={{ fontSize: 16, margin: "12px 0 7px" }}>{competitors.filter((c) => c.kind === "direct").length} aanbieders</h3>
                <p className="tiny">{competitors.filter((c) => c.kind === "direct").map((c) => c.name).slice(0, 3).join(", ") || "Nog niet onderzocht"}</p>
              </div>
              <div style={{ padding: 15, background: "#fff3ea", borderRadius: 14 }}>
                <span className="pill coral">Indirect</span>
                <h3 style={{ fontSize: 16, margin: "12px 0 7px" }}>{competitors.filter((c) => c.kind === "indirect").length} aanbieders</h3>
                <p className="tiny">{competitors.filter((c) => c.kind === "indirect").map((c) => c.name).slice(0, 3).join(", ") || "Nog niet onderzocht"}</p>
              </div>
              <div style={{ padding: 15, background: "#edf3e9", borderRadius: 14 }}>
                <span className="pill green">Alternatief</span>
                <h3 style={{ fontSize: 16, margin: "12px 0 7px" }}>{competitors.filter((c) => c.kind === "alternative" || c.kind === "status_quo").length} alternatieven</h3>
                <p className="tiny">{competitors.filter((c) => c.kind === "alternative" || c.kind === "status_quo").map((c) => c.name).slice(0, 3).join(", ")}</p>
              </div>
            </div>
            {!kinds.has("direct") && <div className="note">Nog geen directe aanbieders vastgelegd. &quot;Geen concurrentie&quot; is zelden waar; zoek ook in aangrenzende markten.</div>}
          </div>
        </div>

        {/* Concurrenten */}
        <div key="competitors">
          <CompetitorPanel
            competitors={competitors}
            canWrite={canWrite}
            claims={claims.filter((c) => c.status !== "insufficient").map((c) => ({ id: c.id, statement: c.statement }))}
            addAction={saveCompetitor.bind(null, id, null)}
            updateActions={Object.fromEntries(competitors.map((c) => [c.id, saveCompetitor.bind(null, id, c.id)]))}
            deleteActions={Object.fromEntries(competitors.map((c) => [c.id, deleteCompetitor.bind(null, id, c.id)]))}
          />
        </div>

        {/* Doelgroepen */}
        <div key="customers">
          <div className="section-title">
            <div>
              <h2>Wie heeft dit probleem?</h2>
              <p className="sub">We onderscheiden de gebruiker, de beslisser en degene die betaalt.</p>
            </div>
            <Link className="btn soft sm" href={`/app/ideas/${id}/experiments`}>Plan klantinterviews →</Link>
          </div>
          {(segRes.data ?? []).length === 0 ? (
            <div className="empty-state"><h3>Nog geen segmenten</h3><p>Leg minstens de gebruiker en de betaler of beslisser vast. In B2B zijn dat vaak verschillende mensen.</p></div>
          ) : (
            <div className="grid-3">
              {(segRes.data ?? []).map((s) => {
                const [label, pill] = ROLE[s.role as keyof typeof ROLE];
                return (
                  <div className="card" key={s.id}>
                    <span className={`pill ${pill}`}>{label}</span>
                    <h3 style={{ margin: "16px 0 10px" }}>{s.label}</h3>
                    {s.job_to_be_done && <p className="sub"><strong>Wil bereiken:</strong> {s.job_to_be_done}</p>}
                    {s.pain && <p className="sub mt-8"><strong>Pijn:</strong> {s.pain}</p>}
                    {s.current_alternative && <p className="sub mt-8"><strong>Nu:</strong> {s.current_alternative}</p>}
                    <div className="divider" />
                    <div className="tiny">Nog te toetsen</div>
                    <strong style={{ fontSize: 12 }}>{s.open_question ?? "—"}</strong>
                    {canWrite && (
                      <form action={deleteSegment.bind(null, id, s.id)} className="mt-12"><button className="text-link" style={{ color: "#a43c42" }}>Verwijderen</button></form>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          {canWrite && (
            <div className="card mt-18">
              <h3>Segment toevoegen</h3>
              <ActionForm action={saveSegment.bind(null, id)} submitLabel="Toevoegen" resetOnSuccess>
                <div className="double-field mt-12">
                  <div className="form-line">
                    <label htmlFor="sg-role">Rol</label>
                    <select className="field" id="sg-role" name="role" defaultValue="user">
                      {Object.entries(ROLE).map(([k, [v]]) => <option key={k} value={k}>{v}</option>)}
                    </select>
                  </div>
                  <div className="form-line"><label htmlFor="sg-label">Naam</label><input className="field" id="sg-label" name="label" placeholder="Bijv. Eventmanager" /></div>
                </div>
                <div className="form-line"><label htmlFor="sg-job">Wat probeert deze persoon te bereiken?</label><input className="field" id="sg-job" name="job_to_be_done" /></div>
                <div className="double-field">
                  <div className="form-line"><label htmlFor="sg-pain">Pijn of frustratie</label><input className="field" id="sg-pain" name="pain" /></div>
                  <div className="form-line"><label htmlFor="sg-alt">Huidige oplossing</label><input className="field" id="sg-alt" name="current_alternative" /></div>
                </div>
                <div className="form-line"><label htmlFor="sg-open">Belangrijkste open vraag</label><input className="field" id="sg-open" name="open_question" /></div>
              </ActionForm>
            </div>
          )}
          <div className="card" style={{ marginTop: 18 }}>
            <div className="eyebrow">GOEDE VRAAG VOOR ECHT ONDERZOEK</div>
            <h3 style={{ margin: "7px 0" }}>&quot;Kun je vertellen over de laatste keer dat je dit probleem had?&quot;</h3>
            <p className="sub">Dat levert vaak concreter gedrag op dan vragen of iemand jouw nieuwe oplossing aantrekkelijk vindt.</p>
          </div>
        </div>

        {/* Marktpotentieel */}
        <div key="sizing">
          <SizingPanel
            canWrite={canWrite}
            claims={sizingClaims}
            scenarios={(scenRes.data ?? []).map((s) => ({
              id: s.id,
              kind: s.kind as ScenarioKind,
              model: s.model as SizingModel,
              factors: (s.sizing_factors ?? []).sort((a, b) => a.position - b.position).map((f) => ({ key: f.key, label: f.label, unit: f.unit, value: Number(f.value), claim_id: f.claim_id, note: f.note })),
            }))}
            actions={Object.fromEntries((scenRes.data ?? []).map((s) => [s.id, saveScenario.bind(null, id, s.id)]))}
          />
          <UnitEconomicsPanel
            canWrite={canWrite}
            action={saveUnitEconomics.bind(null, id)}
            initial={{
              pricePerCustomerYear: ue?.price_per_customer_year ?? null,
              grossMarginPct: ue?.gross_margin_pct ?? null,
              cacEur: ue?.cac_eur ?? null,
              annualChurnPct: ue?.annual_churn_pct ?? null,
              fixedCostsYear: ue?.fixed_costs_year ?? null,
              upfrontInvestment: ue?.upfront_investment ?? null,
            }}
          />
        </div>

        {/* Bronnen */}
        <div key="sources">
          <div className="section-title">
            <div>
              <h2>Alle bronnen bij elkaar.</h2>
              <p className="sub">Per bron: herkomst, datum, het bewaarde fragment en welke bevindingen erop steunen.</p>
            </div>
          </div>
          <div className="card">
            {sources.length === 0 && <p className="sub">Nog geen bronnen.</p>}
            {sources.map((s) => {
              const used = claims.filter((c) => c.evidence.some((e) => e.source?.title === s.title)).length;
              return (
                <div className="source-item" key={s.id}>
                  <span className="source-icon" aria-hidden="true">{s.source_type === "official_statistic" ? "▣" : s.url ? "↗" : "◉"}</span>
                  <div style={{ flex: 1 }}>
                    <strong>{s.url ? <a href={s.url} target="_blank" rel="noreferrer noopener">{s.title}</a> : s.title}</strong>
                    <p>
                      {SOURCE_TYPES[s.source_type as SourceType]}
                      {s.publisher ? ` · ${s.publisher}` : ""} · {s.published_on ? new Date(s.published_on).toLocaleDateString("nl-NL") : "datum onbekend"} · opgehaald{" "}
                      {new Date(s.retrieved_at).toLocaleDateString("nl-NL")} · {(s.source_excerpts ?? []).length} fragment(en) · {used} bevinding(en)
                    </p>
                    {s.access_note && <p>{s.access_note}</p>}
                    <details>
                      <summary className="text-link">Bewaarde fragmenten</summary>
                      {(s.source_excerpts ?? []).map((e) => (
                        <blockquote className="quote" key={e.id}>{e.text}{e.location ? <span className="tiny"> ({e.location})</span> : null}</blockquote>
                      ))}
                    </details>
                  </div>
                  <div className="stack" style={{ justifyItems: "end" }}>
                    <span className={`pill ${s.is_primary || s.source_type === "official_statistic" ? "green" : "gray"}`}>{s.is_primary ? "Primair" : s.source_type === "official_statistic" ? "Officieel" : "Secundair"}</span>
                    {canWrite && (
                      <form action={deleteSource.bind(null, id, s.id)}><button className="text-link" style={{ color: "#a43c42" }}>Verwijderen</button></form>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          {canWrite && (
            <div className="grid-2 mt-18">
              <div className="card">
                <h3>1. Bron toevoegen</h3>
                <p className="sub" style={{ margin: "6px 0 12px" }}>URL, CSV-regel of rapportpassage: alleen het relevante fragment wordt bewaard.</p>
                <AddSourceForm action={addSource.bind(null, id)} />
              </div>
              <div className="card">
                <h3>2. Bevinding met citaat vastleggen</h3>
                <p className="sub" style={{ margin: "6px 0 12px" }}>ProofLab controleert of het citaat letterlijk in het fragment staat en bepaalt de status zelf.</p>
                <AddClaimForm action={addClaim.bind(null, id)} excerpts={excerpts} questions={questions.map((q) => ({ id: q.id, position: q.position, question: q.question }))} />
              </div>
            </div>
          )}
          <div className="note">
            Statussen: {Object.values(CLAIM_STATUS).map((s) => s.label).join(" · ")}. De status wordt berekend uit de bronnen en het citaat, niet handmatig gekozen.
          </div>
        </div>
      </Tabs>
    </PageFrame>
  );
}

function DeleteQuestion({ ideaId, questionId }: { ideaId: string; questionId: string }) {
  return (
    <button formAction={deleteQuestion.bind(null, ideaId, questionId)} className="text-link" style={{ color: "#a43c42" }}>
      Vraag verwijderen
    </button>
  );
}
