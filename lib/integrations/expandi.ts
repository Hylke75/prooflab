// Expandi (LinkedIn outreach) webhooks. Expandi does not publish a fixed payload format, so the parser is
// tolerant: it looks for the event type, message text, contact identity and campaign under the field names
// seen in practice, at the top level and in nested objects. Names and profile URLs never leave this module:
// the contact becomes a keyed hash.

import { createHash, createHmac, randomBytes } from "node:crypto";

export type OutreachEventType = "connection_request" | "connection_accepted" | "message_sent" | "reply" | "other";

export const OUTREACH_EVENTS: Record<OutreachEventType, string> = {
  connection_request: "Connectieverzoek verstuurd",
  connection_accepted: "Connectie geaccepteerd",
  message_sent: "Bericht verstuurd",
  reply: "Antwoord ontvangen",
  other: "Overig",
};

export type ParsedOutreach = {
  event: OutreachEventType;
  rawEvent: string | null;
  message: string | null; // only kept for replies
  identity: string | null;
  campaign: string | null;
  eventId: string | null;
};

// Webhook tokens: 32 random bytes, base64url (43 characters). Only the sha256 hash is stored.
export const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export function newWebhookToken(): string {
  return randomBytes(32).toString("base64url");
}

export function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

function asText(v: unknown): string | null {
  if (typeof v === "string") return v.trim() || null;
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return null;
}

// Breadth-first search for the first usable value under one of `keys` (in priority order per level).
function find(root: unknown, keys: string[], opts: { maxDepth?: number; skip?: string[] } = {}): unknown {
  const maxDepth = opts.maxDepth ?? 3;
  let level: Obj[] = isObj(root) ? [root] : Array.isArray(root) ? root.filter(isObj) : [];
  for (let depth = 0; depth <= maxDepth && level.length; depth++) {
    for (const node of level) {
      for (const k of keys) {
        const hit = Object.keys(node).find((x) => x.toLowerCase() === k);
        if (hit !== undefined && node[hit] != null && node[hit] !== "") return node[hit];
      }
    }
    const next: Obj[] = [];
    for (const node of level)
      for (const [k, v] of Object.entries(node)) {
        if (opts.skip?.includes(k.toLowerCase())) continue;
        if (isObj(v)) next.push(v);
        else if (Array.isArray(v)) next.push(...v.filter(isObj).slice(0, 5));
      }
    level = next;
  }
  return undefined;
}

function findText(root: unknown, keys: string[], opts?: { maxDepth?: number; skip?: string[] }): string | null {
  const v = find(root, keys, opts);
  if (isObj(v)) return asText(v.name) ?? asText(v.title) ?? asText(v.text) ?? asText(v.body) ?? asText(v.content);
  return asText(v);
}

export function classifyEvent(raw: string | null): OutreachEventType {
  const s = (raw ?? "").toLowerCase().replace(/[^a-z]+/g, " ");
  if (!s.trim()) return "other";
  if (/\b(repl|respon|answer|antwoord|beantwoord|received|inbound|incoming|ontvangen)/.test(s)) return "reply";
  if (/accept|geaccepteerd/.test(s)) return "connection_accepted";
  if (/\b(message|messages|msg|bericht)\b.*\b(sent|send|verstuurd)\b|\b(sent|send)\b.*\b(message|msg)\b|follow ?up/.test(s)) return "message_sent";
  if (/invit|connect|request|verzoek/.test(s)) return "connection_request";
  return "other";
}

const EVENT_KEYS = ["event", "event_type", "eventtype", "type", "hook_event", "hookevent", "trigger", "action", "event_name", "name"];
const MESSAGE_KEYS = ["reply", "reply_text", "message", "text", "last_message", "lastmessage", "content", "message_text", "body"];
const CONTACT_CONTAINERS = ["contact", "lead", "prospect", "profile", "person", "recipient"];
const IDENTITY_KEYS = ["profile_link", "linkedin_url", "linkedin_profile_url", "profile_url", "public_identifier", "linkedin_id", "email", "id"];
const CAMPAIGN_KEYS = ["campaign_name", "campaign", "campaignname", "campaign_instance", "campaign_title"];
const EVENT_ID_KEYS = ["event_id", "eventid", "message_id", "messageid", "uuid", "delivery_id"];

// Identities of the same person in different notations hash to the same value.
export function normalizeIdentity(raw: string): string {
  let s = raw.trim().toLowerCase();
  if (/linkedin\.com/.test(s)) {
    s = s.replace(/^https?:\/\//, "").replace(/^(www\.|[a-z]{2}\.)/, "").split(/[?#]/)[0].replace(/\/+$/, "");
  }
  return s;
}

export function parseExpandiPayload(json: unknown): ParsedOutreach {
  // The event type: top level first, then nested objects (e.g. hook.event); never inside the contact.
  let rawEvent = findText(json, EVENT_KEYS, { maxDepth: 2, skip: CONTACT_CONTAINERS });
  if (isObj(json) && isObj(json.hook)) rawEvent = asText(json.hook.event) ?? asText(json.hook.name) ?? rawEvent;
  const event = classifyEvent(rawEvent);

  let identity: string | null = null;
  const container = isObj(json) ? CONTACT_CONTAINERS.map((k) => json[k]).find(isObj) : undefined;
  if (container) identity = findText(container, IDENTITY_KEYS, { maxDepth: 1 });
  identity ??= findText(json, IDENTITY_KEYS.filter((k) => k !== "id"), { maxDepth: 2 });

  const rawMessage = findText(json, MESSAGE_KEYS, { maxDepth: 3, skip: ["hook"] });
  const message = event === "reply" && rawMessage ? rawMessage.replace(/\r\n/g, "\n").slice(0, 4000) : null;

  const campaign = findText(json, CAMPAIGN_KEYS, { maxDepth: 2 })?.slice(0, 200) ?? null;
  const eventId = findText(json, EVENT_ID_KEYS, { maxDepth: 2 }) ?? (isObj(json) ? asText(json.id) : null);

  return { event, rawEvent, message, identity: identity ? normalizeIdentity(identity) : null, campaign, eventId };
}

export function contactHash(salt: string, identity: string | null, fallback: string): string {
  return createHmac("sha256", salt)
    .update(identity ? `expandi|${identity}` : `expandi-anon|${fallback}`)
    .digest("hex")
    .slice(0, 32);
}

// Same event delivered twice → same key. Without an event id, the exact payload decides.
export function dedupeKey(parsed: ParsedOutreach, rawBody: string): string {
  if (parsed.eventId) return `${parsed.event}:id:${parsed.eventId}`.slice(0, 200);
  return `${parsed.event}:h:${createHash("sha256").update(rawBody).digest("hex").slice(0, 40)}`;
}
