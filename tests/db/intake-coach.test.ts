import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import { createHash, randomUUID } from "node:crypto";

// Databasekant van migratie 20261106100000_intake_coach.sql: inzet bij de intake, de uitgebreide
// uitkomstdefinitie en de vergrendeling daarvan. Draait tegen een lokale Postgres (scripts/test-db.sh);
// overgeslagen zonder TEST_DATABASE_URL.
const url = process.env.TEST_DATABASE_URL;
const d = url ? describe : describe.skip;
const ingestKey = "intake-coach-test-key";

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

async function newIdea(owner: Who, org: string, extra = "", values = ""): Promise<string> {
  return as(owner, async (c) =>
    (
      await c.query(
        `insert into public.ideas (org_id, title, decision_question, project_type, description, target_audience, region,
           outcome_statement, outcome_metric, outcome_target${extra})
         values ($1, 'Testidee', 'Investeren we €25.000?', 'new_product', 'Beschrijving', 'Eventmanagers', 'Nederland',
           'Zes maanden na het besluit hebben 15 klanten betaald', 'betalende klanten', 15${values})
         returning id`,
        [org],
      )
    ).rows[0].id,
  );
}

d("intake en succescriterium", () => {
  let alice: Who;
  let org: string;

  beforeAll(async () => {
    db = new Client({ connectionString: url });
    await db.connect();
    await db.query("insert into public.ingest_keys (key_hash) values ($1) on conflict do nothing", [createHash("sha256").update(ingestKey).digest("hex")]);
    alice = await user(`alice-${randomUUID()}@example.com`);
    org = await as(alice, async (c) => (await c.query("select public.create_organization('Bureau intake') as id")).rows[0].id);
  });

  afterAll(async () => {
    await db?.end();
  });

  it("bewaart de inzet als soort plus getal, en weigert een half ingevulde inzet", async () => {
    const idea = await newIdea(alice, org, ", stake_kind, stake_value, decision_deadline", ", 'time', 120, current_date + 30");
    const row = await as(alice, async (c) => (await c.query("select stake_kind, stake_value::float from public.ideas where id = $1", [idea])).rows[0]);
    expect(row).toEqual({ stake_kind: "time", stake_value: 120 });
    await expect(as(alice, (c) => c.query("update public.ideas set stake_value = null where id = $1", [idea]))).rejects.toThrow(/ideas_stake_pair/);
    await expect(as(alice, (c) => c.query("update public.ideas set stake_kind = 'geld' where id = $1", [idea]))).rejects.toThrow(/check/);
    // Bestaande ideeën zonder inzet blijven geldig.
    await newIdea(alice, org);
  });

  it("vergrendelt ook bedrag per klant, omzetdoel en meetdatum zodra er een voorspelling is", async () => {
    const idea = await newIdea(
      alice,
      org,
      ", outcome_min_value_per_customer, outcome_revenue_target, outcome_measure_date",
      ", 1500, 22500, current_date + 120",
    );
    // Voor de eerste voorspelling mag de definitie nog veranderen.
    await as(alice, (c) => c.query("update public.ideas set outcome_revenue_target = 30000 where id = $1", [idea]));
    await as(alice, (c) =>
      c.query("insert into public.forecasts (idea_id, moment, forecaster_kind, forecaster_id, probability, rationale) values ($1, 'intake', 'consultant', $2, 0.3, 'Eén zin waarom')", [idea, alice.id]),
    );
    for (const set of ["outcome_min_value_per_customer = 10", "outcome_revenue_target = 1", "outcome_measure_date = current_date + 10"]) {
      await expect(as(alice, (c) => c.query(`update public.ideas set ${set} where id = $1`, [idea]))).rejects.toThrow(/OUTCOME_LOCKED/);
    }
    await expect(as(alice, (c) => c.query("update public.ideas set outcome_revenue_target = -5 where id = $1", [idea]))).rejects.toThrow();
  });
});
