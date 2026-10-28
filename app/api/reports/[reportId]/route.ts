import { NextResponse } from "next/server";
import { getUser } from "@/lib/data";
import { supabaseServer } from "@/lib/supabase/server";

// Audit export of one immutable report snapshot as JSON (access via row level security).
export async function GET(_: Request, ctx: RouteContext<"/api/reports/[reportId]">) {
  const { reportId } = await ctx.params;
  if (!(await getUser())) return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });
  if (!/^[0-9a-f-]{36}$/.test(reportId)) return NextResponse.json({ error: "Ongeldig" }, { status: 400 });
  const supabase = await supabaseServer();
  const { data } = await supabase.from("reports").select("version, snapshot, created_at, ideas(title)").eq("id", reportId).maybeSingle();
  if (!data) return NextResponse.json({ error: "Niet gevonden" }, { status: 404 });
  const name = `prooflab-${(data.ideas?.title ?? "rapport").toLowerCase().replace(/[^a-z0-9]+/g, "-")}-v${data.version}.json`;
  return new NextResponse(JSON.stringify(data.snapshot, null, 2), {
    headers: { "content-type": "application/json; charset=utf-8", "content-disposition": `attachment; filename="${name}"` },
  });
}
