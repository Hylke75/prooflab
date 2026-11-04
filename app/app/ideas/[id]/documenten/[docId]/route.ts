import { NextResponse } from "next/server";
import { getUser } from "@/lib/data";
import { supabaseServer } from "@/lib/supabase/server";
import { BUCKET, DOWNLOAD_TTL_SECONDS } from "@/lib/domain/step-files";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Een document uit "Notities en documenten" downloaden: wie het dossier mag lezen (ook de opdrachtgever) krijgt een
// doorverwijzing naar een kort geldige link (60 seconden) die het bestand als bijlage met de oorspronkelijke naam
// aanbiedt. Rij en bestand worden met de sessie van de gebruiker gelezen, dus RLS en de storage-policy gelden.
export async function GET(_: Request, ctx: RouteContext<"/app/ideas/[id]/documenten/[docId]">) {
  const { id, docId } = await ctx.params;
  if (!(await getUser())) return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });
  if (!UUID.test(id) || !UUID.test(docId)) return NextResponse.json({ error: "Ongeldig" }, { status: 400 });
  const supabase = await supabaseServer();
  const { data: doc } = await supabase.from("step_documents").select("storage_path, file_name").eq("id", docId).eq("idea_id", id).maybeSingle();
  if (!doc) return NextResponse.json({ error: "Niet gevonden" }, { status: 404 });
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(doc.storage_path, DOWNLOAD_TTL_SECONDS, { download: doc.file_name });
  if (error || !data?.signedUrl) return NextResponse.json({ error: "Het document kan nu niet worden opgehaald." }, { status: 502 });
  return NextResponse.redirect(data.signedUrl, { status: 303, headers: { "cache-control": "no-store" } });
}
