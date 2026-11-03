import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import { randomUUID } from "node:crypto";

// Golf C (onderzoek en herleidbaarheid) tegen een lokale Postgres met de Supabase-shim en alle migraties (zie
// scripts/test-db.sh). Overgeslagen zonder TEST_DATABASE_URL.
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

async function newIdea(owner: Who, name: string) {
  return as(owner, async (c) => {
    const org = (await c.query("select public.create_organization($1) as id", [name])).rows[0].id;
    return (
      await c.query(
        `insert into public.ideas (org_id, title, decision_question, project_type, description, target_audience, region)
         values ($1, 'EventMatch', 'Investeren we?', 'new_product', 'Beschrijving', 'Zakelijke klanten (B2B)', 'Nederland') returning id`,
        [org],
      )
    ).rows[0].id as string;
  });
}

let alice: Who;
let idea: string;

beforeAll(async () => {
  if (!url) return;
  db = new Client({ connectionString: url });
  await db.connect();
  alice = await user(`alice-${randomUUID()}@example.com`);
  idea = await newIdea(alice, "Bureau golf C");
});

afterAll(async () => {
  await db?.end();
});

d("punt 7: populatie, regio en peildatum per bevinding", () => {
  it("vult ontbrekende velden met 'onbekend' en houdt de bevinding standaard direct", async () => {
    const row = await as(alice, async (c) =>
      (await c.query("insert into public.claims (idea_id, statement, evidence_type) values ($1, 'Er zijn 4.100 bureaus', 'official_statistic') returning population, region, reference_date, relevance", [idea])).rows[0],
    );
    expect(row).toEqual({ population: "onbekend", region: "onbekend", reference_date: "onbekend", relevance: "direct" });
  });

  it("weigert een lege regio, een onleesbare peildatum en een onbekende relevantie", async () => {
    const insert = (cols: string, vals: string[]) =>
      as(alice, (c) => c.query(`insert into public.claims (idea_id, statement, evidence_type, ${cols}) values ($1, 'x bewering', 'official_statistic', ${vals.map((_, i) => `$${i + 2}`).join(", ")})`, [idea, ...vals]));
    await expect(insert("region", [" "])).rejects.toThrow();
    await expect(as(alice, (c) => c.query("insert into public.claims (idea_id, statement, evidence_type, region) values ($1, 'x bewering', 'official_statistic', null)", [idea]))).rejects.toThrow();
    await expect(insert("reference_date", ["vorig jaar"])).rejects.toThrow();
    await expect(insert("reference_date", ["2025-13"])).rejects.toThrow();
    await expect(insert("relevance", ["half"])).rejects.toThrow();
    await expect(insert("reference_date, relevance", ["2025-06", "indirect"])).resolves.toBeTruthy();
  });
});
