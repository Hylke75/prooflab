// Structured, privacy-safe server logging. One JSON line per event on stdout/stderr (readable in Vercel,
// Supabase or any log drain) and, for errors, an optional report to a Sentry-compatible endpoint
// (lib/monitoring.ts, only when SENTRY_DSN is set).
//
// Never log personal data: no e-mail addresses, names, answers, transcripts, quotes, tokens or secrets. Every
// field passes through redact(), which drops sensitive keys and scrubs e-mail addresses, bearer tokens,
// personal link tokens and long secrets out of strings. Pass ids, counts, statuses and codes instead.

export type LogLevel = "info" | "warn" | "error";
export type LogFields = Record<string, unknown>;

const MAX_STRING = 300;
const MAX_DEPTH = 4;
const MAX_ITEMS = 20;

// Keys whose values are personal or secret, whatever they contain.
const SENSITIVE_KEY =
  /^(e-?mail|emails|to|from|cc|bcc|recipient|answers?|transcript|quote|quotes|text|html|body|raw|payload|password|passwd|secret|token|api_?key|authorization|cookie|cookies|set-cookie|phone|ip|ip_address|user_agent|ua|name|full_?name|first_?name|last_?name|address|identity|contact)$/i;
const SENSITIVE_KEY_PART = /(e-?mail|password|secret|token|api_?key|authorization|cookie|answer|transcript)/i;

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const BEARER = /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi;
const KNOWN_KEYS = /\b(sk-ant-[A-Za-z0-9_-]+|sk-[A-Za-z0-9_-]{16,}|sb_(secret|publishable)_[A-Za-z0-9_-]+|re_[A-Za-z0-9_]{16,}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)/g;
// Personal links and webhook tokens: ?u=…, ?token=…, /s/afmelden?t=…, /api/integrations/expandi/<token>.
const QUERY_SECRET = /([?&](?:u|t|token|key|code|access_token|refresh_token|sig|signature)=)[^&#\s"']+/gi;
const EXPANDI_PATH = /(\/api\/integrations\/expandi\/)[^/?#\s"']+/gi;
const LONG_SECRET = /\b[A-Za-z0-9_-]{40,}\b/g;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function redactString(input: string): string {
  const out = input
    .replace(EMAIL, "[e-mail]")
    .replace(BEARER, "$1 [redacted]")
    .replace(KNOWN_KEYS, "[secret]")
    .replace(QUERY_SECRET, "$1[redacted]")
    .replace(EXPANDI_PATH, "$1[token]")
    .replace(LONG_SECRET, "[secret]");
  return out.length > MAX_STRING ? `${out.slice(0, MAX_STRING)}…` : out;
}

export function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY.test(key) || SENSITIVE_KEY_PART.test(key);
}

// Deep copy with personal data removed. Errors become { name, message, code }.
export function redact(value: unknown, depth = 0): unknown {
  if (value == null || typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "string") return UUID.test(value) ? value : redactString(value);
  if (typeof value === "function" || typeof value === "symbol") return undefined;
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Error) return serializeError(value);
  if (depth >= MAX_DEPTH) return "[…]";
  if (Array.isArray(value)) return value.slice(0, MAX_ITEMS).map((v) => redact(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>).slice(0, MAX_ITEMS)) {
    out[k] = isSensitiveKey(k) ? "[redacted]" : redact(v, depth + 1);
  }
  return out;
}

export type SerializedError = { name: string; message: string; code?: string; digest?: string; stack?: string };

export function serializeError(e: unknown): SerializedError {
  if (e instanceof Error) {
    const x = e as Error & { code?: unknown; digest?: unknown; status?: unknown };
    const code = x.code ?? x.status;
    return {
      name: x.name || "Error",
      message: redactString(x.message ?? ""),
      ...(code != null ? { code: String(code).slice(0, 40) } : {}),
      ...(x.digest != null ? { digest: String(x.digest).slice(0, 40) } : {}),
      // File paths and line numbers only; frames never contain request data.
      ...(x.stack ? { stack: x.stack.split("\n").slice(1, 8).map((l) => redactString(l.trim())).join("\n") } : {}),
    };
  }
  if (e && typeof e === "object" && "message" in e) {
    const o = e as { message?: unknown; code?: unknown };
    return { name: "Error", message: redactString(String(o.message)), ...(o.code != null ? { code: String(o.code).slice(0, 40) } : {}) };
  }
  return { name: "Error", message: redactString(String(e)) };
}

export type LogRecord = { level: LogLevel; event: string; time: string; error?: SerializedError } & LogFields;

export function formatRecord(level: LogLevel, event: string, fields: LogFields = {}, error?: unknown): LogRecord {
  const safe = redact(fields) as LogFields;
  // Reserved keys cannot be overwritten by fields.
  delete safe.level;
  delete safe.event;
  delete safe.time;
  delete safe.error;
  return {
    level,
    event: event.replace(/[^a-z0-9_.:-]/gi, "_").slice(0, 80),
    time: new Date().toISOString(),
    ...safe,
    ...(error !== undefined ? { error: serializeError(error) } : {}),
  };
}

type Sink = (record: LogRecord) => void;
const consoleSink: Sink = (r) => {
  const line = JSON.stringify(r);
  if (r.level === "error") console.error(line);
  else if (r.level === "warn") console.warn(line);
  else console.log(line);
};
let sink: Sink = consoleSink;

// Tests capture records instead of printing them.
export function setLogSink(next: Sink | null) {
  sink = next ?? consoleSink;
}

async function emit(level: LogLevel, event: string, fields?: LogFields, error?: unknown): Promise<void> {
  const record = formatRecord(level, event, fields, error);
  try {
    sink(record);
  } catch {
    // Logging must never break the request.
  }
  if (level === "error") {
    try {
      const { reportError } = await import("./monitoring");
      await reportError(record);
    } catch {
      // Monitoring is best effort.
    }
  }
}

export const log = {
  info: (event: string, fields?: LogFields) => emit("info", event, fields),
  warn: (event: string, fields?: LogFields, error?: unknown) => emit("warn", event, fields, error),
  error: (event: string, fields?: LogFields, error?: unknown) => emit("error", event, fields, error),
};
