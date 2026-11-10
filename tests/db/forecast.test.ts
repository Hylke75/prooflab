import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import { createHash, randomUUID } from "node:crypto";

const ingestKey = "forecast-test-key";

// The database side of the forecasting and outcome loop as the app uses it (intake, base rate, decision
// clock, AI forecasts, check-in, outcome, own base rate). Runs against a throwaway local Postgres with the
// Supabase shim + migrations applied (scripts/test-db.sh). Skipped when TEST_DATABASE_URL is not set.
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

async function user(email: string): Promise<Who> {
  const id = randomUUID();
  await db.query("insert into auth.users (id, email, email_confirmed_at) values ($1, $2, now())", [id, email]);
  return { id, email };
}

const DEFINED = `outcome_statement, outcome_metric, outcome_target`;

async function newOrg(owner: Who): Promise<string> {
  return as(owner, async (c) => (await c.query("select public.create_organization('Bureau ' || $1) as id", [owner.email])).rows[0].id);
}

// An idea created through the intake: the outcome definition is part of the insert.
async function newIdea(owner: Who, org: string, projectType = "new_product"): Promise<string> {
  return as(owner, async (c) =>
    (
      await c.query(
        `insert into public.ideas (org_id, title, decision_question, project_type, description, target_audience, region, ${DEFINED})
         values ($1, 'Testidee', 'Investeren we €25.000?', $2, 'Beschrijving', 'Eventmanagers', 'Nederland',
           'Zes maanden na het besluit hebben 15 klanten betaald', 'betalende klanten', 15)
         returning id`,
        [org, projectType],
      )
    ).rows[0].id,
  );
}

const forecast = (c: Client, idea: string, moment: string, kind: string, who: string | null, p: number) =>
  c.query("insert into public.forecasts (idea_id, moment, forecaster_kind, forecaster_id, probability, rationale) values ($1, $2, $3, $4, $5, 'Eén zin waarom')", [
    idea,
    moment,
    kind,
    who,
    p,
  ]);

d("forecasting and outcome loop", () => {
  let alice: Who;
  let client: Who;
  let org: string;

  beforeAll(async () => {
    db = new Client({ connectionString: url });
    await db.connect();
    await db.query("insert into public.ingest_keys (key_hash) values ($1) on conflict do nothing", [createHash("sha256").update(ingestKey).digest("hex")]);
    alice = await user(`alice-${randomUUID()}@example.com`);
    client = await user(`klant-${randomUUID()}@example.com`);
    org = await newOrg(alice);
  });

  afterAll(async () => {
    await db?.end();
  });

  it("stores the base rate copied from a reference class, and only a consultant can set it", async () => {
    const idea = await newIdea(alice, org);
    const cls = await as(alice, async (c) => (await c.query("select id, low, high from public.reference_classes order by position limit 1")).rows[0]);
    await as(alice, (c) =>
      c.query("update public.ideas set reference_class = $2, base_rate_low = $3, base_rate_high = $4, base_rate_note = 'MKB wijkt af' where id = $1", [idea, cls.id, cls.low, cls.high]),
    );
    const row = await as(alice, async (c) => (await c.query("select reference_class, base_rate_low::float, base_rate_high::float from public.ideas where id = $1", [idea])).rows[0]);
    expect(row).toEqual({ reference_class: cls.id, base_rate_low: Number(cls.low), base_rate_high: Number(cls.high) });
    await as(alice, (c) => c.query("insert into public.idea_members (idea_id, email, role) values ($1, $2, 'client_decider')", [idea, client.email]));
    await as(client, (c) => c.query("select public.claim_invitations()"));
    const changed = await as(client, async (c) => (await c.query("update public.ideas set reference_class = 'none' where id = $1", [idea])).rowCount);
    expect(changed).toBe(0);
    // "No good reference" keeps the range empty.
    await as(alice, (c) => c.query("update public.ideas set reference_class = 'none', base_rate_low = null, base_rate_high = null, base_rate_note = 'Geen vergelijkbare markt' where id = $1", [idea]));
  });

  it("starts the six-month clock once at the decision, also after forecasts exist", async () => {
    const idea = await newIdea(alice, org);
    // The decision moment is open once a realiteitscheck exists.
    await as(alice, (c) => c.query("insert into public.reality_checks (idea_id, findings, advice, advice_reason) values ($1, '[]', 'test_more', 'Nog te weinig bewijs')", [idea]));
    await expect(as(alice, (c) => forecast(c, idea, "intake", "consultant", alice.id, 0.4))).rejects.toThrow(/FORECAST_MOMENT/);
    await as(alice, (c) => forecast(c, idea, "decision", "consultant", alice.id, 0.4));
    await as(alice, (c) => c.query("update public.ideas set outcome_due = (current_date + interval '6 months')::date where id = $1 and outcome_due is null", [idea]));
    await expect(as(alice, (c) => c.query("update public.ideas set outcome_due = current_date + 30 where id = $1", [idea]))).rejects.toThrow(/OUTCOME_LOCKED/);
    // A later decision leaves the clock alone (the app filters on outcome_due is null).
    const touched = await as(alice, async (c) => (await c.query("update public.ideas set outcome_due = current_date where id = $1 and outcome_due is null", [idea])).rowCount);
    expect(touched).toBe(0);
  });

  it("records one AI forecast per moment, hidden from the consultant until their own forecast", async () => {
    const idea = await newIdea(alice, org);
    // A user cannot type in an "AI" forecast; only the app server can record one (ingest secret).
    await expect(
      as(alice, (c) => c.query("insert into public.forecasts (idea_id, moment, forecaster_kind, forecaster_id, probability, rationale, model) values ($1, 'intake', 'ai', null, 0.25, 'Weinig bewijs', 'model')", [idea])),
    ).rejects.toThrow(/row-level security/);
    await expect(as(alice, (c) => c.query("select public.record_ai_forecast('fout', $1, 'intake', 0.25, 'x', 'model')", [idea]))).rejects.toThrow(/FORBIDDEN/);
    await as(alice, (c) => c.query("select public.record_ai_forecast($1, $2, 'intake', 0.25, 'Weinig bewijs', 'model')", [ingestKey, idea]));
    expect(await as(alice, async (c) => (await c.query("select 1 from public.forecasts where idea_id = $1", [idea])).rowCount)).toBe(0);
    await as(alice, (c) => forecast(c, idea, "intake", "consultant", alice.id, 0.35));
    expect(await as(alice, async (c) => (await c.query("select 1 from public.forecasts where idea_id = $1", [idea])).rowCount)).toBe(2);
    expect(await as(alice, async (c) => (await c.query("select public.record_ai_forecast($1, $2, 'intake', 0.3, 'Nog een', 'model') as ok", [ingestKey, idea])).rows[0].ok)).toBe(false);
    await expect(as(alice, (c) => forecast(c, idea, "intake", "consultant", alice.id, 0.5))).rejects.toThrow(/duplicate key/);
  });

  it("lets the consultant record the check-in and the outcome once, never the client", async () => {
    const idea = await newIdea(alice, org);
    await as(alice, (c) => c.query("insert into public.idea_members (idea_id, email, role) values ($1, $2, 'client_decider')", [idea, client.email]));
    await as(client, (c) => c.query("select public.claim_invitations()"));
    await expect(
      as(client, (c) => c.query("insert into public.outcome_checkins (idea_id, on_track, note) values ($1, 'yes', 'Gaat goed')", [idea])),
    ).rejects.toThrow(/row-level security/);
    await as(alice, (c) => c.query("insert into public.outcome_checkins (idea_id, on_track, current_value, note) values ($1, 'unsure', 6, 'Zes klanten na drie maanden')", [idea]));
    expect(await as(client, async (c) => (await c.query("select on_track from public.outcome_checkins where idea_id = $1", [idea])).rows)).toEqual([{ on_track: "unsure" }]);
    await expect(
      as(client, (c) => c.query("insert into public.idea_outcomes (idea_id, achieved, evidence) values ($1, 'yes', 'Volgens mij gehaald')", [idea])),
    ).rejects.toThrow(/row-level security/);
    await as(alice, (c) => c.query("insert into public.idea_outcomes (idea_id, achieved, actual_value, evidence) values ($1, 'partial', 11, 'Elf betalende klanten volgens de boekhouding')", [idea]));
    await expect(
      as(alice, (c) => c.query("insert into public.idea_outcomes (idea_id, achieved, evidence) values ($1, 'yes', 'Toch gehaald, achteraf')", [idea])),
    ).rejects.toThrow(/duplicate key/);
    // The client sees the outcome.
    expect(await as(client, async (c) => (await c.query("select achieved from public.idea_outcomes where idea_id = $1", [idea])).rows)).toEqual([{ achieved: "partial" }]);
  });

  it("gives an own base rate per project type only from ten resolved ideas", async () => {
    const owner = await user(`bureau-${randomUUID()}@example.com`);
    const own = await newOrg(owner);
    for (let i = 0; i < 10; i++) {
      const idea = await newIdea(owner, own, "expansion");
      await as(owner, (c) => c.query("insert into public.idea_outcomes (idea_id, achieved, evidence) values ($1, $2, 'Gemeten na zes maanden')", [idea, i < 3 ? "yes" : i < 5 ? "partial" : "no"]));
      if (i === 8) {
        expect(await as(owner, async (c) => (await c.query("select * from public.own_base_rate($1, 'expansion')", [own])).rowCount)).toBe(0);
        const few = await as(owner, async (c) => (await c.query("select resolved::int from public.own_base_rate($1, 'expansion', 1)", [own])).rows[0]);
        expect(few.resolved).toBe(9);
      }
    }
    const rate = await as(owner, async (c) => (await c.query("select resolved::int, round(achieved, 2)::float as achieved from public.own_base_rate($1, 'expansion')", [own])).rows[0]);
    expect(rate).toEqual({ resolved: 10, achieved: 0.4 });
    expect(await as(owner, async (c) => (await c.query("select * from public.own_base_rate($1, 'new_product')", [own])).rowCount)).toBe(0);
    // Calibration buckets for the org: nobody forecast here, so none.
    expect(await as(owner, async (c) => (await c.query("select * from public.forecast_calibration($1)", [own])).rowCount)).toBe(0);
    // Another organisation sees nothing.
    expect(await as(alice, async (c) => (await c.query("select * from public.own_base_rate($1, 'expansion', 1)", [own])).rowCount)).toBe(0);
  });
});
