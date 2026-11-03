import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import { randomUUID } from "node:crypto";

// system_status(): owner-only operational markers (see supabase/migrations/20261104110000_ops.sql).
// Helper pattern copied from coach.test.ts. Skipped when TEST_DATABASE_URL is not set.
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
      await db.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: who.id, email: who.email, role: "authenticated" })]);
    }
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

d("system_status", () => {
  let owner: { id: string; email: string };
  let editor: { id: string; email: string };
  let stranger: { id: string; email: string };
  let org: string;
  let otherOrg: string;

  beforeAll(async () => {
    db = new Client({ connectionString: url });
    await db.connect();
    owner = await user(`owner-${randomUUID()}@example.com`);
    editor = await user(`editor-${randomUUID()}@example.com`);
    stranger = await user(`stranger-${randomUUID()}@example.com`);
    org = await as(owner, async (c) => (await c.query("select public.create_organization('Statusbureau') as id")).rows[0].id as string);
    otherOrg = await as(stranger, async (c) => (await c.query("select public.create_organization('Ander bureau') as id")).rows[0].id as string);
    await db.query("insert into public.organization_members (org_id, user_id, role) values ($1, $2, 'editor')", [org, editor.id]);
    // One AI run this month and one last year: only the first counts.
    const idea = await as(owner, async (c) =>
      (
        await c.query(
          `insert into public.ideas (org_id, title, decision_question, project_type, description, target_audience, region)
           values ($1, 'Statusidee', 'Investeren we?', 'new_product', 'Beschrijving', 'Doelgroep', 'Nederland') returning id`,
          [org],
        )
      ).rows[0].id as string,
    );
    await db.query(
      `insert into public.ai_runs (idea_id, purpose, model, prompt_version, cost_usd, outcome, created_at)
       values ($1, 'test', 'm', 'v', 1.25, 'ok', now()), ($1, 'test', 'm', 'v', 9, 'ok', now() - interval '400 days')`,
      [idea],
    );
  });

  afterAll(async () => {
    await db?.end();
  });

  it("returns feature markers and this month's spend for the owner", async () => {
    const row = await as(owner, async (c) => (await c.query("select * from public.system_status()")).rows[0]);
    expect(row.org_id).toBe(org);
    expect(row.has_core).toBe(true);
    expect(row.has_survey_key_answers).toBe(true);
    expect(row.has_forecasts).toBe(true);
    expect(row.has_coach).toBe(true);
    expect(row.has_ops).toBe(true);
    expect(row.auth_hook_function).toBe(true);
    expect(Number(row.ai_spent_usd)).toBeCloseTo(1.25);
    expect(Number(row.ai_cap_usd)).toBeGreaterThan(0);
    // A plain Postgres has neither the CLI's migration table nor pg_cron: unknown, not an error.
    expect(row.migration_version).toBeNull();
    expect(typeof row.cron_available).toBe("boolean");
    if (!row.cron_available) {
      expect(row.purge_last_run_at).toBeNull();
      expect(row.purge_last_status).toBeNull();
    }
  });

  it("accepts an explicit organisation of the owner", async () => {
    const row = await as(owner, async (c) => (await c.query("select org_id from public.system_status($1)", [org])).rows[0]);
    expect(row.org_id).toBe(org);
  });

  it("refuses editors, owners of another organisation and anonymous callers", async () => {
    await expect(as(editor, (c) => c.query("select * from public.system_status()"))).rejects.toThrow(/FORBIDDEN/);
    await expect(as(editor, (c) => c.query("select * from public.system_status($1)", [org]))).rejects.toThrow(/FORBIDDEN/);
    await expect(as(owner, (c) => c.query("select * from public.system_status($1)", [otherOrg]))).rejects.toThrow(/FORBIDDEN/);
    await expect(as(stranger, (c) => c.query("select * from public.system_status($1)", [org]))).rejects.toThrow(/FORBIDDEN/);
    await expect(as("anon", (c) => c.query("select * from public.system_status()"))).rejects.toThrow(/permission denied/);
  });

  it("never exposes the ingest key hash", async () => {
    const row = await as(owner, async (c) => (await c.query("select * from public.system_status()")).rows[0]);
    expect(Object.keys(row)).not.toContain("key_hash");
    expect(typeof row.ingest_key_registered).toBe("boolean");
  });
});
