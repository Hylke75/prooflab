import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import { randomUUID } from "node:crypto";

// Gebruikerstest A/B/C (supabase/migrations/20261112090000_gebruikerstest.sql). Draait tegen een wegwerp-Postgres
// (scripts/test-db.sh); overgeslagen zonder TEST_DATABASE_URL.
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
         values ($1, 'Gebruikerstest', 'Investeren we €25.000?', 'new_product', 'Beschrijving', 'Sportclubs', 'Nederland') returning id`,
        [org],
      )
    ).rows[0].id as string;
    return { org, idea };
  });
}

d("gebruikerstest: deel A in de database", () => {
  let owner: U;

  beforeAll(async () => {
    db = new Client({ connectionString: url });
    await db.connect();
    owner = await user(`eigenaar-${randomUUID()}@example.com`);
  });

  afterAll(async () => {
    await db?.end();
  });

  it("A5: een bevinding kan de status weerlegd krijgen; een onbekende status niet", async () => {
    const { idea } = await newIdea(owner);
    const id = await as(owner, async (c) =>
      (await c.query("insert into public.claims (idea_id, statement, evidence_type) values ($1, 'Clubs betalen voor AI-communicatie', 'third_party_estimate') returning id", [idea])).rows[0].id as string,
    );
    await as(owner, (c) => c.query("update public.claims set status = 'refuted' where id = $1", [id]));
    expect((await db.query("select status from public.claims where id = $1", [id])).rows[0].status).toBe("refuted");
    await expect(as(owner, (c) => c.query("update public.claims set status = 'bogus' where id = $1", [id]))).rejects.toThrow(/claims_status_check/);
  });

  it("A5: precies één check op claims.status", async () => {
    const rows = (
      await db.query(
        `select con.conname from pg_constraint con join pg_class rel on rel.oid = con.conrelid
         join pg_attribute att on att.attrelid = rel.oid and att.attname = 'status'
         where rel.relname = 'claims' and con.contype = 'c' and con.conkey = array[att.attnum]`,
      )
    ).rows;
    expect(rows.map((r) => r.conname)).toEqual(["claims_status_check"]);
  });

  it("A5: nieuwe dossiers starten op methode 2026-11-e; overstappen van d naar e kan, terug niet", async () => {
    const { idea } = await newIdea(owner);
    expect((await db.query("select method_version from public.ideas where id = $1", [idea])).rows[0].method_version).toBe("2026-11-e");
    expect((await db.query("select public.method_version_rank('2026-11-e') as r")).rows[0].r).toBe(5);
    await expect(db.query("update public.ideas set method_version = '2026-11-d' where id = $1", [idea])).rejects.toThrow(/METHOD_VERSION/);
  });
});

d("gebruikerstest: deel B in de database", () => {
  let owner: U;

  beforeAll(async () => {
    db = new Client({ connectionString: url });
    await db.connect();
    owner = await user(`eigenaar-b-${randomUUID()}@example.com`);
  });

  afterAll(async () => {
    await db?.end();
  });

  it("B3: de soorten kanaal en regelgeving mogen; een onbekende soort niet", async () => {
    const { idea } = await newIdea(owner);
    const id = await as(owner, async (c) =>
      (await c.query("insert into public.assumptions (idea_id, statement, category, importance) values ($1, 'Clubs zijn te bereiken via bonden', 'viability', 5) returning id", [idea])).rows[0].id as string,
    );
    for (const kind of ["channel", "regulation"]) {
      await as(owner, (c) => c.query("update public.assumptions set kind = $2 where id = $1", [id, kind]));
    }
    await expect(as(owner, (c) => c.query("update public.assumptions set kind = 'onzin' where id = $1", [id]))).rejects.toThrow(/assumptions_kind_check/);
  });

  it("B4: de kolommen submitted_by en self_approved bestaan", async () => {
    const cols = (await db.query("select column_name from information_schema.columns where table_name = 'experiments' and column_name in ('submitted_by', 'self_approved') order by 1")).rows;
    expect(cols.map((r) => r.column_name)).toEqual(["self_approved", "submitted_by"]);
  });
});
