import { Coach } from "./Coach";
import { Topbar } from "./Topbar";
import { coachFor, type CoachPage } from "@/lib/domain/coach";
import { getWorkspace } from "@/lib/data";
import { loadProgress } from "@/lib/progress";
import { aiConfigured } from "@/lib/env";

// Main column + coach column of the three-column grid from the reference design.
export async function PageFrame({
  crumbs,
  coach,
  ideaId,
  badge,
  children,
}: {
  crumbs: string[];
  coach: CoachPage;
  ideaId?: string;
  badge?: string;
  children: React.ReactNode;
}) {
  const ws = await getWorkspace();
  const progress = ideaId ? await loadProgress(ideaId) : null;
  const initials = ws.user.email.slice(0, 2).toUpperCase();
  return (
    <>
      <main className="main" id="main">
        <Topbar crumbs={crumbs} initials={initials} badge={badge} />
        <div className="workspace">
          <section className="screen active">{children}</section>
        </div>
      </main>
      <Coach data={coachFor(coach, progress)} aiConnected={aiConfigured()} />
    </>
  );
}
