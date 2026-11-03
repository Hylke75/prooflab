import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import { randomUUID } from "node:crypto";

// Methode 2026-11-b (supabase/migrations/20261106110000_method_v2.sql): de beslisregel op de Test Card wordt
// na goedkeuring mee vergrendeld. Draait tegen een wegwerp-Postgres (scripts/test-db.sh); overgeslagen zonder
// TEST_DATABASE_URL.
const url = process.env.TEST_DATABASE_URL;
const d = url ? describe : describe.skip;

let db: Client;
type U = { id: string; email: string };

async function as<T>(who: U, fn: (c: Client) => Promise<T>): Promise<T> {
  await db.query("begin");
  try {
    await db.query("set local role authenticated");
    await db.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: who.id, email: who.email, role: "authenticated" })]);
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

async function newIdea(owner: U) {
  return as(owner, async (c) => {
    const org = (await c.query("select public.create_organization('Bureau ' || $1) as id", [owner.email])).rows[0].id as string;
    const idea = (
      await c.query(
        `insert into public.ideas (org_id, title, decision_question, project_type, description, target_audience, region)
         values ($1, 'Methode-idee', 'Investeren we €25.000?', 'new_product', 'Beschrijving', 'Eventmanagers', 'Nederland') returning id`,
        [org],
      )
    ).rows[0].id as string;
    return { org, idea };
  });
}

async function hypothesisWithRule(owner: U, idea: string, rule: "absolute" | "probability") {
  return as(owner, async (c) => {
    const a = (await c.query("insert into public.assumptions (idea_id, statement, category, importance) values ($1, 'Klanten betalen vooraf', 'viability', 5) returning id", [idea])).rows[0].id;
    const h = (
      await c.query(
        `insert into public.hypotheses (idea_id, assumption_id, we_believe, target_group, test_method, metric_label,
           metric_numerator, metric_denominator, success_threshold_pct, fail_threshold_pct, min_sample, max_duration_days,
           decision_rule, success_count, required_n, expected_pct, available_per_week)
         values ($1, $2, 'Eventmanagers doen een aanbetaling na het gesprek', 'NL eventmanagers', 'interviews', 'aanbetaling',
           'geïnterviewden met aanbetaling', 'geïnterviewden', 20, null, 15, 21, $3, $4, 15, 20, 5) returning id`,
        [idea, a, rule, rule === "absolute" ? 3 : null],
      )
    ).rows[0].id;
    const e = (await c.query("insert into public.experiments (idea_id, hypothesis_id, type, title) values ($1, $2, 'interview', 'Gesprekken') returning id", [idea, h])).rows[0].id;
    return { hypothesis: h as string, experiment: e as string };
  });
}

d("methode 2026-11-b", () => {
  let owner: U;
  let A: { org: string; idea: string };

  beforeAll(async () => {
    db = new Client({ connectionString: url });
    await db.connect();
    owner = await user(`eigenaar-${randomUUID()}@example.com`);
    A = await newIdea(owner);
  });

  afterAll(async () => {
    await db?.end();
  });

  it("vergrendelt de beslisregel en de vooraf berekende aantallen na goedkeuring", async () => {
    const x = await hypothesisWithRule(owner, A.idea, "absolute");
    // Vóór goedkeuring mag de regel nog veranderen.
    await as(owner, (c) => c.query("update public.hypotheses set success_count = 4 where id = $1", [x.hypothesis]));
    await as(owner, (c) => c.query("update public.experiments set state = 'ready_for_review' where id = $1", [x.experiment]));
    await as(owner, (c) => c.query("update public.experiments set state = 'approved' where id = $1", [x.experiment]));
    for (const change of [
      "decision_rule = 'probability', success_count = null",
      "success_count = 2",
      "required_n = 5",
      "expected_pct = 50",
      "available_per_week = 100",
    ]) {
      await expect(as(owner, (c) => c.query(`update public.hypotheses set ${change} where id = $1`, [x.hypothesis]))).rejects.toThrow(/HYPOTHESIS_LOCKED/);
      // Ook buiten de rijbeveiliging om (servicerol) houdt de trigger het tegen.
      await expect(db.query(`update public.hypotheses set ${change} where id = $1`, [x.hypothesis])).rejects.toThrow(/HYPOTHESIS_LOCKED/);
    }
    const row = (await db.query("select decision_rule, success_count, required_n, expected_pct::float, available_per_week from public.hypotheses where id = $1", [x.hypothesis])).rows[0];
    expect(row).toEqual({ decision_rule: "absolute", success_count: 4, required_n: 15, expected_pct: 20, available_per_week: 5 });
  });

  it("accepteert alleen bekende beslisregels en een aantal bij de aantalregel", async () => {
    await expect(hypothesisWithRule(owner, A.idea, "onbekend" as "absolute")).rejects.toThrow(/check/);
    await expect(
      as(owner, async (c) => {
        const a = (await c.query("insert into public.assumptions (idea_id, statement, category, importance) values ($1, 'x x x', 'viability', 3) returning id", [A.idea])).rows[0].id;
        await c.query(
          `insert into public.hypotheses (idea_id, assumption_id, we_believe, target_group, test_method, metric_label, metric_numerator, metric_denominator,
             success_threshold_pct, min_sample, max_duration_days, decision_rule) values ($1, $2, 'w', 't', 'm', 'l', 'n', 'd', 20, 15, 21, 'absolute')`,
          [A.idea, a],
        );
      }),
    ).rejects.toThrow(/hypotheses_absolute_count/);
  });
});
