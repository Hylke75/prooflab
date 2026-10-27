import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import { randomUUID, createHash } from "node:crypto";

// Runs against a throwaway local Postgres with the Supabase shim + migrations applied
// (see scripts/test-db.sh). Skipped when TEST_DATABASE_URL is not set.
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
      await db.query("select set_config('request.jwt.claims', $1, true)", [
        JSON.stringify({ sub: who.id, email: who.email, role: "authenticated" }),
      ]);
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
  await db.query("insert into auth.users (id, email) values ($1, $2)", [id, email]);
  return { id, email };
}

const ingestKey = "test-ingest-key";

async function newIdea(owner: { id: string; email: string }) {
  return as(owner, async (c) => {
    const org = (await c.query("select public.create_organization('Bureau ' || $1) as id", [owner.email])).rows[0].id;
    const idea = (
      await c.query(
        `insert into public.ideas (org_id, title, decision_question, project_type, description, target_audience, region)
         values ($1, 'Testidee', 'Investeren we €25.000?', 'new_product', 'Beschrijving', 'Eventmanagers', 'Nederland')
         returning id`,
        [org],
      )
    ).rows[0].id;
    return { org, idea };
  });
}

async function newExperiment(owner: { id: string; email: string }, idea: string) {
  return as(owner, async (c) => {
    const a = (
      await c.query(
        "insert into public.assumptions (idea_id, statement, category, importance) values ($1, 'Klanten vragen een demo aan', 'desirability', 5) returning id",
        [idea],
      )
    ).rows[0].id;
    const h = (
      await c.query(
        `insert into public.hypotheses (idea_id, assumption_id, we_believe, target_group, test_method, metric_label,
           metric_numerator, metric_denominator, success_threshold_pct, fail_threshold_pct, min_sample, max_duration_days)
         values ($1, $2, 'Eventmanagers vragen een demo aan', 'NL eventmanagers', 'landingspagina', 'aanvraagratio',
           'unieke aanvragen', 'unieke relevante bezoekers', 15, 5, 80, 21) returning id`,
        [idea, a],
      )
    ).rows[0].id;
    const e = (
      await c.query(
        "insert into public.experiments (idea_id, hypothesis_id, type, title) values ($1, $2, 'landing', 'Landingspagina') returning id",
        [idea, h],
      )
    ).rows[0].id;
    return { assumption: a, hypothesis: h, experiment: e };
  });
}

d("row level security and integrity rules", () => {
  let alice: { id: string; email: string };
  let bob: { id: string; email: string };
  let client: { id: string; email: string };
  let viewer: { id: string; email: string };
  let A: { org: string; idea: string };

  beforeAll(async () => {
    db = new Client({ connectionString: url });
    await db.connect();
    await db.query("insert into public.ingest_keys (key_hash) values ($1) on conflict do nothing", [
      createHash("sha256").update(ingestKey).digest("hex"),
    ]);
    alice = await user(`alice-${randomUUID()}@example.com`);
    bob = await user(`bob-${randomUUID()}@example.com`);
    client = await user(`klant-${randomUUID()}@example.com`);
    viewer = await user(`kijker-${randomUUID()}@example.com`);
    A = await newIdea(alice);
    await newIdea(bob);
  });

  afterAll(async () => {
    await db?.end();
  });

  it("isolates organisations from each other", async () => {
    const seen = await as(bob, async (c) => (await c.query("select id from public.ideas where id = $1", [A.idea])).rowCount);
    expect(seen).toBe(0);
    await expect(
      as(bob, (c) =>
        c.query("insert into public.claims (idea_id, statement, evidence_type) values ($1, 'x', 'ai_inference')", [A.idea]),
      ),
    ).rejects.toThrow(/row-level security/);
    const updated = await as(bob, async (c) => (await c.query("update public.ideas set title = 'Gekaapt' where id = $1", [A.idea])).rowCount);
    expect(updated).toBe(0);
  });

  it("gives anonymous visitors no table access", async () => {
    await expect(as("anon", (c) => c.query("select * from public.ideas"))).rejects.toThrow(/permission denied/);
    await expect(as("anon", (c) => c.query("select * from public.test_submissions"))).rejects.toThrow(/permission denied/);
  });

  it("lets an invited client read the idea but not change it or see raw participant data", async () => {
    await as(alice, (c) =>
      c.query("insert into public.idea_members (idea_id, email, role) values ($1, $2, 'client_decider'), ($1, $3, 'client_viewer')", [
        A.idea,
        client.email,
        viewer.email,
      ]),
    );
    const before = await as(client, async (c) => (await c.query("select id from public.ideas where id = $1", [A.idea])).rowCount);
    expect(before).toBe(0);
    const claimed = await as(client, async (c) => (await c.query("select public.claim_invitations() as n")).rows[0].n);
    expect(claimed).toBe(1);
    await as(viewer, (c) => c.query("select public.claim_invitations()"));
    const after = await as(client, async (c) => (await c.query("select id from public.ideas where id = $1", [A.idea])).rowCount);
    expect(after).toBe(1);
    const updated = await as(client, async (c) => (await c.query("update public.ideas set title = 'x' where id = $1", [A.idea])).rowCount);
    expect(updated).toBe(0);
    const interviews = await as(client, async (c) => (await c.query("select * from public.interviews where idea_id = $1", [A.idea])).rowCount);
    expect(interviews).toBe(0);
  });

  it("locks the hypothesis when an experiment is approved and enforces the state machine", async () => {
    const x = await newExperiment(alice, A.idea);
    await expect(
      as(alice, (c) => c.query("update public.experiments set state = 'live' where id = $1", [x.experiment])),
    ).rejects.toThrow(/EXPERIMENT_STATE/);
    await as(alice, (c) => c.query("update public.experiments set state = 'ready_for_review' where id = $1", [x.experiment]));
    await as(alice, (c) => c.query("update public.experiments set state = 'approved' where id = $1", [x.experiment]));
    const h = await as(alice, async (c) => (await c.query("select locked_at from public.hypotheses where id = $1", [x.hypothesis])).rows[0]);
    expect(h.locked_at).not.toBeNull();
    await expect(
      as(alice, (c) => c.query("update public.hypotheses set success_threshold_pct = 5 where id = $1", [x.hypothesis])),
    ).rejects.toThrow(/HYPOTHESIS_LOCKED/);
    await expect(
      as(alice, (c) => c.query("update public.experiments set config = '{\"headline\":\"anders\"}' where id = $1", [x.experiment])),
    ).rejects.toThrow(/EXPERIMENT_LOCKED/);
    await expect(
      as(alice, (c) =>
        c.query(
          `insert into public.hypotheses (idea_id, assumption_id, version, we_believe, target_group, test_method, metric_label,
             metric_numerator, metric_denominator, success_threshold_pct, min_sample, max_duration_days)
           values ($1, $2, 2, 'x', 'y', 'z', 'm', 'n', 'd', 10, 50, 14)`,
          [A.idea, x.assumption],
        ),
      ),
    ).rejects.toThrow(/HYPOTHESIS_REASON/);
  });

  it("only accepts deduplicated test events from live experiments with a valid ingest key", async () => {
    const x = await newExperiment(alice, A.idea);
    await as(alice, (c) => c.query("update public.experiments set state = 'ready_for_review' where id = $1", [x.experiment]));
    await as(alice, (c) => c.query("update public.experiments set state = 'approved' where id = $1", [x.experiment]));
    const slug = await as(alice, async (c) => (await c.query("select public_slug from public.experiments where id = $1", [x.experiment])).rows[0].public_slug);
    expect(slug).toMatch(/^[a-f0-9]{14}$/);

    const notLive = await as("anon", async (c) =>
      (await c.query("select public.record_test_event($1, $2, 'v1', 'view', 'a', 'linkedin') as ok", [ingestKey, slug])).rows[0].ok,
    );
    expect(notLive).toBe(false);

    await as(alice, (c) => c.query("update public.experiments set state = 'live' where id = $1", [x.experiment]));
    await expect(
      as("anon", (c) => c.query("select public.record_test_event('wrong', $1, 'v1', 'view', 'a', 'linkedin')", [slug])),
    ).rejects.toThrow(/FORBIDDEN/);

    const first = await as("anon", async (c) =>
      (await c.query("select public.record_test_event($1, $2, 'v1', 'view', 'a', 'linkedin') as ok", [ingestKey, slug])).rows[0].ok,
    );
    const again = await as("anon", async (c) =>
      (await c.query("select public.record_test_event($1, $2, 'v1', 'view', 'a', 'linkedin') as ok", [ingestKey, slug])).rows[0].ok,
    );
    expect(first).toBe(true);
    expect(again).toBe(false);

    const sub1 = await as("anon", async (c) =>
      (await c.query("select public.submit_test_form($1, $2, 'v1', 'a', 'linkedin', 'x@example.com', '{}', true, 'toestemming') as ok", [ingestKey, slug])).rows[0].ok,
    );
    const sub2 = await as("anon", async (c) =>
      (await c.query("select public.submit_test_form($1, $2, 'v1', 'a', 'linkedin', 'x@example.com', '{}', true, 'toestemming') as ok", [ingestKey, slug])).rows[0].ok,
    );
    expect(sub1).toBe(true);
    expect(sub2).toBe(false);
    const counts = await as(alice, async (c) =>
      (await c.query("select event_type, count(*)::int as n from public.test_events where experiment_id = $1 group by 1 order by 1", [x.experiment])).rows,
    );
    expect(counts).toEqual([
      { event_type: "submit", n: 1 },
      { event_type: "view", n: 1 },
    ]);
  });

  it("keeps decisions immutable and lets only the client decider confirm", async () => {
    const decision = await as(alice, async (c) => {
      const rc = (
        await c.query(
          "insert into public.reality_checks (idea_id, findings, advice, advice_reason) values ($1, '[]', 'test_more', 'Betaalbereidheid ontbreekt') returning id",
          [A.idea],
        )
      ).rows[0].id;
      return (
        await c.query(
          "insert into public.decisions (idea_id, reality_check_id, action, rationale) values ($1, $2, 'test_more', 'Eerst prijs testen') returning id",
          [A.idea, rc],
        )
      ).rows[0].id;
    });
    // No update policy exists for decisions, so a direct edit touches zero rows.
    const edited = await as(alice, async (c) =>
      (await c.query("update public.decisions set action = 'continue' where id = $1", [decision])).rowCount,
    );
    expect(edited).toBe(0);
    await expect(
      as(viewer, (c) => c.query("select public.confirm_decision($1, 'akkoord')", [decision])),
    ).rejects.toThrow(/FORBIDDEN/);
    const ok = await as(client, async (c) => (await c.query("select public.confirm_decision($1, 'akkoord') as ok", [decision])).rows[0].ok);
    expect(ok).toBe(true);
    const audit = await as(alice, async (c) =>
      (await c.query("select count(*)::int as n from public.audit_events where idea_id = $1 and table_name = 'decisions'", [A.idea])).rows[0].n,
    );
    expect(audit).toBeGreaterThanOrEqual(2);
  });
});
