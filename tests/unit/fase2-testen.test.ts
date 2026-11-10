import { describe, expect, it, vi } from "vitest";
import { createHmac, randomBytes } from "node:crypto";
import { decryptSecret, encryptSecret, encryptionKey } from "@/lib/domain/secret-box";
import { depositText, mollieKeyMode, paymentStatusOf, type FetchLike } from "@/lib/integrations/mollie";
import { handleMollieWebhook, refundPayment, startDeposit, syncPayment, type MollieRpc } from "@/lib/integrations/mollie-flow";
import { mollieClient } from "@/lib/integrations/mollie";
import { bookingSecret, bookingTokenHash, calcomAdapter, calendlyAdapter, handleBookingWebhook, REPLAY_WINDOW_MS, type RecordBooking } from "@/lib/integrations/bookings";
import { countsFromRow, EMPTY_COUNTS, personKey, successesFor, systemObservationKind, systemObservationSummary, type ActionCounts } from "@/lib/domain/action-counts";
import { absoluteRuleAllowed, ctaFor, SUCCESS_METRIC_CARD } from "@/lib/domain/success-metric";
import { contentCodeProblem, pageFromTestCard, pricePointsFrom, promiseFrom, testLink } from "@/lib/domain/test-page-generator";
import { validateTestCard, type TestCardInput } from "@/lib/domain/test-card";
import { consentTextFor, contactProblem, privacyBlock, privacyNotice } from "@/lib/domain/test-privacy";
import { commitmentFieldErrors, commitmentPath, commitmentTokenHash, ipHash, newCommitmentToken, sniffMime, COMMITMENT_TOKEN } from "@/lib/domain/commitments";
import { verdictV2 } from "@/lib/domain/stats";
import { testEvidenceLevel } from "@/lib/domain/evidence";
import { metricFitsAssumption } from "@/lib/domain/assumption-kind";
import { evaluateRules, NOT_DONE, RULE_LABELS, type CoachFacts } from "@/lib/coach/rules";

// Fase 2 · punt 4: testen uitvoeren in ProofLab. Alles met nep-afhankelijkheden: Mollie via een injecteerbare fetch,
// de database via een nep-RPC. Er gaat nooit een verzoek naar Mollie, Calendly of Cal.com.

const SALT = "test-salt";
const KEY = randomBytes(32);
const SLUG = "abcdef12345678";

// ---------------------------------------------------------------------------
// Versleutelde sleutel
// ---------------------------------------------------------------------------

describe("secret box (AES-256-GCM)", () => {
  it("versleutelt en ontsleutelt, en geeft null bij een verkeerde sleutel of aangepaste tekst", () => {
    const c = encryptSecret("live_abcdefghijklmnopqrstuvwxyz1234", KEY);
    expect(c).toMatch(/^v1:/);
    expect(c).not.toContain("live_");
    expect(decryptSecret(c, KEY)).toBe("live_abcdefghijklmnopqrstuvwxyz1234");
    expect(decryptSecret(c, randomBytes(32))).toBeNull();
    const parts = c.split(":");
    parts[3] = Buffer.from("andere tekst").toString("base64url");
    expect(decryptSecret(parts.join(":"), KEY)).toBeNull();
    expect(decryptSecret("onzin", KEY)).toBeNull();
  });
  it("accepteert alleen een sleutel van precies 32 bytes", () => {
    expect(encryptionKey(KEY.toString("base64"))).not.toBeNull();
    expect(encryptionKey(randomBytes(16).toString("base64"))).toBeNull();
    expect(encryptionKey("")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Mollie
// ---------------------------------------------------------------------------

describe("Mollie-status", () => {
  it("herkent test- en livesleutels", () => {
    expect(mollieKeyMode("test_dHar4XY7LxsDOtmnkVtjNVWXLSlXsM")).toBe("test");
    expect(mollieKeyMode("live_dHar4XY7LxsDOtmnkVtjNVWXLSlXsM")).toBe("live");
    expect(mollieKeyMode("sk_live_123")).toBeNull();
  });
  it("volledig terugbetaald of teruggeboekt telt niet meer als betaald; gedeeltelijk wel", () => {
    const amount = { value: "10.00", currency: "EUR" };
    expect(paymentStatusOf({ status: "paid", amount })).toBe("paid");
    expect(paymentStatusOf({ status: "paid", amount, amountRefunded: { value: "10.00" } })).toBe("refunded");
    expect(paymentStatusOf({ status: "paid", amount, amountRefunded: { value: "4.00" } })).toBe("paid");
    expect(paymentStatusOf({ status: "paid", amount, amountChargedBack: { value: "10.00" } })).toBe("charged_back");
    expect(paymentStatusOf({ status: "hacked", amount })).toBeNull();
  });
  it("de eerlijke tekst zegt dat het product nog niet bestaat en dat alles wordt terugbetaald", () => {
    const t = depositText(25, "ClubPost", "Stichting Sport").join(" ");
    expect(t).toMatch(/bestaat nog niet/);
    expect(t).toMatch(/volledige bedrag terug/);
    expect(t).toMatch(/€ 25/);
  });
});

type Payment = { mollie_id: string; status: string; mode: string; amount: number };

// Een nep-database met dezelfde regels als de RPC's in de migratie (lookup per test, status van Mollie, terugbetaald blijft).
function fakeRpc(opts: { checkout?: unknown; payments?: Payment[] } = {}) {
  const payments = opts.payments ?? [];
  const cipher = encryptSecret("live_dHar4XY7LxsDOtmnkVtjNVWXLSlXsM", KEY);
  const rpc: MollieRpc = {
    depositCheckout: vi.fn(async () => ({ data: opts.checkout ?? { status: "ok", cipher, amount: 10, product: "ClubPost", experiment_id: "e" }, error: null })),
    registerPayment: vi.fn(async (a) => {
      payments.push({ mollie_id: a.mollieId, status: a.status, mode: a.mode, amount: a.amount });
      return { data: "ok", error: null };
    }),
    webhookLookup: vi.fn(async (a) => ({ data: payments.some((p) => p.mollie_id === a.mollieId) && a.slug === SLUG ? { cipher } : null, error: null })),
    recordStatus: vi.fn(async (a) => {
      const p = payments.find((x) => x.mollie_id === a.mollieId);
      if (!p) return { data: "unknown", error: null };
      if (p.status === "refunded" || p.status === "charged_back" || (p.status === a.status && p.mode === a.mode)) return { data: "unchanged", error: null };
      p.status = a.status;
      p.mode = a.mode;
      return { data: "ok", error: null };
    }),
  };
  return { rpc, payments };
}

// Nep-Mollie: betalingen in een map; elk verzoek wordt vastgelegd.
function fakeMollie(store: Record<string, { status: string; mode: "test" | "live"; amount: string; refunded?: string }>) {
  const calls: { method: string; url: string; body?: unknown; auth: string }[] = [];
  let next = 1;
  const fetch: FetchLike = async (url, init) => {
    calls.push({ method: init.method, url, body: init.body ? JSON.parse(init.body) : undefined, auth: init.headers.authorization });
    const json = (status: number, body: unknown) => ({ ok: status < 400, status, json: async () => body });
    const m = /\/payments(?:\/(tr_[A-Za-z0-9]+))?(\/refunds)?$/.exec(url);
    if (!m) return json(404, {});
    const pay = (id: string) => {
      const p = store[id];
      return { resource: "payment", id, mode: p.mode, status: p.status, amount: { value: p.amount, currency: "EUR" }, ...(p.refunded ? { amountRefunded: { value: p.refunded, currency: "EUR" } } : {}), _links: { checkout: { href: `https://www.mollie.com/checkout/${id}` } } };
    };
    if (init.method === "POST" && !m[1]) {
      const id = `tr_test${next++}abc`;
      const body = JSON.parse(init.body ?? "{}") as { amount: { value: string } };
      store[id] = { status: "open", mode: init.headers.authorization.includes("test_") ? "test" : "live", amount: body.amount.value };
      return json(201, pay(id));
    }
    if (!m[1] || !store[m[1]]) return json(404, { detail: "Not found" });
    if (m[2] && init.method === "POST") {
      store[m[1]].refunded = store[m[1]].amount;
      return json(201, { resource: "refund" });
    }
    return json(200, pay(m[1]));
  };
  return { fetch, calls };
}

describe("Mollie-webhook en betaalstroom", () => {
  it("een webhook met een onbekend id telt niets en vraagt niets aan Mollie", async () => {
    const { rpc } = fakeRpc();
    const { fetch, calls } = fakeMollie({});
    expect(await handleMollieWebhook({ rpc, fetch, encryptionKey: KEY, slug: SLUG, id: "tr_onbekend1" })).toBe("unknown");
    expect(calls).toHaveLength(0);
    expect(rpc.recordStatus).not.toHaveBeenCalled();
    expect(await handleMollieWebhook({ rpc, fetch, encryptionKey: KEY, slug: SLUG, id: "geen-id" })).toBe("invalid");
  });

  it("een vervalste webhook kan geen betaling op betaald zetten: de status komt van Mollie zelf", async () => {
    const { rpc, payments } = fakeRpc({ payments: [{ mollie_id: "tr_abc12345", status: "open", mode: "live", amount: 10 }] });
    const { fetch, calls } = fakeMollie({ tr_abc12345: { status: "open", mode: "live", amount: "10.00" } });
    // Iemand roept de webhook aan voor een bestaand id, maar bij Mollie is de betaling nog open.
    expect(await handleMollieWebhook({ rpc, fetch, encryptionKey: KEY, slug: SLUG, id: "tr_abc12345" })).toBe("unchanged");
    expect(payments[0].status).toBe("open");
    expect(calls[0]).toMatchObject({ method: "GET", url: "https://api.mollie.com/v2/payments/tr_abc12345" });
    expect(calls[0].auth).toBe("Bearer live_dHar4XY7LxsDOtmnkVtjNVWXLSlXsM");
    // Een andere test (slug) kent het id niet.
    expect(await handleMollieWebhook({ rpc, fetch, encryptionKey: KEY, slug: "ffffffffffffff", id: "tr_abc12345" })).toBe("unknown");
  });

  it("legt betaald vast als Mollie dat zegt, en terugbetaald telt daarna nooit meer", async () => {
    const store = { tr_abc12345: { status: "paid", mode: "live" as const, amount: "10.00" } };
    const { rpc, payments } = fakeRpc({ payments: [{ mollie_id: "tr_abc12345", status: "open", mode: "live", amount: 10 }] });
    const { fetch } = fakeMollie(store);
    expect(await handleMollieWebhook({ rpc, fetch, encryptionKey: KEY, slug: SLUG, id: "tr_abc12345" })).toBe("ok");
    expect(payments[0].status).toBe("paid");
    const client = mollieClient({ apiKey: "live_dHar4XY7LxsDOtmnkVtjNVWXLSlXsM", fetch });
    const r = await refundPayment({ rpc, client, payment: { mollie_id: "tr_abc12345", amount: 10, status: "paid" } });
    expect(r.ok).toBe(true);
    expect(payments[0].status).toBe("refunded");
    // Een latere (of afgespeelde) melding "paid" maakt het niet weer betaald.
    expect(await rpc.recordStatus({ mollieId: "tr_abc12345", status: "paid", mode: "live" })).toEqual({ data: "unchanged", error: null });
    expect(payments[0].status).toBe("refunded");
    // Een niet-betaalde betaling kan niet worden terugbetaald.
    expect((await refundPayment({ rpc, client, payment: { mollie_id: "tr_abc12345", amount: 10, status: "open" } })).ok).toBe(false);
  });

  it("start een betaling met het bedrag uit de database, met redirect en webhook naar deze test", async () => {
    const { rpc, payments } = fakeRpc();
    const { fetch, calls } = fakeMollie({});
    const out = await startDeposit({ rpc, fetch, encryptionKey: KEY, slug: SLUG, visitor: "v".repeat(32), personKey: "a".repeat(64), rateBucket: "b", appUrl: "https://prooflab.example" });
    expect(out).toMatchObject({ ok: true, mode: "live" });
    expect(calls[0].body).toMatchObject({
      amount: { currency: "EUR", value: "10.00" },
      redirectUrl: `https://prooflab.example/t/${SLUG}?reservering=1`,
      webhookUrl: `https://prooflab.example/api/webhooks/mollie/${SLUG}`,
    });
    expect(JSON.stringify(calls[0].body)).not.toContain("@");
    expect(payments[0]).toMatchObject({ status: "open", mode: "live", amount: 10 });
  });

  it("vraagt Mollie niets als dezelfde persoon al betaald heeft, de test dicht is of er niet geklikt is", async () => {
    for (const status of ["already_paid", "closed", "no_click", "disabled"]) {
      const { rpc } = fakeRpc({ checkout: { status } });
      const { fetch, calls } = fakeMollie({});
      const out = await startDeposit({ rpc, fetch, encryptionKey: KEY, slug: SLUG, visitor: "v", personKey: "a".repeat(64), rateBucket: "b", appUrl: "https://x.nl" });
      expect(out).toMatchObject({ ok: false, reason: status });
      expect(calls).toHaveLength(0);
    }
    const { rpc } = fakeRpc();
    expect(await startDeposit({ rpc, fetch: fakeMollie({}).fetch, encryptionKey: null, slug: SLUG, visitor: "v", personKey: "a", rateBucket: "b", appUrl: "https://x.nl" })).toMatchObject({ ok: false, reason: "not_configured" });
  });

  it("lokaal (localhost) zonder webhook; testsleutel geeft een betaling in testmodus", async () => {
    const cipher = encryptSecret("test_dHar4XY7LxsDOtmnkVtjNVWXLSlXsM", KEY);
    const { rpc, payments } = fakeRpc({ checkout: { status: "ok", cipher, amount: 5, product: "X" } });
    const { fetch, calls } = fakeMollie({});
    const out = await startDeposit({ rpc, fetch, encryptionKey: KEY, slug: SLUG, visitor: "v", personKey: "a".repeat(64), rateBucket: "b", appUrl: "http://localhost:3000" });
    expect(out).toMatchObject({ ok: true, mode: "test" });
    expect((calls[0].body as { webhookUrl?: string }).webhookUrl).toBeUndefined();
    expect(payments[0].mode).toBe("test");
  });

  it("verversen haalt de status bij Mollie op; een fout van Mollie verandert niets", async () => {
    const { rpc, payments } = fakeRpc({ payments: [{ mollie_id: "tr_abc12345", status: "open", mode: "live", amount: 10 }] });
    const client = mollieClient({ apiKey: "live_x", fetch: fakeMollie({}).fetch });
    expect(await syncPayment({ rpc, client, id: "tr_abc12345" })).toBe("mollie_error");
    expect(payments[0].status).toBe("open");
  });
});

// ---------------------------------------------------------------------------
// Afspraken (Calendly en Cal.com)
// ---------------------------------------------------------------------------

const TOKEN = "A".repeat(43);
const NOW = Date.parse("2026-11-05T10:00:00Z");

function calendlyBody(event: "invitee.created" | "invitee.canceled", uri = "https://api.calendly.com/scheduled_events/E1/invitees/I1", email = "Bestuur@Club.nl") {
  return JSON.stringify({
    event,
    created_at: "2026-11-05T09:59:00.000000Z",
    payload: { uri, email, status: event === "invitee.canceled" ? "canceled" : "active", created_at: "2026-11-05T09:59:00.000000Z", scheduled_event: { start_time: "2026-11-12T14:00:00.000000Z" } },
  });
}
function calendlyHeaders(body: string, secret: string, t = Math.floor(NOW / 1000)) {
  const sig = createHmac("sha256", secret).update(`${t}.${body}`).digest("hex");
  return (n: string) => (n === "calendly-webhook-signature" ? `t=${t},v1=${sig}` : null);
}
function calcomBody(trigger: string, uid = "bk_1", createdAt = new Date(NOW - 60_000).toISOString(), email = "info@club.nl") {
  return JSON.stringify({ triggerEvent: trigger, createdAt, payload: { uid, startTime: "2026-11-12T14:00:00Z", attendees: [{ email, name: "X" }] } });
}
const calcomHeaders = (body: string, secret: string) => (n: string) => (n === "x-cal-signature-256" ? createHmac("sha256", secret).update(body).digest("hex") : null);

// Nep-database met de regels van record_test_booking: uniek per aanbieder + id, geannuleerd blijft geannuleerd.
function fakeBookings() {
  const rows = new Map<string, { person: string; status: "booked" | "cancelled" }>();
  const record: RecordBooking = vi.fn(async (a) => {
    if (a.tokenHash !== bookingTokenHash(TOKEN)) return { data: "unknown", error: null };
    const k = `${a.provider}|${a.externalId}`;
    const r = rows.get(k);
    if (r) {
      if (a.status === "cancelled" && r.status === "booked") {
        r.status = "cancelled";
        return { data: "ok", error: null };
      }
      return { data: "duplicate", error: null };
    }
    if (a.status === "cancelled") return { data: "ignored", error: null };
    rows.set(k, { person: a.personKey, status: "booked" });
    return { data: "ok", error: null };
  });
  const bookers = () => new Set([...rows.values()].filter((r) => r.status === "booked").map((r) => r.person)).size;
  return { record, bookers };
}

const hook = (provider: string, rawBody: string, headers: (n: string) => string | null, record: RecordBooking, nowMs = NOW, token = TOKEN) =>
  handleBookingWebhook({ provider, token, headers, rawBody, salt: SALT, nowMs, personKey: (e) => personKey(SALT, e), record });

describe("afspraken-webhooks", () => {
  const calSecret = bookingSecret(SALT, "calendly", TOKEN);
  const comSecret = bookingSecret(SALT, "calcom", TOKEN);

  it("Calendly: een geldige handtekening telt een geboekte afspraak, per persoon één keer", async () => {
    const db = fakeBookings();
    const b1 = calendlyBody("invitee.created");
    expect(await hook("calendly", b1, calendlyHeaders(b1, calSecret), db.record)).toEqual({ status: 200, result: "ok" });
    // Dezelfde melding nog eens: dubbel.
    expect((await hook("calendly", b1, calendlyHeaders(b1, calSecret), db.record)).result).toBe("duplicate");
    // Tweede afspraak van dezelfde persoon (andere hoofdletters): telt niet extra.
    const b2 = calendlyBody("invitee.created", "https://api.calendly.com/scheduled_events/E2/invitees/I2", "bestuur@club.nl ");
    expect((await hook("calendly", b2, calendlyHeaders(b2, calSecret), db.record)).result).toBe("ok");
    expect(db.bookers()).toBe(1);
  });

  it("weigert een vervalste of ontbrekende handtekening en telt dan niets", async () => {
    const db = fakeBookings();
    const b = calendlyBody("invitee.created");
    expect(await hook("calendly", b, calendlyHeaders(b, "verkeerde-sleutel"), db.record)).toEqual({ status: 401, result: "bad_signature" });
    expect(await hook("calendly", b, () => null, db.record)).toEqual({ status: 401, result: "missing_signature" });
    // Handtekening van Cal.com op een Calendly-adres (andere sleutel per aanbieder).
    expect((await hook("calendly", b, calendlyHeaders(b, comSecret), db.record)).status).toBe(401);
    // Body aangepast na ondertekenen.
    expect((await hook("calendly", b.replace("Bestuur", "Iemand"), calendlyHeaders(b, calSecret), db.record)).result).toBe("bad_signature");
    const c = calcomBody("BOOKING_CREATED");
    expect((await hook("calcom", c, calcomHeaders(c, "fout"), db.record)).status).toBe(401);
    expect(db.record).not.toHaveBeenCalled();
    expect(db.bookers()).toBe(0);
  });

  it("weigert een oude melding (replay) buiten het tijdsvenster", async () => {
    const db = fakeBookings();
    const b = calendlyBody("invitee.created");
    const old = Math.floor((NOW - REPLAY_WINDOW_MS - 60_000) / 1000);
    expect(await hook("calendly", b, calendlyHeaders(b, calSecret, old), db.record)).toEqual({ status: 401, result: "stale" });
    const c = calcomBody("BOOKING_CREATED", "bk_1", new Date(NOW - REPLAY_WINDOW_MS - 60_000).toISOString());
    expect(await hook("calcom", c, calcomHeaders(c, comSecret), db.record)).toEqual({ status: 401, result: "stale" });
    expect(db.record).not.toHaveBeenCalled();
  });

  it("een geannuleerde afspraak telt niet, ook niet na een afgespeelde boeking", async () => {
    const db = fakeBookings();
    const created = calcomBody("BOOKING_CREATED", "bk_9");
    expect((await hook("calcom", created, calcomHeaders(created, comSecret), db.record)).result).toBe("ok");
    expect(db.bookers()).toBe(1);
    const cancelled = calcomBody("BOOKING_CANCELLED", "bk_9");
    expect((await hook("calcom", cancelled, calcomHeaders(cancelled, comSecret), db.record)).result).toBe("ok");
    expect(db.bookers()).toBe(0);
    expect((await hook("calcom", created, calcomHeaders(created, comSecret), db.record)).result).toBe("duplicate");
    expect(db.bookers()).toBe(0);
    // Calendly-annulering.
    const cb = calendlyBody("invitee.created");
    await hook("calendly", cb, calendlyHeaders(cb, calSecret), db.record);
    const cc = calendlyBody("invitee.canceled");
    expect((await hook("calendly", cc, calendlyHeaders(cc, calSecret), db.record)).result).toBe("ok");
    expect(db.bookers()).toBe(0);
  });

  it("onbekende code, aanbieder of gebeurtenis telt niets", async () => {
    const db = fakeBookings();
    const other = "B".repeat(43);
    const b = calendlyBody("invitee.created");
    const sig = (n: string) => (n === "calendly-webhook-signature" ? `t=${Math.floor(NOW / 1000)},v1=${createHmac("sha256", bookingSecret(SALT, "calendly", other)).update(`${Math.floor(NOW / 1000)}.${b}`).digest("hex")}` : null);
    expect(await hook("calendly", b, sig, db.record, NOW, other)).toEqual({ status: 404, result: "unknown" });
    expect((await hook("zoom", b, calendlyHeaders(b, calSecret), db.record)).status).toBe(404);
    const ping = JSON.stringify({ event: "routing_form_submission.created", payload: {} });
    expect((await hook("calendly", ping, calendlyHeaders(ping, calSecret), db.record)).result).toBe("ignored");
    expect(db.bookers()).toBe(0);
  });

  it("adapters lezen id, e-mail, status en tijden", () => {
    expect(calendlyAdapter.parse(JSON.parse(calendlyBody("invitee.created")))).toMatchObject({ kind: "booking", status: "booked", scheduledFor: "2026-11-12T14:00:00.000Z" });
    expect(calcomAdapter.parse(JSON.parse(calcomBody("BOOKING_CANCELLED")))).toMatchObject({ kind: "booking", externalId: "bk_1", status: "cancelled", email: "info@club.nl" });
    expect(calcomAdapter.parse({ triggerEvent: "MEETING_ENDED", payload: {} })).toMatchObject({ kind: "ignored" });
  });
});

// ---------------------------------------------------------------------------
// Per persoon tellen en de automatische waarneming
// ---------------------------------------------------------------------------

const counts = (over: Partial<ActionCounts>): ActionCounts => ({ ...EMPTY_COUNTS, ...over });

describe("per persoon tellen", () => {
  it("één persoonssleutel per genormaliseerd e-mailadres", () => {
    expect(personKey(SALT, "Bestuur@Club.NL ")).toBe(personKey(SALT, "bestuur@club.nl"));
    expect(personKey(SALT, "bestuur@club.nl")).toMatch(/^[a-f0-9]{64}$/);
    expect(personKey(SALT, "geen adres")).toBeNull();
    expect(personKey("", "a@b.nl")).toBeNull();
  });
  it("successen volgen de succesmaat; testmodus, terugbetaald en geannuleerd zitten niet in de telling", () => {
    const c = counts({ visitors: 100, clickers: 20, submitters: 8, payers: 3, testPayers: 4, refunded: 2, committers: 2, bookers: 5, cancelledBookings: 1 });
    expect(successesFor("signup", c, { collectEmail: true })).toBe(8);
    expect(successesFor("signup", c, { collectEmail: false })).toBe(20);
    expect(successesFor("payment", c, { collectEmail: true })).toBe(3);
    expect(successesFor("commitment", c, { collectEmail: true })).toBe(2);
    expect(successesFor("booking", c, { collectEmail: true })).toBe(5);
    expect(countsFromRow({ visitors: "7", payers: 2, test_payers: 1, cancelled_bookings: "3" })).toMatchObject({ visitors: 7, payers: 2, testPayers: 1, cancelledBookings: 3 });
  });
  it("de systeemwaarneming heet expliciet Waargenomen handeling of Geverifieerde betaling/toezegging", () => {
    expect(systemObservationKind("landing", "signup", true)).toEqual({ kind: "demo_request", evidenceType: "observed_action" });
    expect(systemObservationKind("landing", "signup", false)).toEqual({ kind: "waitlist_signup", evidenceType: "observed_action" });
    expect(systemObservationKind("pricing", "payment", false)).toEqual({ kind: "deposit", evidenceType: "verified_transaction" });
    expect(systemObservationKind("landing", "commitment", false)).toEqual({ kind: "quote_request", evidenceType: "verified_commitment" });
    expect(systemObservationKind("landing", "booking", false)).toEqual({ kind: "demo_request", evidenceType: "observed_action" });
    expect(systemObservationKind("survey", "signup", false).evidenceType).toBeNull();
    const s = systemObservationSummary({ type: "landing", metric: "signup", counts: counts({ visitors: 120, clickers: 34, submitters: 12 }), successes: 12, n: 120, metricLabel: "Demo-aanvraag", interval: "10,0%" });
    expect(s).toMatch(/^Waargenomen handeling, automatisch per persoon geteld: 120 unieke bezoekers, 34 unieke klikkers, 12 unieke aanmelders\./);
    const p = systemObservationSummary({ type: "pricing", metric: "payment", counts: counts({ visitors: 50, payers: 3, testPayers: 2, refunded: 1 }), successes: 3, n: 50, metricLabel: "Betaalde aanbetaling", interval: "6%" });
    expect(p).toMatch(/^Geverifieerde betaling/);
    expect(p).toMatch(/3 unieke betalers \(live\)/);
    expect(p).toMatch(/terugbetaalde betaling telt niet/);
    expect(p).toMatch(/testmodus tellen niet/);
  });
});

// ---------------------------------------------------------------------------
// Beslisregels met betalingen
// ---------------------------------------------------------------------------

describe("beslisregel met betalingen", () => {
  const base = { successThresholdPct: 5, failThresholdPct: 2, minSample: 40, endConditionReached: true };
  it("vast aantal: 3 betaalde aanbetalingen = geslaagd, ongeacht dubbele betalingen of testmodus", () => {
    // Twee betalingen van dezelfde persoon en vier in testmodus: de database telt 2 unieke live betalers.
    const c = counts({ visitors: 60, payers: 2, testPayers: 4 });
    const under = verdictV2({ ...base, rule: "absolute", successCount: 3, successes: successesFor("payment", c, { collectEmail: false }), n: c.visitors });
    expect(under.kind).toBe("fail");
    const c3 = counts({ visitors: 60, payers: 3 });
    const pass = verdictV2({ ...base, rule: "absolute", successCount: 3, successes: successesFor("payment", c3, { collectEmail: false }), n: c3.visitors });
    expect(pass.kind).toBe("pass");
    expect(pass.reason).toMatch(/gehaald: 3/);
    // Een terugbetaling haalt de telling weer onder het aantal.
    const after = counts({ visitors: 60, payers: 2, refunded: 1 });
    expect(verdictV2({ ...base, rule: "absolute", successCount: 3, successes: successesFor("payment", after, { collectEmail: false }), n: after.visitors }).kind).toBe("fail");
  });
  it("kansregel: unieke betalers als successen en unieke bezoekers als n", () => {
    const strong = counts({ visitors: 100, payers: 15 });
    const v = verdictV2({ ...base, rule: "probability", successes: successesFor("payment", strong, { collectEmail: true }), n: strong.visitors });
    expect(v.kind).toBe("pass");
    expect(v.probability).toBeGreaterThan(0.8);
    const weak = counts({ visitors: 100, payers: 0, testPayers: 30 });
    expect(verdictV2({ ...base, rule: "probability", successes: successesFor("payment", weak, { collectEmail: true }), n: weak.visitors }).kind).toBe("fail");
    // Geen uitspraak vóór de eindconditie.
    expect(verdictV2({ ...base, endConditionReached: false, rule: "probability", successes: 15, n: 100 }).kind).toBe("running");
  });
  it("de testkaart staat een vast aantal toe bij betaling, toezegging en afspraak, niet bij aanmelding", () => {
    expect(absoluteRuleAllowed("landing", "payment")).toBe(true);
    expect(absoluteRuleAllowed("pricing", "commitment")).toBe(true);
    expect(absoluteRuleAllowed("landing", "booking")).toBe(true);
    expect(absoluteRuleAllowed("landing", "signup")).toBe(false);
    expect(absoluteRuleAllowed("survey", "payment")).toBe(false);
    expect(absoluteRuleAllowed("interview", null)).toBe(true);
    const card: TestCardInput = {
      type: "landing", title: "Reserveringen", we_believe: "Sportclubs reserveren met een aanbetaling", target_group: "Sportclubs", test_method: "landingpagina",
      metric_label: SUCCESS_METRIC_CARD.payment.metric_label, metric_numerator: SUCCESS_METRIC_CARD.payment.metric_numerator, metric_denominator: SUCCESS_METRIC_CARD.payment.metric_denominator,
      success_threshold_pct: 7.5, fail_threshold_pct: null, min_sample: 40, max_duration_days: 21, rule: "absolute", success_count: 3, thresholds_locked: true,
      recruitment_group: "cold", channels: ["linkedin"], headline: "Reserveer je plek", price_points: 0, guide_questions: 0,
      privacy_controller: "Stichting Sport", privacy_contact: "privacy@sport.nl", success_metric: "payment", deposit_enabled: true,
    };
    expect(validateTestCard(card)).toEqual({});
    expect(validateTestCard({ ...card, success_metric: "signup" }).success_count).toMatch(/Kies de kansregel/);
    expect(validateTestCard({ ...card, deposit_enabled: false }).success_metric).toMatch(/betaalstap/);
    expect(validateTestCard({ ...card, privacy_contact: "" }).privacy_contact).toBeTruthy();
    expect(validateTestCard({ ...card, privacy_controller: "" }).privacy_controller).toBeTruthy();
  });
  it("bewijsniveau en prijsaanname volgen de succesmaat", () => {
    expect(testEvidenceLevel("landing", { successMetric: "payment" })).toBe("deposit");
    expect(testEvidenceLevel("landing", { successMetric: "commitment" })).toBe("quote");
    expect(testEvidenceLevel("landing", { successMetric: "booking" })).toBe("small_action");
    expect(testEvidenceLevel("landing")).toBe("small_action");
    expect(metricFitsAssumption("price", { type: "landing", metric_label: "Aanmelding", metric_numerator: "aanmelders", success_metric: "payment" }).ok).toBe(true);
    expect(metricFitsAssumption("price", { type: "landing", metric_label: "Aanmelding", metric_numerator: "aanmelders", success_metric: "signup" }).ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Generator, linkbouwer, privacy, toezeggingen, coach
// ---------------------------------------------------------------------------

describe("testpagina uit de testkaart", () => {
  it("vult kop, ondertitel, aanbod en knoptekst uit hypothese, doelgroep en intake", () => {
    const g = pageFromTestCard({
      type: "landing",
      weBelieve: "Wij denken dat sportclubs hun nieuwsbrief door AI laten schrijven, omdat vrijwilligers weinig tijd hebben.",
      targetGroup: "amateursportclubs",
      ideaTitle: "ClubPost",
      description: "",
      intakePrice: null,
      successMetric: "booking",
    });
    expect(g.headline).toBe("Sportclubs hun nieuwsbrief door AI laten schrijven");
    expect(g.subline).toBe("Voor amateursportclubs: vrijwilligers weinig tijd hebben.");
    expect(g.cta_label).toBe(ctaFor("landing", "booking"));
    expect(g.product_name).toBe("ClubPost");
    expect(g.notes.length).toBeGreaterThan(2);
  });
  it("prijspunten rond de intakeprijs, nooit verzonnen zonder prijs; de eerlijkheidscontrole kijkt mee", () => {
    expect(pricePointsFrom({ amount: 100, period: "per maand", text: "€ 100 per maand" }).map((p) => p.amount)).toEqual(["80", "100", "125"]);
    expect(pricePointsFrom(null).every((p) => p.amount === "")).toBe(true);
    const g = pageFromTestCard({ type: "pricing", weBelieve: "x", targetGroup: "", ideaTitle: "Y", description: "Gegarandeerd 100% meer leden, nu beschikbaar.", intakePrice: null });
    expect(g.warnings.length).toBeGreaterThanOrEqual(2);
    expect(promiseFrom("We denken dat clubs betalen want het scheelt tijd")).toEqual({ main: "clubs betalen", reason: "het scheelt tijd" });
  });
  it("linkbouwer: utm_source per kanaal en alleen een schone berichtcode", () => {
    expect(testLink("https://p.nl/t/abc", "linkedin")).toBe("https://p.nl/t/abc?utm_source=linkedin");
    expect(testLink("https://p.nl/t/abc", "linkedin", "post-1")).toBe("https://p.nl/t/abc?utm_source=linkedin&utm_content=post-1");
    expect(testLink("https://p.nl/t/abc", "linkedin", "Post 1!")).toBe("https://p.nl/t/abc?utm_source=linkedin");
    expect(contentCodeProblem("post 1")).toBeTruthy();
    expect(contentCodeProblem("post-1")).toBeNull();
  });
});

describe("privacy op de testpagina", () => {
  it("12 maanden bewaartermijn en de verwerkingsverantwoordelijke in de AVG-tekst", () => {
    expect(consentTextFor("Bureau X")).toMatch(/12 maanden/);
    expect(consentTextFor("Bureau X")).not.toMatch(/180 dagen/);
    const n = privacyNotice({ controller_name: "Stichting Sport", controller_contact: "privacy@sport.nl" }, { deposit: true }).join(" ");
    expect(n).toMatch(/Verwerkingsverantwoordelijke: Stichting Sport/);
    expect(n).toMatch(/privacy@sport\.nl/);
    expect(n).toMatch(/Mollie/);
    expect(n).toMatch(/Autoriteit Persoonsgegevens/);
  });
  it("een nieuwe test zonder naam of contact gaat niet live; een oude test zonder privacyblok wel", () => {
    expect(privacyBlock({ privacy: { controller_name: "", controller_contact: "" } }, "landing")).toBeTruthy();
    expect(privacyBlock({ privacy: { controller_name: "Stichting", controller_contact: "06-12345678" } }, "landing")).toBeNull();
    expect(privacyBlock({ headline: "oud" }, "landing")).toBeNull();
    expect(privacyBlock({ privacy: { controller_name: "", controller_contact: "" } }, "interview")).toBeNull();
    expect(contactProblem("https://sport.nl/privacy")).toBeNull();
    expect(contactProblem("bel me")).toBeTruthy();
  });
});

describe("toezeggingen", () => {
  it("herkent het bestandstype aan de inhoud, niet aan de naam", () => {
    expect(sniffMime(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]))).toBe("application/pdf");
    expect(sniffMime(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBe("image/png");
    expect(sniffMime(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg");
    expect(sniffMime(new TextEncoder().encode("<html>"))).toBeNull();
  });
  it("pad, eenmalige code, gehashte IP en verplichte velden", () => {
    const idea = "11111111-1111-4111-8111-111111111111";
    const exp = "22222222-2222-4222-8222-222222222222";
    expect(commitmentPath(idea, exp, "33333333-3333-4333-8333-333333333333", "LOI Club ä.pdf")).toBe(`${idea}/${exp}/33333333-3333-4333-8333-333333333333-LOI-Club-a.pdf`);
    const t = newCommitmentToken();
    expect(t).toMatch(COMMITMENT_TOKEN);
    expect(commitmentTokenHash(t)).toMatch(/^[a-f0-9]{64}$/);
    expect(ipHash(SALT, "1.2.3.4")).not.toContain("1.2.3.4");
    expect(Object.keys(commitmentFieldErrors({ name: "", org: "C", email: "x" }))).toEqual(["signer_name", "signer_org", "signer_email"]);
  });
});

describe("coach: aanbetalingen terugbetalen", () => {
  const f = (over: Partial<CoachFacts>): CoachFacts => ({
    ideaId: "i", today: "2026-11-05", now: NOW, sprint: null, claims: [], competitorKinds: ["status_quo"], sourceTypes: [], assumptions: [], experiments: [], interviews: [],
    observations: [], learningCards: [], realityCheck: null, decisions: [], decisionDeadline: null, clientDeciderInvited: false,
    outcome: { defined: true, due: null, resolved: false, checkins: [] }, forecasts: [], outreach: { replies: 0, latestReplyAt: null, latestImportAt: null }, ...over,
  });
  it("herinnert pas na een besluit, en alleen zolang er betaalde aanbetalingen openstaan", () => {
    const codes = (x: CoachFacts) => evaluateRules(x).map((n) => n.code);
    expect(codes(f({ depositsOutstanding: 2 }))).not.toContain("deposits_refund");
    const decided = { decisions: [{ id: "d1", decidedAt: "2026-11-04", confirmed: true }] };
    expect(codes(f({ ...decided, depositsOutstanding: 2 }))).toContain("deposits_refund");
    expect(codes(f({ ...decided, depositsOutstanding: 0 }))).not.toContain("deposits_refund");
    expect(codes(f({ ...decided }))).not.toContain("deposits_refund");
    expect(RULE_LABELS.deposits_refund).toBeTruthy();
    expect(NOT_DONE.deposits_refund).toBeTruthy();
  });
});
