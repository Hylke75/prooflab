import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import { randomUUID } from "node:crypto";

// Learning from outcomes (supabase/migrations/20261104130000_learning.sql): counts for learned evidence
// weights, the opt-in setting, survey versus behaviour, coach note statistics and the helpful vote. Runs
// against a throwaway local Postgres (scripts/test-db.sh). Skipped when TEST_DATABASE_URL is not set.
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

type U = { id: string; email: string };

const newIdea = (owner: U, org: string) =>
  as(owner, async (c) =>
    (
      await c.query(
        `insert into public.ideas (org_id, title, decision_question, project_type, description, target_audience, region, outcome_statement, outcome_metric, outcome_target)
         values ($1, 'Leeridee', 'Investeren we €25.000?', 'new_product', 'Beschrijving', 'Eventmanagers', 'Nederland',
           'Zes maanden na het besluit hebben 15 klanten betaald', 'betalende klanten', 15) returning id`,
        [org],
      )
    ).rows[0].id as string,
  );

const assumption = (c: Client, idea: string) =>
  c.query("insert into public.assumptions (idea_id, statement, category, importance) values ($1, 'Eventmanagers willen dit', 'desirability', 5) returning id", [idea]).then((r) => r.rows[0].id as string);

async function observe(c: Client, idea: string, a: string, kind: string, relation: string, extra: { synthetic?: boolean; origin?: string } = {}) {
  const o = (
    await c.query("insert into public.observations (idea_id, kind, summary, is_synthetic, origin) values ($1, $2, 'Samenvatting', $3, $4) returning id", [
      idea,
      kind,
      extra.synthetic ?? false,
      extra.origin ?? "manual",
    ])
  ).rows[0].id;
  await c.query("insert into public.assumption_observations (assumption_id, observation_id, idea_id, relation) values ($1, $2, $3, $4)", [a, o, idea, relation]);
}

// An experiment of a type on an assumption, with an approved Learning Card carrying the verdict.
async function tested(c: Client, idea: string, a: string, type: string, verdict: string) {
  const h = (
    await c.query(
      `insert into public.hypotheses (idea_id, assumption_id, we_believe, target_group, test_method, metric_label,
         metric_numerator, metric_denominator, success_threshold_pct, fail_threshold_pct, min_sample, max_duration_days)
       values ($1, $2, 'Eventmanagers handelen', 'NL eventmanagers', 'test', 'ratio', 'teller', 'noemer', 15, 5, 20, 21) returning id`,
      [idea, a],
    )
  ).rows[0].id;
  const e = (await c.query("insert into public.experiments (idea_id, hypothesis_id, type, title) values ($1, $2, $3, 'Test') returning id", [idea, h, type])).rows[0].id;
  const card = (
    await c.query(
      `insert into public.learning_cards (experiment_id, idea_id, we_believed, we_observed, we_learned, therefore, verdict, data_reliability)
       values ($1, $2, 'a', 'b', 'c', 'd', $3, 'medium') returning id`,
      [e, idea, verdict],
    )
  ).rows[0].id;
  await c.query("update public.learning_cards set status = 'approved' where id = $1", [card]);
}

const resolve = (c: Client, idea: string, achieved: string) =>
  c.query("insert into public.idea_outcomes (idea_id, achieved, evidence) values ($1, $2, 'Gemeten na zes maanden in de boekhouding')", [idea, achieved]);

d("learning from outcomes", () => {
  let owner: U;
  let editor: U;
  let client: U;
  let outsider: U;
  let org: string;
  let clientIdea: string;

  beforeAll(async () => {
    db = new Client({ connectionString: url });
    await db.connect();
    owner = await user(`eigenaar-${randomUUID()}@example.com`);
    editor = await user(`consultant-${randomUUID()}@example.com`);
    client = await user(`klant-${randomUUID()}@example.com`);
    outsider = await user(`ander-${randomUUID()}@example.com`);
    org = await as(owner, async (c) => (await c.query("select public.create_organization('Leerbureau') as id")).rows[0].id);
    await as(owner, (c) => c.query("insert into public.organization_members (org_id, user_id, role) values ($1, $2, 'editor')", [org, editor.id]));
    await as(outsider, (c) => c.query("select public.create_organization('Ander bureau')"));

    // Ten resolved dossiers: survey answers supported the assumption in 5 of 6 that reached the outcome and in
    // 1 of 4 that did not; one contradicting survey in a failed dossier. Noise that must not count: synthetic
    // data and AI coding nobody accepted.
    const outcomes = ["yes", "yes", "yes", "yes", "yes", "yes", "no", "no", "no", "no"];
    for (let i = 0; i < outcomes.length; i++) {
      const idea = await newIdea(owner, org);
      if (i === 0) clientIdea = idea;
      await as(owner, async (c) => {
        const a = await assumption(c, idea);
        if ((outcomes[i] === "yes" && i < 5) || i === 6) await observe(c, idea, a, "survey_answer", "supports");
        if (i === 7) await observe(c, idea, a, "survey_answer", "contradicts");
        await observe(c, idea, a, "deposit", "supports", { synthetic: true });
        await observe(c, idea, a, "repeat_purchase", "supports", { origin: "ai" });
        if (i === 8) await observe(c, idea, a, "objection", "supports"); // counter-evidence by nature
        if (i < 2) await tested(c, idea, a, "landing", "pass");
        if (i === 9) await tested(c, idea, a, "landing", "fail");
        await resolve(c, idea, outcomes[i]);
      });
    }
    await as(owner, (c) => c.query("insert into public.idea_members (idea_id, email, role) values ($1, $2, 'client_decider')", [clientIdea, client.email]));
    await as(client, (c) => c.query("select public.claim_invitations()"));
  });

  afterAll(async () => {
    await db?.end();
  });

  const counts = (who: Who) =>
    as(who, async (c) =>
      (await c.query("select dimension, kind, achieved, direction, dossiers::int from public.learning_evidence_counts($1) order by 1, 2, 3, 4", [org])).rows,
    );

  it("counts resolved dossiers per kind, outcome and direction for members only", async () => {
    const rows = await counts(editor);
    expect(rows.filter((r) => r.dimension === "resolved")).toEqual([
      { dimension: "resolved", kind: "", achieved: "no", direction: "", dossiers: 4 },
      { dimension: "resolved", kind: "", achieved: "yes", direction: "", dossiers: 6 },
    ]);
    expect(rows.filter((r) => r.kind === "survey_answer")).toEqual([
      { dimension: "observation", kind: "survey_answer", achieved: "no", direction: "negative", dossiers: 1 },
      { dimension: "observation", kind: "survey_answer", achieved: "no", direction: "positive", dossiers: 1 },
      { dimension: "observation", kind: "survey_answer", achieved: "yes", direction: "positive", dossiers: 5 },
    ]);
    // Objections always count against, synthetic and unreviewed AI coding not at all.
    expect(rows.filter((r) => r.kind === "objection")).toEqual([{ dimension: "observation", kind: "objection", achieved: "no", direction: "negative", dossiers: 1 }]);
    expect(rows.some((r) => r.kind === "deposit" || r.kind === "repeat_purchase")).toBe(false);
    expect(rows.filter((r) => r.dimension === "test")).toEqual([
      { dimension: "test", kind: "landing", achieved: "no", direction: "negative", dossiers: 1 },
      { dimension: "test", kind: "landing", achieved: "yes", direction: "positive", dossiers: 2 },
    ]);
    expect(await counts(outsider)).toEqual([]);
    expect(await counts(client)).toEqual([]);
    await expect(as("anon", (c) => c.query("select * from public.learning_evidence_counts($1)", [org]))).rejects.toThrow(/permission denied/);
    await expect(as(owner, (c) => c.query("select * from public.learning_counts_internal($1)", [org]))).rejects.toThrow(/permission denied/);
  });

  it("keeps learned weights off by default; any consultant can switch them, stamped by the database", async () => {
    const uses = (who: Who) => as(who, async (c) => (await c.query("select public.idea_uses_learned_weights($1) as on", [clientIdea])).rows[0].on);
    const ideaCounts = (who: Who) => as(who, async (c) => (await c.query("select * from public.idea_learning_counts($1)", [clientIdea])).rowCount);
    expect(await uses(client)).toBe(false);
    expect(await ideaCounts(owner)).toBe(0);

    // An editor cannot update the organisation row directly, but may use the switch.
    expect(await as(editor, async (c) => (await c.query("update public.organizations set use_learned_weights = true where id = $1", [org])).rowCount)).toBe(0);
    await as(editor, (c) => c.query("select public.set_learned_weights($1, true)", [org]));
    const row = await as(owner, async (c) => (await c.query("select use_learned_weights, learned_weights_changed_by, learned_weights_changed_at is not null as stamped from public.organizations where id = $1", [org])).rows[0]);
    expect(row).toEqual({ use_learned_weights: true, learned_weights_changed_by: editor.id, stamped: true });

    // Client and consultant compute with the same factors; others see nothing.
    expect(await uses(client)).toBe(true);
    expect(await ideaCounts(client)).toBeGreaterThan(0);
    expect(await uses(outsider)).toBe(false);
    expect(await ideaCounts(outsider)).toBe(0);
    await expect(as(client, (c) => c.query("select public.set_learned_weights($1, false)", [org]))).rejects.toThrow(/FORBIDDEN/);
    await expect(as(outsider, (c) => c.query("select public.set_learned_weights($1, false)", [org]))).rejects.toThrow(/FORBIDDEN/);

    // The owner editing the name keeps the stamp; switching back off records the owner.
    await as(owner, (c) => c.query("update public.organizations set name = 'Leerbureau BV', learned_weights_changed_by = $2 where id = $1", [org, outsider.id]));
    expect(await as(owner, async (c) => (await c.query("select learned_weights_changed_by from public.organizations where id = $1", [org])).rows[0].learned_weights_changed_by)).toBe(editor.id);
    await as(owner, (c) => c.query("select public.set_learned_weights($1, false)", [org]));
    expect(await uses(client)).toBe(false);
  });

  it("compares a survey with a behaviour test on the same assumption", async () => {
    const own = await user(`enquete-${randomUUID()}@example.com`);
    const o = await as(own, async (c) => (await c.query("select public.create_organization('Enquêtebureau') as id")).rows[0].id);
    const idea = await newIdea(own, o);
    await as(own, async (c) => {
      const agree = await assumption(c, idea);
      await tested(c, idea, agree, "survey", "pass");
      await tested(c, idea, agree, "pricing", "pass");
      const disagree = await assumption(c, idea);
      await tested(c, idea, disagree, "survey", "pass");
      await tested(c, idea, disagree, "landing", "fail");
      const mixed = await assumption(c, idea);
      await tested(c, idea, mixed, "survey", "pass");
      await tested(c, idea, mixed, "survey", "fail");
      await tested(c, idea, mixed, "landing", "pass");
      const onlySurvey = await assumption(c, idea);
      await tested(c, idea, onlySurvey, "survey", "fail");
    });
    const rows = await as(own, async (c) => (await c.query("select survey_verdict, behaviour_verdict, assumptions::int from public.survey_behaviour_agreement($1) order by 1, 2", [o])).rows);
    expect(rows).toEqual([
      { survey_verdict: "mixed", behaviour_verdict: "pass", assumptions: 1 },
      { survey_verdict: "pass", behaviour_verdict: "fail", assumptions: 1 },
      { survey_verdict: "pass", behaviour_verdict: "pass", assumptions: 1 },
    ]);
    expect(await as(owner, async (c) => (await c.query("select * from public.survey_behaviour_agreement($1)", [o])).rowCount)).toBe(0);
  });

  it("lets a consultant vote on a coach note while its content stays locked, and reports per rule", async () => {
    const idea = await newIdea(owner, org);
    const [n1, n2] = await as(owner, async (c) => {
      const ids: string[] = [];
      for (const code of [`critical_untested:${randomUUID()}`, "outcome_undefined"]) {
        ids.push(
          (
            await c.query(
              "insert into public.coach_notes (idea_id, code, kind, title, body, href, source) values ($1, $2, 'tip', 'Een titel', 'Een uitleg met waarom.', $3, 'rules') returning id",
              [idea, code, `/app/ideas/${idea}`],
            )
          ).rows[0].id,
        );
      }
      return ids;
    });
    await as(editor, (c) => c.query("update public.coach_notes set helpful = true where id = $1", [n1]));
    await as(editor, (c) => c.query("update public.coach_notes set status = 'done' where id = $1", [n1]));
    await as(editor, (c) => c.query("update public.coach_notes set status = 'dismissed', helpful = false where id = $1", [n2]));
    await expect(as(editor, (c) => c.query("update public.coach_notes set title = 'Anders' where id = $1", [n1]))).rejects.toThrow(/COACH_NOTE_LOCKED/);
    // A vote does not move the resolution stamp.
    const before = await as(owner, async (c) => (await c.query("select resolved_at, resolved_by from public.coach_notes where id = $1", [n1])).rows[0]);
    await as(owner, (c) => c.query("update public.coach_notes set helpful = false, resolved_at = now() - interval '9 days' where id = $1", [n1]));
    const after = await as(owner, async (c) => (await c.query("select resolved_at, resolved_by, helpful from public.coach_notes where id = $1", [n1])).rows[0]);
    expect(after).toEqual({ ...before, helpful: false });
    // A client of another dossier cannot vote.
    expect(await as(client, async (c) => (await c.query("update public.coach_notes set helpful = true where id = $1", [n2])).rowCount)).toBe(0);

    // Resolve the dossier with a decision forecast, so the Brier score shows up next to the notes.
    await as(owner, async (c) => {
      await c.query("insert into public.reality_checks (idea_id, findings, advice, advice_reason) values ($1, '[]', 'continue', 'Genoeg bewijs')", [idea]);
      await c.query("insert into public.forecasts (idea_id, moment, forecaster_kind, forecaster_id, probability, rationale) values ($1, 'decision', 'consultant', $2, 0.7, 'Eén zin waarom')", [idea, owner.id]);
      await resolve(c, idea, "yes");
    });
    const stats = await as(editor, async (c) =>
      (await c.query("select rule, status, helpful, round(decision_brier, 4)::float as brier, days_to_resolve is not null as timed from public.coach_note_stats($1) where idea_id = $2 order by rule", [org, idea])).rows,
    );
    expect(stats).toEqual([
      { rule: "critical_untested", status: "done", helpful: false, brier: 0.09, timed: true },
      { rule: "outcome_undefined", status: "dismissed", helpful: false, brier: 0.09, timed: true },
    ]);
    expect(await as(outsider, async (c) => (await c.query("select * from public.coach_note_stats($1)", [org])).rowCount)).toBe(0);
    await expect(as("anon", (c) => c.query("select * from public.coach_note_stats($1)", [org]))).rejects.toThrow(/permission denied/);
  });
});
