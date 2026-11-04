import { after, NextResponse } from "next/server";
import { supabaseServer, supabaseWithToken } from "@/lib/supabase/server";
import { originFrom, workOnRun } from "@/lib/research-worker";
import { tokenSecondsLeft } from "@/lib/research-worker-plan";
import { log } from "@/lib/log";

// Een portie werk duurt na de response hooguit ongeveer vijf minuten (zie lib/research-worker-plan.ts).
export const maxDuration = 300;
export const dynamic = "force-dynamic";

// Fase B2, punt 4: zet de onderzoeksrun op de server voort. Aangeroepen door de browser (cookie-sessie: hervatten
// als de keten stilstond) en door de server zelf (Bearer-token van de consultant: de volgende portie). Antwoordt
// direct met 202; het werk gebeurt na de response, dus het tabblad mag dicht. Autorisatie: het token moet bij een
// ingelogde gebruiker horen die de run ziet en het dossier mag bewerken (RLS en can_write_idea).
export async function POST(req: Request, ctx: RouteContext<"/api/research/[runId]/advance">) {
  const { runId } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/.test(runId)) return NextResponse.json({ error: "Ongeldig" }, { status: 400 });
  const bearer = req.headers.get("authorization")?.match(/^Bearer\s+(\S+)$/i)?.[1] ?? null;
  let token: string | null = null;
  let client: Awaited<ReturnType<typeof supabaseServer>>;
  if (bearer) {
    client = supabaseWithToken(bearer);
    const { data } = await client.auth.getUser(bearer);
    if (!data.user) return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });
    token = bearer;
  } else {
    client = await supabaseServer();
    const { data } = await client.auth.getUser();
    if (!data.user) return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });
    token = (await client.auth.getSession()).data.session?.access_token ?? null;
  }
  if (!token) return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });
  const { data: run } = await client.from("research_runs").select("idea_id, status").eq("id", runId).maybeSingle();
  if (!run) return NextResponse.json({ error: "Niet gevonden" }, { status: 404 });
  const { data: canWrite } = await client.rpc("can_write_idea", { p_idea: run.idea_id });
  if (!canWrite) return NextResponse.json({ error: "Geen toegang" }, { status: 403 });
  if (run.status !== "queued" && run.status !== "running") return NextResponse.json({ status: run.status }, { status: 200 });

  const hops = Math.max(0, Number(req.headers.get("x-prooflab-hop") ?? 0) || 0);
  const origin = originFrom(new URL(req.url).origin);
  const work = token;
  after(async () => {
    try {
      await workOnRun(runId, work, origin, hops);
    } catch (e) {
      await log.error("research_advance_failed", { runId, hops }, e);
    }
  });
  return NextResponse.json({ status: run.status, accepted: true, tokenSeconds: tokenSecondsLeft(token) }, { status: 202 });
}
