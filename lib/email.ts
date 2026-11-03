import "server-only";
import { env, emailConfigured } from "@/lib/env";
import { log } from "@/lib/log";

export type SendResult = { ok: true; id: string | null } | { ok: false; error: string; retryable: boolean };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// One e-mail through the Resend HTTP API. Plain text plus a minimal HTML twin; Resend's open and click tracking
// stay off (they are domain settings in Resend: leave them disabled). One retry on rate limiting.
export async function sendEmail(input: {
  to: string;
  subject: string;
  text: string;
  html: string;
  listUnsubscribe: string;
  idempotencyKey: string;
}): Promise<SendResult> {
  if (!emailConfigured()) return { ok: false, error: "E-mail is niet gekoppeld (RESEND_API_KEY of EMAIL_FROM ontbreekt).", retryable: false };
  const body = JSON.stringify({
    from: env.emailFrom,
    to: [input.to],
    subject: input.subject,
    text: input.text,
    html: input.html,
    headers: { "List-Unsubscribe": `<${input.listUnsubscribe}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
  });
  for (let attempt = 0; attempt < 2; attempt++) {
    let res: Response;
    try {
      res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { authorization: `Bearer ${env.resendKey}`, "content-type": "application/json", "idempotency-key": input.idempotencyKey },
        body,
        signal: AbortSignal.timeout(15_000),
      });
    } catch (e) {
      // Never the recipient or the content: only what failed.
      await log.error("email_send_failed", { provider: "resend", reason: "network", attempt: attempt + 1 }, e);
      return { ok: false, error: "Geen verbinding met de e-maildienst.", retryable: true };
    }
    if (res.ok) {
      const json = (await res.json().catch(() => null)) as { id?: string } | null;
      return { ok: true, id: json?.id ?? null };
    }
    if (res.status === 429 && attempt === 0) {
      const wait = Math.min(2000, Math.max(500, Number(res.headers.get("retry-after") ?? "1") * 1000));
      await sleep(wait);
      continue;
    }
    const detail = (await res.json().catch(() => null)) as { message?: string; name?: string } | null;
    const retryable = res.status === 429 || res.status >= 500;
    await log[retryable ? "warn" : "error"]("email_send_failed", {
      provider: "resend",
      status: res.status,
      providerCode: typeof detail?.name === "string" ? detail.name.slice(0, 60) : null,
      retryable,
      attempt: attempt + 1,
    });
    return {
      ok: false,
      error: `E-maildienst weigerde (${res.status})${detail?.message ? `: ${String(detail.message).slice(0, 200)}` : ""}`,
      retryable,
    };
  }
  await log.warn("email_send_failed", { provider: "resend", status: 429, retryable: true, attempt: 2 });
  return { ok: false, error: "E-maildienst: te veel verzoeken. Probeer het zo opnieuw.", retryable: true };
}

// Resend allows a few requests per second per account; keep a small gap between mails.
export const SEND_GAP_MS = 300;
export { sleep };
