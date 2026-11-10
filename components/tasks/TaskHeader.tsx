import Link from "next/link";
import type { ReactNode } from "react";
import { Icon } from "@/components/Icon";
import { TASK_STATUS_LABELS, taskPosition, type Task, type TaskKey, type TaskList } from "@/lib/domain/tasks";
import "./tasks.css";

// Kop van elk taakscherm: "Fase · taak x van y", de titel, één zin waarom, de taken van deze fase als stappen en het
// vaste blok Wat jij doet / Wat AI kan. Zo weet je op elk scherm waar je bent en wie wat doet.
export function TaskHeader({
  ideaId,
  list,
  taskKey,
  title,
  why,
  aiConnected,
  aside,
  steps = true,
}: {
  ideaId: string;
  list: TaskList;
  taskKey: TaskKey;
  title: string;
  why: string;
  aiConnected: boolean;
  // Klein element rechts van de titel, bijvoorbeeld een link naar naslag.
  aside?: ReactNode;
  // false: de pagina heeft zelf al tabbladen die de taken zijn (Markt); dan geen tweede rij stappen.
  steps?: boolean;
}) {
  const pos = taskPosition(list, taskKey);
  if (!pos) return null;
  const base = `/app/ideas/${ideaId}`;
  return (
    <header className="task-head">
      <div className="task-title-row">
        <div>
          <div className="eyebrow">
            {pos.phase.label} · taak {pos.index} van {pos.total} · <span title="Geschatte tijd">{pos.task.time}</span>
          </div>
          <h1>{title}</h1>
          <p className="sub">{why}</p>
        </div>
        {aside}
      </div>
      {steps && <TaskSteps base={base} tasks={pos.phase.tasks} current={taskKey} label={`Taken van ${pos.phase.label}`} />}
      <RoleBlock task={pos.task} aiConnected={aiConnected} />
    </header>
  );
}

export function TaskSteps({ base, tasks, current, label }: { base: string; tasks: Task[]; current: TaskKey; label: string }) {
  return (
    <ol className="task-steps no-print" aria-label={label}>
      {tasks.map((t, i) => {
        const here = t.key === current;
        const cls = here ? undefined : t.status === "done" ? "done" : t.status === "locked" ? "locked" : undefined;
        return (
          <li key={t.key}>
            <Link href={`${base}${t.path}`} prefetch={false} className={cls} aria-current={here ? "step" : undefined} title={t.why}>
              <span className="task-no" aria-hidden="true">{t.status === "done" && !here ? <Icon name="check" size="sm" /> : i + 1}</span>
              <span className="task-label">{t.label}</span>
              <span className="sr-only">, {here ? "je bent hier" : TASK_STATUS_LABELS[t.status].toLowerCase()}</span>
            </Link>
          </li>
        );
      })}
    </ol>
  );
}

// Vast blok op elk taakscherm. Zonder AI-koppeling blijft zichtbaar wat AI zou kunnen, met het handmatige alternatief.
export function RoleBlock({ task, aiConnected }: { task: Pick<Task, "me" | "ai">; aiConnected: boolean }) {
  return (
    <div className="role-block" role="note" aria-label="Wie doet wat">
      <div className="role-me">
        <strong>Wat jij doet</strong>
        {task.me}
      </div>
      <div className={`role-ai${task.ai && aiConnected ? "" : " off"}`}>
        <strong>Wat AI kan</strong>
        {!task.ai ? "Hier doet AI niets: dit is jouw werk." : aiConnected ? task.ai : `${task.ai} AI is nog niet gekoppeld; je kunt alles ook zelf invullen.`}
      </div>
    </div>
  );
}

// Onderaan een taakscherm: terug naar Wat nu? en door naar de volgende taak.
export function TaskFooter({ ideaId, next, nextLabel }: { ideaId: string; next: Task | null; nextLabel?: string }) {
  const base = `/app/ideas/${ideaId}`;
  return (
    <div className="task-footer no-print">
      <Link className="btn white" href={base} prefetch={false}>
        ← Wat nu?
      </Link>
      {next && (
        <Link className={`btn ${next.status === "locked" ? "white" : "primary"}`} href={`${base}${next.path}`} prefetch={false}>
          {nextLabel ?? `Verder: ${next.label}`} <Icon name="arrow" size="sm" />
        </Link>
      )}
    </div>
  );
}

// De drie vaste labels voor herkomst. Alleen "Gemeten bewijs" telt als bewijs.
export type ProofKind = "ai" | "rules" | "template" | "confirmed" | "measured";
const PROOF: Record<ProofKind, { label: string; pill: string }> = {
  ai: { label: "AI-voorstel", pill: "blue" },
  rules: { label: "Berekend voorstel", pill: "gray" },
  template: { label: "Voorstel uit de standaardset", pill: "gray" },
  confirmed: { label: "Door jou bevestigd", pill: "orange" },
  measured: { label: "Gemeten bewijs", pill: "green" },
};
export function ProofLabel({ kind }: { kind: ProofKind }) {
  return <span className={`pill ${PROOF[kind].pill} proof-label`}>{PROOF[kind].label}</span>;
}
