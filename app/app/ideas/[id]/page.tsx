import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { PageFrame } from "@/components/shell/PageFrame";
import { Icon } from "@/components/Icon";
import { getIdea } from "@/lib/data";
import { loadProgress } from "@/lib/progress";
import { loadOpenNotes } from "@/lib/coach/review";
import { NOTE_KINDS, NOTES_SHOWN, byNotePriority, type NoteKind } from "@/lib/coach/rules";
import { IDEA_OVERVIEW } from "@/lib/steps";
import { ideaTasks, TASK_STATUS_LABELS, type TaskStatus } from "@/lib/domain/tasks";
import { loadDeadlineRisks } from "@/lib/recruitment-data";
import "@/components/tasks/tasks.css";

export const metadata: Metadata = { title: IDEA_OVERVIEW.label };

const PILL: Record<TaskStatus, string> = { done: "green", busy: "orange", todo: "blue", locked: "locked" };

// Wat nu? (voorstel "ProofLab eenvoudiger"): de startpagina van een idee is één takenlijst over vijf fasen, met één
// knop naar de volgende taak. Dit is de enige voortgang in de app; sidebar en taakkoppen lezen dezelfde lijst
// (lib/domain/tasks.ts). Opdrachtgevers gaan zoals voorheen direct naar het rapport.
export default async function IdeaOverview({ params }: PageProps<"/app/ideas/[id]">) {
  const { id } = await params;
  const { idea, canWrite } = await getIdea(id);
  if (!canWrite) redirect(`/app/ideas/${id}/report`);
  const progress = await loadProgress(id);
  const list = ideaTasks(progress);
  const [notes, risks] = await Promise.all([
    loadOpenNotes(id, "consultant"),
    progress.experimentsLive > 0 ? loadDeadlineRisks(id, idea.decision_deadline) : Promise.resolve([]),
  ]);
  const base = `/app/ideas/${id}`;
  const current = list.phases.find((p) => p.key === list.current);
  const next = list.next;

  return (
    <PageFrame crumbs={["Werkruimte", idea.title, IDEA_OVERVIEW.label]} coach="overview" ideaId={id} section="">
      <div className="task-page">
        <div className="eyebrow">{IDEA_OVERVIEW.label}</div>
        <h1>{idea.title}</h1>
        {idea.decision_question && <p className="sub">{idea.decision_question}</p>}

        <section className="now-card mt-24" aria-labelledby="volgende-taak">
          <div className="eyebrow">{current ? `Je bent in fase ${current.number} van 5: ${current.label}` : "Alle fasen zijn klaar"}</div>
          {next ? (
            <>
              <h2 className="as-h3" id="volgende-taak">Volgende taak: {next.label}</h2>
              <p>{next.why}</p>
              <Link className="btn primary" href={`${base}${next.path}`} prefetch={false}>
                {next.key === "forecast" ? "Geef je voorspelling" : "Ga naar de volgende taak"} <Icon name="arrow" size="sm" />
              </Link>
            </>
          ) : (
            <>
              <h2 className="as-h3" id="volgende-taak">Er staat niets meer open</h2>
              <p>Het besluit is genomen en het rapport is gedeeld. Je kunt alles hieronder nog nalezen.</p>
            </>
          )}
        </section>

        {risks.length > 0 && (
          <p className="note" role="status" id="werving-in-gevaar">
            <strong>Werving:</strong> &ldquo;{risks[0].title}&rdquo;: {risks[0].text}{" "}
            <Link className="text-link" href={`${base}/experiments/${risks[0].id}#werving`} prefetch={false}>Naar de test →</Link>
            {risks.length > 1 && <> (en {risks.length - 1} {risks.length === 2 ? "andere test" : "andere tests"})</>}
          </p>
        )}

        <h2 className="as-h3 mt-24">Alle taken</h2>
        <ol className="phase-list" aria-label="Fasen en taken van dit idee">
          {list.phases.map((ph) => {
            const isCurrent = ph.key === list.current;
            return (
              <li key={ph.key} className={`phase-item${isCurrent ? " current" : ""}${ph.status === "done" ? " done" : ""}`} aria-current={isCurrent ? "step" : undefined}>
                <details open={isCurrent}>
                  <summary>
                    <span className="phase-no" aria-hidden="true">{ph.status === "done" ? <Icon name="check" size="sm" /> : ph.number}</span>
                    <h2>{ph.label}</h2>
                    <span className={`pill ${PILL[ph.status]}`}>{isCurrent && ph.status !== "done" ? `Nu · ${TASK_STATUS_LABELS[ph.status]}` : TASK_STATUS_LABELS[ph.status]}</span>
                  </summary>
                  <ul className="phase-tasks">
                    {ph.tasks.map((t) => (
                      <li key={t.key} className={`phase-task${next?.key === t.key ? " next" : ""}`}>
                        <div>
                          <Link href={`${base}${t.path}`} prefetch={false}>{t.label}</Link>
                          {t.optional && <span className="tiny" style={{ display: "inline", marginLeft: 6 }}>(aanbevolen)</span>}
                          <span className="tiny">{t.why}</span>
                        </div>
                        <span className={`pill ${PILL[t.status]}`}>{TASK_STATUS_LABELS[t.status]}</span>
                      </li>
                    ))}
                  </ul>
                </details>
              </li>
            );
          })}
        </ol>

        {notes.length > 0 && (
          <section className="card mt-24" aria-labelledby="tips">
            <div className="section-title">
              <h2 className="as-h3" id="tips">Tips</h2>
              <span className="pill gray">{notes.length} open</span>
            </div>
            {byNotePriority(notes)
              .slice(0, NOTES_SHOWN)
              .map((n) => {
                const k = NOTE_KINDS[(n.kind as NoteKind) in NOTE_KINDS ? (n.kind as NoteKind) : "tip"];
                return (
                  <div className="quickline" key={n.id}>
                    <span className="num" aria-hidden="true"><Icon name={k.icon} size="sm" /></span>
                    <div>
                      <strong>{n.title}</strong>
                      <span>{k.label}{n.source === "ai" ? " · AI-voorstel" : " · vaste regel"}</span>
                    </div>
                    {n.href && <Link className="text-link" href={n.href} prefetch={false} aria-label={`Bekijken: ${n.title}`}>Bekijken →</Link>}
                  </div>
                );
              })}
          </section>
        )}

        <p className="tiny mt-24">
          <Link className="text-link" href={`${base}/evidence?stap=bewijs`} prefetch={false}>Alle bewijs op een rij</Link> ·{" "}
          <Link className="text-link" href={`${base}/outcome`} prefetch={false}>Voorspelling en uitkomst</Link> ·{" "}
          <Link className="text-link" href={`${base}/method`} prefetch={false}>Methode</Link>
        </p>
      </div>
    </PageFrame>
  );
}
