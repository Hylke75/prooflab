import type { ProviderId } from "./config";
import { AiProviderError, kindForStatus } from "./types";

// Shared HTTP for the fetch-based adapters: JSON POST with a timeout, a small number of retries on rate limits
// and server errors (honouring Retry-After, capped), and errors mapped to AiProviderError. The API key travels
// in a header and never appears in an error message.

export type HttpOptions = {
  fetch?: typeof fetch;
  maxRetries?: number;
  timeoutMs?: number;
  sleep?: (ms: number) => Promise<void>;
};

const RETRYABLE = new Set([429, 500, 502, 503, 504, 529]);
const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function postJson(
  provider: ProviderId,
  url: string,
  headers: Record<string, string>,
  body: unknown,
  opts: HttpOptions & { timeoutMs: number },
): Promise<unknown> {
  const doFetch = opts.fetch ?? fetch;
  const sleep = opts.sleep ?? defaultSleep;
  const maxRetries = opts.maxRetries ?? 2;
  for (let attempt = 0; ; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs);
    let res: Response;
    try {
      res = await doFetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", ...headers },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
    } catch (e) {
      clearTimeout(timer);
      if (ctrl.signal.aborted || (e instanceof Error && (e.name === "AbortError" || e.name === "TimeoutError"))) {
        throw new AiProviderError(provider, "timeout", null);
      }
      if (attempt < maxRetries) {
        await sleep(1000 * 2 ** attempt);
        continue;
      }
      throw new AiProviderError(provider, "network", null);
    }
    clearTimeout(timer);
    if (res.ok) {
      try {
        return await res.json();
      } catch {
        throw new AiProviderError(provider, "server", res.status, "geen geldige JSON");
      }
    }
    if (RETRYABLE.has(res.status) && attempt < maxRetries) {
      const after = Number(res.headers.get("retry-after"));
      await sleep(Number.isFinite(after) && after > 0 ? Math.min(after, 20) * 1000 : 1000 * 2 ** attempt);
      continue;
    }
    throw new AiProviderError(provider, kindForStatus(res.status), res.status, await errorDetail(res));
  }
}

// The provider's own error message (never echoes our request, so no key), shortened.
async function errorDetail(res: Response): Promise<string | undefined> {
  try {
    const j = (await res.json()) as { error?: { message?: string } | string };
    const msg = typeof j.error === "string" ? j.error : j.error?.message;
    return msg ? msg.replace(/(sk|AIza)[-\w]{8,}/g, "[sleutel]").slice(0, 200) : undefined;
  } catch {
    return undefined;
  }
}
