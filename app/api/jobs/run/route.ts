import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { runWorker, workerConfigured } from "@/lib/jobs/worker";

// Runs queued background jobs for up to ~50 s. Called by Vercel Cron (vercel.json, every minute; Vercel sends
// "Authorization: Bearer $CRON_SECRET") or by any external scheduler with the same header.
export const maxDuration = 60;
export const dynamic = "force-dynamic";

function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET ?? "";
  if (secret.length < 16) return false;
  const got = Buffer.from(req.headers.get("authorization") ?? "");
  const want = Buffer.from(`Bearer ${secret}`);
  return got.length === want.length && timingSafeEqual(got, want);
}

async function handle(req: Request) {
  if (!process.env.CRON_SECRET) return NextResponse.json({ error: "CRON_SECRET is niet ingesteld." }, { status: 503 });
  if (!authorized(req)) return NextResponse.json({ error: "Geen toegang" }, { status: 401 });
  if (!workerConfigured()) return NextResponse.json({ error: "INGEST_SECRET/TRACKING_SALT of Supabase ontbreekt." }, { status: 503 });
  try {
    return NextResponse.json({ ok: true, ...(await runWorker()) });
  } catch (e) {
    console.error("job worker failed", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "De taken konden niet worden verwerkt." }, { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;
