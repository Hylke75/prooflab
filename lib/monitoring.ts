// Optional error reporting to any Sentry-compatible endpoint (Sentry, GlitchTip, Bugsink, …) without a vendor
// SDK: one envelope POST per error, built from an already redacted log record. Active only when SENTRY_DSN is
// set; without it this module does nothing. No user ids, IP addresses, cookies or headers are sent.
import type { LogRecord } from "./log";

export type Dsn = { protocol: string; publicKey: string; host: string; path: string; projectId: string };

export function parseDsn(dsn: string | undefined | null): Dsn | null {
  if (!dsn) return null;
  try {
    const u = new URL(dsn.trim());
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    const parts = u.pathname.split("/").filter(Boolean);
    const projectId = parts.pop();
    if (!u.username || !projectId || !/^\d+$/.test(projectId)) return null;
    return {
      protocol: u.protocol.slice(0, -1),
      publicKey: decodeURIComponent(u.username),
      host: u.host,
      path: parts.length ? `/${parts.join("/")}` : "",
      projectId,
    };
  } catch {
    return null;
  }
}

export function envelopeUrl(d: Dsn): string {
  return `${d.protocol}://${d.host}${d.path}/api/${d.projectId}/envelope/`;
}

// Origin of the reporting endpoint, for connect-src (only needed if a browser ever reports directly).
export function dsnOrigin(dsn: string | undefined | null): string | null {
  const d = parseDsn(dsn);
  return d ? `${d.protocol}://${d.host}` : null;
}

const hex32 = () => crypto.randomUUID().replace(/-/g, "");

export function buildEnvelope(d: Dsn, record: LogRecord, meta: { environment?: string; release?: string } = {}): string {
  const eventId = hex32();
  const { level, event, time, error, ...extra } = record;
  const payload = {
    event_id: eventId,
    timestamp: Date.parse(time) / 1000,
    platform: "node",
    level: level === "warn" ? "warning" : level,
    logger: "prooflab",
    environment: meta.environment || "production",
    ...(meta.release ? { release: meta.release } : {}),
    transaction: event,
    message: { formatted: error ? `${event}: ${error.message}` : event },
    tags: { event },
    extra,
    ...(error
      ? {
          exception: {
            values: [
              {
                type: error.name,
                value: error.message,
                ...(error.stack ? { stacktrace: { frames: framesOf(error.stack) } } : {}),
              },
            ],
          },
        }
      : {}),
  };
  const header = { event_id: eventId, sent_at: new Date().toISOString() };
  const itemHeader = { type: "event", content_type: "application/json" };
  return `${JSON.stringify(header)}\n${JSON.stringify(itemHeader)}\n${JSON.stringify(payload)}\n`;
}

// Sentry expects frames oldest first.
function framesOf(stack: string) {
  return stack
    .split("\n")
    .map((line) => {
      const m = line.match(/at (?:(.+?) \()?(.+?):(\d+):(\d+)\)?$/);
      return m ? { function: m[1] ?? "?", filename: m[2], lineno: Number(m[3]), colno: Number(m[4]), in_app: !m[2].includes("node_modules") && !m[2].startsWith("node:") } : null;
    })
    .filter((f): f is NonNullable<typeof f> => f !== null)
    .reverse();
}

export function monitoringConfigured(): boolean {
  return parseDsn(process.env.SENTRY_DSN) !== null;
}

// Best effort, at most 3 seconds, never throws.
export async function reportError(record: LogRecord): Promise<boolean> {
  const d = parseDsn(process.env.SENTRY_DSN);
  if (!d) return false;
  try {
    const res = await fetch(envelopeUrl(d), {
      method: "POST",
      headers: {
        "content-type": "application/x-sentry-envelope",
        "x-sentry-auth": `Sentry sentry_version=7, sentry_key=${d.publicKey}, sentry_client=prooflab-envelope/1.0`,
      },
      body: buildEnvelope(d, record, {
        environment: process.env.SENTRY_ENVIRONMENT || process.env.VERCEL_ENV || process.env.NODE_ENV,
        release: process.env.SENTRY_RELEASE || process.env.VERCEL_GIT_COMMIT_SHA,
      }),
      signal: AbortSignal.timeout(3000),
    });
    return res.ok;
  } catch {
    return false;
  }
}
