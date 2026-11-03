import { NextResponse } from "next/server";
import { supabaseAnon } from "@/lib/supabase/server";
import { env, trackingConfigured } from "@/lib/env";
import { log } from "@/lib/log";
import { contactHash, dedupeKey, parseExpandiPayload, TOKEN_PATTERN, tokenHash } from "@/lib/integrations/expandi";

const MAX_BYTES = 64 * 1024;
const MAX_EVENTS_PER_REQUEST = 25;

// Webhook for Expandi (LinkedIn outreach). Server-to-server, so there is no same-origin check; the random
// token in the URL identifies the dossier and the database checks the ingest secret and a rate limit per
// endpoint. Unknown or inactive token → 404 (stop at once); rate limit reached → 429 so Expandi retries
// later instead of losing events; everything else → 200 with { ok, counted }.
export async function POST(request: Request, ctx: RouteContext<"/api/integrations/expandi/[token]">) {
  const { token } = await ctx.params;
  if (!TOKEN_PATTERN.test(token)) return reject("malformed_token", 404);

  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > MAX_BYTES) return reject("too_large", 413, { reason: "too_large" });
  const raw = await readCapped(request, MAX_BYTES);
  if (raw === null) return reject("too_large", 413, { reason: "too_large" });

  if (!trackingConfigured()) return reject("not_configured", 200, { reason: "not_configured" });
  const type = (request.headers.get("content-type") ?? "").toLowerCase();
  if (type && !type.includes("json")) return reject("json_only", 200, { reason: "json_only" });
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return reject("invalid_json", 200, { reason: "invalid_json" });
  }

  // Some senders batch events in an array (or under "events" / "data").
  const box = json as { events?: unknown; data?: unknown } | null;
  const items: unknown[] = Array.isArray(json)
    ? json
    : Array.isArray(box?.events)
      ? box.events
      : Array.isArray(box?.data)
        ? box.data
        : [json];

  const supabase = supabaseAnon();
  const hash = tokenHash(token);
  let counted = 0;
  for (const item of items.slice(0, MAX_EVENTS_PER_REQUEST)) {
    const itemRaw = items.length === 1 ? raw : JSON.stringify(item);
    const p = parseExpandiPayload(item);
    const key = dedupeKey(p, itemRaw);
    const { data, error } = await supabase.rpc("record_outreach_event", {
      p_key: env.ingestSecret,
      p_token_hash: hash,
      p_event: p.event,
      p_contact_hash: contactHash(env.trackingSalt, p.identity, key),
      p_campaign: p.campaign,
      p_message: p.message,
      p_dedupe: key,
    });
    if (error) {
      await log.error("webhook_rejected", { source: "expandi", reason: "rpc_error", code: error.code, counted });
      return NextResponse.json({ ok: false });
    }
    if (data === "unknown") return reject("unknown_token", 404);
    if (data === "rate") return reject("rate_limited", 429, { reason: "rate_limited", counted }, { "retry-after": "60" });
    if (data === "ok") counted++;
  }
  return NextResponse.json({ ok: true, counted });
}

// Every rejection is logged with its reason and status only: never the token, the payload or the contact.
async function reject(reason: string, status: number, body: Record<string, unknown> = {}, headers?: Record<string, string>) {
  await log.warn("webhook_rejected", { source: "expandi", reason, status });
  return NextResponse.json({ ok: false, ...body }, { status, headers });
}

async function readCapped(request: Request, max: number): Promise<string | null> {
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}
