import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import { randomUUID } from "node:crypto";

// Database rules behind the quantification features (pre-mortem assumptions, Monte Carlo ranges).
// Runs against a throwaway local Postgres with the Supabase shim + migrations applied
// (see scripts/test-db.sh). Skipped when TEST_DATABASE_URL is not set.
const url = process.env.TEST_DATABASE_URL;
const d = url ? describe : describe.skip;

let db: Client;

type Who = { id: string; email: string };

async function as<T>(who: Who, fn: (c: Client) => Promise<T>): Promise<T> {
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

async function user(email: string) {
  const id = randomUUID();
  await db.query("insert into auth.users (id, email, email_confirmed_at) values ($1, $2, now())", [id, email]);
  return { id, email };
}

async function newIdea(owner: Who) {
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

d("quantification: pre-mortem and sizing ranges", () => {
  let alice: Who;
  let bob: Who;
  let client: Who;
  let A: { org: string; idea: string };

  beforeAll(async () => {
    db = new Client({ connectionString: url });
    await db.connect();
    alice = await user(`alice-${randomUUID()}@example.com`);
    bob = await user(`bob-${randomUUID()}@example.com`);
    client = await user(`klant-${randomUUID()}@example.com`);
    A = await newIdea(alice);
    await newIdea(bob);
    await as(alice, (c) => c.query("insert into public.idea_members (idea_id, email, role) values ($1, $2, 'client_decider')", [A.idea, client.email]));
    await as(client, (c) => c.query("select public.claim_invitations()"));
  });

  afterAll(async () => {
    await db?.end();
  });

  it("lets the consultant store pre-mortem reasons as assumptions, and nobody else", async () => {
    const row = await as(alice, async (c) =>
      (
        await c.query(
          "insert into public.assumptions (idea_id, statement, category, importance, origin) values ($1, 'Eventmanagers stappen zonder moeite over', 'desirability', 4, 'premortem') returning origin, status",
          [A.idea],
        )
      ).rows[0],
    );
    expect(row).toEqual({ origin: "premortem", status: "untested" });
    // The client can read it but not add one.
    const seen = await as(client, async (c) => (await c.query("select id from public.assumptions where idea_id = $1 and origin = 'premortem'", [A.idea])).rowCount);
    expect(seen).toBe(1);
    await expect(
      as(client, (c) =>
        c.query("insert into public.assumptions (idea_id, statement, category, importance, origin) values ($1, 'Klant voegt toe', 'desirability', 4, 'premortem')", [A.idea]),
      ),
    ).rejects.toThrow(/row-level security/);
    await expect(
      as(bob, (c) =>
        c.query("insert into public.assumptions (idea_id, statement, category, importance, origin) values ($1, 'Ander bureau', 'desirability', 4, 'premortem')", [A.idea]),
      ),
    ).rejects.toThrow(/row-level security/);
    await expect(
      as(alice, (c) =>
        c.query("insert into public.assumptions (idea_id, statement, category, importance, origin) values ($1, 'Onbekende herkomst', 'desirability', 4, 'guess')", [A.idea]),
      ),
    ).rejects.toThrow(/assumptions_origin_check/);
  });

  it("stores a 90% range per sizing factor and refuses an inverted or negative range", async () => {
    const factor = await as(alice, async (c) => {
      await c.query("insert into public.sizing_scenarios (idea_id, kind) values ($1, 'realistic') on conflict do nothing", [A.idea]);
      const scenario = (await c.query("select id from public.sizing_scenarios where idea_id = $1 and kind = 'realistic'", [A.idea])).rows[0].id;
      await c.query(
        "insert into public.sizing_factors (scenario_id, idea_id, key, label, value, unit, position) values ($1, $2, 'quantify_test', 'Test', 20, 'percent', 99) on conflict (scenario_id, key) do nothing",
        [scenario, A.idea],
      );
      return (await c.query("select id from public.sizing_factors where scenario_id = $1 and key = 'quantify_test'", [scenario])).rows[0].id as string;
    });
    const ok = await as(alice, async (c) =>
      (await c.query("update public.sizing_factors set low_value = 10, high_value = 35 where id = $1 returning low_value, high_value", [factor])).rows[0],
    );
    expect(ok).toEqual({ low_value: "10", high_value: "35" });
    await expect(as(alice, (c) => c.query("update public.sizing_factors set low_value = 40, high_value = 35 where id = $1", [factor]))).rejects.toThrow(
      /sizing_factors_range_order/,
    );
    await expect(as(alice, (c) => c.query("update public.sizing_factors set low_value = -1 where id = $1", [factor]))).rejects.toThrow(/check constraint/);
    // Clearing the range is allowed (the factor then stays fixed in the simulation).
    const cleared = await as(alice, async (c) =>
      (await c.query("update public.sizing_factors set low_value = null, high_value = null where id = $1", [factor])).rowCount,
    );
    expect(cleared).toBe(1);
    const byClient = await as(client, async (c) => (await c.query("update public.sizing_factors set low_value = 1, high_value = 2 where id = $1", [factor])).rowCount);
    expect(byClient).toBe(0);
  });
});
