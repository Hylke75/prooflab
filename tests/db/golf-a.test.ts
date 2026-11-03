import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import { randomUUID } from "node:crypto";

// Golf A (supabase/migrations/20261107090000_golf_a.sql): methode 2026-11-c en de database-afspraken rond bewijs
// en testen. Draait tegen een wegwerp-Postgres (scripts/test-db.sh); overgeslagen zonder TEST_DATABASE_URL.
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
         values ($1, 'Golf A', 'Investeren we €25.000?', 'new_product', 'Beschrijving', 'Eventmanagers', 'Nederland') returning id`,
        [org],
      )
    ).rows[0].id as string;
    return { org, idea };
  });
}

// Zet de methodeversie buiten de triggers om, zoals een dossier van vóór de migratie.
async function forceVersion(idea: string, v: string) {
  await db.query("begin");
  await db.query("set local session_replication_role = replica");
  await db.query("update public.ideas set method_version = $2 where id = $1", [idea, v]);
  await db.query("commit");
}

d("golf A", () => {
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

  it("methode 2026-11-c: standaard voor nieuwe dossiers; overstappen van a of b naar c, nooit terug", async () => {
    expect((await db.query("select method_version from public.ideas where id = $1", [A.idea])).rows[0].method_version).toBe("2026-11-c");
    const a = await newIdea(owner);
    const b = await newIdea(owner);
    await forceVersion(a.idea, "2026-11-a");
    await forceVersion(b.idea, "2026-11-b");
    expect(await as(owner, async (c) => (await c.query("select public.switch_method_version($1, '2026-11-c', '{}'::jsonb) as v", [a.idea])).rows[0].v)).toBe("2026-11-c");
    expect(await as(owner, async (c) => (await c.query("select public.switch_method_version($1, '2026-11-c', '{}'::jsonb) as v", [b.idea])).rows[0].v)).toBe("2026-11-c");
    const audit = (await db.query("select detail from public.audit_events where idea_id = $1 and action = 'method_switch'", [b.idea])).rows;
    expect(audit[0].detail).toMatchObject({ from: "2026-11-b", to: "2026-11-c" });
    await expect(as(owner, (c) => c.query("select public.switch_method_version($1, '2026-11-b', '{}'::jsonb)", [A.idea]))).rejects.toThrow(/METHOD_VERSION/);
    await expect(db.query("update public.ideas set method_version = '2026-11-a' where id = $1", [b.idea])).rejects.toThrow(/METHOD_VERSION/);
    await expect(db.query("update public.ideas set method_version = '2026-11-d' where id = $1", [A.idea])).rejects.toThrow(/check|METHOD_VERSION/);
  });
});
