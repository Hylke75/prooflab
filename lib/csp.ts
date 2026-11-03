// Content-Security-Policy with a fresh nonce per request (set in proxy.ts). Next.js reads the nonce from the
// request's CSP header and puts it on its own scripts and inline <style> tags, so every page must be rendered
// per request (the root layout calls connection()).
//
// Styles: <style> elements need the nonce (style-src-elem). React style props become style="…" attributes,
// which a nonce cannot cover; style-src-attr 'unsafe-inline' allows those attributes only, so an injected
// <style> or stylesheet from elsewhere is still blocked.

export type CspOptions = {
  nonce: string;
  supabaseUrl?: string;
  sentryOrigin?: string | null;
  dev?: boolean;
  upgradeInsecure?: boolean;
};

function origin(url: string | undefined | null): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.protocol === "https:" || u.protocol === "http:" ? u.origin : null;
  } catch {
    return null;
  }
}

export function buildCsp(o: CspOptions): string {
  const supabase = origin(o.supabaseUrl);
  const realtime = supabase ? supabase.replace(/^http/, "ws") : null;
  const sentry = origin(o.sentryOrigin);
  const nonce = `'nonce-${o.nonce}'`;
  const directives: [string, ...string[]][] = [
    ["default-src", "'self'"],
    ["script-src", "'self'", nonce, "'strict-dynamic'", ...(o.dev ? ["'unsafe-eval'"] : [])],
    ["style-src", "'self'", nonce],
    ["style-src-elem", "'self'", nonce],
    ["style-src-attr", "'unsafe-inline'"],
    ["img-src", "'self'", "data:", "blob:"],
    ["font-src", "'self'", "data:"],
    ["connect-src", "'self'", ...[supabase, realtime, sentry].filter((x): x is string => !!x), ...(o.dev ? ["ws:"] : [])],
    ["frame-src", "'none'"],
    ["worker-src", "'self'", "blob:"],
    ["manifest-src", "'self'"],
    ["object-src", "'none'"],
    ["base-uri", "'none'"],
    ["form-action", "'self'"],
    ["frame-ancestors", "'none'"],
  ];
  const parts = directives.map((d) => d.join(" "));
  if (o.upgradeInsecure) parts.push("upgrade-insecure-requests");
  return parts.join("; ");
}

// 128 bits from the Web Crypto API (available in the proxy runtime), base64-encoded.
export function makeNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}
