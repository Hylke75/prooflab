import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import { randomUUID, createHash } from "node:crypto";

// The background job queue against the real schema (scripts/test-db.sh). Helper pattern from coach.test.ts.
// Skipped when TEST_DATABASE_URL is not set.
const url = process.env.TEST_DATABASE_URL;
const d = url ? describe : describe.skip;

let db: Client;

type Who = { id: string; email: string } | "anon";

async function as<T>(who: Who, fn: (c: Client) => Promise<T>, c: Client = db): Promise<T> {
  await c.query("begin");
  try {
    if (who === "anon") {
      await c.query("set local role anon");
      await c.query("select set_config('request.jwt.claims', '', true)");
    } else {
      await c.query("set local role authenticated");
      await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: who.id, email: who.email, role: "authenticated" })]);
    }
    const out = await fn(c);
    await c.query("commit");
    return out;
  } catch (e) {
    await c.query("rollback");
    throw e;
  }
}

async function user(email: string) {
  const id = randomUUID();
  await db.query("insert into auth.users (id, email, email_confirmed_at) values ($1, $2, now())", [id, email]);
  return { id, email };
}

const ingestKey = "test-ingest-key";
const sha = (s: string) => createHash("sha256").update(s).digest("hex");

async function liveSurvey(owner: { id: string; email: string }) {
  return as(owner, async (c) => {
    const org = (await c.query("select public.create_organization('Bureau ' || $1) as id", [owner.email])).rows[0].id;
    const idea = (
      await c.query(
        `insert into public.ideas (org_id, title, decision_question, project_type, description, target_audience, region)
         values ($1, 'Takenidee', 'Investeren we?', 'new_product', 'Beschrijving', 'MKB', 'Nederland') returning id`,
        [org],
      )
    ).rows[0].id as string;
    const a = (await c.query("insert into public.assumptions (idea_id, statement, category, importance) values ($1, 'Ze zoeken hulp', 'desirability', 5) returning id", [idea])).rows[0].id;
    const h = (
      await c.query(
        `insert into public.hypotheses (idea_id, assumption_id, we_believe, target_group, test_method, metric_label, metric_numerator, metric_denominator, success_threshold_pct, min_sample, max_duration_days)
         values ($1, $2, 'Ze zoeken actief', 'MKB', 'enquête', 'zocht actief', 'zocht', 'respondenten', 30, 20, 14) returning id`,
        [idea, a],
      )
    ).rows[0].id;
    const e = (await c.query("insert into public.experiments (idea_id, hypothesis_id, type, title, config) values ($1, $2, 'survey', 'Enquête', $3) returning id", [idea, h, JSON.stringify({ key_question: "q", success_options: ["ja"], questions: [] })])).rows[0].id as string;
    for (const s of ["ready_for_review", "approved", "live"]) await c.query("update public.experiments set state = $2 where id = $1", [e, s]);
    return { org, idea, e };
  });
}

async function invitation(owner: { id: string; email: string }, S: { idea: string; e: string }, email: string, status = "pending") {
  const id = randomUUID();
  await as(owner, (c) =>
    c.query("insert into public.survey_invitations (id, experiment_id, idea_id, email, token_hash, email_hash) values ($1, $2, $3, $4, $5, $6)", [id, S.e, S.idea, email, sha(id), sha(email)]),
  );
  if (status !== "pending") await db.query("update public.survey_invitations set status = $2, sent_at = now() - interval '4 days' where id = $1", [id, status]);
  return id;
}

const enqueue = (who: Who, idea: string, kind: string, payload: object, dedupe: string | null) =>
  as(who, async (c) => (await c.query("select public.enqueue_job($1, $2, $3, $4) as r", [idea, kind, JSON.stringify(payload), dedupe])).rows[0].r as { id: string; created: boolean });

const claim = (key = ingestKey, c: Client = db) =>
  as("anon", async (x) => (await x.query("select * from public.claim_jobs($1, 10, 60)", [key])).rows, c);

const complete = (job: string, outcome: string, opts: { error?: string; progress?: object; delay?: number } = {}) =>
  as("anon", async (c) =>
    (await c.query("select public.complete_job($1, $2, $3, $4, $5, $6) as s", [ingestKey, job, outcome, opts.error ?? null, opts.progress ? JSON.stringify(opts.progress) : null, opts.delay ?? 0])).rows[0].s as string,
  );

const mark = (job: string, inv: string, action: string) =>
  as("anon", async (c) => (await c.query("select public.job_survey_mark($1, $2, $3, $4, null) as t", [ingestKey, job, inv, action])).rows[0].t as Date | null);

// Other jobs stay out of the way of the claim tests: everything still queued is finished first.
const drain = () => db.query("update public.jobs set status = 'done' where status in ('queued', 'running')");

d("background jobs", () => {
  let alice: { id: string; email: string };
  let bob: { id: string; email: string };
  let klant: { id: string; email: string };
  let S: Awaited<ReturnType<typeof liveSurvey>>;
  let other: Awaited<ReturnType<typeof liveSurvey>>;

  beforeAll(async () => {
    db = new Client({ connectionString: url });
    await db.connect();
    await db.query("insert into public.ingest_keys (key_hash) values ($1) on conflict do nothing", [sha(ingestKey)]);
    alice = await user(`alice-${randomUUID()}@example.com`);
    bob = await user(`bob-${randomUUID()}@example.com`);
    klant = await user(`klant-${randomUUID()}@example.com`);
    S = await liveSurvey(alice);
    other = await liveSurvey(bob);
    await as(alice, (c) => c.query("insert into public.idea_members (idea_id, email, role) values ($1, $2, 'client_decider')", [S.idea, klant.email]));
    await as(klant, (c) => c.query("select public.claim_invitations()"));
  });

  afterAll(async () => {
    await db?.end();
  });

  it("lets consultants enqueue, deduplicates active work and hides jobs from clients and other organisations", async () => {
    await drain();
    const payload = { experiment_id: S.e, template: { subject: "a", body: "b" }, ids: [randomUUID()] };
    const first = await enqueue(alice, S.idea, "survey_invite", payload, `survey-email:${S.e}`);
    expect(first.created).toBe(true);
    const second = await enqueue(alice, S.idea, "survey_reminder", payload, `survey-email:${S.e}`);
    expect(second).toEqual({ id: first.id, created: false });
    const row = (await db.query("select org_id, created_by, status, attempts from public.jobs where id = $1", [first.id])).rows[0];
    expect(row).toEqual({ org_id: S.org, created_by: alice.id, status: "queued", attempts: 0 });

    await expect(enqueue(klant, S.idea, "survey_invite", payload, null)).rejects.toThrow(/FORBIDDEN/);
    await expect(enqueue(bob, S.idea, "survey_invite", payload, null)).rejects.toThrow(/FORBIDDEN/);
    await expect(enqueue(alice, S.idea, "drop_tables", payload, null)).rejects.toThrow(/JOB_KIND/);
    await expect(enqueue("anon", S.idea, "survey_invite", payload, null)).rejects.toThrow(/permission denied/);

    const seen = (who: Who) => as(who, async (c) => (await c.query("select id from public.jobs where id = $1", [first.id])).rowCount);
    expect(await seen(alice)).toBe(1);
    expect(await seen(bob)).toBe(0);
    expect(await seen(klant)).toBe(0);
    await expect(seen("anon")).rejects.toThrow(/permission denied/);
    // Nobody writes the table directly.
    await expect(as(alice, (c) => c.query("update public.jobs set status = 'done' where id = $1", [first.id]))).rejects.toThrow(/permission denied/);
    await expect(
      as(alice, (c) => c.query("insert into public.jobs (org_id, idea_id, kind) values ($1, $2, 'survey_invite')", [S.org, S.idea])),
    ).rejects.toThrow(/permission denied/);
  });

  it("only lets the worker claim with the ingest secret, and not as a signed-in user", async () => {
    await expect(claim("wrong-key")).rejects.toThrow(/FORBIDDEN/);
    await expect(as(alice, (c) => c.query("select * from public.claim_jobs($1, 1, 60)", [ingestKey]))).rejects.toThrow(/permission denied/);
    await expect(as("anon", (c) => c.query("select public.job_survey_batch($1, $2, '{}')", ["wrong-key", randomUUID()]))).rejects.toThrow(/FORBIDDEN/);
    await expect(as("anon", (c) => c.query("select public.complete_job($1, $2, 'done', null, null, 0)", ["wrong-key", randomUUID()]))).rejects.toThrow(/FORBIDDEN/);
  });

  it("claims with FOR UPDATE SKIP LOCKED: a locked job is skipped, not waited for", async () => {
    await drain();
    const payload = { experiment_id: S.e, template: { subject: "a", body: "b" }, ids: [randomUUID()] };
    const a = await enqueue(alice, S.idea, "survey_invite", payload, null);
    const b = await enqueue(bob, other.idea, "survey_invite", { ...payload, experiment_id: other.e }, null);
    const second = new Client({ connectionString: url });
    await second.connect();
    try {
      // Another worker holds job a (row lock inside an open transaction).
      await db.query("begin");
      await db.query("select id from public.jobs where id = $1 for update", [a.id]);
      const got = await claim(ingestKey, second);
      expect(got.map((r) => r.id)).toEqual([b.id]);
      expect(got[0]).toMatchObject({ status: "running", attempts: 1 });
      expect(new Date(got[0].locked_until).getTime()).toBeGreaterThan(Date.now());
      await db.query("commit");
      const next = await claim(ingestKey, second);
      expect(next.map((r) => r.id)).toEqual([a.id]);
      expect(await claim(ingestKey, second)).toEqual([]);
    } finally {
      await second.end();
    }
  });

  it("requeues with backoff, counts attempts, yields without counting and fails after the last attempt", async () => {
    await drain();
    const payload = { experiment_id: S.e, template: { subject: "a", body: "b" }, ids: [randomUUID()] };
    const j = await enqueue(alice, S.idea, "survey_invite", payload, null);
    await db.query("update public.jobs set max_attempts = 2 where id = $1", [j.id]);
    expect((await claim()).map((r) => r.id)).toEqual([j.id]);
    expect(await complete(j.id, "yield", { progress: { done: 3 } })).toBe("queued");
    let row = (await db.query("select attempts, progress from public.jobs where id = $1", [j.id])).rows[0];
    expect(row).toEqual({ attempts: 0, progress: { done: 3 } });
    expect((await claim()).map((r) => r.id)).toEqual([j.id]);
    expect(await complete(j.id, "retry", { error: "E-maildienst tijdelijk niet bereikbaar", delay: 300 })).toBe("queued");
    row = (await db.query("select attempts, last_error, run_after > now() + interval '4 minutes' as later from public.jobs where id = $1", [j.id])).rows[0];
    expect(row).toEqual({ attempts: 1, last_error: "E-maildienst tijdelijk niet bereikbaar", later: true });
    expect(await claim()).toEqual([]);
    await db.query("update public.jobs set run_after = now() where id = $1", [j.id]);
    expect((await claim()).map((r) => r.attempts)).toEqual([2]);
    expect(await complete(j.id, "retry", { error: "weer mis" })).toBe("failed");
    row = (await db.query("select status, finished_at is not null as finished, locked_until from public.jobs where id = $1", [j.id])).rows[0];
    expect(row).toEqual({ status: "failed", finished: true, locked_until: null });
    // A finished job cannot be restarted, not even by the worker.
    expect(await complete(j.id, "done")).toBe("failed");
    await expect(db.query("update public.jobs set status = 'queued' where id = $1", [j.id])).rejects.toThrow(/JOB_FINAL/);
  });

  it("reclaims a job whose worker died (lease expired) and fails it after the last attempt", async () => {
    await drain();
    const payload = { experiment_id: S.e, template: { subject: "a", body: "b" }, ids: [randomUUID()] };
    const j = await enqueue(alice, S.idea, "survey_invite", payload, null);
    await db.query("update public.jobs set max_attempts = 2 where id = $1", [j.id]);
    await claim();
    await db.query("update public.jobs set locked_until = now() - interval '1 second' where id = $1", [j.id]);
    expect((await claim()).map((r) => [r.id, r.attempts])).toEqual([[j.id, 2]]);
    await db.query("update public.jobs set locked_until = now() - interval '1 second' where id = $1", [j.id]);
    expect(await claim()).toEqual([]);
    expect((await db.query("select status, last_error from public.jobs where id = $1", [j.id])).rows[0]).toMatchObject({ status: "failed", last_error: expect.stringMatching(/Time-out/) });
  });

  it("claims each invitation once per job, only while the job runs and the survey is live", async () => {
    await drain();
    const inv = await invitation(alice, S, `sanne-${randomUUID()}@voorbeeld.nl`);
    const outside = await invitation(alice, S, `jan-${randomUUID()}@voorbeeld.nl`);
    const j = await enqueue(alice, S.idea, "survey_invite", { experiment_id: S.e, template: { subject: "a", body: "b" }, ids: [inv], names: { [inv]: "Sanne" } }, null);
    // Not running yet: nothing can be claimed.
    expect(await mark(j.id, inv, "claim")).toBeNull();
    await claim();
    const batch = await as("anon", async (c) => (await c.query("select public.job_survey_batch($1, $2, $3) as b", [ingestKey, j.id, [inv, outside]])).rows[0].b);
    expect(batch.experiment).toMatchObject({ id: S.e, type: "survey", state: "live" });
    expect(batch.items.map((i: { id: string }) => i.id)).toEqual([inv]);
    expect(await mark(j.id, outside, "claim")).toBeNull();
    expect(await mark(j.id, inv, "claim")).not.toBeNull();
    expect(await mark(j.id, inv, "claim")).toBeNull();
    expect((await db.query("select status from public.survey_invitations where id = $1", [inv])).rows[0].status).toBe("sent");
    // A refused mail goes back to failed and can be claimed again (by a later send).
    expect(await mark(j.id, inv, "fail")).not.toBeNull();
    expect((await db.query("select status, error from public.survey_invitations where id = $1", [inv])).rows[0]).toEqual({ status: "failed", error: "Niet verstuurd." });
    // Survey paused: no claims.
    await as(alice, (c) => c.query("update public.experiments set state = 'paused' where id = $1", [S.e]));
    expect(await mark(j.id, inv, "claim")).toBeNull();
    await as(alice, (c) => c.query("update public.experiments set state = 'live' where id = $1", [S.e]));
    expect(await mark(j.id, inv, "claim")).not.toBeNull();
    // Done: the names for the greeting leave the payload.
    expect(await complete(j.id, "done", { progress: { done: 1, sent: 1 } })).toBe("done");
    const payload = (await db.query("select payload from public.jobs where id = $1", [j.id])).rows[0].payload;
    expect(payload.names).toBeUndefined();
    expect(payload.ids).toEqual([inv]);
  });

  it("lets a consultant cancel; the worker then claims nothing and the cancellation sticks", async () => {
    await drain();
    const inv = await invitation(alice, S, `piet-${randomUUID()}@voorbeeld.nl`);
    const j = await enqueue(alice, S.idea, "survey_invite", { experiment_id: S.e, template: { subject: "a", body: "b" }, ids: [inv] }, `survey-email:${S.e}`);
    await claim();
    await expect(as(klant, (c) => c.query("select public.cancel_job($1)", [j.id]))).rejects.toThrow(/FORBIDDEN/);
    await expect(as(bob, (c) => c.query("select public.cancel_job($1)", [j.id]))).rejects.toThrow(/FORBIDDEN/);
    expect((await as(alice, (c) => c.query("select public.cancel_job($1) as ok", [j.id]))).rows[0].ok).toBe(true);
    expect((await as(alice, (c) => c.query("select public.cancel_job($1) as ok", [j.id]))).rows[0].ok).toBe(false);
    expect(await mark(j.id, inv, "claim")).toBeNull();
    expect(await as("anon", async (c) => (await c.query("select public.job_survey_batch($1, $2, $3) as b", [ingestKey, j.id, [inv]])).rows[0].b)).toBeNull();
    expect(await as("anon", async (c) => (await c.query("select public.job_heartbeat($1, $2, '{}', 60) as s", [ingestKey, j.id])).rows[0].s)).toBe("cancelled");
    expect(await complete(j.id, "done", { progress: { done: 0 } })).toBe("cancelled");
    const row = (await db.query("select status, cancelled_by, finished_at is not null as finished from public.jobs where id = $1", [j.id])).rows[0];
    expect(row).toEqual({ status: "cancelled", cancelled_by: alice.id, finished: true });
    // The dedupe key is free again for a new send.
    const again = await enqueue(alice, S.idea, "survey_invite", { experiment_id: S.e, template: { subject: "a", body: "b" }, ids: [inv] }, `survey-email:${S.e}`);
    expect(again.created).toBe(true);
  });

  it("never claims a bounced address, stores the message ids and checks suppression hashes of the job's organisation", async () => {
    await drain();
    const bounced = await invitation(alice, S, `bounce-${randomUUID()}@voorbeeld.nl`);
    await db.query("update public.survey_invitations set status = 'failed', delivery_issue = 'bounced' where id = $1", [bounced]);
    const good = await invitation(alice, S, `goed-${randomUUID()}@voorbeeld.nl`);
    const j = await enqueue(alice, S.idea, "survey_invite", { experiment_id: S.e, template: { subject: "a", body: "b" }, ids: [bounced, good] }, null);
    await claim();
    const batch = await as("anon", async (c) => (await c.query("select public.job_survey_batch($1, $2, $3) as b", [ingestKey, j.id, [bounced, good]])).rows[0].b);
    const byId = Object.fromEntries(batch.items.map((i: { id: string }) => [i.id, i]));
    expect(byId[bounced]).toMatchObject({ delivery_issue: "bounced", salt_version: "v1" });
    expect(await mark(j.id, bounced, "claim")).toBeNull();
    expect(await mark(j.id, bounced, "suppress")).toBeNull();
    expect((await db.query("select status from public.survey_invitations where id = $1", [bounced])).rows[0].status).toBe("failed");
    expect(await mark(j.id, good, "claim")).not.toBeNull();
    const sent = (inv: string, id: string) => as("anon", async (c) => (await c.query("select public.job_survey_sent($1, $2, $3, $4) as ok", [ingestKey, j.id, inv, id])).rows[0].ok);
    expect(await sent(good, "msg_1")).toBe(true);
    expect((await db.query("select provider_message_id from public.survey_invitations where id = $1", [good])).rows[0].provider_message_id).toBe("msg_1");
    // An invitation outside the job is not touched.
    const outside = await invitation(alice, S, `buiten-${randomUUID()}@voorbeeld.nl`);
    expect(await sent(outside, "msg_2")).toBe(false);
    await expect(as("anon", (c) => c.query("select public.job_survey_sent($1, $2, $3, 'x')", ["wrong-key", j.id, good]))).rejects.toThrow(/FORBIDDEN/);

    const h = sha(`oud-${randomUUID()}`);
    await db.query("insert into public.email_suppressions (org_id, email_hash) values ($1, $2)", [S.org, h]);
    await db.query("insert into public.email_suppressions (org_id, email_hash) values ($1, $2)", [other.org, sha("ander")]);
    const listed = await as("anon", async (c) => (await c.query("select public.job_suppressed_hashes($1, $2, $3) as h", [ingestKey, j.id, [h, sha("ander"), sha("niemand")]])).rows[0].h);
    expect(listed).toEqual([h]);
    await expect(as("anon", (c) => c.query("select public.job_suppressed_hashes($1, $2, '{}')", ["wrong-key", j.id]))).rejects.toThrow(/FORBIDDEN/);
  });

  it("claims a reminder only three days after the first mail and only once", async () => {
    await drain();
    const due = await invitation(alice, S, `oud-${randomUUID()}@voorbeeld.nl`, "sent");
    const fresh = await invitation(alice, S, `nieuw-${randomUUID()}@voorbeeld.nl`);
    await db.query("update public.survey_invitations set status = 'sent', sent_at = now() - interval '1 day' where id = $1", [fresh]);
    const j = await enqueue(alice, S.idea, "survey_reminder", { experiment_id: S.e, template: { subject: "a", body: "b" }, ids: [due, fresh] }, null);
    await claim();
    expect(await mark(j.id, fresh, "claim")).toBeNull();
    expect(await mark(j.id, due, "claim")).not.toBeNull();
    expect(await mark(j.id, due, "claim")).toBeNull();
    // A temporary failure releases the reminder; it can be claimed again.
    expect(await mark(j.id, due, "release")).not.toBeNull();
    expect(await mark(j.id, due, "claim")).not.toBeNull();
  });
});
