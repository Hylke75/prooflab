import { NextResponse } from "next/server";
import { getUser } from "@/lib/data";
import { supabaseServer } from "@/lib/supabase/server";
import { COMMITMENT_BUCKET } from "@/lib/domain/commitments";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Fase 2 · punt 4: een getekende intentieverklaring bekijken. Alleen het onderzoeksteam (RLS en storage-policy:
// can_write_idea); een kort geldige link van 60 seconden. Na de bewaartermijn (namen gewist) niet meer.
export async function GET(_: Request, ctx: RouteContext<"/app/ideas/[id]/toezeggingen/[cId]">) {
  const { id, cId } = await ctx.params;
  if (!(await getUser())) return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });
  if (!UUID.test(id) || !UUID.test(cId)) return NextResponse.json({ error: "Ongeldig" }, { status: 400 });
  const supabase = await supabaseServer();
  const { data: c } = await supabase.from("test_commitments").select("document_path, purged_at").eq("id", cId).eq("idea_id", id).maybeSingle();
  if (!c?.document_path) return NextResponse.json({ error: "Niet gevonden" }, { status: 404 });
  if (c.purged_at) return NextResponse.json({ error: "De bewaartermijn van dit document is verstreken." }, { status: 410 });
  const name = c.document_path.split("/").pop()?.replace(/^[0-9a-f-]{36}-/, "") ?? "toezegging";
  const { data, error } = await supabase.storage.from(COMMITMENT_BUCKET).createSignedUrl(c.document_path, 60, { download: name });
  if (error || !data?.signedUrl) return NextResponse.json({ error: "Het document kan nu niet worden opgehaald." }, { status: 502 });
  return NextResponse.redirect(data.signedUrl, { status: 303, headers: { "cache-control": "no-store" } });
}
