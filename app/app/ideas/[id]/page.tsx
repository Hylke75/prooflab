import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { PageFrame } from "@/components/shell/PageFrame";
import { Icon, type IconName } from "@/components/Icon";
import { calendarDate } from "@/components/sprint/SprintCard";
import { getIdea } from "@/lib/data";
import { loadProgress } from "@/lib/progress";
import { loadOpenNotes } from "@/lib/coach/review";
import { NOTE_KINDS, type NoteKind } from "@/lib/coach/rules";
import { nextAction, predictionTip, sprintStage } from "@/lib/domain/coach";
import { SPRINT_PHASES, sprintStatus, todayInNL } from "@/lib/domain/sprint";
import { dossierStatus, IDEA_OVERVIEW, IDEA_REPORT, STEPS, stepOverview } from "@/lib/steps";

export const metadata: Metadata = { title: IDEA_OVERVIEW.label };

// Snelkoppelingen met dezelfde namen als het menu: de vier stappen, het rapport en de tabbladen onder Markt en Besluit.
const SHORTCUTS: { suffix: string; label: string; icon: IconName }[] = [
  ...STEPS.map((s) => ({ suffix: s.path, label: `${s.number} ${s.label}`, icon: s.icon })),
  { suffix: IDEA_REPORT.path, label: IDEA_REPORT.label, icon: IDEA_REPORT.icon },
  ...STEPS.flatMap((s) => (s.tabs ?? []).filter((t) => t.path !== s.path).map((t) => ({ suffix: t.path, label: `${s.label} · ${t.label}`, icon: s.icon }))),
];

// Overzicht van dit idee (voorheen dossieroverzicht): beslisvraag, sprintweek en stap, voortgang per stap, de volgende actie en de open coachtips.
// Opdrachtgevers gaan zoals voorheen direct naar het rapport.
export default async function IdeaOverview({ params }: PageProps<"/app/ideas/[id]">) {
  const { id } = await params;
  const { idea, canWrite } = await getIdea(id);
  if (!canWrite) redirect(`/app/ideas/${id}/report`);
  const progress = await loadProgress(id);
  const today = todayInNL();
  const next = nextAction(progress);
  const tip = predictionTip(progress);
  const steps = stepOverview(progress);
  const notes = await loadOpenNotes(id, "consultant");
  const s = sprintStatus({
    start: idea.sprint_start,
    weeks: idea.sprint_weeks,
    today,
    stage: sprintStage(progress),
    testsStarted: progress.experimentsLive + progress.experimentsEnded > 0,
  });
  const sprintText = !s.planned
    ? "Nog geen sprint gepland"
    : s.state === "running"
      ? `Week ${s.week} van ${s.weeks} · ${SPRINT_PHASES[s.phase].label}`
      : s.state === "finished"
        ? "Sprint afgerond"
        : `Sprint start over ${s.daysToStart} ${s.daysToStart === 1 ? "dag" : "dagen"}`;
  // B1c: één huidige stap, en apart hoeveel stappen echt bewijs hebben (niet hetzelfde als "klaar").
  const status = dossierStatus(progress);
  const withEvidence = status.stepsWithEvidence;

  return (
    <PageFrame crumbs={["Werkruimte", idea.title, IDEA_OVERVIEW.label]} coach="overview" ideaId={id} section="">
      <div className="section-row">
        <div>
          <div className="eyebrow">{IDEA_OVERVIEW.label}</div>
          <h1>{idea.title}</h1>
          <p className="sub">{idea.decision_question}</p>
        </div>
      </div>

      <div className="grid-3">
        <div className="card tight">
          <div className="eyebrow">Sprint</div>
          <strong>{sprintText}</strong>
          {s.planned && s.behind && <p className="tiny mt-8">{s.behindReason}</p>}
        </div>
        <div className="card tight">
          <div className="eyebrow">Huidige stap</div>
          <strong>{status.currentLabel}</strong>
          <p className="tiny mt-8">{status.steps.find((x) => x.key === status.current)?.why ?? "Alle stappen zijn afgerond."}</p>
        </div>
        <div className="card tight">
          <div className="eyebrow">Beslisdatum en inzet</div>
          <strong>{idea.decision_deadline ? calendarDate(idea.decision_deadline, { day: "numeric", month: "long", year: "numeric" }) : "Geen beslisdatum"}</strong>
          <p className="tiny mt-8">{idea.decision_stakes ? `Inzet: ${idea.decision_stakes}` : "Inzet niet vastgelegd"}</p>
        </div>
      </div>

      <div className="card mt-24">
        <div className="section-title">
          <h2 className="as-h3">Volgende stap</h2>
          <span className="pill blue">Aanbevolen</span>
        </div>
        <p style={{ fontSize: 16, fontWeight: 700 }}>{next.title}</p>
        <p className="sub">{next.detail}</p>
        <Link className="btn primary mt-12" href={next.href} prefetch={false}>
          <Icon name={next.icon} /> {next.title} <Icon name="arrow" size="sm" />
        </Link>
        {tip && tip.href !== next.href && (
          <p className="tiny mt-12">
            Ook nuttig: <Link className="text-link" href={tip.href} prefetch={false}>{tip.title}</Link>. {tip.detail}
          </p>
        )}
      </div>

      <div className="grid-2 mt-24">
        <div className="card">
          <div className="section-title">
            <h2 className="as-h3">Voortgang per stap</h2>
            <span className="pill gray num" title="Stappen met echte waarnemingen of geverifieerde bronnen">{withEvidence} van 4 met bewijs</span>
          </div>
          <ol className="stack" style={{ listStyle: "none", padding: 0, margin: 0 }} aria-label="Stappen van het dossier">
            {steps.map((step) => (
              <li key={step.key} className="quickline" aria-current={step.current ? "step" : undefined}>
                <span className="num" style={step.done ? { background: "var(--color-primary)", color: "var(--color-on-dark)" } : undefined} aria-hidden="true">
                  {step.done ? <Icon name="check" size="sm" /> : step.number}
                </span>
                <div>
                  <strong>
                    <Link href={step.href} prefetch={false}>{step.label}</Link>
                  </strong>
                  <span>{step.counts}</span>
                  <span>{step.why}{step.hasEvidence ? "" : " Nog geen echt bewijs in deze stap."}</span>
                </div>
                <span className={`pill ${step.done ? "green" : step.current ? "blue" : step.state === "running" ? "orange" : "gray"}`}>{step.current && !step.done ? `Nu · ${step.statusLabel}` : step.statusLabel}</span>
              </li>
            ))}
          </ol>
        </div>

        <div className="card">
          <div className="section-title">
            <h2 className="as-h3">Open coachtips</h2>
            <span className={`pill ${notes.length ? "coral" : "gray"}`}>{notes.length} open</span>
          </div>
          {notes.length === 0 ? (
            <p className="sub">Geen open punten. De coach meldt zich als er iets opvalt in het dossier.</p>
          ) : (
            notes.slice(0, 6).map((n) => {
              const k = NOTE_KINDS[(n.kind as NoteKind) in NOTE_KINDS ? (n.kind as NoteKind) : "tip"];
              return (
                <div className="quickline" key={n.id}>
                  <span className="num" aria-hidden="true"><Icon name={k.icon} size="sm" /></span>
                  <div>
                    <strong>{n.title}</strong>
                    <span>{k.label}{n.source === "ai" ? " · AI-coach, advies" : ""}</span>
                  </div>
                  {n.href && <Link className="text-link" href={n.href} prefetch={false} aria-label={`Bekijken: ${n.title}`}>Bekijken →</Link>}
                </div>
              );
            })
          )}
          {notes.length > 6 && <p className="tiny">En nog {notes.length - 6} in het coachpaneel.</p>}
        </div>
      </div>

      <div className="section-title mt-24"><h2>Snelkoppelingen</h2></div>
      <div className="chat-suggestions" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 12 }}>
        {SHORTCUTS.map((sc) => (
          <Link key={sc.suffix} className="suggestion card tight" href={`/app/ideas/${id}${sc.suffix}`} prefetch={false}>
            <Icon name={sc.icon} /> {sc.label}
          </Link>
        ))}
      </div>
    </PageFrame>
  );
}
