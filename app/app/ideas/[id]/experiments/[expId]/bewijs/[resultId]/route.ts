import { NextResponse } from "next/server";
import { getUser } from "@/lib/data";
import { supabaseServer } from "@/lib/supabase/server";
import { EVIDENCE_BUCKET } from "@/lib/domain/manual-results";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Experimentencatalogus: het bewijsbestand bij een handmatig ingevoerd resultaat bekijken. Alleen het onderzoeksteam
// (storage-policy can_write_idea); een kort geldige link van 60 seconden.
export async function GET(_: Request, ctx: RouteContext<"/app/ideas/[id]/experiments/[expId]/bewijs/[resultId]">) {
  const { id, expId, resultId } = await ctx.params;
  if (!(await getUser())) return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });
  if (!UUID.test(id) || !UUID.test(expId) || !UUID.test(resultId)) return NextResponse.json({ error: "Ongeldig" }, { status: 400 });
  const supabase = await supabaseServer();
  const { data: r } = await supabase.from("manual_results").select("evidence_path").eq("id", resultId).eq("experiment_id", expId).eq("idea_id", id).maybeSingle();
  if (!r?.evidence_path) return NextResponse.json({ error: "Niet gevonden" }, { status: 404 });
  const name = r.evidence_path.split("/").pop()?.replace(/^[0-9a-f-]{36}-/, "") ?? "bewijs";
  const { data, error } = await supabase.storage.from(EVIDENCE_BUCKET).createSignedUrl(r.evidence_path, 60, { download: name });
  if (error || !data?.signedUrl) return NextResponse.json({ error: "Het bestand kan nu niet worden opgehaald (alleen het onderzoeksteam kan bewijsbestanden openen)." }, { status: 502 });
  return NextResponse.redirect(data.signedUrl, { status: 303, headers: { "cache-control": "no-store" } });
}
