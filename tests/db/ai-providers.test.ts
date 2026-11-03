import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import { createHash, randomUUID } from "node:crypto";

const ingestKey = "ai-providers-test-key";

// Migration 20261105090000_ai_providers.sql against a throwaway local Postgres (scripts/test-db.sh): the
// organisation's provider choice (RLS), the provider on the AI ledger and on found sources, and one AI forecast
// per model with the blind rules intact. Skipped when TEST_DATABASE_URL is not set.
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

async function newIdea(owner: Who, org: string): Promise<string> {
  return as(owner, async (c) =>
    (
      await c.query(
        `insert into public.ideas (org_id, title, decision_question, project_type, description, target_audience, region, outcome_statement, outcome_metric, outcome_target)
         values ($1, 'AI-idee', 'Investeren we?', 'new_product', 'Beschrijving', 'Eventmanagers', 'Nederland', 'Zes maanden na het besluit 15 betalende klanten', 'klanten', 15)
         returning id`,
        [org],
      )
    ).rows[0].id,
  );
}

d("AI providers: settings, ledger, sources and the forecast ensemble", () => {
  let owner: Who;
  let editor: Who;
  let outsider: Who;
  let client: Who;
  let org: string;

  beforeAll(async () => {
    db = new Client({ connectionString: url });
    await db.connect();
    await db.query("insert into public.ingest_keys (key_hash) values ($1) on conflict do nothing", [createHash("sha256").update(ingestKey).digest("hex")]);
    owner = await user(`eigenaar-${randomUUID()}@example.com`);
    editor = await user(`consultant-${randomUUID()}@example.com`);
    outsider = await user(`buiten-${randomUUID()}@example.com`);
    client = await user(`klant-${randomUUID()}@example.com`);
    org = await as(owner, async (c) => (await c.query("select public.create_organization('AI-bureau') as id")).rows[0].id);
    await as(owner, (c) => c.query("insert into public.organization_members (org_id, user_id, role) values ($1, $2, 'editor')", [org, editor.id]));
    await as(outsider, (c) => c.query("select public.create_organization('Ander bureau')"));
  });

  afterAll(async () => {
    await db?.end();
  });

  it("lets members of the organisation read and write the provider choice, nobody else, and never delete it", async () => {
    await as(owner, (c) =>
      c.query("insert into public.org_ai_settings (org_id, default_provider, coach_provider, ensemble) values ($1, 'openai', 'gemini', false)", [org]),
    );
    const row = await as(editor, async (c) => (await c.query("select default_provider, coach_provider, ensemble, updated_by from public.org_ai_settings where org_id = $1", [org])).rows[0]);
    expect(row).toEqual({ default_provider: "openai", coach_provider: "gemini", ensemble: false, updated_by: owner.id });
    // A consultant (editor) may change it; the change is stamped with who did it.
    await as(editor, (c) => c.query("update public.org_ai_settings set research_provider = 'anthropic', ensemble = true where org_id = $1", [org]));
    expect(
      await as(owner, async (c) => (await c.query("select research_provider, ensemble, updated_by from public.org_ai_settings where org_id = $1", [org])).rows[0]),
    ).toEqual({ research_provider: "anthropic", ensemble: true, updated_by: editor.id });
    // Outsiders see nothing and cannot write.
    expect(await as(outsider, async (c) => (await c.query("select 1 from public.org_ai_settings where org_id = $1", [org])).rowCount)).toBe(0);
    expect(await as(outsider, async (c) => (await c.query("update public.org_ai_settings set default_provider = 'gemini' where org_id = $1", [org])).rowCount)).toBe(0);
    await expect(as(outsider, (c) => c.query("insert into public.org_ai_settings (org_id) values ($1)", [randomUUID()]))).rejects.toThrow();
    // Nobody deletes the row.
    await expect(as(owner, (c) => c.query("delete from public.org_ai_settings where org_id = $1", [org]))).rejects.toThrow(/permission denied/);
    // Only the three providers.
    await expect(as(owner, (c) => c.query("update public.org_ai_settings set coach_provider = 'llama' where org_id = $1", [org]))).rejects.toThrow(/check constraint/);
    // The organisation cannot be moved by an update.
    await as(owner, (c) => c.query("update public.org_ai_settings set org_id = gen_random_uuid() where org_id = $1", [org]));
    expect(await as(owner, async (c) => (await c.query("select 1 from public.org_ai_settings where org_id = $1", [org])).rowCount)).toBe(1);
  });

  it("keeps clients of an idea out of the organisation's settings", async () => {
    const idea = await newIdea(owner, org);
    await as(owner, (c) => c.query("insert into public.idea_members (idea_id, email, role) values ($1, $2, 'client_decider')", [idea, client.email]));
    await as(client, (c) => c.query("select public.claim_invitations()"));
    expect(await as(client, async (c) => (await c.query("select 1 from public.org_ai_settings where org_id = $1", [org])).rowCount)).toBe(0);
  });

  it("records the provider on the AI ledger and on found sources", async () => {
    const idea = await newIdea(owner, org);
    await as(editor, (c) =>
      c.query("insert into public.ai_runs (idea_id, purpose, model, prompt_version, provider, cost_usd, outcome) values ($1, 'research:search', 'm', 'v', 'gemini', 0.12, 'ok')", [idea]),
    );
    await expect(
      as(editor, (c) => c.query("insert into public.ai_runs (idea_id, purpose, model, prompt_version, provider, outcome) values ($1, 'x', 'm', 'v', 'bogus', 'ok')", [idea])),
    ).rejects.toThrow(/check constraint/);
    // The monthly cap counts every provider together.
    await as(editor, (c) =>
      c.query("insert into public.ai_runs (idea_id, purpose, model, prompt_version, provider, cost_usd, outcome) values ($1, 'coach', 'm', 'v', 'openai', 0.30, 'ok')", [idea]),
    );
    const spend = await as(editor, async (c) => (await c.query("select spent::float from public.org_ai_spend($1)", [idea])).rows[0].spent);
    expect(spend).toBeGreaterThanOrEqual(0.42);

    const src = await as(editor, async (c) =>
      (await c.query("insert into public.sources (idea_id, title, source_type, url, origin, found_by) values ($1, 'CBS', 'official_statistic', 'https://cbs.nl/x', 'ai_search', '{openai,gemini}') returning found_by", [idea])).rows[0],
    );
    expect(src.found_by).toEqual(["openai", "gemini"]);
    await expect(
      as(editor, (c) => c.query("insert into public.sources (idea_id, title, source_type, found_by) values ($1, 'X', 'other', '{mistral}')", [idea])),
    ).rejects.toThrow(/check constraint/);
  });

  it("stores one AI forecast per model per moment (at most three), still blind until your own forecast", async () => {
    const idea = await newIdea(owner, org);
    const rec = (model: string | null, p: number) =>
      as(editor, async (c) => (await c.query("select public.record_ai_forecast($1, $2, 'intake', $3, 'Eén zin waarom', $4) as ok", [ingestKey, idea, p, model])).rows[0].ok);
    expect(await rec("claude-a", 0.3)).toBe(true);
    expect(await rec("gpt-b", 0.4)).toBe(true);
    expect(await rec("claude-a", 0.35)).toBe(false); // same model again
    expect(await rec("gemini-c", 0.2)).toBe(true);
    expect(await rec("gemini-d", 0.25)).toBe(false); // never more than three AI forecasters
    await expect(rec(null, 0.3)).rejects.toThrow(/MODEL_REQUIRED/);
    // The blind rule: nothing visible before the consultant's own forecast, then all three.
    expect(await as(editor, async (c) => (await c.query("select 1 from public.forecasts where idea_id = $1", [idea])).rowCount)).toBe(0);
    await as(editor, (c) =>
      c.query("insert into public.forecasts (idea_id, moment, forecaster_kind, forecaster_id, probability, rationale) values ($1, 'intake', 'consultant', $2, 0.3, 'Eigen inschatting')", [idea, editor.id]),
    );
    const ai = await as(editor, async (c) => (await c.query("select model, probability::float from public.forecasts where idea_id = $1 and forecaster_kind = 'ai' order by model", [idea])).rows);
    expect(ai).toEqual([
      { model: "claude-a", probability: 0.3 },
      { model: "gemini-c", probability: 0.2 },
      { model: "gpt-b", probability: 0.4 },
    ]);
    // Still only through the server: a direct AI insert is refused.
    await expect(
      as(editor, (c) => c.query("insert into public.forecasts (idea_id, moment, forecaster_kind, forecaster_id, probability, rationale, model) values ($1, 'intake', 'ai', null, 0.5, 'Zelf getypt', 'x')", [idea])),
    ).rejects.toThrow(/row-level security/);
  });
});
