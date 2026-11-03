// Resend webhooks (bounces and spam complaints). Resend signs deliveries the Svix way:
//   headers svix-id, svix-timestamp (unix seconds) and svix-signature ("v1,<base64> v1,<base64> ...");
//   signature = base64(HMAC-SHA256(base64decode(secret without "whsec_"), `${id}.${timestamp}.${rawBody}`)).
// Event names (resend.com/docs/dashboard/webhooks/event-types, checked 3 November 2026): email.sent,
// email.delivered, email.delivery_delayed, email.bounced (data.bounce.type "Permanent" = hard bounce),
// email.complained, email.opened, email.clicked, email.failed, email.scheduled, email.suppressed, email.received.
// The id of the mail is data.email_id: the id the send call returned.

import { createHmac, timingSafeEqual } from "node:crypto";

export const SIGNATURE_TOLERANCE_SEC = 5 * 60;
export const MAX_WEBHOOK_BYTES = 256 * 1024;

export type SignatureCheck = { ok: true } | { ok: false; reason: "missing_secret" | "missing_headers" | "bad_timestamp" | "too_old" | "bad_signature" };

function secretBytes(secret: string): Buffer | null {
  const raw = secret.trim().replace(/^whsec_/, "");
  if (!raw || !/^[A-Za-z0-9+/=]+$/.test(raw)) return null;
  const buf = Buffer.from(raw, "base64");
  return buf.length ? buf : null;
}

export function signPayload(secret: string, id: string, timestamp: string, body: string): string {
  const key = secretBytes(secret);
  if (!key) throw new Error("Ongeldig webhookgeheim.");
  return createHmac("sha256", key).update(`${id}.${timestamp}.${body}`).digest("base64");
}

// Constant-time check of every "v1,<sig>" in the header; the timestamp may differ at most five minutes from now
// (both directions), so a captured delivery cannot be replayed later.
export function verifyResendSignature(input: {
  secret: string;
  id: string | null;
  timestamp: string | null;
  signature: string | null;
  body: string;
  now?: Date;
}): SignatureCheck {
  const key = secretBytes(input.secret);
  if (!key) return { ok: false, reason: "missing_secret" };
  if (!input.id || !input.timestamp || !input.signature) return { ok: false, reason: "missing_headers" };
  if (!/^\d{1,12}$/.test(input.timestamp)) return { ok: false, reason: "bad_timestamp" };
  const now = Math.floor((input.now ?? new Date()).getTime() / 1000);
  if (Math.abs(now - Number(input.timestamp)) > SIGNATURE_TOLERANCE_SEC) return { ok: false, reason: "too_old" };
  const expected = createHmac("sha256", key).update(`${input.id}.${input.timestamp}.${input.body}`).digest();
  for (const part of input.signature.split(" ")) {
    const [version, sig] = part.split(",", 2);
    if (version !== "v1" || !sig) continue;
    const given = Buffer.from(sig, "base64");
    if (given.length === expected.length && timingSafeEqual(given, expected)) return { ok: true };
  }
  return { ok: false, reason: "bad_signature" };
}

export const HANDLED_EVENTS = ["email.bounced", "email.complained", "email.delivered", "email.delivery_delayed"] as const;
export type HandledEvent = (typeof HANDLED_EVENTS)[number];

export type ResendEvent = {
  type: string;
  emailId: string | null;
  // Bounces only: "Permanent" (hard), "Transient" (soft) or "Undetermined"; subType e.g. "General", "NoEmail".
  bounceType: string | null;
  bounceSubType: string | null;
};

const text = (v: unknown, max: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);

export function parseResendEvent(json: unknown): ResendEvent | null {
  if (!json || typeof json !== "object" || Array.isArray(json)) return null;
  const o = json as { type?: unknown; data?: unknown };
  const type = text(o.type, 60);
  if (!type) return null;
  const data = (o.data && typeof o.data === "object" ? o.data : {}) as { email_id?: unknown; bounce?: unknown };
  const bounce = (data.bounce && typeof data.bounce === "object" ? data.bounce : {}) as { type?: unknown; subType?: unknown };
  return { type, emailId: text(data.email_id, 100), bounceType: text(bounce.type, 40), bounceSubType: text(bounce.subType, 40) };
}

// Only a permanent bounce or a complaint ends mailing to an address; soft bounces and delays are left alone.
export function isHardFailure(e: ResendEvent): boolean {
  return e.type === "email.complained" || (e.type === "email.bounced" && e.bounceType === "Permanent");
}
