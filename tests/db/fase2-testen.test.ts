import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { emailHash } from "@/lib/domain/survey-tokens";

// Fase 2 · punt 4: testen uitvoeren (supabase/migrations/20261116090000_fase2_testen.sql). Draait tegen een
// wegwerp-Postgres (scripts/test-db.sh); overgeslagen zonder TEST_DATABASE_URL.
const url = process.env.TEST_DATABASE_URL;
const d = url ? describe : describe.skip;
const MIGRATION = readFileSync(path.join(process.cwd(), "supabase/migrations/20261116090000_fase2_testen.sql"), "utf8");

let db: Client;
type U = { id: string; email: string };
type Who = U | "anon";

async function as<T>(who: Who, fn: (c: Client) => Promise<T>): Promise<T> {
  await db.query("begin");
  try {
    if (who === "anon") {
      await db.query("set local role anon");
      await db.query("select set_config('request.jwt.claims', '', true)");
    } else {
      await db.query("set local role authenticated");
      await db.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: who.id, email: who.email, role: "authenticated" })]);
    }
    const out = await fn(db);
    await db.query("commit");
    return out;
  } catch (e) {
    await db.query("rollback");
    throw e;
  }
}

async function user(email: string): Promise<U> {
  const id = randomUUID();
  await db.query("insert into auth.users (id, email, email_confirmed_at) values ($1, $2, now())", [id, email]);
  return { id, email };
}

const ingestKey = "test-ingest-key";
const SALT = "test-salt";
const pk = (email: string) => emailHash(SALT, email);
const CIPHER = "v1:aaaaaaaaaaaaaaaa:bbbbbbbbbbbbbbbbbbbbbb:cccccccccccccccccccccccccccc";

type Opts = { privacy?: { controller_name: string; controller_contact: string } | null; deposit?: boolean; metric?: string; rule?: "absolute"; live?: boolean; org?: string };

async function landingTest(owner: U, o: Opts = {}) {
  return as(owner, async (c) => {
    const org = o.org ?? (await c.query("select public.create_organization('Bureau ' || $1) as id", [owner.email])).rows[0].id;
    const idea = (
      await c.query(
        `insert into public.ideas (org_id, title, decision_question, project_type, description, target_audience, region)
         values ($1, 'AI-communicatie voor sportclubs', 'Investeren we €25.000?', 'new_product', 'Beschrijving', 'Sportclubs', 'Nederland') returning id`,
        [org],
      )
    ).rows[0].id as string;
    const a = (await c.query("insert into public.assumptions (idea_id, statement, category, importance) values ($1, 'Clubs betalen voor communicatie', 'viability', 5) returning id", [idea])).rows[0].id;
    const h = (
      await c.query(
        `insert into public.hypotheses (idea_id, assumption_id, we_believe, target_group, test_method, metric_label, metric_numerator, metric_denominator,
           success_threshold_pct, min_sample, max_duration_days, decision_rule, success_count, success_metric)
         values ($1, $2, 'Clubs reserveren', 'Sportclubs', 'landingpagina', 'Betaalde aanbetaling', 'betalers', 'bezoekers', 7.5, 40, 21, $3, $4, $5) returning id`,
        [idea, a, o.rule ?? "probability", o.rule === "absolute" ? 3 : null, o.metric ?? null],
      )
    ).rows[0].id as string;
    const config: Record<string, unknown> = { headline: "Reserveer", cta_label: "Reserveer je plek", collect_email: true, product_name: "ClubPost", researcher: "Bureau" };
    if (o.privacy !== null) config.privacy = o.privacy ?? { controller_name: "Stichting Sport", controller_contact: "privacy@sport.nl" };
    if (o.deposit) config.deposit = { enabled: true, amount_eur: 10 };
    const e = (await c.query("insert into public.experiments (idea_id, hypothesis_id, type, title, config) values ($1, $2, 'landing', 'Reserveringstest', $3) returning id", [idea, h, JSON.stringify(config)])).rows[0].id as string;
    for (const s of ["ready_for_review", "approved"]) await c.query("update public.experiments set state = $2 where id = $1", [e, s]);
    const slug = (await c.query("select public_slug from public.experiments where id = $1", [e])).rows[0].public_slug as string;
    return { org: org as string, idea, h, e, slug };
  });
}

const goLive = (owner: U, e: string) => as(owner, (c) => c.query("update public.experiments set state = 'live' where id = $1", [e]));
const event = (slug: string, visitor: string, ev: string) =>
  as("anon", (c) => c.query("select public.record_test_event($1, $2, $3, $4, 'a', 'linkedin', $5)", [ingestKey, slug, visitor, ev, `bucket-${visitor}`]));
const counts = async (who: U, e: string) => (await as(who, (c) => c.query("select * from public.experiment_action_counts($1)", [e]))).rows[0];
const anonRpc = async (sql: string, params: unknown[]) => (await as("anon", (c) => c.query(sql, params))).rows[0];

d("fase 2 · punt 4: testen uitvoeren", () => {
  let alice: U;
  let klant: U;
  let bob: U;

  beforeAll(async () => {
    db = new Client({ connectionString: url });
    await db.connect();
    await db.query("insert into public.ingest_keys (key_hash) values ($1) on conflict do nothing", [createHash("sha256").update(ingestKey).digest("hex")]);
    alice = await user(`alice-${randomUUID()}@example.com`);
    klant = await user(`klant-${randomUUID()}@example.com`);
    bob = await user(`bob-${randomUUID()}@example.com`);
  });
  afterAll(async () => {
    await db?.end();
  });

  it("de migratie is idempotent", async () => {
    await db.query("begin");
    try {
      await db.query(MIGRATION.replace(/^begin;|commit;\s*$/gm, ""));
      await db.query(MIGRATION.replace(/^begin;|commit;\s*$/gm, ""));
    } finally {
      await db.query("rollback");
    }
  });

  it("een nieuwe test gaat pas live met verwerkingsverantwoordelijke; een oude test zonder privacyblok wel", async () => {
    const empty = await landingTest(alice, { privacy: { controller_name: "", controller_contact: "" } });
    await expect(goLive(alice, empty.e)).rejects.toThrow(/PRIVACY_CONTROLLER/);
    const old = await landingTest(alice, { privacy: null, org: empty.org });
    await goLive(alice, old.e);
    // Pauzeren en hervatten blijft werken.
    await as(alice, (c) => c.query("update public.experiments set state = 'paused' where id = $1", [old.e]));
    await as(alice, (c) => c.query("update public.experiments set state = 'live' where id = $1", [old.e]));
    const ok = await landingTest(alice, { org: empty.org });
    await goLive(alice, ok.e);
  });

  it("nieuwe aanmeldingen worden 12 maanden bewaard", async () => {
    const t = await landingTest(alice);
    await goLive(alice, t.e);
    await event(t.slug, "sub-1", "view");
    await event(t.slug, "sub-1", "cta_click");
    await as("anon", (c) =>
      c.query("select public.submit_test_form($1, $2, 'sub-1', 'a', 'linkedin', 'lid@club.nl', '{}'::jsonb, true, 'toestemming', 'b-sub', null)", [ingestKey, t.slug]),
    );
    const r = (await db.query("select retention_until - current_date as days from public.test_submissions where experiment_id = $1", [t.e])).rows[0];
    expect(Number(r.days)).toBeGreaterThanOrEqual(365);
  });

  it("de Mollie-sleutel: alleen een eigenaar, nooit terug te lezen; de betaalstap vraagt een sleutel", async () => {
    const t = await landingTest(alice, { deposit: true, metric: "payment" });
    await expect(goLive(alice, t.e)).rejects.toThrow(/DEPOSIT_NOT_CONFIGURED/);
    const eddie = await user(`eddie-${randomUUID()}@example.com`);
    await db.query("insert into public.organization_members (org_id, user_id, role) values ($1, $2, 'editor')", [t.org, eddie.id]);
    await expect(as(eddie, (c) => c.query("select public.set_mollie_key($1, $2, 'live', 'ab12')", [t.org, CIPHER]))).rejects.toThrow(/FORBIDDEN/);
    await expect(as(alice, (c) => c.query("select public.set_mollie_key($1, 'live_platte_tekst', 'live', 'ab12')", [t.org]))).rejects.toThrow(/INVALID_KEY/);
    await as(alice, (c) => c.query("select public.set_mollie_key($1, $2, 'live', 'ab12')", [t.org, CIPHER]));
    const status = (await as(eddie, (c) => c.query("select * from public.payment_settings_status($1)", [t.org]))).rows[0];
    expect(status).toMatchObject({ mollie_connected: true, mollie_mode: "live", mollie_key_hint: "ab12" });
    expect(JSON.stringify(status)).not.toContain(CIPHER);
    await expect(as(eddie, (c) => c.query("select * from public.org_payment_settings"))).rejects.toThrow(/permission denied/);
    const audit = (await db.query("select detail from public.audit_events where table_name = 'org_payment_settings' and org_id = $1", [t.org])).rows;
    expect(JSON.stringify(audit)).not.toContain(CIPHER);
    await goLive(alice, t.e);
  });

  it("aanbetalingen: per persoon één keer, testmodus en terugbetaald tellen niet, onbekend id telt niets", async () => {
    const t = await landingTest(alice, { deposit: true, metric: "payment" });
    await as(alice, (c) => c.query("select public.set_mollie_key($1, $2, 'live', 'ab12')", [t.org, CIPHER]));
    await goLive(alice, t.e);
    const checkout = (visitor: string, email: string) =>
      anonRpc("select public.deposit_checkout($1, $2, $3, $4, $5) as r", [ingestKey, t.slug, visitor, pk(email), `pay-${visitor}`]).then((r) => r.r);
    // Zonder klik op de knop geen betaling.
    expect((await checkout("v-geen-klik", "a@club.nl")).status).toBe("no_click");
    for (const v of ["v1", "v2", "v3"]) {
      await event(t.slug, v, "view");
      await event(t.slug, v, "cta_click");
    }
    const ok = await checkout("v1", "a@club.nl");
    expect(ok).toMatchObject({ status: "ok", cipher: CIPHER, mode: "live" });
    expect(Number(ok.amount)).toBe(10);
    const register = (id: string, email: string, mode = "live", amount = 10) =>
      anonRpc("select public.register_test_payment($1, $2, $3, $4, $5, 'EUR', $6, 'open') as r", [ingestKey, t.slug, pk(email), id, amount, mode]).then((r) => r.r);
    const status = (id: string, s: string, mode = "live") => anonRpc("select public.record_mollie_status($1, $2, $3, $4) as r", [ingestKey, id, s, mode]).then((r) => r.r);
    // Het bedrag komt uit de goedgekeurde configuratie.
    await expect(register("tr_fout0001", "a@club.nl", "live", 1)).rejects.toThrow(/AMOUNT_MISMATCH/);
    // Persoon A betaalt twee keer (bijv. twee tabbladen), persoon B in testmodus, persoon C live.
    expect(await register("tr_a0000001", "a@club.nl")).toBe("ok");
    expect(await register("tr_a0000002", "A@Club.nl".toLowerCase())).toBe("ok");
    expect(await register("tr_b0000001", "b@club.nl", "test")).toBe("ok");
    expect(await register("tr_c0000001", "c@club.nl")).toBe("ok");
    let n = await counts(alice, t.e);
    expect(Number(n.payers)).toBe(0); // open telt niet
    for (const id of ["tr_a0000001", "tr_a0000002", "tr_c0000001"]) expect(await status(id, "paid")).toBe("ok");
    expect(await status("tr_b0000001", "paid", "test")).toBe("ok");
    n = await counts(alice, t.e);
    expect(Number(n.payers)).toBe(2); // A en C, A één keer
    expect(Number(n.test_payers)).toBe(1);
    expect(Number(n.visitors)).toBe(3);
    // Al betaald: geen nieuwe betaling voor dezelfde persoon.
    expect((await checkout("v1", "a@club.nl")).status).toBe("already_paid");
    // Een webhook met een onbekend id, een id van een andere test of een verkeerde sleutel doet niets.
    expect((await anonRpc("select public.mollie_webhook_lookup($1, $2, 'tr_onbekend01') as r", [ingestKey, t.slug])).r).toBeNull();
    expect((await anonRpc("select public.mollie_webhook_lookup($1, 'ffffffffffffff', 'tr_c0000001') as r", [ingestKey])).r).toBeNull();
    expect((await anonRpc("select public.mollie_webhook_lookup($1, $2, 'tr_c0000001') as r", [ingestKey, t.slug])).r).toMatchObject({ cipher: CIPHER });
    await expect(anonRpc("select public.mollie_webhook_lookup('fout', $1, 'tr_c0000001') as r", [t.slug])).rejects.toThrow(/FORBIDDEN/);
    expect(await status("tr_onbekend01", "paid")).toBe("unknown");
    expect(Number((await counts(alice, t.e)).payers)).toBe(2);
    // Terugbetaald telt niet meer, ook niet na een (afgespeelde) "paid".
    await as(alice, async (c) => {
      const id = (await c.query("select id from public.test_payments where mollie_id = 'tr_c0000001'")).rows[0].id;
      await c.query("select public.mark_refund_requested($1)", [id]);
    });
    expect(await status("tr_c0000001", "refunded")).toBe("ok");
    expect(await status("tr_c0000001", "paid")).toBe("unchanged");
    n = await counts(alice, t.e);
    expect(Number(n.payers)).toBe(1);
    expect(Number(n.refunded)).toBe(1);
    expect(Number(n.unrefunded)).toBe(3); // twee van A (live) en één in testmodus
    // Niemand kan een status met de hand zetten of een betaling toevoegen.
    await expect(as(alice, (c) => c.query("update public.test_payments set status = 'paid' where mollie_id = 'tr_c0000001'"))).rejects.toThrow(/permission denied/);
    await expect(as(alice, (c) => c.query("insert into public.test_payments (experiment_id, idea_id, mollie_id, amount, status, mode, person_key) values ($1, $2, 'tr_nep00001', 10, 'paid', 'live', $3)", [t.e, t.idea, pk("x@y.nl")]))).rejects.toThrow(/permission denied/);
    const payId = (await db.query("select id from public.test_payments where mollie_id = 'tr_a0000001'")).rows[0].id;
    await expect(as(bob, (c) => c.query("select public.mark_refund_requested($1)", [payId]))).rejects.toThrow(/FORBIDDEN/);
    expect((await as(bob, (c) => c.query("select * from public.experiment_action_counts($1)", [t.e]))).rows).toHaveLength(0);
    // Het auditspoor kent de betalingen, zonder persoonssleutel.
    const audit = (await db.query("select detail from public.audit_events where table_name = 'test_payments' and idea_id = $1", [t.idea])).rows;
    expect(audit.length).toBeGreaterThan(0);
    expect(JSON.stringify(audit)).not.toContain(pk("c@club.nl"));
    // Een privacyverzoek vindt de betalingen op de persoonssleutel.
    const dsr = (await as(alice, (c) => c.query("select public.dsr_search($1, 'a@club.nl', $2) as r", [t.org, [pk("a@club.nl")]]))).rows[0].r;
    expect(dsr.test_payments).toHaveLength(2);
  });

  it("afspraken: geboekt telt per persoon, geannuleerd niet, een oude boeking maakt een annulering niet ongedaan", async () => {
    const t = await landingTest(alice, { metric: "booking", rule: "absolute" });
    await goLive(alice, t.e);
    const token = createHash("sha256").update(`hook-${randomUUID()}`).digest("hex");
    await as(alice, (c) => c.query("insert into public.test_booking_hooks (experiment_id, idea_id, provider, token_hash) values ($1, $2, 'calendly', $3)", [t.e, t.idea, token]));
    await expect(as(klant, (c) => c.query("insert into public.test_booking_hooks (experiment_id, idea_id, provider, token_hash) values ($1, $2, 'calcom', $3)", [t.e, t.idea, token]))).rejects.toThrow();
    const book = (ext: string, email: string, status = "booked", provider = "calendly", tok = token) =>
      anonRpc("select public.record_test_booking($1, $2, $3, $4, $5, $6, now(), now() + interval '7 days') as r", [ingestKey, tok, provider, ext, pk(email), status]).then((r) => r.r);
    expect(await book("I1", "voorzitter@club.nl")).toBe("ok");
    expect(await book("I1", "voorzitter@club.nl")).toBe("duplicate");
    expect(await book("I2", "voorzitter@club.nl")).toBe("ok"); // tweede afspraak, zelfde persoon
    expect(await book("I3", "secretaris@club.nl")).toBe("ok");
    expect(Number((await counts(alice, t.e)).bookers)).toBe(2);
    expect(await book("I3", "secretaris@club.nl", "cancelled")).toBe("ok");
    expect(await book("I3", "secretaris@club.nl", "booked")).toBe("duplicate"); // afgespeelde boeking
    const n = await counts(alice, t.e);
    expect(Number(n.bookers)).toBe(1);
    expect(Number(n.cancelled_bookings)).toBe(1);
    expect(await book("I9", "x@club.nl", "cancelled")).toBe("ignored");
    expect(await book("I1", "voorzitter@club.nl", "booked", "calcom")).toBe("unknown"); // geen Cal.com-koppeling
    expect(await book("I4", "x@club.nl", "booked", "calendly", "f".repeat(64))).toBe("unknown");
    await expect(anonRpc("select public.record_test_booking('fout', $1, 'calendly', 'I5', $2, 'booked', now(), null) as r", [token, pk("x@club.nl")])).rejects.toThrow(/FORBIDDEN/);
    // Schema dat punt 5 (werving) leest.
    const cols = (await db.query("select column_name from information_schema.columns where table_schema = 'public' and table_name = 'test_bookings'")).rows.map((r) => r.column_name);
    for (const col of ["experiment_id", "idea_id", "provider", "external_id", "person_key", "status", "booked_at", "scheduled_for", "created_at"]) expect(cols).toContain(col);
    // Opdrachtgever ziet aantallen, geen koppelingen.
    await as(alice, (c) => c.query("insert into public.idea_members (idea_id, email, role) values ($1, $2, 'client_decider')", [t.idea, klant.email]));
    await as(klant, (c) => c.query("select public.claim_invitations()"));
    expect(Number((await counts(klant, t.e)).bookers)).toBe(1);
    expect((await as(klant, (c) => c.query("select * from public.test_booking_hooks"))).rows).toHaveLength(0);
    // Na afloop van de test geen nieuwe boekingen meer; een annulering wel.
    await as(alice, (c) => c.query("update public.experiments set state = 'ended' where id = $1", [t.e]));
    expect(await book("I6", "nieuw@club.nl")).toBe("closed");
    expect(await book("I2", "voorzitter@club.nl", "cancelled")).toBe("ok");
  });

  it("toezeggingen: alleen met document of akkoord, eenmalige link, per persoon één keer", async () => {
    const t = await landingTest(alice, { metric: "commitment" });
    await goLive(alice, t.e);
    const path = `${t.idea}/${t.e}/${randomUUID()}-loi.pdf`;
    const upload = (p: string, email: string) =>
      as(alice, (c) =>
        c.query(
          "insert into public.test_commitments (experiment_id, idea_id, method, status, person_key, signer_name, signer_org, document_path, document_mime, document_size) values ($1, $2, 'upload', 'signed', $3, 'Piet Jansen', 'VV De Bal', $4, 'application/pdf', 1234) returning id",
          [t.e, t.idea, pk(email), p],
        ),
      );
    // Zonder bestand in de bucket geen toezegging.
    await expect(upload(path, "piet@debal.nl")).rejects.toThrow(/COMMITMENT_DOCUMENT/);
    await as(alice, (c) => c.query("insert into storage.objects (bucket_id, name, owner) values ('commitment-documents', $1, $2)", [path, alice.id]));
    await upload(path, "piet@debal.nl");
    // Een opdrachtgever ziet geen namen of documenten.
    await as(alice, (c) => c.query("insert into public.idea_members (idea_id, email, role) values ($1, $2, 'client_viewer')", [t.idea, klant.email]));
    await as(klant, (c) => c.query("select public.claim_invitations()"));
    expect((await as(klant, (c) => c.query("select * from public.test_commitments"))).rows).toHaveLength(0);
    expect((await as(klant, (c) => c.query("select * from storage.objects where bucket_id = 'commitment-documents'"))).rows).toHaveLength(0);
    // Persoonlijke link: begint als uitnodiging, ook als de app iets anders meestuurt.
    const tokenHash = createHash("sha256").update(`token-${randomUUID()}`).digest("hex");
    await as(alice, (c) =>
      c.query("insert into public.test_commitments (experiment_id, idea_id, method, status, person_key, signer_name, token_hash) values ($1, $2, 'link', 'signed', $3, 'Nep', $4)", [t.e, t.idea, pk("anna@hc.nl"), tokenHash]),
    );
    expect(Number((await counts(alice, t.e)).committers)).toBe(1);
    const invite = (await anonRpc("select public.get_commitment_invite($1, $2) as r", [ingestKey, tokenHash])).r;
    expect(invite).toMatchObject({ state: "open", product: "ClubPost" });
    expect(JSON.stringify(invite)).not.toContain("anna");
    const sign = (typed: string, consent = true) =>
      anonRpc("select public.sign_commitment($1, $2, 'Anna de Vries', 'HC Oranje', $3, $4, $5) as r", [ingestKey, tokenHash, typed, consent, "a".repeat(64)]).then((r) => r.r);
    expect(await sign("Anna de Vries", false)).toBe("invalid");
    expect(await sign("Iemand anders")).toBe("name_mismatch");
    expect(await sign("anna  de vries")).toBe("ok");
    expect(await sign("Anna de Vries")).toBe("used");
    const row = (await db.query("select status, signed_at, ip_hash, typed_name from public.test_commitments where token_hash = $1", [tokenHash])).rows[0];
    expect(row.status).toBe("signed");
    expect(row.signed_at).toBeTruthy();
    expect(row.ip_hash).toMatch(/^a{64}$/);
    // Tweede toezegging van dezelfde persoon telt niet extra.
    const path2 = `${t.idea}/${t.e}/${randomUUID()}-loi2.pdf`;
    await as(alice, (c) => c.query("insert into storage.objects (bucket_id, name, owner) values ('commitment-documents', $1, $2)", [path2, alice.id]));
    await upload(path2, "PIET@debal.nl".toLowerCase());
    expect(Number((await counts(alice, t.e)).committers)).toBe(2);
    // Een toezegging ligt vast; intrekken kan en telt dan niet meer.
    await expect(as(alice, (c) => c.query("update public.test_commitments set signer_org = 'Andere club' where token_hash = $1", [tokenHash]))).rejects.toThrow(/COMMITMENT_LOCKED/);
    await as(alice, (c) => c.query("update public.test_commitments set status = 'revoked' where token_hash = $1", [tokenHash]));
    expect(Number((await counts(alice, t.e)).committers)).toBe(1);
    // Het auditspoor bevat geen namen.
    const audit = (await db.query("select detail from public.audit_events where table_name = 'test_commitments' and idea_id = $1", [t.idea])).rows;
    expect(JSON.stringify(audit)).not.toMatch(/Anna de Vries|HC Oranje/);
  });

  it("de opschoning wist namen en persoonssleutels na de bewaartermijn; de telling blijft", async () => {
    const t = await landingTest(alice, { metric: "commitment" });
    await goLive(alice, t.e);
    const path = `${t.idea}/${t.e}/${randomUUID()}-loi.pdf`;
    await as(alice, (c) => c.query("insert into storage.objects (bucket_id, name, owner) values ('commitment-documents', $1, $2)", [path, alice.id]));
    await as(alice, (c) =>
      c.query(
        "insert into public.test_commitments (experiment_id, idea_id, method, status, person_key, signer_name, signer_org, document_path) values ($1, $2, 'upload', 'signed', $3, 'Piet', 'VV De Bal', $4)",
        [t.e, t.idea, pk("piet@debal.nl"), path],
      ),
    );
    await db.query("update public.test_commitments set retention_until = current_date - 1 where experiment_id = $1", [t.e]);
    await db.query("select public.purge_expired_personal_data()");
    const row = (await db.query("select signer_name, signer_org, purged_at, status from public.test_commitments where experiment_id = $1", [t.e])).rows[0];
    expect(row).toMatchObject({ signer_name: null, signer_org: null, status: "signed" });
    expect(row.purged_at).toBeTruthy();
    expect(Number((await counts(alice, t.e)).committers)).toBe(1);
    // Na de opschoning mag het team het bestand (en alleen de verwijzing) weghalen.
    await as(alice, (c) => c.query("update public.test_commitments set document_path = null where experiment_id = $1", [t.e]));
  });

  it("de succesmaat ligt vast na goedkeuring", async () => {
    const t = await landingTest(alice, { metric: "payment" });
    await expect(as(alice, (c) => c.query("update public.hypotheses set success_metric = 'signup' where id = $1", [t.h]))).rejects.toThrow(/HYPOTHESIS_LOCKED/);
    await expect(as(alice, (c) => c.query("update public.hypotheses set success_metric = 'iets' where id = $1", [t.h]))).rejects.toThrow();
  });

  it("alleen systeemwaarnemingen dragen een soort bewijs", async () => {
    const t = await landingTest(alice);
    await expect(
      as(alice, (c) => c.query("insert into public.observations (idea_id, kind, summary, origin, evidence_type) values ($1, 'deposit', 'AI zegt: ze betalen', 'ai', 'verified_transaction')", [t.idea])),
    ).rejects.toThrow(/observations_evidence_type_check/);
    await goLive(alice, t.e);
    await as(alice, (c) => c.query("update public.experiments set state = 'ended' where id = $1", [t.e]));
    await as(alice, (c) =>
      c.query("insert into public.observations (idea_id, experiment_id, kind, summary, origin, evidence_type) values ($1, $2, 'demo_request', 'Waargenomen handeling', 'system', 'observed_action')", [t.idea, t.e]),
    );
    const rows = (await as(alice, (c) => c.query("select evidence_type from public.observations where idea_id = $1", [t.idea]))).rows;
    expect(rows.map((r) => r.evidence_type)).toContain("observed_action");
  });
});
