import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import { randomUUID } from "node:crypto";

// Methode 2026-11-d (supabase/migrations/20261109100000_method_d.sql): nieuwe dossiers starten op 2026-11-d,
// bestaande dossiers houden hun versie en stappen alleen vooruit over, met audit. Draait tegen een
// wegwerp-Postgres (scripts/test-db.sh); overgeslagen zonder TEST_DATABASE_URL.
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
         values ($1, 'Methode D', 'Investeren we €25.000?', 'new_product', 'Beschrijving', 'Eventmanagers', 'Nederland') returning id`,
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

const versionOf = async (idea: string) => (await db.query("select method_version from public.ideas where id = $1", [idea])).rows[0].method_version as string;

d("methode 2026-11-d in de database", () => {
  let owner: U;

  beforeAll(async () => {
    db = new Client({ connectionString: url });
    await db.connect();
    owner = await user(`eigenaar-${randomUUID()}@example.com`);
  });

  afterAll(async () => {
    await db?.end();
  });

  it("een nieuw dossier start op 2026-11-d", async () => {
    const { idea } = await newIdea(owner);
    expect(await versionOf(idea)).toBe("2026-11-d");
  });

  it("een bestaand dossier houdt zijn versie zolang niemand overstapt", async () => {
    const { idea } = await newIdea(owner);
    await forceVersion(idea, "2026-11-c");
    await as(owner, (c) => c.query("update public.ideas set title = 'Nieuwe titel' where id = $1", [idea]));
    expect(await versionOf(idea)).toBe("2026-11-c");
  });

  it("overstappen van c naar d kan, met audit; terug naar c niet", async () => {
    const { idea } = await newIdea(owner);
    await forceVersion(idea, "2026-11-c");
    expect(await as(owner, async (c) => (await c.query("select public.switch_method_version($1, '2026-11-d', '{}'::jsonb) as v", [idea])).rows[0].v)).toBe("2026-11-d");
    const audit = (await db.query("select detail, actor_id from public.audit_events where idea_id = $1 and action = 'method_switch'", [idea])).rows;
    expect(audit).toHaveLength(1);
    expect(audit[0].detail).toMatchObject({ from: "2026-11-c", to: "2026-11-d" });
    expect(audit[0].actor_id).toBe(owner.id);
    await expect(as(owner, (c) => c.query("select public.switch_method_version($1, '2026-11-c', '{}'::jsonb)", [idea]))).rejects.toThrow(/METHOD_VERSION/);
    await expect(db.query("update public.ideas set method_version = '2026-11-c' where id = $1", [idea])).rejects.toThrow(/METHOD_VERSION.*2026-11-d/);
  });

  it("ook van 2026-11-a direct naar 2026-11-d; een onbekende versie wordt geweigerd", async () => {
    const { idea } = await newIdea(owner);
    await forceVersion(idea, "2026-11-a");
    expect(await as(owner, async (c) => (await c.query("select public.switch_method_version($1, '2026-11-d', '{}'::jsonb) as v", [idea])).rows[0].v)).toBe("2026-11-d");
    await expect(db.query("update public.ideas set method_version = '2026-11-e' where id = $1", [idea])).rejects.toThrow(/check|METHOD_VERSION/);
    expect((await db.query("select public.method_version_rank('2026-11-d') as r")).rows[0].r).toBe(4);
  });
});
