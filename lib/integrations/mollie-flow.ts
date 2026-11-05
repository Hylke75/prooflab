// Fase 2 · punt 4: de stappen rond een Mollie-betaling, los van Next.js en Supabase zodat ze met een nep-database en een
// nep-fetch te testen zijn. De routes (app/api/t/[slug]/pay en app/api/webhooks/mollie/[slug]) en de terugbetaalactie
// geven de echte afhankelijkheden mee.
//
// Kern van de beveiliging: de webhook levert alleen een betaalnummer. ProofLab zoekt dat nummer op bij déze test, haalt
// met de sleutel van die werkruimte zelf de status op bij Mollie en schrijft alleen wat Mollie zegt. Een vervalste
// webhook kan dus niets: een onbekend nummer telt niet, en een bekend nummer krijgt de echte status.

import { decryptSecret } from "@/lib/domain/secret-box";
import { MOLLIE_ID, mollieClient, type FetchLike, type MolliePayment, type MollieResult } from "./mollie";

export type RpcResult<T> = { data: T | null; error: { message: string; code?: string } | null };
export type MollieRpc = {
  depositCheckout(a: { slug: string; visitor: string; personKey: string; rateBucket: string }): Promise<RpcResult<unknown>>;
  registerPayment(a: { slug: string; personKey: string; mollieId: string; amount: number; currency: string; mode: string; status: string }): Promise<RpcResult<string>>;
  webhookLookup(a: { slug: string; mollieId: string }): Promise<RpcResult<unknown>>;
  recordStatus(a: { mollieId: string; status: string; mode: string }): Promise<RpcResult<string>>;
};

export type CheckoutOutcome =
  | { ok: true; checkoutUrl: string; mode: "test" | "live" }
  | { ok: false; reason: "closed" | "disabled" | "no_click" | "already_paid" | "rate" | "not_configured" | "mollie" | "error"; message: string };

const MESSAGES: Record<string, string> = {
  closed: "Dit onderzoek is gesloten.",
  disabled: "Reserveren met een aanbetaling is bij deze test niet mogelijk.",
  no_click: "Klik eerst op de knop op de pagina.",
  already_paid: "Je hebt al een aanbetaling gedaan. Dank je wel; je hoeft niets meer te doen.",
  rate: "Te veel pogingen achter elkaar. Probeer het over een minuut opnieuw.",
  not_configured: "Betalen is op dit moment niet ingesteld.",
  error: "Er ging iets mis. Probeer het later opnieuw.",
};

export async function startDeposit(deps: {
  rpc: MollieRpc;
  fetch: FetchLike;
  encryptionKey: Buffer | null;
  slug: string;
  visitor: string;
  personKey: string;
  rateBucket: string;
  appUrl: string;
  mollieBaseUrl?: string;
}): Promise<CheckoutOutcome> {
  if (!deps.encryptionKey) return { ok: false, reason: "not_configured", message: MESSAGES.not_configured };
  const { data, error } = await deps.rpc.depositCheckout({ slug: deps.slug, visitor: deps.visitor, personKey: deps.personKey, rateBucket: deps.rateBucket });
  if (error || !data) return { ok: false, reason: "error", message: MESSAGES.error };
  const c = data as { status?: string; cipher?: string; amount?: number | string; product?: string; experiment_id?: string };
  if (c.status !== "ok") {
    const reason = (["closed", "disabled", "no_click", "already_paid", "rate"].includes(c.status ?? "") ? c.status : "error") as Exclude<CheckoutOutcome, { ok: true }>["reason"];
    return { ok: false, reason, message: MESSAGES[reason] };
  }
  const apiKey = decryptSecret(c.cipher, deps.encryptionKey);
  const amount = Number(c.amount);
  if (!apiKey || !(amount > 0)) return { ok: false, reason: "not_configured", message: MESSAGES.not_configured };
  const base = deps.appUrl.replace(/\/$/, "");
  // Mollie bereikt geen localhost: lokaal zonder webhook (de consultant ververst de status dan zelf).
  const webhookUrl = /^https:\/\//.test(base) && !/localhost|127\.0\.0\.1/.test(base) ? `${base}/api/webhooks/mollie/${deps.slug}` : null;
  const client = mollieClient({ apiKey, fetch: deps.fetch, baseUrl: deps.mollieBaseUrl });
  const created = await client.createPayment({
    amount,
    description: `Terugbetaalbare aanbetaling: ${String(c.product ?? "onderzoek").slice(0, 120)}`,
    redirectUrl: `${base}/t/${deps.slug}?reservering=1`,
    webhookUrl,
    metadata: { test: deps.slug },
  });
  if (!created.ok || !created.value.checkoutUrl) return { ok: false, reason: "mollie", message: "De betaling kon niet worden gestart. Probeer het later opnieuw." };
  const p = created.value;
  const reg = await deps.rpc.registerPayment({ slug: deps.slug, personKey: deps.personKey, mollieId: p.id, amount, currency: p.currency, mode: p.mode, status: p.status });
  if (reg.error || reg.data !== "ok") return { ok: false, reason: reg.data === "closed" ? "closed" : "error", message: reg.data === "closed" ? MESSAGES.closed : MESSAGES.error };
  return { ok: true, checkoutUrl: p.checkoutUrl!, mode: p.mode };
}

export type WebhookOutcome = "ok" | "unchanged" | "unknown" | "invalid" | "mollie_error" | "not_configured" | "error";

// De webhook: alleen een id. Onbekend (bij deze test) → niets. Bekend → status bij Mollie ophalen en vastleggen.
export async function handleMollieWebhook(deps: {
  rpc: MollieRpc;
  fetch: FetchLike;
  encryptionKey: Buffer | null;
  slug: string;
  id: string;
  mollieBaseUrl?: string;
}): Promise<WebhookOutcome> {
  if (!MOLLIE_ID.test(deps.id) || !/^[a-f0-9]{14}$/.test(deps.slug)) return "invalid";
  if (!deps.encryptionKey) return "not_configured";
  const { data, error } = await deps.rpc.webhookLookup({ slug: deps.slug, mollieId: deps.id });
  if (error) return "error";
  if (!data) return "unknown";
  const apiKey = decryptSecret((data as { cipher?: string }).cipher, deps.encryptionKey);
  if (!apiKey) return "not_configured";
  return syncPayment({ rpc: deps.rpc, client: mollieClient({ apiKey, fetch: deps.fetch, baseUrl: deps.mollieBaseUrl }), id: deps.id });
}

// De status van één betaling opnieuw ophalen bij Mollie en vastleggen (webhook, terugbetalen, "ververs").
export async function syncPayment(deps: { rpc: MollieRpc; client: ReturnType<typeof mollieClient>; id: string }): Promise<WebhookOutcome> {
  const r: MollieResult<MolliePayment> = await deps.client.getPayment(deps.id);
  if (!r.ok) return "mollie_error";
  const rec = await deps.rpc.recordStatus({ mollieId: deps.id, status: r.value.status, mode: r.value.mode });
  if (rec.error) return "error";
  return rec.data === "ok" ? "ok" : rec.data === "unknown" ? "unknown" : "unchanged";
}

// Terugbetalen: eerst het verzoek bij Mollie, daarna de status opnieuw ophalen (die zegt "refunded" zodra het hele
// bedrag is terugbetaald). Al terugbetaald of niet betaald: niets doen.
export async function refundPayment(deps: { rpc: MollieRpc; client: ReturnType<typeof mollieClient>; payment: { mollie_id: string; amount: number; status: string } }): Promise<{ ok: boolean; message: string }> {
  if (deps.payment.status !== "paid") return { ok: false, message: "Alleen een betaalde aanbetaling kan worden terugbetaald." };
  const r = await deps.client.refund(deps.payment.mollie_id, Number(deps.payment.amount), "Terugbetaling aanbetaling onderzoek");
  if (!r.ok) return { ok: false, message: r.error };
  const s = await syncPayment({ rpc: deps.rpc, client: deps.client, id: deps.payment.mollie_id });
  return { ok: true, message: s === "ok" ? "Terugbetaald." : "Terugbetaling aangevraagd bij Mollie; de status volgt zodra Mollie hem verwerkt." };
}
