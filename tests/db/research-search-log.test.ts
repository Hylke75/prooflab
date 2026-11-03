import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import { randomUUID } from "node:crypto";

// Zoeklogboek (research_search_log) tegen een lokale Postgres met de Supabase-shim en alle migraties (zie
// scripts/test-db.sh): het onderzoeksteam schrijft en leest; de opdrachtgever en buitenstaanders zien niets;
// verwijzingen blijven binnen het idee; het logboek is alleen-toevoegen. Overgeslagen zonder TEST_DATABASE_URL.
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
         values ($1, 'EventMatch', 'Investeren we?', 'new_product', 'Beschrijving', 'Eventmanagers', 'Nederland') returning id`,
        [org],
      )
    ).rows[0].id as string;
  });
}

d("research_search_log: alleen het onderzoeksteam", () => {
  let alice: Who;
  let client: Who;
  let mallory: Who;
  let idea: string;
  let otherIdea: string;
  let run: string;
  let task: string;
  let question: string;
  let otherRun: string;

  beforeAll(async () => {
    db = new Client({ connectionString: url });
    await db.connect();
    alice = await user(`alice-${randomUUID()}@example.com`);
    client = await user(`klant-${randomUUID()}@example.com`);
    mallory = await user(`mallory-${randomUUID()}@example.com`);
    idea = await newIdea(alice, "Bureau logboek");
    otherIdea = await newIdea(mallory, "Ander bureau");
    await as(alice, (c) => c.query("insert into public.idea_members (idea_id, email, role) values ($1, $2, 'client_viewer')", [idea, client.email]));
    await as(client, (c) => c.query("select public.claim_invitations()"));
    ({ run, task, question } = await as(alice, async (c) => {
      const q = (await c.query("insert into public.research_questions (idea_id, position, question, done_criterion) values ($1, 1, 'Hoeveel bureaus?', 'Eén aantal') returning id", [idea])).rows[0].id;
      const r = (await c.query("insert into public.research_runs (idea_id, mode, budget_usd) values ($1, 'quick', 1.5) returning id", [idea])).rows[0].id;
      const t = (await c.query("insert into public.research_tasks (run_id, idea_id, position, kind, label, question_id) values ($1, $2, 1, 'search', 'Zoeken', $3) returning id", [r, idea, q])).rows[0].id;
      return { run: r, task: t, question: q };
    }));
    otherRun = await as(mallory, async (c) => (await c.query("insert into public.research_runs (idea_id, mode, budget_usd) values ($1, 'quick', 1) returning id", [otherIdea])).rows[0].id);
  });

  afterAll(async () => {
    await db?.end();
  });

  const urls = JSON.stringify([{ url: "https://cbs.nl/a", title: "CBS", status: "bewaard", reason: "Letterlijke passages bewaard" }]);

  it("het team schrijft en leest een logregel per zoekopdracht", async () => {
    const id = await as(alice, async (c) =>
      (
        await c.query(
          "insert into public.research_search_log (run_id, task_id, idea_id, question_id, question, provider, query, urls, passages) values ($1, $2, $3, $4, 'Hoeveel bureaus?', 'anthropic', 'aantal bureaus', $5::jsonb, 1) returning id",
          [run, task, idea, question, urls],
        )
      ).rows[0].id,
    );
    const rows = await as(alice, async (c) => (await c.query("select query, passages, urls->0->>'status' as status from public.research_search_log where id = $1", [id])).rows);
    expect(rows).toEqual([{ query: "aantal bureaus", passages: 1, status: "bewaard" }]);
  });

  it("de opdrachtgever en buitenstaanders lezen niets en kunnen niet schrijven", async () => {
    expect(await as(client, async (c) => (await c.query("select id from public.research_search_log where idea_id = $1", [idea])).rowCount)).toBe(0);
    expect(await as(mallory, async (c) => (await c.query("select id from public.research_search_log where idea_id = $1", [idea])).rowCount)).toBe(0);
    await expect(
      as(client, (c) => c.query("insert into public.research_search_log (idea_id, provider, query) values ($1, 'anthropic', 'x')", [idea])),
    ).rejects.toThrow(/row-level security/);
    await expect(
      as(mallory, (c) => c.query("insert into public.research_search_log (idea_id, provider, query) values ($1, 'anthropic', 'x')", [idea])),
    ).rejects.toThrow(/row-level security/);
  });

  it("het logboek is alleen-toevoegen", async () => {
    await expect(as(alice, (c) => c.query("update public.research_search_log set passages = 99 where idea_id = $1", [idea]))).rejects.toThrow(/permission denied/);
    await expect(as(alice, (c) => c.query("delete from public.research_search_log where idea_id = $1", [idea]))).rejects.toThrow(/permission denied/);
  });

  it("verwijst nooit naar een run van een ander idee en weigert onbekende aanbieders", async () => {
    await expect(
      as(mallory, (c) => c.query("insert into public.research_search_log (run_id, idea_id, provider, query) values ($1, $2, 'anthropic', 'x')", [run, otherIdea])),
    ).rejects.toThrow(/IDEA_MISMATCH/);
    expect(otherRun).toBeTruthy();
    await expect(
      as(alice, (c) => c.query("insert into public.research_search_log (idea_id, provider, query) values ($1, 'onbekend', 'x')", [idea])),
    ).rejects.toThrow(/check constraint/);
  });
});
