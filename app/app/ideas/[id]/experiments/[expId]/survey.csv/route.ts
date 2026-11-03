import { NextResponse } from "next/server";
import { getIdea, getUser } from "@/lib/data";
import { supabaseServer } from "@/lib/supabase/server";
import { loadSurveyResponses, surveyConfigOf } from "@/lib/experiment-metrics";
import { csvFilename, surveyCsv } from "@/lib/domain/survey-results";

const UUID = /^[0-9a-f-]{36}$/i;

// CSV export of the survey responses for the research team only: one column per question plus source, channel
// and date. No e-mail addresses (responses never store them; contact details typed in open answers are removed).
export async function GET(_: Request, ctx: RouteContext<"/app/ideas/[id]/experiments/[expId]/survey.csv">) {
  const { id, expId } = await ctx.params;
  if (!(await getUser())) return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });
  if (!UUID.test(id) || !UUID.test(expId)) return NextResponse.json({ error: "Ongeldig" }, { status: 400 });
  const { canWrite } = await getIdea(id);
  if (!canWrite) return NextResponse.json({ error: "Alleen het onderzoeksteam kan antwoorden exporteren." }, { status: 403 });
  const supabase = await supabaseServer();
  const { data: exp } = await supabase.from("experiments").select("type, title, config").eq("id", expId).eq("idea_id", id).maybeSingle();
  const config = exp?.type === "survey" ? surveyConfigOf(exp.config) : null;
  if (!exp || !config) return NextResponse.json({ error: "Niet gevonden" }, { status: 404 });
  const { rows, error } = await loadSurveyResponses(expId);
  if (error) return NextResponse.json({ error: "De antwoorden konden niet worden opgehaald." }, { status: 500 });
  return new NextResponse(surveyCsv(config, rows), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${csvFilename(exp.title, new Date().toISOString().slice(0, 10))}"`,
      "cache-control": "no-store",
    },
  });
}
