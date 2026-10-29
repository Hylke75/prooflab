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

async function user(email: string, confirmed = true) {
  const id = randomUUID();
  await db.query("insert into auth.users (id, email, email_confirmed_at) values ($1, $2, $3)", [id, email, confirmed ? new Date() : null]);
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
      (await c.query("select public.record_test_event($1, $2, 'v1', 'view', 'a', 'linkedin', 'net1') as ok", [ingestKey, slug])).rows[0].ok,
    );
    expect(notLive).toBe(false);

    await as(alice, (c) => c.query("update public.experiments set state = 'live' where id = $1", [x.experiment]));
    await expect(
      as("anon", (c) => c.query("select public.record_test_event('wrong', $1, 'v1', 'view', 'a', 'linkedin', 'net1')", [slug])),
    ).rejects.toThrow(/FORBIDDEN/);

    const ev = async (visitor: string, event: string) =>
      as("anon", async (c) =>
        (await c.query("select public.record_test_event($1, $2, $3, $4, 'a', 'linkedin', 'net1') as ok", [ingestKey, slug, visitor, event])).rows[0].ok,
      );
    const submit = async (visitor: string) =>
      as("anon", async (c) =>
        (await c.query("select public.submit_test_form($1, $2, $3, 'a', 'linkedin', 'x@example.com', '{}', true, 'toestemming', 'net1') as ok", [ingestKey, slug, visitor])).rows[0].ok,
      );
    // Behaviour only counts in order: no click or submission without having seen the page.
    expect(await ev("v2", "cta_click")).toBe(false);
    expect(await submit("v2")).toBe(false);
    expect(await ev("v1", "view")).toBe(true);
    expect(await ev("v1", "view")).toBe(false);
    expect(await submit("v1")).toBe(false);
    expect(await ev("v1", "cta_click")).toBe(true);

    expect(await submit("v1")).toBe(true);
    expect(await submit("v1")).toBe(false);
    const counts = await as(alice, async (c) =>
      (await c.query("select event_type, count(*)::int as n from public.test_events where experiment_id = $1 group by 1 order by 1", [x.experiment])).rows,
    );
    expect(counts).toEqual([
      { event_type: "cta_click", n: 1 },
      { event_type: "submit", n: 1 },
      { event_type: "view", n: 1 },
    ]);
    const agg = await as(alice, async (c) => (await c.query("select * from public.experiment_event_counts($1)", [x.experiment])).rows);
    expect(agg).toEqual([{ channel: "linkedin", variant: "a", viewers: "1", clickers: "1", submitters: "1" }]);

    // Rate limit: at most 30 recorded actions per minute per network and page.
    let accepted = 0;
    for (let i = 0; i < 40; i++) {
      const ok = await as("anon", async (c) =>
        (await c.query("select public.record_test_event($1, $2, $3, 'view', 'a', 'linkedin', 'net2') as ok", [ingestKey, slug, `bulk-${i}`])).rows[0].ok,
      );
      if (ok) accepted++;
    }
    expect(accepted).toBe(30);

    // The pre-registered end date of a live test cannot be moved, and a live test cannot be deleted.
    const before = await as(alice, async (c) => (await c.query("select ends_at from public.experiments where id = $1", [x.experiment])).rows[0].ends_at);
    await as(alice, (c) => c.query("update public.experiments set ends_at = now() + interval '90 days' where id = $1", [x.experiment]));
    const after = await as(alice, async (c) => (await c.query("select ends_at from public.experiments where id = $1", [x.experiment])).rows[0].ends_at);
    expect(after).toEqual(before);
    const deleted = await as(alice, async (c) => (await c.query("delete from public.experiments where id = $1", [x.experiment])).rowCount);
    expect(deleted).toBe(0);
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
  it("never lets a consultant act as the client", async () => {
    // Inviting with an account attached is reserved for claim_invitations().
    await expect(
      as(alice, (c) => c.query("insert into public.idea_members (idea_id, user_id, email, role) values ($1, $2, $3, 'client_decider')", [A.idea, alice.id, alice.email])),
    ).rejects.toThrow(/row-level security/);
    // Even a properly claimed invitation does not let an organisation member confirm.
    await as(alice, (c) => c.query("insert into public.idea_members (idea_id, email, role) values ($1, $2, 'client_decider')", [A.idea, alice.email]));
    await as(alice, (c) => c.query("select public.claim_invitations()"));
    const decision = await as(alice, async (c) => {
      const rc = (await c.query("insert into public.reality_checks (idea_id, findings, advice, advice_reason) values ($1, '[]', 'adjust', 'x') returning id", [A.idea])).rows[0].id;
      return (await c.query("insert into public.decisions (idea_id, reality_check_id, action, rationale) values ($1, $2, 'adjust', 'y') returning id", [A.idea, rc])).rows[0].id;
    });
    await expect(as(alice, (c) => c.query("select public.confirm_decision($1, 'zelf')", [decision]))).rejects.toThrow(/FORBIDDEN/);
    await as(alice, (c) => c.query("delete from public.idea_members where idea_id = $1 and email = $2", [A.idea, alice.email]));
  });

  it("only lets confirmed e-mail addresses claim an invitation", async () => {
    const unconfirmed = await user(`onbevestigd-${randomUUID()}@example.com`, false);
    await as(alice, (c) => c.query("insert into public.idea_members (idea_id, email, role) values ($1, $2, 'client_decider')", [A.idea, unconfirmed.email]));
    const n = await as(unconfirmed, async (c) => (await c.query("select public.claim_invitations() as n")).rows[0].n);
    expect(n).toBe(0);
  });

  it("bases decisions on the latest Reality Check and blocks continuing past blockers", async () => {
    const ids = await as(alice, async (c) => {
      const old = (await c.query("insert into public.reality_checks (idea_id, findings, advice, advice_reason, created_at) values ($1, '[]', 'continue', 'oud', now() - interval '1 day') returning id", [A.idea])).rows[0].id;
      const blocked = (await c.query(`insert into public.reality_checks (idea_id, findings, advice, advice_reason) values ($1, '[{"code":"missing_consent","severity":"blocker"}]', 'pause', 'blokkade') returning id`, [A.idea])).rows[0].id;
      return { old, blocked };
    });
    await expect(
      as(alice, (c) => c.query("insert into public.decisions (idea_id, reality_check_id, action, rationale) values ($1, $2, 'adjust', 'x')", [A.idea, ids.old])),
    ).rejects.toThrow(/DECISION_CHECK/);
    await expect(
      as(alice, (c) => c.query("insert into public.decisions (idea_id, reality_check_id, action, rationale) values ($1, $2, 'continue', 'x')", [A.idea, ids.blocked])),
    ).rejects.toThrow(/DECISION_BLOCKED/);
    // Reality checks themselves are never rewritten.
    const changed = await as(alice, async (c) => (await c.query("update public.reality_checks set advice = 'continue' where id = $1", [ids.blocked])).rowCount);
    expect(changed).toBe(0);
  });

  it("keeps references inside one dossier", async () => {
    const B = await newIdea(alice);
    const claimA = await as(alice, async (c) =>
      (await c.query("insert into public.claims (idea_id, statement, evidence_type) values ($1, 'Bewering', 'ai_inference') returning id", [A.idea])).rows[0].id,
    );
    const assumptionB = await as(alice, async (c) =>
      (await c.query("insert into public.assumptions (idea_id, statement, category) values ($1, 'Aanname', 'desirability') returning id", [B.idea])).rows[0].id,
    );
    await expect(
      as(alice, (c) => c.query("insert into public.assumption_claims (assumption_id, claim_id, idea_id, relation) values ($1, $2, $3, 'supports')", [assumptionB, claimA, B.idea])),
    ).rejects.toThrow(/IDEA_MISMATCH/);
  });

  it("makes approved Learning Cards, reports and AI budgets tamper-proof", async () => {
    const x = await newExperiment(alice, A.idea);
    const card = await as(alice, async (c) =>
      (await c.query(
        `insert into public.learning_cards (experiment_id, idea_id, we_believed, we_observed, we_learned, therefore, verdict, data_reliability)
         values ($1, $2, 'a', 'b', 'c', 'd', 'pass', 'medium') returning id`, [x.experiment, A.idea])).rows[0].id,
    );
    // Generating a second concept card for the same experiment is refused.
    await expect(
      as(alice, (c) => c.query(
        `insert into public.learning_cards (experiment_id, idea_id, we_believed, we_observed, we_learned, therefore, verdict, data_reliability)
         values ($1, $2, 'a', 'b', 'c', 'd', 'pass', 'medium')`, [x.experiment, A.idea])),
    ).rejects.toThrow(/learning_cards_one_draft/);
    await as(alice, (c) => c.query("update public.learning_cards set status = 'approved' where id = $1", [card]));
    await expect(as(alice, (c) => c.query("update public.learning_cards set verdict = 'fail' where id = $1", [card]))).rejects.toThrow(/CARD_LOCKED/);
    await expect(as(alice, (c) => c.query("delete from public.learning_cards where id = $1", [card]))).rejects.toThrow(/CARD_LOCKED/);

    const report = await as(alice, async (c) =>
      (await c.query("insert into public.reports (idea_id, version, snapshot) values ($1, 1, '{}') returning id", [A.idea])).rows[0].id,
    );
    expect(await as(alice, async (c) => (await c.query("delete from public.reports where id = $1", [report])).rowCount)).toBe(0);
    await expect(as(alice, (c) => c.query(`update public.reports set snapshot = '{"x":1}' where id = $1`, [report]))).rejects.toThrow(/REPORT_LOCKED/);
    // Unshared versions stay invisible to the client; after sharing the client can see and mark them.
    expect(await as(client, async (c) => (await c.query("select id from public.reports where id = $1", [report])).rowCount)).toBe(0);
    await as(alice, (c) => c.query("update public.reports set shared_at = now() where id = $1", [report]));
    expect(await as(client, async (c) => (await c.query("select public.mark_report_viewed($1) as ok", [report])).rows[0].ok)).toBe(true);
    const r = await as(alice, async (c) => (await c.query("select shared_by, client_viewed_at from public.reports where id = $1", [report])).rows[0]);
    expect(r.shared_by).toBe(alice.id);
    expect(r.client_viewed_at).not.toBeNull();

    await expect(
      as(alice, (c) => c.query("insert into public.research_runs (idea_id, mode, budget_usd) values ($1, 'deep', 99999)", [A.idea])),
    ).rejects.toThrow(/RUN_BUDGET/);
    const run = await as(alice, async (c) => {
      const id = (await c.query("insert into public.research_runs (idea_id, mode, budget_usd) values ($1, 'deep', 3) returning id", [A.idea])).rows[0].id;
      const task = (await c.query("insert into public.research_tasks (run_id, idea_id, position, kind, label) values ($1, $2, 1, 'plan', 'Plan') returning id", [id, A.idea])).rows[0].id;
      await c.query("select public.add_research_cost($1, 0.75)", [task]);
      await c.query("update public.research_runs set cost_usd = 0, budget_usd = 500 where id = $1", [id]);
      return (await c.query("select cost_usd, budget_usd from public.research_runs where id = $1", [id])).rows[0];
    });
    expect(Number(run.cost_usd)).toBe(0.75);
    expect(Number(run.budget_usd)).toBe(3);
  });

  it("shows clients observations without the literal quote", async () => {
    await as(alice, (c) =>
      c.query("insert into public.observations (idea_id, kind, summary, quote) values ($1, 'problem_confirmed', 'Herkent het probleem', 'Wij verliezen elke week uren')", [A.idea]),
    );
    expect(await as(client, async (c) => (await c.query("select * from public.observations where idea_id = $1", [A.idea])).rowCount)).toBe(0);
    const rows = await as(client, async (c) => (await c.query("select summary, quote from public.observations_for_idea($1)", [A.idea])).rows);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r: { quote: string | null }) => r.quote === null)).toBe(true);
    const own = await as(alice, async (c) => (await c.query("select quote from public.observations_for_idea($1) where quote is not null", [A.idea])).rowCount);
    expect(own).toBeGreaterThan(0);
  });

  it("keeps the audit trail when an idea is deleted", async () => {
    const C = await newIdea(alice);
    await as(alice, (c) => c.query("insert into public.claims (idea_id, statement, evidence_type) values ($1, 'Weg', 'ai_inference')", [C.idea]));
    await as(alice, (c) => c.query("delete from public.ideas where id = $1", [C.idea]));
    const n = await as(alice, async (c) =>
      (await c.query("select count(*)::int as n from public.audit_events where idea_id = $1 and action = 'delete'", [C.idea])).rows[0].n,
    );
    expect(n).toBeGreaterThanOrEqual(2);
  });
});
