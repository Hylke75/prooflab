import type { Metadata } from "next";
import Link from "next/link";
import { Icon } from "@/components/Icon";
import { PageFrame } from "@/components/shell/PageFrame";
import { getWorkspace } from "@/lib/data";
import { supabaseServer } from "@/lib/supabase/server";
import { loadAssumptions, loadProgress } from "@/lib/progress";
import { nextAction } from "@/lib/domain/coach";
import { currentStepLabel, stepsDone } from "@/lib/steps";
import { CreateWorkspace } from "./CreateWorkspace";

export const metadata: Metadata = { title: "Overzicht" };

const SYMBOLS = ["⌘", "▧", "◆", "✦", "◎", "▲"];

export default async function Dashboard() {
  const ws = await getWorkspace();
  const supabase = await supabaseServer();
  const { data: ideas } = await supabase
    .from("ideas")
    .select("id, title, description, status, client_id, is_demo, clients(name)")
    .order("updated_at", { ascending: false })
    .limit(12);

  if (!ws.org && (ideas ?? []).length === 0) {
    return (
      <PageFrame crumbs={["Werkruimte", "Welkom"]} coach="dashboard">
        <CreateWorkspace />
      </PageFrame>
    );
  }

  const list = ideas ?? [];
  const progresses = await Promise.all(list.map((i) => loadProgress(i.id)));
  const assumptionLists = await Promise.all(list.map((i) => loadAssumptions(i.id)));
  const openRisks = assumptionLists.flat().filter((a) => a.importance >= 4 && a.status !== "supported").length;
  const live = progresses.reduce((n, p) => n + p.experimentsLive, 0);
  const active = list.filter((i) => i.status === "active").length;
  const actions = progresses
    .map((p, idx) => ({ ...nextAction(p), idea: list[idx].title }))
    .slice(0, 3);

  return (
    <PageFrame crumbs={["Werkruimte", "Overzicht"]} coach="dashboard" ideaId={list[0]?.id}>
      <div className="hero">
        <div>
          <div className="eyebrow">JOUW IDEEËN. ONDERBOUWD.</div>
          <h1>
            Van goed idee naar
            <br />
            sterk bewijs.
          </h1>
          <p>Onderzoek slimmer. Test sneller. Beslis met vertrouwen.</p>
          {ws.org && (
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

      <div className="grid-3" style={{ marginBottom: 31 }}>
        <div className="card tight">
          <div className="tiny">Ideeën in onderzoek</div>
          <div className="mini-kpi num">{String(active).padStart(2, "0")}</div>
          <span className="pill blue">{list.length} traject{list.length === 1 ? "" : "en"} in totaal</span>
        </div>
        <div className="card tight">
          <div className="tiny">Belangrijkste open risico&apos;s</div>
          <div className="mini-kpi num">{String(openRisks).padStart(2, "0")}</div>
          <span className={`pill ${openRisks ? "orange" : "green"}`}>{openRisks ? "Nog te onderzoeken" : "Geen open kritieke aannames"}</span>
        </div>
        <div className="card tight">
          <div className="tiny">Lopende experimenten</div>
          <div className="mini-kpi num">{String(live).padStart(2, "0")}</div>
          <span className={`pill ${live ? "green" : "gray"}`}>{live ? "Meten echte bezoekers" : "Nog geen test live"}</span>
        </div>
      </div>

      <div className="section-title">
        <h2>Mijn ideeën</h2>
        {ws.org && (
          <Link className="text-link" href="/app/ideas/new">
            Nieuw idee <Icon name="arrow" size="sm" />
          </Link>
        )}
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
            return (
              <Link key={idea.id} href={next.href} className="card idea" style={{ textDecoration: "none" }} aria-label={`Open ${idea.title}`}>
                <div className="idea-top">
                  <span className="idea-symbol" style={idx % 2 ? { background: "#fff0e8", color: "#bd6246" } : undefined}>
                    {SYMBOLS[idx % SYMBOLS.length]}
                  </span>
                  <span className="row" style={{ gap: 6 }}>
                    {idea.is_demo && <span className="pill orange">Demo</span>}
                    <span className={`pill ${idea.status === "active" ? "blue" : "gray"}`}>
                      {idea.status === "active" ? currentStepLabel(p) : idea.status === "stopped" ? "Gestopt" : idea.status === "parked" ? "Gepauzeerd" : "Doorgaan"}
                    </span>
                  </span>
                </div>
                <h3>{idea.title}</h3>
                <p>{idea.description.length > 140 ? `${idea.description.slice(0, 137)}…` : idea.description}</p>
                <div className="progress" aria-label={`${done} van 5 stappen met bewijs afgerond`}>
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
              <Link className="text-link" href={a.href}>
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
