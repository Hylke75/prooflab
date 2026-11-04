import "server-only";
import { randomUUID } from "node:crypto";
import { after } from "next/server";
import { headers } from "next/headers";
import { env } from "@/lib/env";
import { log } from "@/lib/log";
import { supabaseServer, supabaseWithToken, withSupabaseClient } from "@/lib/supabase/server";
import { advanceRun } from "@/lib/research-runner";
import { LEASE_SECONDS, WAIT_MS, isActiveRun, sliceDecision, tokenSecondsLeft, trustedOrigin } from "@/lib/research-worker-plan";

// Fase B2, punt 4: de onderzoeksrun draait op de server en gaat door als het tabblad dicht is.
//
// Architectuur (zie ook docs/OPERATIONS.md §11):
// 1. Starten of hervatten (server action of POST /api/research/[runId]/advance vanuit de browser) plant met
//    after() een vervolgaanroep naar /api/research/[runId]/advance met het toegangstoken van de consultant.
// 2. Die route antwoordt direct (202) en werkt na de response een portie af (workOnRun): lease op de run, stappen
//    uitvoeren tot de portie om is (lib/research-worker-plan.ts), lease vrijgeven, en zichzelf weer aanroepen.
// 3. Elke stap bewaart zijn resultaat voordat de volgende start (lib/research-runner.ts), dus een afgebroken portie
//    verliest niets: de stap wordt na STALE_MS opnieuw opgepakt.
// Geen nieuwe externe dienst, geen service-rol-sleutel: alles loopt onder RLS als de consultant zelf.

const BYPASS = process.env.VERCEL_AUTOMATION_BYPASS_SECRET ?? "";

function knownHosts(): string[] {
  return [env.appUrl, process.env.VERCEL_URL, process.env.VERCEL_BRANCH_URL, process.env.VERCEL_PROJECT_PRODUCTION_URL].filter((h): h is string => !!h);
}

export function originFrom(requestOrigin: string | null): string {
  return trustedOrigin(requestOrigin, knownHosts(), env.appUrl, process.env.NODE_ENV !== "production");
}

// Vraagt de volgende portie aan (de route antwoordt direct; het werk gebeurt daar na de response).
async function hop(origin: string, runId: string, token: string, hops: number): Promise<void> {
  try {
    const res = await fetch(`${origin}/api/research/${runId}/advance`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "x-prooflab-hop": String(hops),
        ...(BYPASS ? { "x-vercel-protection-bypass": BYPASS } : {}),
      },
      cache: "no-store",
    });
    if (!res.ok) await log.warn("research_hop_refused", { runId, status: res.status, hops });
  } catch (e) {
    await log.warn("research_hop_failed", { runId, hops }, e);
  }
}

type Lease = "held" | "busy" | "unsupported";

async function takeLease(client: ReturnType<typeof supabaseWithToken>, runId: string, leaseId: string): Promise<Lease> {
  const { data, error } = await client.rpc("research_run_lease", { p_run: runId, p_lease: leaseId, p_seconds: LEASE_SECONDS });
  // Zonder de B2-migratie bestaat de functie niet: dan beschermt alleen de claim per stap tegen dubbel werk.
  if (error) return "unsupported";
  return data ? "held" : "busy";
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Eén portie: zolang de run loopt, de portie niet om is en het token lang genoeg geldig is, de volgende stap.
export async function workOnRun(runId: string, token: string, origin: string, hops = 0): Promise<void> {
  const client = supabaseWithToken(token);
  await withSupabaseClient(client, async () => {
    const leaseId = randomUUID();
    const lease = await takeLease(client, runId, leaseId);
    if (lease === "busy") return;
    const started = Date.now();
    let status = "running";
    let decision = sliceDecision({ status, elapsedMs: 0, tokenSeconds: tokenSecondsLeft(token), hops });
    try {
      while (decision === "run") {
        const state = await advanceRun(runId).catch(async (e) => {
          await log.error("research_slice_failed", { runId }, e);
          return null;
        });
        // Een onverwachte fout: deze portie stopt; de volgende start bij het openen van de pagina.
        if (!state) return;
        status = state.status;
        // Een stap is nog bezet door een eerder afgebroken portie (hij komt na STALE_MS vrij): even wachten.
        if (isActiveRun(status)) {
          const busy = await client.from("research_tasks").select("id").eq("run_id", runId).eq("status", "running").limit(1);
          if (busy.data?.length) await sleep(WAIT_MS);
        }
        if (lease === "held") await client.rpc("research_run_lease", { p_run: runId, p_lease: leaseId, p_seconds: LEASE_SECONDS });
        decision = sliceDecision({ status, elapsedMs: Date.now() - started, tokenSeconds: tokenSecondsLeft(token), hops });
      }
    } finally {
      if (lease === "held") await client.rpc("research_run_release", { p_run: runId, p_lease: leaseId });
    }
    if (decision === "hop") await hop(origin, runId, token, hops + 1);
    else if (decision === "pause") await log.info("research_run_paused", { runId, hops, tokenSeconds: tokenSecondsLeft(token) });
  });
}

// Plant de eerste portie na de response van het huidige verzoek (server action of route). In een server action
// wordt een bijna verlopen sessie eerst vernieuwd (de nieuwe cookies gaan met de response mee naar de browser),
// zodat de run een vol uur vooruit kan.
export async function kickResearchRun(runId: string, opts: { refresh?: boolean } = {}): Promise<boolean> {
  const supabase = await supabaseServer();
  let {
    data: { session },
  } = await supabase.auth.getSession();
  if (session && opts.refresh && tokenSecondsLeft(session.access_token) < 45 * 60) {
    const refreshed = await supabase.auth.refreshSession();
    if (refreshed.data.session) session = refreshed.data.session;
  }
  if (!session) return false;
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const proto = h.get("x-forwarded-proto") ?? "https";
  const origin = originFrom(host ? `${proto}://${host}` : null);
  const token = session.access_token;
  after(() => hop(origin, runId, token, 0));
  return true;
}
