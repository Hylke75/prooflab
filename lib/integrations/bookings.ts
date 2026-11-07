// Fase 2 · punt 4: geboekte afspraken uit Calendly en Cal.com. Eén adapter-interface, twee implementaties. Elke test
// krijgt per aanbieder een eigen webhookadres (een willekeurige code in de URL) en een eigen geheime sleutel voor de
// handtekening. De sleutel wordt niet bewaard: hij is een HMAC van de code onder TRACKING_SALT, dus alleen de app-server
// kan hem afleiden. Een geboekte afspraak = Waargenomen handeling; een annulering telt niet meer. Puur (node:crypto),
// zonder database of netwerk: de route geeft de database-functie mee.

import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export type BookingProvider = "calendly" | "calcom";
export const BOOKING_PROVIDERS: Record<BookingProvider, { label: string }> = {
  calendly: { label: "Calendly" },
  calcom: { label: "Cal.com" },
};
export function isBookingProvider(v: unknown): v is BookingProvider {
  return v === "calendly" || v === "calcom";
}

export const BOOKING_TOKEN = /^[A-Za-z0-9_-]{43}$/;

export function bookingTokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

// De geheime sleutel voor de handtekening, afgeleid uit de code van het webhookadres.
export function bookingSecret(salt: string, provider: BookingProvider, token: string): string {
  return createHmac("sha256", salt).update(`booking-secret|${provider}|${token}`).digest("base64url").slice(0, 40);
}

export type Headers = (name: string) => string | null;
export type Verify = { ok: true } | { ok: false; reason: "missing_signature" | "bad_signature" | "stale" };
export type ParsedBooking =
  | { kind: "booking"; externalId: string; email: string | null; status: "booked" | "cancelled"; bookedAt: string | null; scheduledFor: string | null }
  | { kind: "ignored"; event: string };

export interface BookingAdapter {
  provider: BookingProvider;
  verify(headers: Headers, rawBody: string, secret: string, nowMs: number): Verify;
  parse(json: unknown): ParsedBooking;
}

// Tijdsvenster tegen het opnieuw afspelen van een oude, echte melding.
export const REPLAY_WINDOW_MS = 5 * 60 * 1000;

const hmacHex = (secret: string, data: string) => createHmac("sha256", secret).update(data).digest("hex");
function sameHex(a: string, b: string): boolean {
  if (!/^[a-f0-9]+$/i.test(a) || a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a.toLowerCase(), "hex"), Buffer.from(b.toLowerCase(), "hex"));
}

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : null);
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const iso = (v: unknown): string | null => {
  const s = str(v);
  return s && Number.isFinite(Date.parse(s)) ? new Date(s).toISOString() : null;
};

// Calendly: header "Calendly-Webhook-Signature: t=<seconden>,v1=<hex>", HMAC-SHA256 over "<t>.<body>".
export const calendlyAdapter: BookingAdapter = {
  provider: "calendly",
  verify(headers, rawBody, secret, nowMs) {
    const h = headers("calendly-webhook-signature");
    if (!h) return { ok: false, reason: "missing_signature" };
    const parts = Object.fromEntries(h.split(",").map((p) => p.trim().split("=", 2) as [string, string]));
    const t = parts.t;
    const v1 = parts.v1;
    if (!t || !v1 || !/^\d{9,11}$/.test(t)) return { ok: false, reason: "missing_signature" };
    if (!sameHex(v1, hmacHex(secret, `${t}.${rawBody}`))) return { ok: false, reason: "bad_signature" };
    if (Math.abs(nowMs - Number(t) * 1000) > REPLAY_WINDOW_MS) return { ok: false, reason: "stale" };
    return { ok: true };
  },
  parse(json) {
    const root = obj(json);
    const event = str(root?.event) ?? "";
    const p = obj(root?.payload);
    if (!p || (event !== "invitee.created" && event !== "invitee.canceled")) return { kind: "ignored", event };
    const externalId = str(p.uri);
    if (!externalId) return { kind: "ignored", event };
    const scheduled = obj(p.scheduled_event);
    return {
      kind: "booking",
      externalId: externalId.slice(0, 300),
      email: str(p.email),
      status: event === "invitee.canceled" || p.status === "canceled" ? "cancelled" : "booked",
      bookedAt: iso(p.created_at) ?? iso(root?.created_at),
      scheduledFor: iso(scheduled?.start_time),
    };
  },
};

// Cal.com: header "X-Cal-Signature-256: <hex>", HMAC-SHA256 over de ruwe body. Er zit geen tijd in de handtekening; het
// tijdsvenster gebruikt createdAt uit de (ondertekende) body.
export const calcomAdapter: BookingAdapter = {
  provider: "calcom",
  verify(headers, rawBody, secret, nowMs) {
    const sig = headers("x-cal-signature-256");
    if (!sig) return { ok: false, reason: "missing_signature" };
    if (!sameHex(sig.trim(), hmacHex(secret, rawBody))) return { ok: false, reason: "bad_signature" };
    let created: number = NaN;
    try {
      created = Date.parse(String((JSON.parse(rawBody) as Obj).createdAt ?? ""));
    } catch {}
    if (!Number.isFinite(created) || Math.abs(nowMs - created) > REPLAY_WINDOW_MS) return { ok: false, reason: "stale" };
    return { ok: true };
  },
  parse(json) {
    const root = obj(json);
    const event = str(root?.triggerEvent) ?? "";
    const p = obj(root?.payload);
    const booked = event === "BOOKING_CREATED" || event === "BOOKING_RESCHEDULED";
    if (!p || (!booked && event !== "BOOKING_CANCELLED")) return { kind: "ignored", event };
    const externalId = str(p.uid) ?? (p.bookingId != null ? String(p.bookingId) : null);
    if (!externalId) return { kind: "ignored", event };
    const attendees = Array.isArray(p.attendees) ? p.attendees : [];
    const email = str(obj(attendees[0])?.email) ?? str(p.email);
    return {
      kind: "booking",
      externalId: externalId.slice(0, 300),
      email,
      status: booked ? "booked" : "cancelled",
      bookedAt: iso(root?.createdAt),
      scheduledFor: iso(p.startTime),
    };
  },
};

export const BOOKING_ADAPTERS: Record<BookingProvider, BookingAdapter> = { calendly: calendlyAdapter, calcom: calcomAdapter };

export type RecordBooking = (a: {
  tokenHash: string;
  provider: BookingProvider;
  externalId: string;
  personKey: string;
  status: "booked" | "cancelled";
  bookedAt: string | null;
  scheduledFor: string | null;
}) => Promise<{ data: string | null; error: { message: string } | null }>;

export type BookingOutcome = { status: number; result: string };

// De hele webhook, met de database-functie en de persoonssleutel als afhankelijkheden (testbaar zonder server).
export async function handleBookingWebhook(d: {
  provider: string;
  token: string;
  headers: Headers;
  rawBody: string;
  salt: string;
  nowMs: number;
  personKey: (email: string) => string | null;
  record: RecordBooking;
}): Promise<BookingOutcome> {
  if (!isBookingProvider(d.provider) || !BOOKING_TOKEN.test(d.token)) return { status: 404, result: "unknown" };
  if (!d.salt) return { status: 503, result: "not_configured" };
  const adapter = BOOKING_ADAPTERS[d.provider];
  const check = adapter.verify(d.headers, d.rawBody, bookingSecret(d.salt, d.provider, d.token), d.nowMs);
  if (!check.ok) return { status: 401, result: check.reason };
  let json: unknown;
  try {
    json = JSON.parse(d.rawBody);
  } catch {
    return { status: 400, result: "invalid_json" };
  }
  const b = adapter.parse(json);
  if (b.kind === "ignored") return { status: 200, result: "ignored" };
  const key = b.email ? d.personKey(b.email) : null;
  if (!key) return { status: 200, result: "no_email" };
  const { data, error } = await d.record({ tokenHash: bookingTokenHash(d.token), provider: d.provider, externalId: b.externalId, personKey: key, status: b.status, bookedAt: b.bookedAt, scheduledFor: b.scheduledFor });
  if (error) return { status: 500, result: "error" };
  if (data === "unknown") return { status: 404, result: "unknown" };
  if (data === "rate") return { status: 429, result: "rate" };
  return { status: 200, result: data ?? "error" };
}
