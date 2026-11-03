import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import { randomUUID, createHash } from "node:crypto";
import { emailHash, invitationToken, tokenHash } from "@/lib/domain/survey-tokens";

// Database rules that survey distribution relies on. Same helper pattern as rls.test.ts: a throwaway local
// Postgres with the Supabase shim + migrations (scripts/test-db.sh). Skipped when TEST_DATABASE_URL is not set.
const url = process.env.TEST_DATABASE_URL;
const d = url ? describe : describe.skip;

let db: Client;

type Who = { id: string; email: string } | "anon";

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

async function user(email: string) {
  const id = randomUUID();
  await db.query("insert into auth.users (id, email, email_confirmed_at) values ($1, $2, now())", [id, email]);
  return { id, email };
}

const ingestKey = "test-ingest-key";
const SALT = "test-salt";

async function liveSurvey(owner: { id: string; email: string }) {
  return as(owner, async (c) => {
    const org = (await c.query("select public.create_organization('Bureau ' || $1) as id", [owner.email])).rows[0].id;
    const idea = (
      await c.query(
        `insert into public.ideas (org_id, title, decision_question, project_type, description, target_audience, region)
         values ($1, 'Enquête-idee', 'Investeren we?', 'new_product', 'Beschrijving', 'MKB', 'Nederland') returning id`,
        [org],
      )
    ).rows[0].id;
    const a = (await c.query("insert into public.assumptions (idea_id, statement, category, importance) values ($1, 'Ze zoeken hulp', 'desirability', 5) returning id", [idea])).rows[0].id;
    const h = (
      await c.query(
        `insert into public.hypotheses (idea_id, assumption_id, we_believe, target_group, test_method, metric_label, metric_numerator, metric_denominator, success_threshold_pct, min_sample, max_duration_days)
         values ($1, $2, 'Ze zoeken actief', 'MKB', 'enquête', 'zocht actief', 'zocht', 'respondenten', 30, 20, 14) returning id`,
        [idea, a],
      )
    ).rows[0].id;
    const e = (await c.query("insert into public.experiments (idea_id, hypothesis_id, type, title, config) values ($1, $2, 'survey', 'Enquête', $3) returning id", [idea, h, JSON.stringify({ key_question: "gezocht", success_options: ["ja"], questions: [] })])).rows[0].id;
    for (const s of ["ready_for_review", "approved", "live"]) await c.query("update public.experiments set state = $2 where id = $1", [e, s]);
    const slug = (await c.query("select public_slug from public.experiments where id = $1", [e])).rows[0].public_slug as string;
    return { org, idea, e, slug };
  });
}

d("survey distribution: invitations, suppressions and promo posts", () => {
  let alice: { id: string; email: string };
  let bob: { id: string; email: string };
  let klant: { id: string; email: string };
  let S: Awaited<ReturnType<typeof liveSurvey>>;

  beforeAll(async () => {
    db = new Client({ connectionString: url });
    await db.connect();
    await db.query("insert into public.ingest_keys (key_hash) values ($1) on conflict do nothing", [createHash("sha256").update(ingestKey).digest("hex")]);
    alice = await user(`alice-${randomUUID()}@example.com`);
    bob = await user(`bob-${randomUUID()}@example.com`);
    klant = await user(`klant-${randomUUID()}@example.com`);
    S = await liveSurvey(alice);
    await liveSurvey(bob);
    await as(alice, (c) => c.query("insert into public.idea_members (idea_id, email, role) values ($1, $2, 'client_decider')", [S.idea, klant.email]));
    await as(klant, (c) => c.query("select public.claim_invitations()"));
  });

  afterAll(async () => {
    await db?.end();
  });

  const invite = (email: string) => {
    const id = randomUUID();
    const token = invitationToken(SALT, id);
    return { id, email, token, hash: tokenHash(token) };
  };

  it("lets a consultant create, claim, fail and retry an invitation with a derived token", async () => {
    const inv = invite("sanne@voorbeeld.nl");
    await as(alice, (c) =>
      c.query("insert into public.survey_invitations (id, experiment_id, idea_id, email, token_hash) values ($1, $2, $3, $4, $5)", [inv.id, S.e, S.idea, inv.email, inv.hash]),
    );
    // Claim: pending → sent happens once; a second claim finds nothing.
    const claim = () =>
      as(alice, async (c) => (await c.query("update public.survey_invitations set status = 'sent', sent_at = now(), error = null where id = $1 and status in ('pending', 'failed') returning id", [inv.id])).rowCount);
    expect(await claim()).toBe(1);
    expect(await claim()).toBe(0);
    await as(alice, (c) => c.query("update public.survey_invitations set status = 'failed', sent_at = null, error = 'E-maildienst weigerde (500)' where id = $1", [inv.id]));
    expect(await claim()).toBe(1);
    // A consultant can never mark someone as responded or unsubscribed; only the RPCs do that.
    await expect(as(alice, (c) => c.query("update public.survey_invitations set status = 'responded' where id = $1", [inv.id]))).rejects.toThrow(/row-level security/);
    await expect(as(alice, (c) => c.query("update public.survey_invitations set status = 'unsubscribed' where id = $1", [inv.id]))).rejects.toThrow(/row-level security/);
    // The same address cannot be invited twice for one survey.
    const dup = invite("sanne@voorbeeld.nl");
    await expect(
      as(alice, (c) => c.query("insert into public.survey_invitations (id, experiment_id, idea_id, email, token_hash) values ($1, $2, $3, $4, $5)", [dup.id, S.e, S.idea, dup.email, dup.hash])),
    ).rejects.toThrow(/duplicate key/);
  });

  it("accepts answers via the personal link exactly once and shows the status on the public page", async () => {
    const inv = invite("jan@voorbeeld.nl");
    await as(alice, (c) =>
      c.query("insert into public.survey_invitations (id, experiment_id, idea_id, email, token_hash, status, sent_at) values ($1, $2, $3, $4, $5, 'pending', null)", [inv.id, S.e, S.idea, inv.email, inv.hash]),
    );
    // The server recomputes the token from the id: same hash, so a reminder reuses the same link.
    expect(tokenHash(invitationToken(SALT, inv.id))).toBe(inv.hash);
    const submit = (visitor: string) =>
      as("anon", async (c) =>
        (await c.query("select public.submit_survey($1, $2, $3, '', '{\"gezocht\":\"nee\"}', true, 30000, $4, 'net1', true, 'ok') as r", [ingestKey, S.slug, visitor, inv.hash])).rows[0].r,
      );
    expect(await submit("v-jan")).toBe("ok");
    expect(await submit("v-jan-2")).toBe("duplicate");
    const pub = await as("anon", async (c) => (await c.query("select public.get_public_survey($1, $2) as s", [S.slug, inv.hash])).rows[0].s);
    expect(pub.invitation).toEqual({ status: "responded" });
    const row = await as(alice, async (c) => (await c.query("select source, channel from public.survey_responses where invitation_id = $1", [inv.id])).rows[0]);
    expect(row).toEqual({ source: "invitation", channel: "email" });
  });

  it("puts the HMAC of an address on the organisation's suppression list via the unsubscribe link", async () => {
    const inv = invite("piet@voorbeeld.nl");
    await as(alice, (c) => c.query("insert into public.survey_invitations (id, experiment_id, idea_id, email, token_hash) values ($1, $2, $3, $4, $5)", [inv.id, S.e, S.idea, inv.email, inv.hash]));
    const eHash = emailHash(SALT, "Piet@Voorbeeld.nl");
    expect(await as("anon", async (c) => (await c.query("select public.unsubscribe_invitation($1, $2, $3) as ok", [ingestKey, inv.hash, eHash])).rows[0].ok)).toBe(true);
    // What createInvitations does: look up the hashes of a new list in the organisation's suppressions.
    const found = await as(alice, async (c) =>
      (await c.query("select email_hash from public.email_suppressions where org_id = $1 and email_hash = any($2)", [S.org, [eHash, emailHash(SALT, "nieuw@voorbeeld.nl")]])).rows.map((r) => r.email_hash),
    );
    expect(found).toEqual([eHash]);
    expect((await as(alice, async (c) => (await c.query("select status from public.survey_invitations where id = $1", [inv.id])).rows[0])).status).toBe("unsubscribed");
    // Other organisations and clients see nothing.
    expect(await as(bob, async (c) => (await c.query("select * from public.email_suppressions where org_id = $1", [S.org])).rowCount)).toBe(0);
    expect(await as(klant, async (c) => (await c.query("select * from public.survey_invitations where idea_id = $1", [S.idea])).rowCount)).toBe(0);
    // Anonymous visitors cannot read or write the list directly, and the RPC refuses a wrong ingest key.
    await expect(as("anon", (c) => c.query("select * from public.email_suppressions"))).rejects.toThrow(/permission denied/);
    await expect(as("anon", (c) => c.query("select public.unsubscribe_invitation('fout', $1, $2)", [inv.hash, eHash]))).rejects.toThrow(/FORBIDDEN/);
  });

  it("allows exactly one reminder, claimed on reminded_at", async () => {
    const inv = invite("kees@voorbeeld.nl");
    await as(alice, (c) => c.query("insert into public.survey_invitations (id, experiment_id, idea_id, email, token_hash) values ($1, $2, $3, $4, $5)", [inv.id, S.e, S.idea, inv.email, inv.hash]));
    await as(alice, (c) => c.query("update public.survey_invitations set status = 'sent', sent_at = now() - interval '4 days' where id = $1", [inv.id]));
    // Conditional claim, as sendReminderBatch does.
    const claim = () => as(alice, async (c) => (await c.query("update public.survey_invitations set reminded_at = now() where id = $1 and status = 'sent' and reminded_at is null", [inv.id])).rowCount);
    expect(await claim()).toBe(1);
    expect(await claim()).toBe(0);
  });

  it("suppresses the stored address hash, not the one in the link", async () => {
    const inv = invite("lisa@voorbeeld.nl");
    const stored = emailHash(SALT, inv.email);
    await as(alice, (c) =>
      c.query("insert into public.survey_invitations (id, experiment_id, idea_id, email, email_hash, token_hash) values ($1, $2, $3, $4, $5, $6)", [inv.id, S.e, S.idea, inv.email, stored, inv.hash]),
    );
    const forged = emailHash(SALT, "iemand-anders@voorbeeld.nl");
    await as("anon", (c) => c.query("select public.unsubscribe_invitation($1, $2, $3)", [ingestKey, inv.hash, forged]));
    const rows = await as(alice, async (c) => (await c.query("select email_hash from public.email_suppressions where org_id = $1 and email_hash = any($2)", [S.org, [stored, forged]])).rows);
    expect(rows.map((r) => r.email_hash)).toEqual([stored]);
  });

  it("keeps the key question out of the public survey and shows clients only key answers", async () => {
    const pub = await as("anon", async (c) => (await c.query("select public.get_public_survey($1, null) as s", [S.slug])).rows[0].s);
    expect(pub.config.key_question).toBeUndefined();
    expect(pub.config.success_options).toBeUndefined();
    await as("anon", (c) =>
      c.query("select public.submit_survey($1, $2, 'v-open', 'linkedin', '{\"gezocht\":\"ja\",\"toelichting\":\"Ik ben Jan van Bakkerij X\"}', true, 30000, null, 'net2', true, 'ok')", [ingestKey, S.slug]),
    );
    const seen = await as(klant, async (c) => (await c.query("select source, channel, key_answer from public.survey_key_answers($1)", [S.e])).rows);
    expect(seen).toContainEqual({ source: "open_link", channel: "linkedin", key_answer: "ja" });
    expect(JSON.stringify(seen)).not.toContain("Bakkerij");
    expect(await as(klant, async (c) => (await c.query("select * from public.survey_responses where experiment_id = $1", [S.e])).rowCount)).toBe(0);
    expect(await as(bob, async (c) => (await c.query("select * from public.survey_key_answers($1)", [S.e])).rowCount)).toBe(0);
  });

  it("keeps promo posts per experiment, editable by consultants only, within the platform rules", async () => {
    const post = await as(alice, async (c) =>
      (await c.query("insert into public.promo_posts (experiment_id, idea_id, platform, body, origin) values ($1, $2, 'x', 'Doe mee aan ons onderzoek: https://a/s/x?utm_source=x', 'template') returning id", [S.e, S.idea])).rows[0].id,
    );
    expect(await as(alice, async (c) => (await c.query("update public.promo_posts set body = 'Aangepaste tekst voor X', origin = 'manual' where id = $1", [post])).rowCount)).toBe(1);
    await expect(as(alice, (c) => c.query("insert into public.promo_posts (experiment_id, idea_id, platform, body) values ($1, $2, 'tiktok', 'Een bericht van genoeg lengte')", [S.e, S.idea]))).rejects.toThrow(/check constraint/);
    await expect(as(alice, (c) => c.query("insert into public.promo_posts (experiment_id, idea_id, platform, body) values ($1, $2, 'x', 'kort')", [S.e, S.idea]))).rejects.toThrow(/check constraint/);
    expect(await as(bob, async (c) => (await c.query("select * from public.promo_posts where id = $1", [post])).rowCount)).toBe(0);
    expect(await as(klant, async (c) => (await c.query("update public.promo_posts set body = 'Gekaapt door de klant' where id = $1", [post])).rowCount)).toBe(0);
    expect(await as(alice, async (c) => (await c.query("delete from public.promo_posts where id = $1", [post])).rowCount)).toBe(1);
  });
});
