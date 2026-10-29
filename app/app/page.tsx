import type { Metadata } from "next";
import Link from "next/link";
import { Icon } from "@/components/Icon";
import { PageFrame } from "@/components/shell/PageFrame";
import { SprintCard, calendarDate } from "@/components/sprint/SprintCard";
import { getWorkspace, type Workspace } from "@/lib/data";
import { supabaseServer } from "@/lib/supabase/server";
import { loadAssumptions, loadProgress } from "@/lib/progress";
import { nextAction, sprintStage, type IdeaProgress } from "@/lib/domain/coach";
import { SPRINT_PHASES, sprintStatus, testDay, todayInNL } from "@/lib/domain/sprint";
import { DECISIONS, type DecisionAction } from "@/lib/domain/labels";
import { currentStepLabel, stepsDone } from "@/lib/steps";
import { CreateWorkspace } from "./CreateWorkspace";

export const metadata: Metadata = { title: "Overzicht" };

const SYMBOLS = ["⌘", "▧", "◆", "✦", "◎", "▲"];
// An assumption counts as strongly supported once observed behaviour lifts it past desk research (max. 0.45).
const STRONG_EVIDENCE = 0.6;
const pad = (n: number) => String(n).padStart(2, "0");

type IdeaRow = {
  id: string;
  title: string;
  description: string;
  status: string;
  is_demo: boolean;
  decision_deadline: string | null;
  sprint_start?: string | null;
  sprint_weeks?: number | null;
  clients: { name: string } | null;
};

export default async function Dashboard() {
  const ws = await getWorkspace();
  const supabase = await supabaseServer();
  // "*" keeps the overview working on databases that do not have the sprint columns yet.
  const { data } = await supabase.from("ideas").select("*, clients(name)").order("updated_at", { ascending: false }).limit(12);
  const list = (data ?? []) as unknown as IdeaRow[];

  if (!ws.org && list.length === 0) {
    return (
      <PageFrame crumbs={["Werkruimte", "Welkom"]} coach="dashboard">
        <CreateWorkspace />
      </PageFrame>
    );
  }
  const progresses = await Promise.all(list.map((i) => loadProgress(i.id)));
  if (!ws.org) return <ClientHome ws={ws} list={list} progresses={progresses} />;
  return <ConsultantHome list={list} progresses={progresses} />;
}

function Hero({ client }: { client: boolean }) {
  return (
    <div className="hero">
      <div>
        <div className="eyebrow">{client ? "MEEKIJKEN ALS OPDRACHTGEVER" : "JOUW IDEEËN. ONDERBOUWD."}</div>
        <h1>
          Van goed idee naar
          <br />
          sterk bewijs.
        </h1>
        <p>{client ? "Volg het onderzoek, lees de gedeelde rapporten en bevestig besluiten." : "Onderzoek slimmer. Test sneller. Beslis met vertrouwen."}</p>
        {!client && (
          <Link className="btn primary" href="/app/ideas/new">
            <Icon name="plus" /> Nieuw idee onderzoeken
          </Link>
        )}
      </div>
      <div className="hero-shape" aria-hidden="true">
        <div className="spark-shape"><span>✳</span></div>
        <div className="floating one">✦ Marktinzichten</div>
        <div className="floating two">↗ Kansen ontdekken</div>
        <div className="floating three">✓ Echt bewijs</div>
      </div>
    </div>
  );
}

function ideaStatusLabel(status: string, p: IdeaProgress) {
  return status === "active" ? currentStepLabel(p) : status === "stopped" ? "Gestopt" : status === "parked" ? "Gepauzeerd" : "Doorgaan";
}

async function ConsultantHome({ list, progresses }: { list: IdeaRow[]; progresses: IdeaProgress[] }) {
  const today = todayInNL();
  const assumptionLists = await Promise.all(list.map((i) => loadAssumptions(i.id)));
  const critical = assumptionLists.flat().filter((a) => a.importance >= 4);
  const strong = critical.filter((a) => a.evidence >= STRONG_EVIDENCE);
  const liveTests = progresses
    .flatMap((p, idx) => p.experiments.filter((e) => e.state === "live").map((e) => ({ ...e, idea: list[idx].title, day: testDay(e.startedAt, e.endsAt) })))
    .sort((a, b) => (a.endsAt ?? "").localeCompare(b.endsAt ?? ""));
  const awaiting = progresses.filter((p) => p.decisions > 0 && !p.latestDecisionConfirmed).length;
  const actions = progresses.map((p, idx) => ({ ...nextAction(p), idea: list[idx].title })).slice(0, 3);
  const sprintIdeas = list.map((i, idx) => ({ idea: i, p: progresses[idx] })).filter(({ idea }) => idea.status === "active");

  return (
    <PageFrame crumbs={["Werkruimte", "Overzicht"]} coach="dashboard" ideaId={list[0]?.id}>
      <Hero client={false} />

      <div className="grid-3" style={{ marginBottom: 31 }}>
        <div className="card tight">
          <div className="tiny">Kritieke aannames met sterk bewijs</div>
          <div className="mini-kpi num">
            {pad(strong.length)}
            <span className="tiny" style={{ fontSize: 13, letterSpacing: 0, marginLeft: 6 }}>van {critical.length}</span>
          </div>
          <span className={`pill ${critical.length && strong.length === critical.length ? "green" : critical.length ? "orange" : "gray"}`}>
            {critical.length === 0 ? "Nog geen kritieke aannames" : strong.length === critical.length ? "Allemaal onderbouwd met gedrag" : `${critical.length - strong.length} nog zonder sterk bewijs`}
          </span>
        </div>
        <div className="card tight">
          <div className="tiny">Lopende tests</div>
          <div className="mini-kpi num">{pad(liveTests.length)}</div>
          {liveTests[0] ? (
            <span className="pill green" title={`${liveTests[0].idea}: ${liveTests[0].title}`}>
              {liveTests[0].day ? `Dag ${liveTests[0].day.day} van ${liveTests[0].day.of}` : "Loopt"} · {liveTests[0].title.length > 26 ? `${liveTests[0].title.slice(0, 25)}…` : liveTests[0].title}
            </span>
          ) : (
            <span className="pill gray">Nog geen test live</span>
          )}
        </div>
        <div className="card tight">
          <div className="tiny">Besluiten die wachten op bevestiging</div>
          <div className="mini-kpi num">{pad(awaiting)}</div>
          <span className={`pill ${awaiting ? "orange" : "green"}`}>{awaiting ? "Opdrachtgever moet bevestigen" : "Niets openstaand"}</span>
        </div>
      </div>

      <div className="section-title">
        <h2>Mijn ideeën</h2>
        <Link className="text-link" href="/app/ideas/new">
          Nieuw idee <Icon name="arrow" size="sm" />
        </Link>
      </div>
      {list.length === 0 ? (
        <div className="empty-state">
          <h3>Nog geen ideeën</h3>
          <p>Begin met de beslissing die je wilt nemen. ProofLab maakt daar een onderzoekskaart en een eerste test bij.</p>
          <Link className="btn primary" href="/app/ideas/new">
            <Icon name="plus" /> Nieuw idee onderzoeken
          </Link>
        </div>
      ) : (
        <div className="ideas">
          {list.map((idea, idx) => {
            const p = progresses[idx];
            const done = Object.values(stepsDone(p)).filter(Boolean).length;
            const next = nextAction(p);
            const s = sprintStatus({ start: idea.sprint_start, weeks: idea.sprint_weeks, today, stage: sprintStage(p), testsStarted: p.experimentsLive + p.experimentsEnded > 0 });
            return (
              <Link key={idea.id} href={next.href} className="card idea" style={{ textDecoration: "none" }} aria-label={`${idea.title}: ${next.title}`}>
                <div className="idea-top">
                  <span className="idea-symbol" style={idx % 2 ? { background: "#fff0e8", color: "#bd6246" } : undefined}>
                    {SYMBOLS[idx % SYMBOLS.length]}
                  </span>
                  <span className="row" style={{ gap: 6 }}>
                    {idea.is_demo && <span className="pill orange">Demo</span>}
                    {s.planned && s.state === "running" && <span className={`pill ${s.behind ? "coral" : "gray"}`}>Week {s.week}/{s.weeks}{s.behind ? " · loopt achter" : ""}</span>}
                    <span className={`pill ${idea.status === "active" ? "blue" : "gray"}`}>{ideaStatusLabel(idea.status, p)}</span>
                  </span>
                </div>
                <h3>{idea.title}</h3>
                <p>{idea.description.length > 140 ? `${idea.description.slice(0, 137)}…` : idea.description}</p>
                <div className="progress" role="img" aria-label={`${done} van 5 stappen met bewijs afgerond`}>
                  <div style={{ width: `${(done / 5) * 100}%`, background: idx % 2 ? "var(--coral)" : undefined }} />
                </div>
                <div className="idea-foot">
                  <span>
                    {idea.clients?.name ? `${idea.clients.name} · ` : ""}
                    {done} van 5 stappen met bewijs
                  </span>
                  <span>
                    Verder <Icon name="arrow" size="sm" className="va-middle" />
                  </span>
                </div>
              </Link>
            );
          })}
        </div>
      )}

      {sprintIdeas.length > 0 && (
        <>
          <div className="section-title" style={{ marginTop: 31 }}>
            <h2>Sprintplanning</h2>
            <span className="pill gray">Onderzoek · aannames · testen · besluit</span>
          </div>
          <div className="sprints">
            {sprintIdeas.map(({ idea, p }) => (
              <SprintCard key={idea.id} idea={idea} progress={p} canWrite today={today} />
            ))}
          </div>
        </>
      )}

      <div className="grid-2" style={{ marginTop: 20 }}>
        <div className="card">
          <div className="section-title">
            <h3>Wat is nu slim om te doen?</h3>
            <span className="pill blue">Aanbevolen</span>
          </div>
          {actions.length === 0 && <p className="sub">Maak eerst een idee aan.</p>}
          {actions.map((a, i) => (
            <div className="quickline" key={a.href + i}>
              <span className="num">{i + 1}</span>
              <div>
                <strong>{a.title}</strong>
                <span>
                  {a.idea}: {a.detail}
                </span>
              </div>
              <Link className="text-link" href={a.href} aria-label={`Open: ${a.title} (${a.idea})`}>
                Open →
              </Link>
            </div>
          ))}
        </div>
        <div className="card" style={{ background: "#e3f0e8", borderColor: "#d5e8dc" }}>
          <div className="eyebrow" style={{ color: "#2b7159" }}>ZO WERKT PROOFLAB</div>
          <h3 style={{ fontSize: 25, maxWidth: 370, margin: "9px 0" }}>Eén heldere stap tegelijk. Zonder ingewikkelde modellen.</h3>
          <p className="sub" style={{ color: "#3f5f52", marginBottom: 22 }}>
            ProofLab denkt kritisch mee en helpt je de juiste onderbouwing te vinden. Jij houdt de regie.
          </p>
          <Link className="btn white" href="/app/help">
            Zo werkt het stappenplan <Icon name="arrow" size="sm" />
          </Link>
        </div>
      </div>
    </PageFrame>
  );
}

type SharedReport = { id: string; idea_id: string; version: number; created_at: string; shared_at: string | null };

async function sharedReports(ids: string[]): Promise<SharedReport[]> {
  if (ids.length === 0) return [];
  const supabase = await supabaseServer();
  const res = await supabase.from("reports").select("id, idea_id, version, created_at, shared_at").in("idea_id", ids).order("version", { ascending: false });
  // Before the sharing migration there is no shared_at column, and nothing counts as shared.
  return (res.error ? [] : (res.data ?? [])).filter((r) => r.shared_at);
}

async function ClientHome({ ws, list, progresses }: { ws: Workspace; list: IdeaRow[]; progresses: IdeaProgress[] }) {
  const supabase = await supabaseServer();
  const today = todayInNL();
  const ids = list.map((i) => i.id);
  const [{ data: memberships }, { data: decisions }, reports] = await Promise.all([
    supabase.from("idea_members").select("idea_id, role").eq("user_id", ws.user.id),
    supabase.from("decisions").select("id, idea_id, action, decided_at, client_confirmed_at").in("idea_id", ids).order("decided_at", { ascending: false }),
    sharedReports(ids),
  ]);
  const isDecider = (ideaId: string) => (memberships ?? []).some((m) => m.idea_id === ideaId && m.role === "client_decider");
  const latestDecision = (ideaId: string) => (decisions ?? []).find((d) => d.idea_id === ideaId);
  const toConfirm = list
    .map((idea) => ({ idea, decision: latestDecision(idea.id) }))
    .filter(({ idea, decision }) => decision && !decision.client_confirmed_at && isDecider(idea.id));

  return (
    <PageFrame crumbs={["Opdrachtgever", "Mijn dossiers"]} coach="dashboard" ideaId={list[0]?.id}>
      <Hero client />

      {toConfirm.map(({ idea, decision }) => (
        <div className="action-card" key={idea.id} role="region" aria-label={`Actie nodig voor ${idea.title}`}>
          <div>
            <span className="pill orange">Actie nodig</span>
            <h2 style={{ marginTop: 8 }}>Bevestig het besluit: {DECISIONS[decision!.action as DecisionAction]?.label ?? decision!.action}</h2>
            <p>
              {idea.title} · vastgelegd op {new Date(decision!.decided_at).toLocaleDateString("nl-NL", { day: "numeric", month: "long" })}. Lees de onderbouwing en bevestig het besluit, eventueel met een opmerking.
            </p>
          </div>
          <Link className="btn primary" href={`/app/ideas/${idea.id}/evidence`}>
            Bekijk en bevestig <Icon name="arrow" size="sm" />
          </Link>
        </div>
      ))}

      <div className="grid-3" style={{ marginBottom: 31 }}>
        <div className="card tight">
          <div className="tiny">Dossiers</div>
          <div className="mini-kpi num">{pad(list.length)}</div>
          <span className="pill blue">{list.filter((i) => i.status === "active").length} in onderzoek</span>
        </div>
        <div className="card tight">
          <div className="tiny">Gedeelde rapporten</div>
          <div className="mini-kpi num">{pad(reports.length)}</div>
          <span className={`pill ${reports.length ? "green" : "gray"}`}>{reports.length ? `Laatste ${calendarDate(reports[0].shared_at!)}` : "Nog niets gedeeld"}</span>
        </div>
        <div className="card tight">
          <div className="tiny">Besluiten om te bevestigen</div>
          <div className="mini-kpi num">{pad(toConfirm.length)}</div>
          <span className={`pill ${toConfirm.length ? "orange" : "green"}`}>{toConfirm.length ? "Wacht op u" : "Niets openstaand"}</span>
        </div>
      </div>

      <div className="section-title">
        <h2>Mijn dossiers</h2>
      </div>
      <div className="ideas">
        {list.map((idea, idx) => {
          const p = progresses[idx];
          const s = sprintStatus({ start: idea.sprint_start, weeks: idea.sprint_weeks, today, stage: sprintStage(p), testsStarted: p.experimentsLive + p.experimentsEnded > 0 });
          const report = reports.find((r) => r.idea_id === idea.id);
          const decision = latestDecision(idea.id);
          return (
            <article key={idea.id} className="card idea">
              <div className="idea-top">
                <span className="idea-symbol" style={idx % 2 ? { background: "#fff0e8", color: "#bd6246" } : undefined} aria-hidden="true">
                  {SYMBOLS[idx % SYMBOLS.length]}
                </span>
                <span className="pill blue">{ideaStatusLabel(idea.status, p)}</span>
              </div>
              <h3>{idea.title}</h3>
              <p>{idea.description.length > 140 ? `${idea.description.slice(0, 137)}…` : idea.description}</p>
              <div className="data-row">
                <span>Sprint</span>
                <strong>
                  {!s.planned
                    ? "Nog niet gepland"
                    : s.state === "not_started"
                      ? `Start ${calendarDate(s.startDate, { day: "numeric", month: "long" })}`
                      : s.state === "finished"
                        ? "Afgerond"
                        : `Week ${s.week} van ${s.weeks} · ${SPRINT_PHASES[s.phase].label}`}
                </strong>
              </div>
              {idea.decision_deadline && (
                <div className="data-row">
                  <span>Beslisdatum</span>
                  <strong>{calendarDate(idea.decision_deadline, { day: "numeric", month: "long", year: "numeric" })}</strong>
                </div>
              )}
              <div className="data-row">
                <span>Laatste rapport</span>
                <strong>{report ? `Versie ${report.version} · gedeeld ${calendarDate(report.shared_at!, { day: "numeric", month: "short" })}` : "Nog niet gedeeld"}</strong>
              </div>
              <div className="data-row">
                <span>Besluit</span>
                <strong>
                  {decision
                    ? `${DECISIONS[decision.action as DecisionAction]?.label ?? decision.action}${decision.client_confirmed_at ? " · bevestigd" : " · nog niet bevestigd"}`
                    : "Nog geen besluit"}
                </strong>
              </div>
              <div className="row mt-12">
                {report && (
                  <Link className="btn primary sm" href={`/app/ideas/${idea.id}/report?v=${report.version}`}>
                    Lees het rapport
                  </Link>
                )}
                <Link className="btn white sm" href={`/app/ideas/${idea.id}/evidence`}>
                  Bekijk het bewijs
                </Link>
              </div>
            </article>
          );
        })}
      </div>

      <div className="card mt-24" style={{ background: "#e3f0e8", borderColor: "#d5e8dc" }}>
        <div className="eyebrow" style={{ color: "#2b7159" }}>ZO WERKT MEEKIJKEN</div>
        <h3 style={{ fontSize: 22, maxWidth: 520, margin: "9px 0" }}>U ziet wat bewezen is, en wat nog niet.</h3>
        <p className="sub" style={{ color: "#3f5f52", marginBottom: 18 }}>
          Het onderzoeksteam voert het onderzoek en de tests uit. U leest de gedeelde rapportversies en bevestigt het besluit. Ruwe interviewcitaten en
          gegevens van testdeelnemers blijven bij het onderzoeksteam.
        </p>
        <Link className="btn white" href="/app/help#begrippen">
          Wat betekenen de begrippen? <Icon name="arrow" size="sm" />
        </Link>
      </div>
    </PageFrame>
  );
}
