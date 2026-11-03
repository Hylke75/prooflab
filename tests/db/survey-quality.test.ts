import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import { randomUUID, createHash } from "node:crypto";
import { assessResponse, countResponses, minimumDurationMs, templateSurvey, type Answers, type SurveyConfig } from "@/lib/domain/survey";
import { addAttentionCheck } from "@/lib/domain/survey-editor";

// Database side of survey quality: stored quality flags, the key metric counted in SQL (survey_key_counts), the
// public view without screening and attention answers, and per-question summaries shared with clients. Same helper
// pattern as survey-distribution.test.ts; skipped when TEST_DATABASE_URL is not set.
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

const ingestKey = "test-ingest-key-sq";

// The screened template with three extra scale questions (four in total) and an attention check.
function surveyConfig(): SurveyConfig {
  const t = templateSurvey({ assumption: "Ze zoeken hulp", audience: "MKB", researcher: "Link & Lead", product: "X", screen: true });
  const scale = (id: string) => ({ id, type: "scale" as const, text: `Hoeveel last had u van onderdeel ${id}?`, required: true, scale: { min: 1, max: 5, minLabel: "Geen", maxLabel: "Veel" } });
  return addAttentionCheck({ ...t, questions: [...t.questions, scale("s2"), scale("s3"), scale("s4")] });
}
const CONFIG = surveyConfig();
const CHECK = CONFIG.questions.find((q) => q.attention)!.id;

async function liveSurvey(owner: { id: string; email: string }) {
  return as(owner, async (c) => {
    const org = (await c.query("select public.create_organization('Bureau ' || $1) as id", [owner.email])).rows[0].id;
    const idea = (
      await c.query(
        `insert into public.ideas (org_id, title, decision_question, project_type, description, target_audience, region)
         values ($1, 'Kwaliteit', 'Investeren we?', 'new_product', 'Beschrijving', 'MKB', 'Nederland') returning id`,
        [org],
      )
    ).rows[0].id;
    const a = (await c.query("insert into public.assumptions (idea_id, statement, category, importance) values ($1, 'Ze zoeken hulp', 'desirability', 5) returning id", [idea])).rows[0].id;
    const h = (
      await c.query(
        `insert into public.hypotheses (idea_id, assumption_id, we_believe, target_group, test_method, metric_label, metric_numerator, metric_denominator, success_threshold_pct, min_sample, max_duration_days)
         values ($1, $2, 'Ze zoeken actief', 'MKB', 'enquête', 'zocht actief', 'zocht', 'respondenten', 30, 20, 14) returning id`,
        [idea, a],
      )
    ).rows[0].id;
    const e = (await c.query("insert into public.experiments (idea_id, hypothesis_id, type, title, config) values ($1, $2, 'survey', 'Enquête', $3) returning id", [idea, h, JSON.stringify(CONFIG)])).rows[0].id;
    for (const s of ["ready_for_review", "approved", "live"]) await c.query("update public.experiments set state = $2 where id = $1", [e, s]);
    const slug = (await c.query("select public_slug from public.experiments where id = $1", [e])).rows[0].public_slug as string;
    return { org, idea, e, slug };
  });
}

let bucket = 0;
// What the submit route does: assess with the TypeScript rule, store the outcome.
async function submit(slug: string, answers: Answers, opts: { duration?: number; channel?: string; visitor?: string } = {}) {
  const duration = opts.duration ?? minimumDurationMs(CONFIG) + 5000;
  const a = assessResponse(CONFIG, answers, duration);
  return as("anon", async (c) =>
    (
      await c.query("select public.submit_survey($1, $2, $3, $4, $5, true, $6, null, $7, $8, $9) as r", [
        ingestKey,
        slug,
        opts.visitor ?? randomUUID(),
        opts.channel ?? "linkedin",
        JSON.stringify(answers),
        duration,
        `sq-${bucket++}`,
        a.qualified,
        a.quality,
      ])
    ).rows[0].r as string,
  );
}

const good = (over: Answers = {}): Answers => ({ laatst: "maand", gezocht: "ja_betaald", last: 4, s2: 2, s3: 3, s4: 5, [CHECK]: "o2", ...over });

d("survey quality: stored flags, counts in SQL and client sharing", () => {
  let alice: { id: string; email: string };
  let bob: { id: string; email: string };
  let klant: { id: string; email: string };
  let S: Awaited<ReturnType<typeof liveSurvey>>;
  const submitted: { answers: Answers; channel: string; duration: number }[] = [];

  beforeAll(async () => {
    db = new Client({ connectionString: url });
    await db.connect();
    await db.query("insert into public.ingest_keys (key_hash) values ($1) on conflict do nothing", [createHash("sha256").update(ingestKey).digest("hex")]);
    alice = await user(`alice-${randomUUID()}@example.com`);
    bob = await user(`bob-${randomUUID()}@example.com`);
    klant = await user(`klant-${randomUUID()}@example.com`);
    S = await liveSurvey(alice);
    await liveSurvey(bob);
    await as(alice, (c) => c.query("insert into public.idea_members (idea_id, email, role) values ($1, $2, 'client_decider')", [S.idea, klant.email]));
    await as(klant, (c) => c.query("select public.claim_invitations()"));
    const slow = minimumDurationMs(CONFIG) + 5000;
    const plan: { answers: Answers; channel: string; duration: number }[] = [
      { answers: good(), channel: "linkedin", duration: slow },
      { answers: good({ gezocht: "nee", last: 1 }), channel: "linkedin", duration: slow },
      { answers: good({ gezocht: "ja_gezocht", s2: 4 }), channel: "linkedin", duration: slow },
      { answers: good({ gezocht: "nee", s3: 1 }), channel: "network", duration: slow },
      { answers: good({ s4: 1 }), channel: "network", duration: slow },
      { answers: good({ gezocht: "nee", last: 5 }), channel: "network", duration: slow },
      { answers: { laatst: "nooit" }, channel: "linkedin", duration: 3000 }, // outside the target group
      { answers: good(), channel: "linkedin", duration: 2000 }, // too fast
      { answers: good({ [CHECK]: "o4" }), channel: "network", duration: slow }, // failed attention check
      { answers: good({ last: 3, s2: 3, s3: 3, s4: 3 }), channel: "network", duration: slow }, // same answer everywhere
    ];
    for (const p of plan) {
      expect(await submit(S.slug, p.answers, { duration: p.duration, channel: p.channel })).toBe("ok");
      submitted.push(p);
    }
  });

  afterAll(async () => {
    await db?.end();
  });

  it("stores the quality flags and refuses a response without a valid assessment", async () => {
    const rows = await as(alice, async (c) => (await c.query("select qualified, quality from public.survey_responses where experiment_id = $1", [S.e])).rows);
    expect(rows).toHaveLength(10);
    expect(rows.filter((r) => !r.qualified)).toHaveLength(1);
    expect(rows.map((r) => r.quality).sort()).toEqual(["attention", "ok", "ok", "ok", "ok", "ok", "ok", "ok", "straightlining", "too_fast"]);
    const bad = await as("anon", async (c) =>
      (await c.query("select public.submit_survey($1, $2, 'v-bad', 'x', '{}', true, 30000, null, 'sq-bad', true, 'perfect') as r", [ingestKey, S.slug])).rows[0].r,
    );
    expect(bad).toBe("invalid");
    await expect(
      as("anon", (c) => c.query("select public.submit_survey($1, $2, 'v-old', 'x', '{}', true, 30000, null, 'sq-old')", [ingestKey, S.slug])),
    ).rejects.toThrow(/does not exist/);
  });

  it("counts the key metric in SQL exactly as the TypeScript rule does", async () => {
    const sql = await as(klant, async (c) => (await c.query("select * from public.survey_key_counts($1)", [S.e])).rows);
    const ts = countResponses(
      CONFIG,
      submitted.map((p) => ({ answers: p.answers, source: "open_link" as const, channel: p.channel, duration_ms: p.duration })),
    ).sort((a, b) => a.channel.localeCompare(b.channel));
    expect(sql).toEqual(ts);
    expect(sql.find((r) => r.channel === "linkedin")).toMatchObject({ responses: 5, n: 3, successes: 2, too_fast: 1, screened_out: 1 });
    expect(sql.find((r) => r.channel === "network")).toMatchObject({ responses: 5, n: 3, successes: 1, failed_attention: 1, straightlining: 1 });
    // Outsiders see nothing; anonymous callers cannot call it.
    expect(await as(bob, async (c) => (await c.query("select * from public.survey_key_counts($1)", [S.e])).rowCount)).toBe(0);
    await expect(as("anon", (c) => c.query("select * from public.survey_key_counts($1)", [S.e]))).rejects.toThrow(/permission denied/);
  });

  it("keeps qualifying screening answers and attention-check answers out of the public view, and gives the server the full config", async () => {
    const pub = await as("anon", async (c) => (await c.query("select public.get_public_survey($1, null) as s", [S.slug])).rows[0].s);
    expect(pub.config.screening).toEqual({ question: "laatst" });
    expect(pub.config.questions.map((q: { id: string }) => q.id)).toEqual(CONFIG.questions.map((q) => q.id));
    expect(JSON.stringify(pub.config)).not.toContain('"attention"');
    expect(pub.config.key_question).toBeUndefined();
    const full = await as("anon", async (c) => (await c.query("select public.get_survey_config($1, $2) as s", [ingestKey, S.slug])).rows[0].s);
    expect(full.screening.qualifying).toEqual(["week", "maand", "kwartaal", "langer"]);
    expect(full.key_question).toBe("gezocht");
    await expect(as("anon", (c) => c.query("select public.get_survey_config('wrong', $1)", [S.slug]))).rejects.toThrow(/FORBIDDEN/);
    await expect(as(alice, (c) => c.query("select public.get_survey_config($1, $2)", [ingestKey, S.slug]))).rejects.toThrow(/permission denied/);
  });

  it("shares only the chosen closed questions with clients, aggregated over believable responses", async () => {
    // Nothing shared yet: clients get no per-question summaries.
    expect(await as(klant, async (c) => (await c.query("select * from public.survey_shared_summaries($1)", [S.e])).rowCount)).toBe(0);
    // Clients cannot decide what is shared.
    await expect(as(klant, (c) => c.query("insert into public.survey_shares (experiment_id, idea_id, questions) values ($1, $2, '{gezocht}')", [S.e, S.idea]))).rejects.toThrow(
      /row-level security/,
    );
    // Even when an open question ends up in the list, its answers never leave the database.
    await as(alice, (c) => c.query("insert into public.survey_shares (experiment_id, idea_id, questions, updated_by) values ($1, $2, '{gezocht,last,toelichting,uitgaven}', $3)", [S.e, S.idea, klant.id]));
    const share = await as(klant, async (c) => (await c.query("select questions, updated_by from public.survey_shares where experiment_id = $1", [S.e])).rows[0]);
    expect(share.updated_by).toBe(alice.id); // stamped by the database
    const rows = await as(klant, async (c) => (await c.query("select question_id, value, answers, count from public.survey_shared_summaries($1)", [S.e])).rows);
    expect(new Set(rows.map((r) => r.question_id))).toEqual(new Set(["gezocht", "last"])); // uitgaven: fewer than 5 answers
    expect(rows.filter((r) => r.question_id === "gezocht")).toEqual([
      { question_id: "gezocht", value: "ja_betaald", answers: 6, count: 2 },
      { question_id: "gezocht", value: "ja_gezocht", answers: 6, count: 1 },
      { question_id: "gezocht", value: "nee", answers: 6, count: 3 },
    ]);
    expect(rows.filter((r) => r.question_id === "last").reduce((s, r) => s + r.count, 0)).toBe(6);
    expect(await as(bob, async (c) => (await c.query("select * from public.survey_shared_summaries($1)", [S.e])).rowCount)).toBe(0);
    await expect(as("anon", (c) => c.query("select * from public.survey_shared_summaries($1)", [S.e]))).rejects.toThrow(/permission denied/);
    // The share stays editable after approval (the survey config itself is locked).
    expect(await as(alice, async (c) => (await c.query("update public.survey_shares set questions = '{last}' where experiment_id = $1", [S.e])).rowCount)).toBe(1);
    expect(await as(klant, async (c) => (await c.query("update public.survey_shares set questions = '{gezocht}' where experiment_id = $1", [S.e])).rowCount)).toBe(0);
    const after = await as(klant, async (c) => (await c.query("select distinct question_id from public.survey_shared_summaries($1)", [S.e])).rows);
    expect(after).toEqual([{ question_id: "last" }]);
  });

  it("has one submit_survey that stores the post code and the quality flags, counted per post by the same rule", async () => {
    const overloads = (await db.query("select count(*)::int as n from pg_proc where proname = 'submit_survey' and pronamespace = 'public'::regnamespace")).rows[0].n;
    expect(overloads).toBe(1);
    const other = await liveSurvey(alice);
    const post = async (answers: Answers, content: string, duration = minimumDurationMs(CONFIG) + 5000) => {
      const a = assessResponse(CONFIG, answers, duration);
      return as("anon", async (c) =>
        (
          await c.query("select public.submit_survey($1, $2, $3, 'linkedin', $4, true, $5, null, $6, $7, $8, $9) as r", [
            ingestKey,
            other.slug,
            randomUUID(),
            JSON.stringify(answers),
            duration,
            `sq-p-${bucket++}`,
            a.qualified,
            a.quality,
            content,
          ])
        ).rows[0].r,
      );
    };
    expect(await post(good(), "li-abc12")).toBe("ok");
    expect(await post(good({ gezocht: "nee" }), "li-abc12")).toBe("ok");
    expect(await post(good(), "li-abc12", 1000)).toBe("ok"); // too fast: not counted for the post either
    expect(await post({ laatst: "nooit" }, "li-abc12")).toBe("ok");
    expect(await post(good(), "Bad Code!")).toBe("ok"); // cleaned to "badcode"
    const rows = await as(alice, async (c) => (await c.query("select * from public.survey_key_counts($1)", [other.e])).rows);
    expect(rows.find((r) => r.content === "li-abc12")).toMatchObject({ responses: 4, n: 2, successes: 1, too_fast: 1, screened_out: 1 });
    expect(rows.find((r) => r.content === "badcode")).toMatchObject({ responses: 1, n: 1, successes: 1 });
    const stored = await as(alice, async (c) => (await c.query("select content, qualified, quality from public.survey_responses where experiment_id = $1 order by created_at", [other.e])).rows);
    expect(stored.every((r) => r.quality != null && r.qualified != null)).toBe(true);
  });

  it("rejects a share that points at an experiment of another dossier", async () => {
    const other = await liveSurvey(alice);
    await expect(
      as(alice, (c) => c.query("insert into public.survey_shares (experiment_id, idea_id, questions) values ($1, $2, '{}')", [other.e, S.idea])),
    ).rejects.toThrow(/IDEA_MISMATCH|duplicate key/);
  });
});
