import { Coach } from "./Coach";
import { Topbar } from "./Topbar";
import { SprintStrip } from "@/components/sprint/SprintCard";
import { coachFor, type CoachPage } from "@/lib/domain/coach";
import { todayInNL } from "@/lib/domain/sprint";
import { getIdea, getWorkspace } from "@/lib/data";
import { loadProgress } from "@/lib/progress";
import { aiConfigured } from "@/lib/env";
import { supabaseServer } from "@/lib/supabase/server";

const IDEA_PAGES: CoachPage[] = ["research", "assumptions", "experiments", "evidence", "report"];

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
  const supabase = await supabaseServer();
  const [progress, access, profile] = await Promise.all([
    ideaId ? loadProgress(ideaId) : Promise.resolve(null),
    ideaId ? getIdea(ideaId) : Promise.resolve(null),
    supabase.from("profiles").select("full_name").eq("user_id", ws.user.id).maybeSingle(),
  ]);
  const name = profile.data?.full_name?.trim() || null;
  const initials = (name ? name.split(/\s+/).map((w) => w[0]).join("").slice(0, 2) : ws.user.email.slice(0, 2)).toUpperCase();
  const audience = access ? (access.canWrite ? "consultant" : "client") : ws.org ? "consultant" : "client";
  return (
    <>
      <main className="main" id="main" tabIndex={-1}>
        <Topbar crumbs={crumbs} initials={initials} email={ws.user.email} name={name} badge={badge} />
        <div className="workspace">
          {access && progress && IDEA_PAGES.includes(coach) && <SprintStrip idea={access.idea} progress={progress} canWrite={access.canWrite} today={todayInNL()} />}
          <section className="screen active">{children}</section>
        </div>
      </main>
      <Coach data={coachFor(coach, progress, { audience, isClientDecider: access?.isClientDecider })} aiConnected={aiConfigured()} />
    </>
  );
}
