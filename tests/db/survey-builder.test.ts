import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import { randomUUID, createHash } from "node:crypto";
import { templateSurvey } from "@/lib/domain/survey";
import { KIND_DEFAULTS } from "@/lib/domain/evidence";

// Survey builder against a throwaway local Postgres with the Supabase shim + migrations applied
// (see scripts/test-db.sh). Skipped when TEST_DATABASE_URL is not set. Helpers as in rls.test.ts.
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

const ingestKey = "test-ingest-key-survey-builder";

d("survey builder: stored config, lock, self-reported evidence and open answers", () => {
  let alice: Who;
  let client: Who;
  let idea: string;
  let exp: string;
  let assumption: string;
  const config = templateSurvey({ assumption: "Ze zoeken hulp", audience: "MKB-ondernemers", researcher: "Bureau", product: "Testidee" });

  beforeAll(async () => {
    db = new Client({ connectionString: url });
    await db.connect();
    await db.query("insert into public.ingest_keys (key_hash) values ($1) on conflict do nothing", [createHash("sha256").update(ingestKey).digest("hex")]);
    alice = await user(`alice-${randomUUID()}@example.com`);
    client = await user(`klant-${randomUUID()}@example.com`);
    const ids = await as(alice, async (c) => {
      const org = (await c.query("select public.create_organization('Bureau survey') as id")).rows[0].id;
      const i = (
        await c.query(
          `insert into public.ideas (org_id, title, decision_question, project_type, description, target_audience, region)
           values ($1, 'Testidee', 'Investeren we?', 'new_product', 'Beschrijving', 'MKB', 'Nederland') returning id`,
          [org],
        )
      ).rows[0].id;
      const a = (await c.query("insert into public.assumptions (idea_id, statement, category, importance) values ($1, 'Ze zoeken hulp', 'desirability', 5) returning id", [i])).rows[0].id;
      const h = (
        await c.query(
          `insert into public.hypotheses (idea_id, assumption_id, we_believe, target_group, test_method, metric_label, metric_numerator, metric_denominator, success_threshold_pct, fail_threshold_pct, min_sample, max_duration_days)
           values ($1, $2, 'Ze zoeken actief', 'MKB', 'enquête', 'Kernvraag', 'respondenten die "Ja" kozen', 'respondenten die de kernvraag beantwoordden', 40, 15, 2, 14) returning id`,
          [i, a],
        )
      ).rows[0].id;
      const e = (await c.query("insert into public.experiments (idea_id, hypothesis_id, type, title, config) values ($1, $2, 'survey', 'Enquête', $3) returning id", [i, h, JSON.stringify(config)])).rows[0].id;
      await c.query("insert into public.idea_members (idea_id, email, role) values ($1, $2, 'client_viewer')", [i, client.email]);
      return { i, e, a };
    });
    idea = ids.i;
    exp = ids.e;
    assumption = ids.a;
    await as(client, (c) => c.query("select public.claim_invitations()"));
  });

  afterAll(async () => {
    await db?.end();
  });

  it("stores the survey config as drafted and locks it after approval", async () => {
    const stored = await as(alice, async (c) => (await c.query("select config from public.experiments where id = $1", [exp])).rows[0].config);
    expect(stored.key_question).toBe("gezocht");
    // Still editable as a draft.
    await as(alice, (c) => c.query("update public.experiments set config = $2 where id = $1", [exp, JSON.stringify({ ...config, title: "Onderzoek onder ondernemers" })]));
    await as(alice, async (c) => {
      await c.query("update public.experiments set state = 'ready_for_review' where id = $1", [exp]);
      await c.query("update public.experiments set state = 'approved' where id = $1", [exp]);
    });
    await expect(as(alice, (c) => c.query("update public.experiments set config = $2 where id = $1", [exp, JSON.stringify({ ...config, success_options: ["nee"] })]))).rejects.toThrow(/EXPERIMENT_LOCKED/);
    const slug = await as(alice, async (c) => (await c.query("select public_slug from public.experiments where id = $1", [exp])).rows[0].public_slug);
    expect(slug).toMatch(/^[a-f0-9]{14}$/);
  });

  it("stores open answers as a survey source with excerpts that the client can read, but not the raw responses", async () => {
    await as(alice, async (c) => {
      await c.query("update public.experiments set state = 'live' where id = $1", [exp]);
    });
    const slug = await as(alice, async (c) => (await c.query("select public_slug from public.experiments where id = $1", [exp])).rows[0].public_slug);
    const r = (
      await (async () => {
        await db.query("begin");
        try {
          await db.query("set local role anon");
          const out = await db.query(
            "select public.submit_survey($1, $2, 'v-open-1', 'linkedin', $3, true, 60000, null, 'net-sb') as r",
            [ingestKey, slug, JSON.stringify({ laatst: "maand", gezocht: "nee", last: 3, toelichting: "Te weinig tijd om uit te zoeken" })],
          );
          await db.query("commit");
          return out;
        } catch (e) {
          await db.query("rollback");
          throw e;
        }
      })()
    ).rows[0].r;
    expect(r).toBe("ok");
    const source = await as(alice, async (c) => {
      const s = (
        await c.query(
          "insert into public.sources (idea_id, title, source_type, is_primary, origin, access_note) values ($1, 'Enquête – open antwoorden', 'survey', false, 'manual', 'Zelfrapportage') returning id",
          [idea],
        )
      ).rows[0].id;
      await c.query("insert into public.source_excerpts (source_id, idea_id, text, location) values ($1, $2, 'Te weinig tijd om uit te zoeken', 'vraag toelichting, respondent 1 (open link)')", [s, idea]);
      return s;
    });
    const seen = await as(client, async (c) => (await c.query("select source_type from public.sources where id = $1", [source])).rows);
    expect(seen).toEqual([{ source_type: "survey" }]);
    expect(await as(client, async (c) => (await c.query("select * from public.survey_responses where experiment_id = $1", [exp])).rowCount)).toBe(0);
    expect(await as(alice, async (c) => (await c.query("select * from public.survey_responses where experiment_id = $1", [exp])).rowCount)).toBe(1);
  });
  it("records the survey outcome as a self-reported observation, never as behaviour", async () => {
    const dims = KIND_DEFAULTS.survey_answer;
    // Only allowed on an ended experiment (database rule), as in createLearningCard.
    await expect(
      as(alice, (c) => c.query("insert into public.observations (idea_id, experiment_id, kind, summary, origin) values ($1, $2, 'survey_answer', 'te vroeg', 'system')", [idea, exp])),
    ).rejects.toThrow(/row-level security/);
    await as(alice, (c) => c.query("update public.experiments set state = 'ended' where id = $1", [exp]));
    const row = await as(alice, async (c) => {
      const o = (
        await c.query(
          `insert into public.observations (idea_id, experiment_id, kind, summary, is_fact, is_behaviour, is_real_context, is_costly, origin)
           values ($1, $2, 'survey_answer', 'Enquête (zelfrapportage): 1 van 2', $3, $4, $5, $6, 'system') returning id, is_behaviour`,
          [idea, exp, dims.isFact, dims.isBehaviour, dims.isRealContext, dims.isCostly],
        )
      ).rows[0];
      await c.query("insert into public.assumption_observations (assumption_id, observation_id, idea_id, relation) values ($1, $2, $3, 'supports')", [assumption, o.id, idea]);
      return o;
    });
    expect(row.is_behaviour).toBe(false);
  });

});
