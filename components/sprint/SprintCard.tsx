import Link from "next/link";
import { setSprint } from "@/app/app/sprint-actions";
import { sprintStage, type IdeaProgress } from "@/lib/domain/coach";
import { SPRINT_PHASES, sprintStatus, weekRange } from "@/lib/domain/sprint";
import { SprintPlanForm } from "./SprintPlanForm";

export type SprintIdea = {
  id: string;
  title: string;
  sprint_start?: string | null;
  sprint_weeks?: number | null;
  decision_deadline?: string | null;
};

// Calendar dates are stored without time; format them as such.
export const calendarDate = (d: string, opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "short", year: "numeric" }) =>
  new Date(`${d.slice(0, 10)}T00:00:00Z`).toLocaleDateString("nl-NL", { ...opts, timeZone: "UTC" });

function compute(idea: SprintIdea, progress: IdeaProgress, today: string) {
  return sprintStatus({
    start: idea.sprint_start,
    weeks: idea.sprint_weeks,
    today,
    stage: sprintStage(progress),
    testsStarted: progress.experimentsLive + progress.experimentsEnded > 0,
  });
}

function weekLabel(s: Extract<ReturnType<typeof sprintStatus>, { planned: true }>) {
  if (s.state === "not_started") return `Start over ${s.daysToStart} ${s.daysToStart === 1 ? "dag" : "dagen"}`;
  if (s.state === "finished") return `Sprint afgerond (${s.weeks} weken)`;
  return `Week ${s.week} van ${s.weeks}`;
}

function Deadline({ date, today }: { date: string | null | undefined; today: string }) {
  if (!date) return null;
  const overdue = date.slice(0, 10) < today;
  return (
    <span className={`pill ${overdue ? "coral" : "gray"}`}>
      {overdue ? "Beslisdatum verstreken: " : "Beslisdatum "}
      {calendarDate(date)}
    </span>
  );
}

// Compact sprint card for the dashboard (one per idea).
export function SprintCard({ idea, progress, canWrite, today }: { idea: SprintIdea; progress: IdeaProgress; canWrite: boolean; today: string }) {
  const s = compute(idea, progress, today);
  return (
    <div className="card tight sprint-card">
      <div className="sprint-head">
        <div style={{ minWidth: 0 }}>
          <div className="tiny sprint-kicker">Validatiesprint</div>
          <Link className="sprint-title" href={`/app/ideas/${idea.id}`}>{idea.title}</Link>
        </div>
        {s.planned && <span className="pill blue num">{weekLabel(s)}</span>}
      </div>
      {s.planned ? (
        <>
          <ol className="sprint-track" aria-label="Mijlpalen van de sprint">
            {s.milestones.map((m) => (
              <li key={m.phase} className={m.status} aria-current={m.status === "current" ? "step" : undefined}>
                <span className="sprint-bar" aria-hidden="true" />
                <strong>{weekRange(m)}</strong>
                <span>{m.label}</span>
              </li>
            ))}
          </ol>
          <div className="row sprint-foot">
            {s.behind ? <span className="pill coral">Loopt achter</span> : s.state === "running" ? <span className="pill green">Op schema</span> : null}
            <Deadline date={idea.decision_deadline} today={today} />
            <span className="tiny">Eind {calendarDate(s.endDate, { day: "numeric", month: "short" })}</span>
          </div>
          {s.behindReason && <p className="tiny mt-8">{s.behindReason}</p>}
        </>
      ) : (
        <>
          <p className="tiny mt-8">Nog geen sprint gepland. Een vaste sprint van 4 tot 6 weken geeft het traject een weekplanning en een rapportdatum.</p>
          <div className="row mt-8"><Deadline date={idea.decision_deadline} today={today} /></div>
          {canWrite ? (
            <details className="sprint-plan mt-8">
              <summary className="btn white sm">Plan de sprint</summary>
              <SprintPlanForm action={setSprint.bind(null, idea.id)} today={today} />
            </details>
          ) : (
            <p className="tiny">Het onderzoeksteam plant de sprint.</p>
          )}
        </>
      )}
    </div>
  );
}

// One-line sprint context in the header of every idea page.
export function SprintStrip({ idea, progress, canWrite, today }: { idea: SprintIdea; progress: IdeaProgress; canWrite: boolean; today: string }) {
  const s = compute(idea, progress, today);
  if (!s.planned) {
    if (!canWrite && !idea.decision_deadline) return null;
    return (
      <div className="sprint-strip no-print">
        <span className="tiny sprint-kicker">Sprint</span>
        <span className="tiny">Nog niet gepland</span>
        <Deadline date={idea.decision_deadline} today={today} />
        {canWrite && (
          <details className="sprint-plan">
            <summary className="text-link">Plan de sprint</summary>
            <div className="sprint-pop">
              <SprintPlanForm action={setSprint.bind(null, idea.id)} today={today} compact />
            </div>
          </details>
        )}
      </div>
    );
  }
  const current = s.state === "running" ? SPRINT_PHASES[s.phase].label : s.state === "finished" ? "Afgerond" : "Nog niet gestart";
  return (
    <div className="sprint-strip no-print" role="group" aria-label="Sprintplanning">
      <span className="tiny sprint-kicker">Sprint</span>
      <span className="pill blue num">{weekLabel(s)}</span>
      <span className="sprint-phase">{current}</span>
      <span className="sprint-mini" aria-hidden="true">
        {Array.from({ length: s.weeks }, (_, i) => (
          <i key={i} className={s.state === "finished" || (s.state === "running" && i + 1 < s.week) ? "past" : s.state === "running" && i + 1 === s.week ? "now" : ""} />
        ))}
      </span>
      {s.behind && <span className="pill coral" title={s.behindReason ?? undefined}>Loopt achter</span>}
      <Deadline date={idea.decision_deadline} today={today} />
      {s.behindReason && <span className="tiny sprint-reason">{s.behindReason}</span>}
      {canWrite && (
        <details className="sprint-plan">
          <summary className="text-link">Wijzig</summary>
          <div className="sprint-pop">
            <SprintPlanForm action={setSprint.bind(null, idea.id)} today={today} weeks={s.weeks} start={s.startDate} compact />
          </div>
        </details>
      )}
    </div>
  );
}
