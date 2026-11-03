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

  it("een opdrachtgever leest de relevantie van gekoppelde bevindingen via RLS (methode 2026-11-c rekent ermee)", async () => {
    const a = await as(alice, async (c) => {
      const claim = (await c.query("insert into public.claims (idea_id, statement, evidence_type, region, relevance) values ($1, 'Europees cijfer', 'official_statistic', 'Europa', 'indirect') returning id", [idea])).rows[0].id;
      const assumption = (await c.query("insert into public.assumptions (idea_id, statement, category, importance) values ($1, 'Bureaus hebben dit probleem', 'desirability', 4) returning id", [idea])).rows[0].id;
      await c.query("insert into public.assumption_claims (assumption_id, claim_id, idea_id, relation) values ($1, $2, $3, 'supports')", [assumption, claim, idea]);
      return assumption as string;
    });
    const client = await user(`klant-c-${randomUUID()}@example.com`);
    await as(alice, (c) => c.query("insert into public.idea_members (idea_id, email, role) values ($1, $2, 'client_viewer')", [idea, client.email]));
    await as(client, (c) => c.query("select public.claim_invitations()"));
    // Dezelfde gegevens als de embed assumption_claims → claims(status, relevance) in lib/progress.ts.
    const read = (who: Who) =>
      as(who, async (c) =>
        (await c.query("select ac.relation, cl.status, cl.relevance from public.assumption_claims ac join public.claims cl on cl.id = ac.claim_id where ac.assumption_id = $1", [a])).rows,
      );
    const mine = await read(alice);
    expect(mine).toEqual([{ relation: "supports", status: expect.any(String), relevance: "indirect" }]);
    expect(await read(client)).toEqual(mine);
  });
});

d("punt 8: jaar en regio per sizing-factor", () => {
  it("bewaart jaar en regio (leeg = onbekend) en weigert een onmogelijk jaar of een lege regio", async () => {
    const scenario = await as(alice, async (c) =>
      (await c.query("insert into public.sizing_scenarios (idea_id, kind) values ($1, 'realistic') returning id", [idea])).rows[0].id as string,
    );
    const add = (key: string, year: number | null, region: string | null) =>
      as(alice, (c) =>
        c.query(
          "insert into public.sizing_factors (scenario_id, idea_id, key, label, value, unit, position, year, region) values ($1, $2, $3, $3, 1, 'count', 1, $4, $5) returning year, region",
          [scenario, idea, key, year, region],
        ),
      );
    expect((await add("base_count", 2025, "Nederland")).rows[0]).toEqual({ year: 2025, region: "Nederland" });
    expect((await add("fit_pct", null, null)).rows[0]).toEqual({ year: null, region: null });
    await expect(add("reach_pct", 1825, null)).rejects.toThrow();
    await expect(add("reach_pct", 2025, "  ")).rejects.toThrow();
  });
});

d("punt 10: zoekopdracht naar tegenbewijs", () => {
  it("kent de stap 'counter' en logt zoektermen apart met kind 'counter'", async () => {
    const out = await as(alice, async (c) => {
      const q = (await c.query("insert into public.research_questions (idea_id, position, question, done_criterion) values ($1, 1, 'Hoeveel bureaus?', 'Eén aantal') returning id", [idea])).rows[0].id;
      const run = (await c.query("insert into public.research_runs (idea_id, mode, budget_usd) values ($1, 'quick', 1.5) returning id", [idea])).rows[0].id;
      const task = (await c.query("insert into public.research_tasks (run_id, idea_id, position, kind, label, question_id) values ($1, $2, 1, 'counter', 'Tegenbewijs zoeken', $3) returning id", [run, idea, q])).rows[0].id;
      const ins = (kind: string | null) =>
        c.query(
          `insert into public.research_search_log (run_id, task_id, idea_id, question_id, provider, query${kind ? ", kind" : ""}) values ($1, $2, $3, $4, 'anthropic', 'bureaus'${kind ? ", $5" : ""}) returning kind`,
          kind ? [run, task, idea, q, kind] : [run, task, idea, q],
        );
      const plain = (await ins(null)).rows[0].kind;
      const counter = (await ins("counter")).rows[0].kind;
      return { run, plain, counter };
    });
    expect(out).toMatchObject({ plain: "search", counter: "counter" });
    await expect(
      as(alice, (c) => c.query("insert into public.research_search_log (run_id, idea_id, provider, query, kind) values ($1, $2, 'anthropic', 'x', 'bevestiging')", [out.run, idea])),
    ).rejects.toThrow();
    await expect(as(alice, (c) => c.query("insert into public.research_tasks (run_id, idea_id, position, kind, label) values ($1, $2, 9, 'onbekend', 'x')", [out.run, idea]))).rejects.toThrow();
  });
});

d("punt 19: momentopname van aantallen valt niet onder de bewaartermijn", () => {
  it("purge_expired_personal_data wist verlopen persoonsgegevens maar laat de momentopname in het rapport staan", async () => {
    const tallies = {
      version: 1,
      note: "Geanonimiseerde aantallen op het moment van dit rapport.",
      tests: [
        {
          test: "Gesprekken",
          type: "Klantinterview",
          state: "completed",
          n: 1,
          successes: 1,
          byChannel: [{ channel: "network", n: 1, successes: 1 }],
          bySource: [{ source: "network", n: 1, successes: 1 }],
          byGroup: [{ group: "bekenden", n: 1, successes: null }],
          keyQuestion: null,
        },
      ],
      totals: { tests: 1, n: 1, successes: 1 },
    };
    const ids = await as(alice, async (c) => {
      const a = (await c.query("insert into public.assumptions (idea_id, statement, category, importance) values ($1, 'Bureaus willen dit', 'desirability', 5) returning id", [idea])).rows[0].id;
      const h = (
        await c.query(
          `insert into public.hypotheses (idea_id, assumption_id, we_believe, target_group, test_method, metric_label, metric_numerator, metric_denominator, success_threshold_pct, min_sample, max_duration_days)
           values ($1, $2, 'Bureaus herkennen het probleem', 'NL bureaus', 'interviews', 'herkend', 'herkend', 'gesprekken', 30, 5, 14) returning id`,
          [idea, a],
        )
      ).rows[0].id;
      const e = (await c.query("insert into public.experiments (idea_id, hypothesis_id, type, title) values ($1, $2, 'interview', 'Gesprekken') returning id", [idea, h])).rows[0].id;
      const iv = (
        await c.query(
          "insert into public.interviews (experiment_id, idea_id, participant_label, dmu_role, recruited_via, held_on, record_type, transcript, consent_recorded, is_acquaintance) values ($1, $2, 'Eventmanager A', 'user', 'network', current_date, 'notes', 'Piet zei: we zoeken dit al jaren.', true, true) returning id",
          [e, idea],
        )
      ).rows[0].id;
      const report = (await c.query("insert into public.reports (idea_id, version, snapshot) values ($1, 1, $2) returning id", [idea, JSON.stringify({ version: 1, tallies })])).rows[0].id;
      return { iv: iv as string, report: report as string };
    });
    const before = (await db.query("select snapshot from public.reports where id = $1", [ids.report])).rows[0].snapshot;

    // De bewaartermijn van het interview is verlopen; de opruimtaak draait (als de planner, zonder gebruikersrol).
    await db.query("update public.interviews set retention_until = current_date - 1 where id = $1", [ids.iv]);
    await db.query("select public.purge_expired_personal_data()");

    const iv = (await db.query("select transcript from public.interviews where id = $1", [ids.iv])).rows[0];
    expect(iv.transcript).toBe("[verwijderd na afloop van de bewaartermijn]");
    const after = (await db.query("select snapshot from public.reports where id = $1", [ids.report])).rows[0].snapshot;
    expect(after).toEqual(before);
    expect(after.tallies).toEqual(tallies);
    // De opruimfunctie raakt de rapporttabel nergens aan.
    const body = (await db.query("select prosrc from pg_proc where proname = 'purge_expired_personal_data'")).rows[0].prosrc as string;
    expect(body).not.toMatch(/reports/);
  });
});
