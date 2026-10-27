import { NextResponse } from "next/server";
import { getUser } from "@/lib/data";
import { supabaseServer } from "@/lib/supabase/server";
import { advanceRun } from "@/lib/research-runner";

export const maxDuration = 300;

// Advances a research run by one task. Authorization: the run must be visible to the user and
// the user must be able to write the idea (both enforced by RLS on the queries below).
export async function POST(_: Request, ctx: RouteContext<"/api/research/[runId]/advance">) {
  const { runId } = await ctx.params;
  if (!(await getUser())) return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });
  if (!/^[0-9a-f-]{36}$/.test(runId)) return NextResponse.json({ error: "Ongeldig" }, { status: 400 });
  const supabase = await supabaseServer();
  const { data: run } = await supabase.from("research_runs").select("idea_id").eq("id", runId).maybeSingle();
  if (!run) return NextResponse.json({ error: "Niet gevonden" }, { status: 404 });
  const { data: canWrite } = await supabase.rpc("can_write_idea", { p_idea: run.idea_id });
  if (!canWrite) return NextResponse.json({ error: "Geen toegang" }, { status: 403 });
  try {
    return NextResponse.json(await advanceRun(runId));
  } catch {
    return NextResponse.json({ error: "De onderzoeksstap kon niet worden uitgevoerd." }, { status: 500 });
  }
}
