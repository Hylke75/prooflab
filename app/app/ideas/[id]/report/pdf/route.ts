import { NextResponse } from "next/server";
import { getUser } from "@/lib/data";
import { supabaseServer } from "@/lib/supabase/server";
import type { ReportSnapshot } from "@/lib/report";
import { renderReportPdf } from "@/lib/report-pdf";

// PDF download of one report version (?v=N, default the newest the user may see), rendered on the server from the
// immutable snapshot. Same visibility as the report page: consultants see every version, clients only shared ones
// (row level security on reports; the filter below only picks the right default).
export const maxDuration = 60;

export async function GET(req: Request, ctx: RouteContext<"/app/ideas/[id]/report/pdf">) {
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "Ongeldig" }, { status: 400 });
  if (!(await getUser())) return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });
  const supabase = await supabaseServer();
  const [{ data: canWrite }, { data: versions }] = await Promise.all([
    supabase.rpc("can_write_idea", { p_idea: id }),
    supabase.from("reports").select("id, version, shared_at").eq("idea_id", id).order("version", { ascending: false }),
  ]);
  const visible = (versions ?? []).filter((v) => canWrite || v.shared_at);
  const raw = new URL(req.url).searchParams.get("v");
  const wanted = raw && /^\d{1,6}$/.test(raw) ? Number(raw) : visible[0]?.version;
  const current = visible.find((v) => v.version === wanted);
  if (!current) return NextResponse.json({ error: "Geen rapportversie gevonden." }, { status: 404 });
  const { data: row } = await supabase.from("reports").select("snapshot, ideas(title)").eq("id", current.id).maybeSingle();
  if (!row?.snapshot) return NextResponse.json({ error: "Geen rapportversie gevonden." }, { status: 404 });

  try {
    const pdf = await renderReportPdf(row.snapshot as ReportSnapshot, { shared: !!current.shared_at, version: current.version });
    const slug = (row.ideas?.title ?? "rapport").toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "rapport";
    return new NextResponse(new Uint8Array(pdf), {
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `attachment; filename="prooflab-${slug}-v${current.version}.pdf"`,
        "cache-control": "private, no-store",
      },
    });
  } catch (e) {
    console.error("report pdf failed", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "De PDF kon niet worden gemaakt." }, { status: 500 });
  }
}
