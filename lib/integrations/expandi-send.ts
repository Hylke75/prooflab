import "server-only";
import { lookup } from "node:dns/promises";
import https from "node:https";
import { isIP } from "node:net";
import { isBlockedAddress } from "@/lib/fetch-page";
import { validateCampaignUrl, type ExpandiPayload } from "./expandi-push";

// One contact to an Expandi campaign webhook. Same SSRF rules as lib/fetch-page.ts, stricter: only https to an
// Expandi host (validateCampaignUrl), the name is resolved once and the connection is pinned to that public
// address (no DNS rebinding), no redirects are followed, 10 s timeout, the answer is read up to 8 KB.

export type PushResult = { ok: true } | { ok: false; error: string; retryable: boolean };

export async function postToExpandi(rawUrl: string, payload: ExpandiPayload): Promise<PushResult> {
  const check = validateCampaignUrl(rawUrl);
  if (!check.ok) return { ok: false, error: check.error, retryable: false };
  const url = new URL(check.url);
  let pin: { address: string; family: number };
  try {
    const addrs = isIP(url.hostname) ? [{ address: url.hostname, family: isIP(url.hostname) }] : await lookup(url.hostname, { all: true, verbatim: true });
    if (addrs.length === 0 || addrs.some((a) => isBlockedAddress(a.address))) return { ok: false, error: "Het adres van de outreachtool is niet publiek bereikbaar.", retryable: false };
    pin = addrs[0];
  } catch {
    return { ok: false, error: "De outreachtool is niet bereikbaar (DNS).", retryable: true };
  }
  const body = JSON.stringify(payload);
  return new Promise<PushResult>((resolve) => {
    const req = https.request(
      url,
      {
        method: "POST",
        headers: { "content-type": "application/json", "content-length": Buffer.byteLength(body), "user-agent": "ProofLab/1.0 (+expandi-push)", accept: "application/json, text/plain" },
        lookup: ((_host: string, opts: { all?: boolean }, cb: (...args: unknown[]) => void) =>
          opts?.all ? cb(null, [{ address: pin.address, family: pin.family }]) : cb(null, pin.address, pin.family)) as unknown as https.RequestOptions["lookup"],
        servername: url.hostname,
        timeout: 10_000,
      },
      (res) => {
        const status = res.statusCode ?? 0;
        let size = 0;
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => {
          size += c.byteLength;
          if (size <= 8192) chunks.push(c);
        });
        res.on("end", () => {
          if (status >= 200 && status < 300) return resolve({ ok: true });
          const text = Buffer.concat(chunks).toString("utf8").replace(/\s+/g, " ").slice(0, 160);
          if (status >= 300 && status < 400) return resolve({ ok: false, error: "De outreachtool stuurde door naar een ander adres; controleer de webhook-URL.", retryable: false });
          resolve({ ok: false, error: `De outreachtool weigerde (${status})${text ? `: ${text}` : ""}`, retryable: status === 429 || status >= 500 });
        });
        res.on("error", () => resolve({ ok: false, error: "De verbinding met de outreachtool werd verbroken.", retryable: true }));
      },
    );
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", () => resolve({ ok: false, error: "Geen verbinding met de outreachtool.", retryable: true }));
    req.end(body);
  });
}
