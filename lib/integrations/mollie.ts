// Fase 2 · punt 4: Mollie (API v2) voor terugbetaalbare aanbetalingen. Alleen wat ProofLab nodig heeft: een betaling
// maken, een betaling ophalen en terugbetalen. fetch is injecteerbaar: tests gebruiken een nep-fetch en er gaat in tests
// nooit een verzoek naar Mollie. De sleutel (test_… of live_…) hoort bij een werkruimte en komt nooit bij de browser.

export const MOLLIE_API = "https://api.mollie.com/v2";

export type MollieMode = "test" | "live";
// Onze status: die van Mollie, plus "refunded" en "charged_back" als het hele bedrag is terugbetaald of teruggeboekt.
export type PaymentStatus = "open" | "pending" | "authorized" | "paid" | "canceled" | "expired" | "failed" | "refunded" | "charged_back";

export const PAYMENT_STATUS_LABELS: Record<PaymentStatus, { label: string; pill: string }> = {
  open: { label: "Open (nog niet betaald)", pill: "gray" },
  pending: { label: "In behandeling", pill: "orange" },
  authorized: { label: "Geautoriseerd", pill: "orange" },
  paid: { label: "Betaald", pill: "green" },
  canceled: { label: "Geannuleerd", pill: "gray" },
  expired: { label: "Verlopen", pill: "gray" },
  failed: { label: "Mislukt", pill: "coral" },
  refunded: { label: "Terugbetaald", pill: "blue" },
  charged_back: { label: "Teruggeboekt", pill: "coral" },
};

const KEY = /^(test|live)_[A-Za-z0-9]{20,64}$/;

export function mollieKeyMode(key: string): MollieMode | null {
  const m = KEY.exec(key.trim());
  return m ? (m[1] as MollieMode) : null;
}

export const MOLLIE_ID = /^tr_[A-Za-z0-9]{4,40}$/;

export type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body?: string }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export type MolliePayment = {
  id: string;
  mode: MollieMode;
  status: PaymentStatus; // afgeleid, zie paymentStatusOf
  amount: number;
  currency: string;
  checkoutUrl: string | null;
};

type Money = { value?: unknown; currency?: unknown } | undefined;
const money = (m: Money): number => {
  const v = Number(typeof m?.value === "string" ? m.value : NaN);
  return Number.isFinite(v) ? v : 0;
};

// De status die telt: volledig terugbetaald of teruggeboekt telt niet meer, ook al zegt Mollie nog "paid".
export function paymentStatusOf(raw: { status?: unknown; amount?: Money; amountRefunded?: Money; amountChargedBack?: Money }): PaymentStatus | null {
  const s = typeof raw.status === "string" ? raw.status : "";
  const known: PaymentStatus[] = ["open", "pending", "authorized", "paid", "canceled", "expired", "failed"];
  if (!known.includes(s as PaymentStatus)) return null;
  const amount = money(raw.amount);
  if (money(raw.amountChargedBack) > 0) return "charged_back";
  if (amount > 0 && money(raw.amountRefunded) >= amount - 0.001) return "refunded";
  return s as PaymentStatus;
}

function parsePayment(json: unknown): MolliePayment | null {
  const p = json as { id?: unknown; mode?: unknown; amount?: Money; _links?: { checkout?: { href?: unknown } } } | null;
  if (!p || typeof p.id !== "string" || !MOLLIE_ID.test(p.id)) return null;
  const mode = p.mode === "live" ? "live" : p.mode === "test" ? "test" : null;
  const status = paymentStatusOf(p as Parameters<typeof paymentStatusOf>[0]);
  if (!mode || !status) return null;
  const href = p._links?.checkout?.href;
  return {
    id: p.id,
    mode,
    status,
    amount: money(p.amount),
    currency: typeof p.amount?.currency === "string" ? p.amount.currency : "EUR",
    checkoutUrl: typeof href === "string" && /^https:\/\//.test(href) ? href : null,
  };
}

export type MollieResult<T> = { ok: true; value: T } | { ok: false; error: string; status?: number };

export function mollieClient(opts: { apiKey: string; fetch: FetchLike; baseUrl?: string }) {
  const base = (opts.baseUrl ?? MOLLIE_API).replace(/\/$/, "");
  const call = async (method: string, path: string, body?: unknown): Promise<MollieResult<unknown>> => {
    try {
      const res = await opts.fetch(`${base}${path}`, {
        method,
        headers: { authorization: `Bearer ${opts.apiKey}`, "content-type": "application/json", accept: "application/json" },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        const detail = (json as { detail?: unknown } | null)?.detail;
        return { ok: false, status: res.status, error: res.status === 401 ? "Mollie weigert de sleutel (401)." : res.status === 404 ? "Mollie kent deze betaling niet (404)." : `Mollie gaf een fout (${res.status})${typeof detail === "string" ? `: ${detail.slice(0, 200)}` : ""}.` };
      }
      return { ok: true, value: json };
    } catch {
      return { ok: false, error: "Mollie is nu niet bereikbaar. Probeer het later opnieuw." };
    }
  };
  return {
    async createPayment(p: { amount: number; description: string; redirectUrl: string; webhookUrl: string | null; metadata: Record<string, string> }): Promise<MollieResult<MolliePayment>> {
      const r = await call("POST", "/payments", {
        amount: { currency: "EUR", value: p.amount.toFixed(2) },
        description: p.description.slice(0, 255),
        redirectUrl: p.redirectUrl,
        ...(p.webhookUrl ? { webhookUrl: p.webhookUrl } : {}),
        metadata: p.metadata,
      });
      if (!r.ok) return r;
      const pay = parsePayment(r.value);
      return pay ? { ok: true, value: pay } : { ok: false, error: "Onverwacht antwoord van Mollie." };
    },
    async getPayment(id: string): Promise<MollieResult<MolliePayment>> {
      if (!MOLLIE_ID.test(id)) return { ok: false, error: "Geen geldig Mollie-betaalnummer." };
      const r = await call("GET", `/payments/${encodeURIComponent(id)}`);
      if (!r.ok) return r;
      const pay = parsePayment(r.value);
      return pay && pay.id === id ? { ok: true, value: pay } : { ok: false, error: "Onverwacht antwoord van Mollie." };
    },
    async refund(id: string, amount: number, description: string): Promise<MollieResult<true>> {
      if (!MOLLIE_ID.test(id)) return { ok: false, error: "Geen geldig Mollie-betaalnummer." };
      const r = await call("POST", `/payments/${encodeURIComponent(id)}/refunds`, { amount: { currency: "EUR", value: amount.toFixed(2) }, description: description.slice(0, 140) });
      return r.ok ? { ok: true, value: true } : r;
    },
  };
}
export type MollieClient = ReturnType<typeof mollieClient>;

// De eerlijke tekst bij de betaalstap. Verplicht en niet aan te passen: het product bestaat nog niet en de aanbetaling
// wordt volledig terugbetaald.
export function depositText(amountEur: number, product: string, controller: string): string[] {
  const bedrag = `€ ${amountEur.toLocaleString("nl-NL", { minimumFractionDigits: amountEur % 1 ? 2 : 0, maximumFractionDigits: 2 })}`;
  return [
    `${product || "Dit aanbod"} bestaat nog niet: we onderzoeken of er genoeg belangstelling is om het te maken.`,
    `Wil je een plek reserveren? Dat kan met een aanbetaling van ${bedrag}. Dit is geen aankoop: ${controller || "de onderzoeker"} betaalt het volledige bedrag terug na afloop van het onderzoek, ook als je je bedenkt.`,
    "De betaling loopt via Mollie (iDEAL, kaart). We vragen je e-mailadres alleen om dubbele reserveringen te herkennen; we bewaren een versleutelde code, niet het adres zelf.",
  ];
}
