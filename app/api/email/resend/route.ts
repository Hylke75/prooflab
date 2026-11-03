import { NextResponse } from "next/server";
import { supabaseAnon } from "@/lib/supabase/server";
import { env } from "@/lib/env";
import { HANDLED_EVENTS, MAX_WEBHOOK_BYTES, isHardFailure, parseResendEvent, verifyResendSignature } from "@/lib/integrations/resend";

// Resend webhook: hard bounces and spam complaints of survey invitations. Configure in Resend → Webhooks with the
// URL <app>/api/email/resend and the events email.bounced and email.complained (email.delivered and
// email.delivery_delayed are accepted and ignored). The signing secret goes in RESEND_WEBHOOK_SECRET.
// Responses: 401 bad signature (Resend retries; a forged call never gets further), 503 not configured,
// 500 database error (Resend retries), otherwise 200. Each svix-id is processed once.
export async function POST(request: Request) {
  if (!env.resendWebhookSecret) return NextResponse.json({ ok: false, reason: "not_configured" }, { status: 503 });
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > MAX_WEBHOOK_BYTES) return NextResponse.json({ ok: false }, { status: 413 });
  const body = await readCapped(request, MAX_WEBHOOK_BYTES);
  if (body === null) return NextResponse.json({ ok: false }, { status: 413 });

  const id = request.headers.get("svix-id");
  const check = verifyResendSignature({
    secret: env.resendWebhookSecret,
    id,
    timestamp: request.headers.get("svix-timestamp"),
    signature: request.headers.get("svix-signature"),
    body,
  });
  if (!check.ok) return NextResponse.json({ ok: false, reason: check.reason }, { status: check.reason === "missing_secret" ? 503 : 401 });

  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    return NextResponse.json({ ok: false, reason: "invalid_json" }, { status: 400 });
  }
  const event = parseResendEvent(json);
  if (!event) return NextResponse.json({ ok: false, reason: "invalid_event" }, { status: 400 });
  // Delivered, delayed, soft bounces and other event types change nothing in ProofLab.
  if (!(HANDLED_EVENTS as readonly string[]).includes(event.type) || !isHardFailure(event)) {
    return NextResponse.json({ ok: true, result: "ignored" });
  }
  if (!env.ingestSecret) return NextResponse.json({ ok: false, reason: "not_configured" }, { status: 503 });

  const { data, error } = await supabaseAnon().rpc("record_email_event", {
    p_key: env.ingestSecret,
    p_webhook_id: id!.slice(0, 100),
    p_event: event.type,
    p_message_id: event.emailId,
    p_permanent: event.bounceType === "Permanent",
    p_subtype: event.bounceSubType,
  });
  if (error) {
    console.error("resend webhook: event not recorded", error.message);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
  return NextResponse.json({ ok: true, result: String(data) });
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
