import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import { createHash, randomUUID } from "node:crypto";

// Golf B (besluit en voorspelling) aan de databasekant: kalibratie zonder stopdossiers, inzet bij de uitkomst,
// vergrendeling van de beslisregel, bevestigen met de samenvatting "Wat ging tegen", eerst voorspellen en de
// verlengde testfase met de uitkomstklok. Draait tegen een lokale Postgres met shim en migraties (scripts/test-db.sh).
const url = process.env.TEST_DATABASE_URL;
const ingestKey = "golf-b-test-key";
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

async function newOrg(owner: Who): Promise<string> {
  return as(owner, async (c) => (await c.query("select public.create_organization('Bureau ' || $1) as id", [owner.email])).rows[0].id);
}

async function newIdea(owner: Who, org: string): Promise<string> {
  return as(owner, async (c) =>
    (
      await c.query(
        `insert into public.ideas (org_id, title, decision_question, project_type, description, target_audience, region,
           outcome_statement, outcome_metric, outcome_target, reference_class, base_rate_low, base_rate_high)
         values ($1, 'Testidee', 'Investeren we €25.000?', 'new_product', 'Beschrijving', 'Eventmanagers', 'Nederland',
           'Zes maanden na het besluit hebben 15 klanten betaald', 'betalende klanten', 15, 'none', null, null)
         returning id`,
        [org],
      )
    ).rows[0].id,
  );
}

const realityCheck = async (who: Who, idea: string) =>
  as(who, async (c) => (await c.query("insert into public.reality_checks (idea_id, findings, advice, advice_reason) values ($1, '[]', 'test_more', 'Nog te weinig bewijs') returning id", [idea])).rows[0].id as string);

const forecast = (c: Client, idea: string, moment: string, who: string, p: number) =>
  c.query("insert into public.forecasts (idea_id, moment, forecaster_kind, forecaster_id, probability, rationale) values ($1, $2, 'consultant', $3, $4, 'Eén zin waarom')", [idea, moment, who, p]);

async function decide(who: Who, idea: string, action: string, extra: Record<string, unknown> = {}): Promise<string> {
  const rc = await realityCheck(who, idea);
  const cols = ["idea_id", "reality_check_id", "action", "rationale", ...Object.keys(extra)];
  const vals = [idea, rc, action, "Het bewijs is voldoende voor dit besluit", ...Object.values(extra)];
  return as(who, async (c) =>
    (await c.query(`insert into public.decisions (${cols.join(", ")}) values (${cols.map((_, i) => `$${i + 1}`).join(", ")}) returning id`, vals)).rows[0].id,
  );
}

// De klok start zoals de app hem start: eenmalig, na het besluit.
const startClock = (who: Who, idea: string) =>
  as(who, (c) => c.query("update public.ideas set outcome_clock_start = current_date, outcome_due = current_date + 30 where id = $1 and outcome_due is null", [idea]));

d("golf B: besluit en voorspelling", () => {
  let alice: Who;
  let org: string;

  beforeAll(async () => {
    db = new Client({ connectionString: url });
    await db.connect();
    await db.query("insert into public.ingest_keys (key_hash) values ($1) on conflict do nothing", [createHash("sha256").update(ingestKey).digest("hex")]);
    alice = await user(`alice-${randomUUID()}@example.com`);
    org = await newOrg(alice);
  });

  afterAll(async () => {
    await db?.end();
  });

  describe("punt 1: uitkomst na stop of pauze", () => {
    it("legt bij een stop de stopvraag vast, zes maanden na het besluit, en weigert de oorspronkelijke uitkomst", async () => {
      const idea = await newIdea(alice, org);
      await realityCheck(alice, idea);
      await as(alice, (c) => forecast(c, idea, "decision", alice.id, 0.3));
      await decide(alice, idea, "stop");
      await startClock(alice, idea);
      const row = await as(alice, async (c) => (await c.query("select outcome_question, outcome_due = (current_date + interval '6 months')::date as six from public.ideas where id = $1", [idea])).rows[0]);
      expect(row).toEqual({ outcome_question: "stop_review", six: true });
      // Geen nieuwe voorspellingen en geen idea_outcomes meer.
      expect(await as(alice, async (c) => (await c.query("select public.open_forecast_moment($1) as m", [idea])).rows[0].m)).toBeNull();
      await expect(as(alice, (c) => c.query("insert into public.idea_outcomes (idea_id, achieved, evidence) values ($1, 'no', 'Gestopt dus niet gehaald')", [idea]))).rejects.toThrow(/OUTCOME_STOPPED/);
      // De vraag ligt vast.
      await expect(as(alice, (c) => c.query("update public.ideas set outcome_question = 'success' where id = $1", [idea]))).rejects.toThrow(/OUTCOME_QUESTION_LOCKED/);
      await as(alice, (c) => c.query("insert into public.stop_reviews (idea_id, justified, evidence) values ($1, 'yes', 'Concurrent haalde in zes maanden twee klanten')", [idea]));
      // Een vastgelegd antwoord is een vast feit: geen update of delete.
      await expect(as(alice, (c) => c.query("update public.stop_reviews set justified = 'no' where idea_id = $1", [idea]))).rejects.toThrow(/permission denied/);
    });

    it("weigert de stopvraag bij een dossier dat doorgaat", async () => {
      const idea = await newIdea(alice, org);
      await decide(alice, idea, "continue");
      await startClock(alice, idea);
      expect(await as(alice, async (c) => (await c.query("select outcome_question from public.ideas where id = $1", [idea])).rows[0].outcome_question)).toBe("success");
      await expect(as(alice, (c) => c.query("insert into public.stop_reviews (idea_id, justified, evidence) values ($1, 'yes', 'Past niet bij dit dossier')", [idea]))).rejects.toThrow(/STOP_REVIEW_NOT_APPLICABLE/);
    });

    it("telt stopdossiers niet mee in scores, kalibratie en eigen basisrate, wel bij de terechte stops", async () => {
      const owner = await user(`owner-${randomUUID()}@example.com`);
      const o = await newOrg(owner);
      // Eén dossier dat doorging en is gehaald.
      const go = await newIdea(owner, o);
      await realityCheck(owner, go);
      await as(owner, (c) => forecast(c, go, "decision", owner.id, 0.8));
      await decide(owner, go, "continue");
      await startClock(owner, go);
      await as(owner, (c) => c.query("insert into public.idea_outcomes (idea_id, achieved, evidence) values ($1, 'yes', 'Vijftien klanten in de boekhouding')", [go]));
      // Eén gestopt dossier met een voorspelling van 10%.
      const stop = await newIdea(owner, o);
      await realityCheck(owner, stop);
      await as(owner, (c) => forecast(c, stop, "decision", owner.id, 0.1));
      await decide(owner, stop, "pause");
      await startClock(owner, stop);
      await as(owner, (c) => c.query("insert into public.stop_reviews (idea_id, justified, evidence) values ($1, 'yes', 'Markt bleek kleiner dan gedacht')", [stop]));

      const scores = await as(owner, async (c) => (await c.query("select forecasts::int, mean_probability::float from public.forecast_scores($1)", [o])).rows);
      expect(scores).toEqual([{ forecasts: 1, mean_probability: 0.8 }]);
      const cal = await as(owner, async (c) => (await c.query("select bucket, forecasts::int from public.forecast_calibration($1)", [o])).rows);
      expect(cal).toEqual([{ bucket: 8, forecasts: 1 }]);
      const base = await as(owner, async (c) => (await c.query("select resolved::int, achieved::float from public.own_base_rate($1, null, 0)", [o])).rows);
      expect(base).toEqual([{ resolved: 1, achieved: 1 }]);
      const stops = await as(owner, async (c) => (await c.query("select stopped::int, justified::int, open::int from public.stop_review_counts($1)", [o])).rows[0]);
      expect(stops).toEqual({ stopped: 1, justified: 1, open: 0 });
      // Een buitenstaander ziet niets.
      expect(await as(alice, async (c) => (await c.query("select stopped::int from public.stop_review_counts($1)", [o])).rows[0].stopped)).toBe(0);
    });
  });

  describe("punt 2: inzet bij de uitkomst", () => {
    async function resolvedIdea(owner: Who, o: string, effort: { started: boolean; hours?: number; budget?: number }, p = 0.7): Promise<string> {
      const idea = await newIdea(owner, o);
      await realityCheck(owner, idea);
      await as(owner, (c) => forecast(c, idea, "decision", owner.id, p));
      await decide(owner, idea, "continue");
      await startClock(owner, idea);
      await as(owner, (c) =>
        c.query("insert into public.idea_outcomes (idea_id, achieved, evidence, started, effort_hours, budget_pct_of_plan) values ($1, 'no', 'Geen klanten in de boekhouding', $2, $3, $4)", [
          idea,
          effort.started,
          effort.hours ?? null,
          effort.budget ?? null,
        ]),
      );
      return idea;
    }

    it("markeert onvoldoende uitvoering en laat alleen dan uitsluiten, met reden en audit", async () => {
      const owner = await user(`owner-${randomUUID()}@example.com`);
      const o = await newOrg(owner);
      const done = await resolvedIdea(owner, o, { started: true, hours: 200, budget: 90 }, 0.4);
      const lazy = await resolvedIdea(owner, o, { started: true, budget: 20 }, 0.8);
      const flags = await as(owner, async (c) => (await c.query("select idea_id, execution_insufficient from public.idea_outcomes where idea_id = any($1)", [[done, lazy]])).rows);
      expect(Object.fromEntries(flags.map((r) => [r.idea_id, r.execution_insufficient]))).toEqual({ [done]: false, [lazy]: true });

      await expect(as(owner, (c) => c.query("insert into public.calibration_exclusions (idea_id, reason) values ($1, 'Volgens plan uitgevoerd, toch uitsluiten')", [done]))).rejects.toThrow(/EXCLUSION_NOT_ALLOWED/);
      await expect(as(owner, (c) => c.query("insert into public.calibration_exclusions (idea_id, reason) values ($1, 'kort')", [lazy]))).rejects.toThrow(/check constraint/);
      // Twee voorspellingen meten mee zolang niemand uitsluit.
      expect(await as(owner, async (c) => (await c.query("select sum(forecasts)::int as n from public.forecast_scores($1)", [o])).rows[0].n)).toBe(2);
      await as(owner, (c) => c.query("insert into public.calibration_exclusions (idea_id, reason) values ($1, 'Budget ging na twee maanden naar een ander project')", [lazy]));
      expect(await as(owner, async (c) => (await c.query("select sum(forecasts)::int as n from public.forecast_scores($1)", [o])).rows[0].n)).toBe(1);
      expect(await as(owner, async (c) => (await c.query("select resolved::int from public.own_base_rate($1, null, 0)", [o])).rows[0].resolved)).toBe(1);
      const audit = await as(owner, async (c) => (await c.query("select action, actor_id, detail->>'reason' as reason from public.audit_events where table_name = 'calibration_exclusions' and idea_id = $1", [lazy])).rows);
      expect(audit).toContainEqual({ action: "calibration_exclude", actor_id: owner.id, reason: "Budget ging na twee maanden naar een ander project" });
      // Weer meetellen kan, en staat ook in het spoor.
      await as(owner, (c) => c.query("delete from public.calibration_exclusions where idea_id = $1", [lazy]));
      expect(await as(owner, async (c) => (await c.query("select sum(forecasts)::int as n from public.forecast_scores($1)", [o])).rows[0].n)).toBe(2);
      expect(await as(owner, async (c) => (await c.query("select count(*)::int as n from public.audit_events where action = 'calibration_include' and idea_id = $1", [lazy])).rows[0].n)).toBe(1);
    });

    it("laat alleen een consultant van de werkruimte uitsluiten", async () => {
      const owner = await user(`owner-${randomUUID()}@example.com`);
      const client = await user(`klant-${randomUUID()}@example.com`);
      const o = await newOrg(owner);
      const idea = await resolvedIdea(owner, o, { started: false });
      await as(owner, (c) => c.query("insert into public.idea_members (idea_id, email, role) values ($1, $2, 'client_decider')", [idea, client.email]));
      await as(client, (c) => c.query("select public.claim_invitations()"));
      await expect(as(client, (c) => c.query("insert into public.calibration_exclusions (idea_id, reason) values ($1, 'De opdrachtgever wil dit niet meetellen')", [idea]))).rejects.toThrow(/row-level security/);
      await expect(as(alice, (c) => c.query("insert into public.calibration_exclusions (idea_id, reason) values ($1, 'Een buitenstaander probeert het ook')", [idea]))).rejects.toThrow(/row-level security/);
    });
  });

  describe("punt 15: de AI telt als één stem", () => {
    it("middelt de AI-voorspellingen per dossier en moment in scores en kalibratie", async () => {
      const owner = await user(`owner-${randomUUID()}@example.com`);
      const o = await newOrg(owner);
      const idea = await newIdea(owner, o);
      await realityCheck(owner, idea);
      await as(owner, (c) => forecast(c, idea, "decision", owner.id, 0.6));
      for (const [p, model] of [
        [0.2, "claude-model"],
        [0.4, "gpt-model"],
        [0.9, "gemini-model"],
      ] as const)
        await as(owner, (c) => c.query("select public.record_ai_forecast($1, $2, 'decision', $3, 'Eén zin waarom', $4)", [ingestKey, idea, p, model]));
      await decide(owner, idea, "continue");
      await startClock(owner, idea);
      await as(owner, (c) => c.query("insert into public.idea_outcomes (idea_id, achieved, evidence, started) values ($1, 'yes', 'Vijftien klanten in de boekhouding', true)", [idea]));
      const scores = await as(owner, async (c) => (await c.query("select forecaster_kind, forecasts::int, round(mean_probability, 2)::float as mean from public.forecast_scores($1) order by forecaster_kind", [o])).rows);
      expect(scores).toEqual([
        { forecaster_kind: "ai", forecasts: 1, mean: 0.5 },
        { forecaster_kind: "consultant", forecasts: 1, mean: 0.6 },
      ]);
      // Kalibratie: één stem van 50% en één van 60%, niet vier losse voorspellingen.
      const cal = await as(owner, async (c) => (await c.query("select bucket, forecasts::int from public.forecast_calibration($1)", [o])).rows);
      expect(cal).toEqual([
        { bucket: 5, forecasts: 1 },
        { bucket: 6, forecasts: 1 },
      ]);
      // De interne functie is niet rechtstreeks aan te roepen.
      await expect(as(owner, (c) => c.query("select * from public.calibration_votes_internal($1)", [o]))).rejects.toThrow(/permission denied/);
    });
  });

  describe("punt 6: beslisregel", () => {
    // Een aanname met een experiment in concept.
    async function assumptionWithTest(who: Who, idea: string): Promise<{ assumption: string; experiment: string }> {
      return as(who, async (c) => {
        const a = (await c.query("insert into public.assumptions (idea_id, statement, category, importance) values ($1, 'Eventmanagers betalen voor selectie', 'desirability', 5) returning id", [idea])).rows[0].id;
        const h = (
          await c.query(
            `insert into public.hypotheses (idea_id, assumption_id, we_believe, target_group, test_method, metric_label,
               metric_numerator, metric_denominator, success_threshold_pct, fail_threshold_pct, min_sample, max_duration_days)
             values ($1, $2, 'Eventmanagers handelen', 'NL eventmanagers', 'test', 'ratio', 'teller', 'noemer', 15, 5, 20, 21) returning id`,
            [idea, a],
          )
        ).rows[0].id;
        const e = (await c.query("insert into public.experiments (idea_id, hypothesis_id, type, title) values ($1, $2, 'landing', 'Landingspagina') returning id", [idea, h])).rows[0].id;
        return { assumption: a, experiment: e };
      });
    }
    const save = (who: Who, idea: string, primary: string | null, conditions: { assumption_id: string; min_probability: number }[]) =>
      as(who, async (c) => (await c.query("select public.save_decision_rule($1, $2, 'Toelichting', $3) as r", [idea, primary, JSON.stringify(conditions)])).rows[0].r as string);
    const ruleRow = (who: Who, idea: string) =>
      as(who, async (c) => (await c.query("select locked_at is not null as locked, recorded_late from public.decision_rules where idea_id = $1", [idea])).rows[0]);

    it("kan worden aangepast tot de eerste goedgekeurde test, en ligt daarna vast", async () => {
      const idea = await newIdea(alice, org);
      const x = await assumptionWithTest(alice, idea);
      expect(await save(alice, idea, x.experiment, [{ assumption_id: x.assumption, min_probability: 0.6 }])).toBe("open");
      expect(await save(alice, idea, x.experiment, [{ assumption_id: x.assumption, min_probability: 0.7 }])).toBe("open");
      expect(await as(alice, async (c) => Number((await c.query("select min_probability from public.decision_rule_assumptions where idea_id = $1", [idea])).rows[0].min_probability))).toBe(0.7);
      // Direct schrijven gaat niet; alleen via save_decision_rule.
      await expect(as(alice, (c) => c.query("update public.decision_rules set note = 'stil gewijzigd' where idea_id = $1", [idea]))).rejects.toThrow(/permission denied/);

      await as(alice, (c) => c.query("update public.experiments set state = 'ready_for_review' where id = $1", [x.experiment]));
      await as(alice, (c) => c.query("update public.experiments set state = 'approved' where id = $1", [x.experiment]));
      expect(await ruleRow(alice, idea)).toEqual({ locked: true, recorded_late: false });
      await expect(save(alice, idea, x.experiment, [{ assumption_id: x.assumption, min_probability: 0.5 }])).rejects.toThrow(/DECISION_RULE_LOCKED/);
      // Ook terug naar concept maakt de regel niet weer open.
      await as(alice, (c) => c.query("update public.experiments set state = 'draft' where id = $1", [x.experiment]));
      await expect(save(alice, idea, null, [{ assumption_id: x.assumption, min_probability: 0.5 }])).rejects.toThrow(/DECISION_RULE_LOCKED/);
      // De aanname in een vergrendelde regel kan niet meer weg.
      await expect(as(alice, (c) => c.query("delete from public.assumptions where id = $1", [x.assumption]))).rejects.toThrow(/DECISION_RULE_LOCKED/);
    });

    it("markeert een regel na de eerste goedgekeurde test als achteraf vastgelegd", async () => {
      const idea = await newIdea(alice, org);
      const x = await assumptionWithTest(alice, idea);
      await as(alice, (c) => c.query("update public.experiments set state = 'ready_for_review' where id = $1", [x.experiment]));
      await as(alice, (c) => c.query("update public.experiments set state = 'approved' where id = $1", [x.experiment]));
      expect(await save(alice, idea, x.experiment, [{ assumption_id: x.assumption, min_probability: 0.6 }])).toBe("locked_late");
      expect(await ruleRow(alice, idea)).toEqual({ locked: true, recorded_late: true });
      expect(await as(alice, async (c) => (await c.query("select count(*)::int as n from public.decision_rule_assumptions where idea_id = $1", [idea])).rows[0].n)).toBe(1);
    });

    it("weigert verwijzingen naar een ander dossier en schrijven door een opdrachtgever", async () => {
      const idea = await newIdea(alice, org);
      const other = await newIdea(alice, org);
      const x = await assumptionWithTest(alice, other);
      await expect(save(alice, idea, x.experiment, [])).rejects.toThrow(/IDEA_MISMATCH/);
      const client = await user(`klant-${randomUUID()}@example.com`);
      await as(alice, (c) => c.query("insert into public.idea_members (idea_id, email, role) values ($1, $2, 'client_decider')", [idea, client.email]));
      await as(client, (c) => c.query("select public.claim_invitations()"));
      await expect(save(client, idea, null, [])).rejects.toThrow(/FORBIDDEN/);
    });

    it("toetst het besluit: afwijken vraagt een motivering die in de audit komt, en een niet-geslaagde hoofdtest maakt de regel niet gehaald", async () => {
      const idea = await newIdea(alice, org);
      const x = await assumptionWithTest(alice, idea);
      await save(alice, idea, x.experiment, [{ assumption_id: x.assumption, min_probability: 0.6 }]);
      const evaluation = JSON.stringify({ met: false, conditions: [], primary: null });
      await expect(decide(alice, idea, "continue")).rejects.toThrow(/DECISION_RULE_EVAL/);
      await expect(decide(alice, idea, "continue", { rule_met: false, rule_evaluation: evaluation })).rejects.toThrow(/DECISION_RULE_DEVIATION/);
      // Zonder geslaagde hoofdtest kan de app de regel niet "gehaald" noemen.
      await expect(decide(alice, idea, "continue", { rule_met: true, rule_evaluation: evaluation })).rejects.toThrow(/DECISION_RULE_EVAL/);
      const id = await decide(alice, idea, "continue", { rule_met: false, rule_evaluation: evaluation, rule_deviation_reason: "Strategisch belangrijk, we nemen het risico bewust" });
      const audit = await as(alice, async (c) => (await c.query("select detail->>'reason' as reason from public.audit_events where action = 'rule_deviation' and row_id = $1", [id])).rows);
      expect(audit).toEqual([{ reason: "Strategisch belangrijk, we nemen het risico bewust" }]);
      // Het eerste definitieve besluit vergrendelt de regel ook zonder goedgekeurde test.
      expect(await ruleRow(alice, idea)).toEqual({ locked: true, recorded_late: false });
      // Een besluit dat de regel volgt, bewaart geen motivering; een tussenbesluit wordt niet getoetst.
      const followed = await decide(alice, idea, "stop", { rule_met: false, rule_evaluation: evaluation, rule_deviation_reason: "overbodig" });
      const testMore = await decide(alice, idea, "test_more", { rule_met: true, rule_evaluation: evaluation });
      const rows = await as(alice, async (c) => (await c.query("select id, rule_met, rule_deviation_reason from public.decisions where id = any($1)", [[followed, testMore]])).rows);
      expect(Object.fromEntries(rows.map((r) => [r.id, [r.rule_met, r.rule_deviation_reason]]))).toEqual({ [followed]: [false, null], [testMore]: [null, null] });
    });
  });
});
