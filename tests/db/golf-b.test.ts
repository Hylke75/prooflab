import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import { randomUUID } from "node:crypto";

// Golf B (besluit en voorspelling) aan de databasekant: kalibratie zonder stopdossiers, inzet bij de uitkomst,
// vergrendeling van de beslisregel, bevestigen met de samenvatting "Wat ging tegen", eerst voorspellen en de
// verlengde testfase met de uitkomstklok. Draait tegen een lokale Postgres met shim en migraties (scripts/test-db.sh).
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
});
