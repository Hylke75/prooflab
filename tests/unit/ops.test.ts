import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { formatRecord, log, redact, redactString, serializeError, setLogSink, type LogRecord } from "@/lib/log";
import { buildEnvelope, dsnOrigin, envelopeUrl, parseDsn, reportError } from "@/lib/monitoring";
import { buildCsp, makeNonce } from "@/lib/csp";

describe("redact", () => {
  it("scrubs e-mail addresses, tokens and secrets out of strings", () => {
    expect(redactString("Invalid `to` field: Jan.Jansen+test@voorbeeld.nl")).toBe("Invalid `to` field: [e-mail]");
    expect(redactString("authorization: Bearer abc.def-ghi")).toBe("authorization: Bearer [redacted]");
    expect(redactString("key sk-ant-api03-AAAAbbbbCCCCdddd")).toBe("key [secret]");
    expect(redactString("sb_secret_abcdefghijk used")).toBe("[secret] used");
    expect(redactString("/s/enquete?u=persoonlijk-token-123&x=1")).toBe("/s/enquete?u=[redacted]&x=1");
    expect(redactString("/api/integrations/expandi/AbCdEf0123456789xyz")).toBe("/api/integrations/expandi/[token]");
    expect(redactString("a".repeat(48))).toBe("[secret]");
    expect(redactString("x".repeat(1000)).length).toBeLessThanOrEqual(301);
  });

  it("drops personal and secret keys whatever they contain", () => {
    const out = redact({
      email: "a@b.nl",
      to: "c@d.nl",
      answers: { q1: "Ik zou betalen" },
      transcript: "lang gesprek",
      quote: "letterlijk",
      text: "mailtekst",
      password: "geheim123",
      apiKey: "x",
      user_email: "e@f.nl",
      name: "Jan",
      ideaId: "6f1c2a7e-1d2b-4c3d-9e8f-0a1b2c3d4e5f",
      status: 422,
      retryable: false,
      purpose: "research:search",
    }) as Record<string, unknown>;
    for (const k of ["email", "to", "answers", "transcript", "quote", "text", "password", "apiKey", "user_email", "name"]) {
      expect(out[k], k).toBe("[redacted]");
    }
    expect(out.ideaId).toBe("6f1c2a7e-1d2b-4c3d-9e8f-0a1b2c3d4e5f");
    expect(out.status).toBe(422);
    expect(out.retryable).toBe(false);
    expect(out.purpose).toBe("research:search");
  });

  it("walks nested values with a depth limit and never leaks an address", () => {
    const out = redact({ a: { b: [{ detail: "mail naar x@y.com mislukt" }] }, deep: { a: { b: { c: { d: { e: 1 } } } } } });
    expect(JSON.stringify(out)).not.toContain("x@y.com");
    expect(JSON.stringify(out)).toContain("[…]");
  });

  it("serializes errors without their personal content", () => {
    const e = Object.assign(new Error("duplicate key for jan@voorbeeld.nl"), { code: "23505" });
    const s = serializeError(e);
    expect(s.message).toBe("duplicate key for [e-mail]");
    expect(s.code).toBe("23505");
    expect(serializeError({ message: "PostgREST p@q.nl", code: "PGRST" }).message).toBe("PostgREST [e-mail]");
    expect(serializeError("plain").message).toBe("plain");
  });
});

describe("logger", () => {
  let records: LogRecord[];
  beforeEach(() => {
    records = [];
    setLogSink((r) => records.push(r));
  });
  afterEach(() => {
    setLogSink(null);
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("writes one structured record with reserved keys protected", async () => {
    await log.warn("webhook_rejected", { source: "expandi", reason: "rate_limited", status: 429, level: "info", event: "x" });
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ level: "warn", event: "webhook_rejected", source: "expandi", status: 429 });
    expect(typeof records[0].time).toBe("string");
  });

  it("redacts fields and the error of an error record", async () => {
    await log.error("email_send_failed", { to: "klant@bedrijf.nl", status: 422 }, new Error("Invalid recipient klant@bedrijf.nl"));
    const line = JSON.stringify(records[0]);
    expect(line).not.toContain("klant@bedrijf.nl");
    expect(records[0].error?.message).toBe("Invalid recipient [e-mail]");
  });

  it("sanitizes the event name", () => {
    expect(formatRecord("info", "bad event\nname").event).toBe("bad_event_name");
  });

  it("does not call out without SENTRY_DSN, and posts an envelope with it", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("SENTRY_DSN", "");
    await log.error("x_failed", {});
    expect(fetchMock).not.toHaveBeenCalled();

    vi.stubEnv("SENTRY_DSN", "https://pub123@errors.example.com/42");
    await log.error("research_task_failed", { runId: "r1", email: "a@b.nl" }, new Error("boom"));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://errors.example.com/api/42/envelope/");
    expect((init.headers as Record<string, string>)["x-sentry-auth"]).toContain("sentry_key=pub123");
    expect(String(init.body)).not.toContain("a@b.nl");
    expect(String(init.body)).toContain("research_task_failed");
  });

  it("never throws when the monitoring endpoint fails", async () => {
    vi.stubEnv("SENTRY_DSN", "https://pub@errors.example.com/1");
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new Error("offline"))));
    await expect(log.error("x_failed", {})).resolves.toBeUndefined();
    expect(await reportError(formatRecord("error", "x"))).toBe(false);
  });
});

describe("instrumentation", () => {
  afterEach(() => setLogSink(null));

  it("logs request errors without the query string or personal data", async () => {
    const records: LogRecord[] = [];
    setLogSink((r) => records.push(r));
    const { onRequestError } = await import("@/instrumentation");
    await onRequestError(
      new Error("kapot bij jan@voorbeeld.nl"),
      { path: "/s/enquete?u=persoonlijk-token", method: "GET", headers: { cookie: "sb=geheim" } },
      { routerKind: "App Router", routePath: "/s/[slug]", routeType: "render", renderSource: "server-rendering", revalidateReason: undefined },
    );
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ level: "error", event: "request_failed", path: "/s/enquete", route: "/s/[slug]" });
    const line = JSON.stringify(records[0]);
    expect(line).not.toContain("persoonlijk-token");
    expect(line).not.toContain("jan@voorbeeld.nl");
    expect(line).not.toContain("geheim");
  });
});

describe("monitoring DSN and envelope", () => {
  it("parses Sentry-style DSNs, including a path prefix", () => {
    expect(parseDsn("https://abc@o1.ingest.sentry.io/123")).toEqual({ protocol: "https", publicKey: "abc", host: "o1.ingest.sentry.io", path: "", projectId: "123" });
    const d = parseDsn("http://key@localhost:8000/glitchtip/7")!;
    expect(envelopeUrl(d)).toBe("http://localhost:8000/glitchtip/api/7/envelope/");
    expect(parseDsn("")).toBeNull();
    expect(parseDsn("not a url")).toBeNull();
    expect(parseDsn("https://o1.ingest.sentry.io/123")).toBeNull();
    expect(parseDsn("ftp://k@h/1")).toBeNull();
    expect(dsnOrigin("https://abc@o1.ingest.sentry.io/123")).toBe("https://o1.ingest.sentry.io");
  });

  it("builds a three-line envelope with the exception", () => {
    const d = parseDsn("https://abc@h.example/9")!;
    const env = buildEnvelope(d, formatRecord("error", "request_failed", { path: "/app" }, new Error("kapot")), { environment: "test" });
    const [header, item, payload] = env.trim().split("\n").map((l) => JSON.parse(l));
    expect(header.event_id).toMatch(/^[0-9a-f]{32}$/);
    expect(item.type).toBe("event");
    expect(payload.environment).toBe("test");
    expect(payload.level).toBe("error");
    expect(payload.exception.values[0]).toMatchObject({ type: "Error", value: "kapot" });
    expect(payload.extra.path).toBe("/app");
    expect(payload.user).toBeUndefined();
  });
});

describe("Content-Security-Policy", () => {
  const nonce = "bm9uY2UtdmFsdWU=";
  const directives = (csp: string) => new Map(csp.split("; ").map((d) => [d.split(" ")[0], d.split(" ").slice(1)]));

  it("has the strict production directives", () => {
    const d = directives(buildCsp({ nonce, supabaseUrl: "https://abc.supabase.co" }));
    expect(d.get("script-src")).toEqual(["'self'", `'nonce-${nonce}'`, "'strict-dynamic'"]);
    expect(d.get("style-src-elem")).toContain(`'nonce-${nonce}'`);
    expect(d.get("style-src-attr")).toEqual(["'unsafe-inline'"]);
    expect(d.get("img-src")).toEqual(["'self'", "data:", "blob:"]);
    expect(d.get("connect-src")).toEqual(["'self'", "https://abc.supabase.co", "wss://abc.supabase.co"]);
    expect(d.get("frame-ancestors")).toEqual(["'none'"]);
    expect(d.get("base-uri")).toEqual(["'none'"]);
    expect(d.get("form-action")).toEqual(["'self'"]);
    expect(d.get("object-src")).toEqual(["'none'"]);
    expect(d.has("upgrade-insecure-requests")).toBe(false);
    expect(d.get("script-src")).not.toContain("'unsafe-inline'");
    expect(d.get("script-src")).not.toContain("'unsafe-eval'");
  });

  it("adds the monitoring origin, dev allowances and https upgrade only when asked", () => {
    const d = directives(buildCsp({ nonce, supabaseUrl: "http://127.0.0.1:54321/", sentryOrigin: "https://o1.ingest.sentry.io", dev: true, upgradeInsecure: true }));
    expect(d.get("connect-src")).toEqual(["'self'", "http://127.0.0.1:54321", "ws://127.0.0.1:54321", "https://o1.ingest.sentry.io", "ws:"]);
    expect(d.get("script-src")).toContain("'unsafe-eval'");
    expect(d.has("upgrade-insecure-requests")).toBe(true);
  });

  it("ignores unusable URLs instead of writing them into the policy", () => {
    const csp = buildCsp({ nonce, supabaseUrl: "javascript:alert(1)", sentryOrigin: "nonsense" });
    expect(directives(csp).get("connect-src")).toEqual(["'self'"]);
  });

  it("makes a fresh 128-bit nonce each time", () => {
    const a = makeNonce();
    expect(Buffer.from(a, "base64")).toHaveLength(16);
    expect(makeNonce()).not.toBe(a);
  });
});
