import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import { randomUUID, createHash } from "node:crypto";
import { emailHash, invitationToken, tokenHash } from "@/lib/domain/survey-tokens";

// Bounce webhook RPC, per-post content columns, Expandi campaign hooks and data-subject requests. Same helper
// pattern as survey-distribution.test.ts (scripts/test-db.sh). Skipped when TEST_DATABASE_URL is not set.
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

async function liveExperiment(owner: { id: string; email: string }, type: "survey" | "landing", org?: string) {
  return as(owner, async (c) => {
    const orgId = org ?? (await c.query("select public.create_organization('Bureau ' || $1) as id", [owner.email])).rows[0].id;
    const idea = (
      await c.query(
        `insert into public.ideas (org_id, title, decision_question, project_type, description, target_audience, region)
         values ($1, 'Privacy-idee', 'Investeren we?', 'new_product', 'Beschrijving', 'MKB', 'Nederland') returning id`,
        [orgId],
      )
    ).rows[0].id;
    const a = (await c.query("insert into public.assumptions (idea_id, statement, category, importance) values ($1, 'Ze zoeken hulp', 'desirability', 5) returning id", [idea])).rows[0].id;
    const h = (
      await c.query(
        `insert into public.hypotheses (idea_id, assumption_id, we_believe, target_group, test_method, metric_label, metric_numerator, metric_denominator, success_threshold_pct, min_sample, max_duration_days)
         values ($1, $2, 'Ze zoeken actief', 'MKB', 'test', 'zocht actief', 'zocht', 'respondenten', 30, 20, 14) returning id`,
        [idea, a],
      )
    ).rows[0].id;
    const config = type === "survey" ? { key_question: "gezocht", success_options: ["ja"], questions: [] } : { headline: "Nieuw", cta_label: "Aanmelden", collect_email: true };
    const e = (await c.query("insert into public.experiments (idea_id, hypothesis_id, type, title, config) values ($1, $2, $3, 'Test', $4) returning id", [idea, h, type, JSON.stringify(config)])).rows[0].id;
    for (const s of ["ready_for_review", "approved", "live"]) await c.query("update public.experiments set state = $2 where id = $1", [e, s]);
    const slug = (await c.query("select public_slug from public.experiments where id = $1", [e])).rows[0].public_slug as string;
    return { org: orgId as string, idea: idea as string, e: e as string, slug };
  });
}

const invite = (email: string) => {
  const id = randomUUID();
  const token = invitationToken(SALT, id);
  return { id, email, token, hash: tokenHash(token), emailHash: emailHash(SALT, email) };
};

d("privacy and outreach", () => {
  let alice: { id: string; email: string };
  let eddie: { id: string; email: string }; // editor (not owner) in alice's organisation
  let bob: { id: string; email: string };
  let klant: { id: string; email: string };
  let S: Awaited<ReturnType<typeof liveExperiment>>;
  let L: Awaited<ReturnType<typeof liveExperiment>>;
  let B: Awaited<ReturnType<typeof liveExperiment>>;

  beforeAll(async () => {
    db = new Client({ connectionString: url });
    await db.connect();
    await db.query("insert into public.ingest_keys (key_hash) values ($1) on conflict do nothing", [createHash("sha256").update(ingestKey).digest("hex")]);
    alice = await user(`alice-${randomUUID()}@example.com`);
    eddie = await user(`eddie-${randomUUID()}@example.com`);
    bob = await user(`bob-${randomUUID()}@example.com`);
    klant = await user(`klant-${randomUUID()}@example.com`);
    S = await liveExperiment(alice, "survey");
    L = await liveExperiment(alice, "landing", S.org);
    B = await liveExperiment(bob, "survey");
    await db.query("insert into public.organization_members (org_id, user_id, role) values ($1, $2, 'editor')", [S.org, eddie.id]);
    await as(alice, (c) => c.query("insert into public.idea_members (idea_id, email, role) values ($1, $2, 'client_decider')", [S.idea, klant.email]));
    await as(klant, (c) => c.query("select public.claim_invitations()"));
  });

  afterAll(async () => {
    await db?.end();
  });

  const addInvitation = async (who: { id: string; email: string }, X: typeof S, inv: ReturnType<typeof invite>, extra: Record<string, string> = {}) => {
    await as(who, (c) =>
      c.query("insert into public.survey_invitations (id, experiment_id, idea_id, email, email_hash, token_hash) values ($1, $2, $3, $4, $5, $6)", [inv.id, X.e, X.idea, inv.email, inv.emailHash, inv.hash]),
    );
    await as(who, (c) => c.query("update public.survey_invitations set status = 'sent', sent_at = now() where id = $1", [inv.id]));
    for (const [k, v] of Object.entries(extra)) {
      await as(who, (c) => c.query(`update public.survey_invitations set ${k === "reminder" ? "reminder_message_id" : "provider_message_id"} = $2 where id = $1`, [inv.id, v]));
    }
  };

  const emailEvent = (webhookId: string, event: string, messageId: string | null, permanent: boolean, key = ingestKey) =>
    as("anon", async (c) => (await c.query("select public.record_email_event($1, $2, $3, $4, $5, 'General') as r", [key, webhookId, event, messageId, permanent])).rows[0].r as string);

  it("marks a hard bounce once, suppresses the address and ignores repeats, soft bounces and unknown mails", async () => {
    const inv = invite("bounce@voorbeeld.nl");
    const msg = `re_${randomUUID()}`;
    await addInvitation(alice, S, inv, { provider: msg });
    const wh = `msg_${randomUUID()}`;
    expect(await emailEvent(wh, "email.bounced", msg, true)).toBe("ok");
    expect(await emailEvent(wh, "email.bounced", msg, true)).toBe("duplicate");
    expect(await emailEvent(`msg_${randomUUID()}`, "email.bounced", msg, false)).toBe("ignored");
    expect(await emailEvent(`msg_${randomUUID()}`, "email.delivered", msg, false)).toBe("ignored");
    expect(await emailEvent(`msg_${randomUUID()}`, "email.bounced", "re_onbekend", true)).toBe("unknown");
    const row = await as(alice, async (c) => (await c.query("select status, delivery_issue, error from public.survey_invitations where id = $1", [inv.id])).rows[0]);
    expect(row.status).toBe("failed");
    expect(row.delivery_issue).toBe("bounced");
    expect(row.error).toMatch(/Onbestelbaar/);
    const sup = await as(alice, async (c) => (await c.query("select reason from public.email_suppressions where org_id = $1 and email_hash = $2", [S.org, inv.emailHash])).rows);
    expect(sup).toEqual([{ reason: "bounced" }]);
    // A consultant cannot clear the bounce or send to the address again.
    await expect(as(alice, (c) => c.query("update public.survey_invitations set delivery_issue = null where id = $1", [inv.id]))).rejects.toThrow(/DELIVERY_ISSUE/);
    await expect(as(alice, (c) => c.query("update public.survey_invitations set status = 'sent' where id = $1", [inv.id]))).rejects.toThrow(/DELIVERY_ISSUE/);
    // Nobody but the RPC sees the processed webhook ids; a wrong ingest key is refused.
    await expect(as("anon", (c) => c.query("select * from public.email_webhook_events"))).rejects.toThrow(/permission denied/);
    await expect(as(alice, (c) => c.query("select * from public.email_webhook_events"))).rejects.toThrow(/permission denied/);
    await expect(emailEvent(`msg_${randomUUID()}`, "email.bounced", msg, true, "fout")).rejects.toThrow(/FORBIDDEN/);
  });

  it("records a spam complaint on the reminder and keeps a responded invitation responded", async () => {
    const inv = invite("klacht@voorbeeld.nl");
    const rem = `re_${randomUUID()}`;
    await addInvitation(alice, S, inv, { reminder: rem });
    await as("anon", (c) => c.query("select public.submit_survey($1, $2, 'v-klacht', '', '{\"gezocht\":\"ja\"}', true, 30000, $3, 'k1', true, 'ok')", [ingestKey, S.slug, inv.hash]));
    expect(await emailEvent(`msg_${randomUUID()}`, "email.complained", rem, false)).toBe("ok");
    const row = await as(alice, async (c) => (await c.query("select status, delivery_issue from public.survey_invitations where id = $1", [inv.id])).rows[0]);
    expect(row).toEqual({ status: "responded", delivery_issue: "complained" });
    expect((await as(alice, async (c) => (await c.query("select reason from public.email_suppressions where email_hash = $1", [inv.emailHash])).rows[0])).reason).toBe("complained");
  });

  it("stores the post code of surveys and test events, and counts per post", async () => {
    const submit = (visitor: string, content: string | null, bucket: string) =>
      as("anon", async (c) => (await c.query("select public.submit_survey($1, $2, $3, 'linkedin', '{\"gezocht\":\"ja\"}', true, 30000, null, $4, true, 'ok', $5) as r", [ingestKey, S.slug, visitor, bucket, content])).rows[0].r);
    expect(await submit("v-c1", "li-ABC", "c1")).toBe("ok");
    expect(await submit("v-c2", "<b>evil</b>" + "x".repeat(60), "c2")).toBe("ok");
    // The old call without p_content still works.
    expect(await as("anon", async (c) => (await c.query("select public.submit_survey($1, $2, 'v-c3', 'x', '{\"gezocht\":\"nee\"}', true, 30000, null, 'c3', true, 'ok') as r", [ingestKey, S.slug])).rows[0].r)).toBe("ok");
    const rows = await as(alice, async (c) => (await c.query("select visitor_hash, content from public.survey_responses where experiment_id = $1 and visitor_hash like 'v-c%' order by visitor_hash", [S.e])).rows);
    expect(rows[0]).toEqual({ visitor_hash: "v-c1", content: "li-abc" });
    expect(rows[1].content).toMatch(/^bevil[a-z]*$/);
    expect(rows[1].content.length).toBeLessThanOrEqual(40);
    expect(rows[2].content).toBeNull();
    const keyRows = await as(klant, async (c) => (await c.query("select content from public.survey_key_answers($1) where content = 'li-abc'", [S.e])).rows);
    expect(keyRows).toHaveLength(1);
    await expect(as(alice, (c) => c.query("insert into public.test_events (experiment_id, idea_id, visitor_hash, event_type, content) values ($1, $2, 'x', 'view', 'NIET GOED')", [L.e, L.idea]))).rejects.toThrow();

    const ev = (visitor: string, event: string, content: string | null) =>
      as("anon", (c) => c.query("select public.record_test_event($1, $2, $3, $4, 'a', 'linkedin', $5, $6)", [ingestKey, L.slug, visitor, event, `b-${visitor}`, content]));
    await ev("lv1", "view", "li-abc");
    await ev("lv1", "cta_click", "li-abc");
    await as("anon", (c) => c.query("select public.submit_test_form($1, $2, 'lv1', 'a', 'linkedin', 'lv1@voorbeeld.nl', '{}', true, 'toestemming', 'b-lv1s', 'li-abc')", [ingestKey, L.slug]));
    await ev("lv2", "view", "dm-xyz");
    await ev("lv3", "view", null);
    const counts = await as(alice, async (c) => (await c.query("select content, viewers::int, clickers::int, submitters::int from public.experiment_content_counts($1) order by content nulls last", [L.e])).rows);
    expect(counts).toEqual([
      { content: "dm-xyz", viewers: 1, clickers: 0, submitters: 0 },
      { content: "li-abc", viewers: 1, clickers: 1, submitters: 1 },
      { content: null, viewers: 1, clickers: 0, submitters: 0 },
    ]);
    const submitEvent = await as(alice, async (c) => (await c.query("select content from public.test_events where experiment_id = $1 and event_type = 'submit'", [L.e])).rows);
    expect(submitEvent).toEqual([{ content: "li-abc" }]);
    // Clients and other organisations see no per-post counts of raw events.
    expect(await as(bob, async (c) => (await c.query("select * from public.experiment_content_counts($1)", [L.e])).rowCount)).toBe(0);
  });

  it("keeps post codes valid and unique per experiment", async () => {
    const ins = (code: string) =>
      as(alice, (c) => c.query("insert into public.promo_posts (experiment_id, idea_id, platform, body, origin, code) values ($1, $2, 'x', 'Doe mee aan ons onderzoek', 'template', $3)", [S.e, S.idea, code]));
    await ins("x-abcde");
    await expect(ins("x-abcde")).rejects.toThrow(/duplicate key/);
    await expect(ins("X ABC")).rejects.toThrow(/check constraint/);
    const def = await as(alice, async (c) => (await c.query("insert into public.promo_posts (experiment_id, idea_id, platform, body) values ($1, $2, 'x', 'Doe mee aan ons onderzoek') returning code", [S.e, S.idea])).rows[0].code);
    expect(def).toMatch(/^p-[0-9a-f]{6}$/);
  });

  it("keeps the Expandi campaign URL with the organisation's consultants", async () => {
    const hook = "https://api.liaufa.com/api/v1/open-api/campaign-instance/1/assign/?key=k&secret=s";
    await as(alice, (c) => c.query("insert into public.expandi_campaign_hooks (experiment_id, idea_id, url) values ($1, $2, $3)", [S.e, S.idea, hook]));
    expect(await as(eddie, async (c) => (await c.query("select url from public.expandi_campaign_hooks where experiment_id = $1", [S.e])).rows)).toEqual([{ url: hook }]);
    expect(await as(klant, async (c) => (await c.query("select * from public.expandi_campaign_hooks where experiment_id = $1", [S.e])).rowCount)).toBe(0);
    expect(await as(bob, async (c) => (await c.query("select * from public.expandi_campaign_hooks where experiment_id = $1", [S.e])).rowCount)).toBe(0);
    await expect(as(bob, (c) => c.query("insert into public.expandi_campaign_hooks (experiment_id, idea_id, url) values ($1, $2, $3)", [S.e, S.idea, hook]))).rejects.toThrow();
    await expect(as(alice, (c) => c.query("update public.expandi_campaign_hooks set url = 'http://intern/' where experiment_id = $1", [S.e]))).rejects.toThrow(/check constraint/);
    await expect(as("anon", (c) => c.query("select * from public.expandi_campaign_hooks"))).rejects.toThrow(/permission denied/);
  });

  it("lets only an owner search and erase one address, and only within the own organisation", async () => {
    const subject = "betrokkene@voorbeeld.nl";
    const hashes = [emailHash(SALT, subject)];
    const mine = invite(subject);
    const theirs = invite(subject);
    await addInvitation(alice, S, mine);
    await addInvitation(bob, B, theirs);
    await as("anon", (c) => c.query("select public.submit_survey($1, $2, 'v-dsr', '', '{\"gezocht\":\"ja\",\"toelichting\":\"Ik ben Piet\"}', true, 30000, $3, 'd1', true, 'ok')", [ingestKey, S.slug, mine.hash]));
    // A landing-page sign-up with the same address.
    await as("anon", (c) => c.query("select public.record_test_event($1, $2, 'lv-dsr', 'view', 'a', 'x', 'd2')", [ingestKey, L.slug]));
    await as("anon", (c) => c.query("select public.record_test_event($1, $2, 'lv-dsr', 'cta_click', 'a', 'x', 'd3')", [ingestKey, L.slug]));
    await as("anon", (c) => c.query("select public.submit_test_form($1, $2, 'lv-dsr', 'a', 'x', $3, '{\"q\":\"antwoord\"}', true, 'toestemming', 'd4')", [ingestKey, L.slug, subject]));
    await as(alice, (c) =>
      c.query(
        "insert into public.interviews (experiment_id, idea_id, participant_label, dmu_role, recruited_via, held_on, record_type, transcript, consent_recorded) values ($1, $2, 'Eventmanager A', 'user', 'network', current_date, 'notes', $3, true)",
        [S.e, S.idea, `Mail me op ${subject.toUpperCase()} voor de uitkomst.`],
      ),
    );

    const search = (who: { id: string; email: string }, org: string) =>
      as(who, async (c) => (await c.query("select public.dsr_search($1, $2, $3) as r", [org, subject, hashes])).rows[0].r);
    const found = await search(alice, S.org);
    expect(found.survey_invitations).toHaveLength(1);
    expect(found.survey_invitations[0].response.answers.toelichting).toBe("Ik ben Piet");
    expect(found.test_submissions).toHaveLength(1);
    expect(found.interviews).toEqual([expect.objectContaining({ participant_label: "Eventmanager A", transcript_mentions_email: true, label_is_email: false })]);
    expect(JSON.stringify(found)).not.toContain(theirs.id);

    // Editors, clients, anonymous visitors and owners of another organisation are refused.
    await expect(search(eddie, S.org)).rejects.toThrow(/FORBIDDEN/);
    await expect(search(klant, S.org)).rejects.toThrow(/FORBIDDEN/);
    await expect(search(bob, S.org)).rejects.toThrow(/FORBIDDEN/);
    await expect(as("anon", (c) => c.query("select public.dsr_search($1, $2, $3)", [S.org, subject, hashes]))).rejects.toThrow(/permission denied/);
    await expect(as(bob, (c) => c.query("select public.dsr_erase($1, $2, $3, true)", [S.org, subject, hashes]))).rejects.toThrow(/FORBIDDEN/);
    await expect(as(alice, (c) => c.query("select public.dsr_search($1, 'geen-adres', $2)", [S.org, hashes]))).rejects.toThrow(/INVALID_EMAIL/);

    const erased = await as(alice, async (c) => (await c.query("select public.dsr_erase($1, $2, $3, true) as r", [S.org, subject, hashes])).rows[0].r);
    expect(erased).toEqual({ invitations: 1, responses: 1, submissions: 1, suppressed: true });
    const inv = await as(alice, async (c) => (await c.query("select email, email_hash from public.survey_invitations where id = $1", [mine.id])).rows[0]);
    expect(inv).toEqual({ email: `verwijderd-${mine.id}@invalid`, email_hash: null });
    expect(await as(alice, async (c) => (await c.query("select * from public.survey_responses where invitation_id = $1", [mine.id])).rowCount)).toBe(0);
    const sub = await as(alice, async (c) => (await c.query("select email, answers from public.test_submissions where experiment_id = $1 and visitor_hash = 'lv-dsr'", [L.e])).rows[0]);
    expect(sub).toEqual({ email: null, answers: {} });
    expect((await as(alice, async (c) => (await c.query("select reason from public.email_suppressions where org_id = $1 and email_hash = $2", [S.org, hashes[0]])).rows[0])).reason).toBe("erasure");
    // The audit trail records the request without the address, and earlier copies of the rows are reduced.
    const audit = await as(alice, async (c) => (await c.query("select action, detail from public.audit_events where org_id = $1 and table_name = 'privacy_requests' order by id", [S.org])).rows);
    expect(audit.map((a) => a.action)).toEqual(["dsr_search", "dsr_erase"]);
    const trail = await db.query("select detail::text as d from public.audit_events where org_id = $1", [S.org]);
    expect(trail.rows.map((r) => r.d ?? "").join(" ")).not.toContain(subject);
    expect(trail.rows.map((r) => r.d ?? "").join(" ")).not.toContain("Ik ben Piet");

    // The other organisation's invitation for the same address is untouched; a new search finds nothing to erase.
    expect((await as(bob, async (c) => (await c.query("select email from public.survey_invitations where id = $1", [theirs.id])).rows[0])).email).toBe(subject);
    const again = await search(alice, S.org);
    expect(again.survey_invitations).toHaveLength(0);
    expect(again.test_submissions).toHaveLength(0);
    expect(again.email_suppressions).toEqual([expect.objectContaining({ reason: "erasure" })]);
  });
});
