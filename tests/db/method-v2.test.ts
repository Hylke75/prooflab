import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import { randomUUID } from "node:crypto";

// Methode 2026-11-b (supabase/migrations/20261106110000_method_v2.sql): de beslisregel op de Test Card wordt
// na goedkeuring mee vergrendeld. Draait tegen een wegwerp-Postgres (scripts/test-db.sh); overgeslagen zonder
// TEST_DATABASE_URL.
const url = process.env.TEST_DATABASE_URL;
const d = url ? describe : describe.skip;

let db: Client;
type U = { id: string; email: string };

async function as<T>(who: U, fn: (c: Client) => Promise<T>): Promise<T> {
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

async function user(email: string): Promise<U> {
  const id = randomUUID();
  await db.query("insert into auth.users (id, email, email_confirmed_at) values ($1, $2, now())", [id, email]);
  return { id, email };
}

async function newIdea(owner: U) {
  return as(owner, async (c) => {
    const org = (await c.query("select public.create_organization('Bureau ' || $1) as id", [owner.email])).rows[0].id as string;
    const idea = (
      await c.query(
        `insert into public.ideas (org_id, title, decision_question, project_type, description, target_audience, region)
         values ($1, 'Methode-idee', 'Investeren we €25.000?', 'new_product', 'Beschrijving', 'Eventmanagers', 'Nederland') returning id`,
        [org],
      )
    ).rows[0].id as string;
    return { org, idea };
  });
}

async function hypothesisWithRule(owner: U, idea: string, rule: "absolute" | "probability") {
  return as(owner, async (c) => {
    const a = (await c.query("insert into public.assumptions (idea_id, statement, category, importance) values ($1, 'Klanten betalen vooraf', 'viability', 5) returning id", [idea])).rows[0].id;
    const h = (
      await c.query(
        `insert into public.hypotheses (idea_id, assumption_id, we_believe, target_group, test_method, metric_label,
           metric_numerator, metric_denominator, success_threshold_pct, fail_threshold_pct, min_sample, max_duration_days,
           decision_rule, success_count, required_n, expected_pct, available_per_week)
         values ($1, $2, 'Eventmanagers doen een aanbetaling na het gesprek', 'NL eventmanagers', 'interviews', 'aanbetaling',
           'geïnterviewden met aanbetaling', 'geïnterviewden', 20, null, 15, 21, $3, $4, 15, 20, 5) returning id`,
        [idea, a, rule, rule === "absolute" ? 3 : null],
      )
    ).rows[0].id;
    const e = (await c.query("insert into public.experiments (idea_id, hypothesis_id, type, title) values ($1, $2, 'interview', 'Gesprekken') returning id", [idea, h])).rows[0].id;
    return { hypothesis: h as string, experiment: e as string };
  });
}

d("methode 2026-11-b", () => {
  let owner: U;
  let A: { org: string; idea: string };

  beforeAll(async () => {
    db = new Client({ connectionString: url });
    await db.connect();
    owner = await user(`eigenaar-${randomUUID()}@example.com`);
    A = await newIdea(owner);
  });

  afterAll(async () => {
    await db?.end();
  });

  it("vergrendelt de beslisregel en de vooraf berekende aantallen na goedkeuring", async () => {
    const x = await hypothesisWithRule(owner, A.idea, "absolute");
    // Vóór goedkeuring mag de regel nog veranderen.
    await as(owner, (c) => c.query("update public.hypotheses set success_count = 4 where id = $1", [x.hypothesis]));
    await as(owner, (c) => c.query("update public.experiments set state = 'ready_for_review' where id = $1", [x.experiment]));
    await as(owner, (c) => c.query("update public.experiments set state = 'approved' where id = $1", [x.experiment]));
    for (const change of [
      "decision_rule = 'probability', success_count = null",
      "success_count = 2",
      "required_n = 5",
      "expected_pct = 50",
      "available_per_week = 100",
    ]) {
      await expect(as(owner, (c) => c.query(`update public.hypotheses set ${change} where id = $1`, [x.hypothesis]))).rejects.toThrow(/HYPOTHESIS_LOCKED/);
      // Ook buiten de rijbeveiliging om (servicerol) houdt de trigger het tegen.
      await expect(db.query(`update public.hypotheses set ${change} where id = $1`, [x.hypothesis])).rejects.toThrow(/HYPOTHESIS_LOCKED/);
    }
    const row = (await db.query("select decision_rule, success_count, required_n, expected_pct::float, available_per_week from public.hypotheses where id = $1", [x.hypothesis])).rows[0];
    expect(row).toEqual({ decision_rule: "absolute", success_count: 4, required_n: 15, expected_pct: 20, available_per_week: 5 });
  });

  it("plafonds: leden lezen, alleen eigenaren schrijven, de opdrachtgever krijgt ze via het dossier", async () => {
    const editor = await user(`consultant-${randomUUID()}@example.com`);
    const outsider = await user(`ander-${randomUUID()}@example.com`);
    const client = await user(`klant-${randomUUID()}@example.com`);
    await as(owner, (c) => c.query("insert into public.organization_members (org_id, user_id, role) values ($1, $2, 'editor')", [A.org, editor.id]));
    await as(owner, (c) => c.query("insert into public.idea_members (idea_id, email, role) values ($1, $2, 'client_decider')", [A.idea, client.email]));
    await as(client, (c) => c.query("select public.claim_invitations()"));

    // Zonder rij: geen plafonds uit de database (de app gebruikt dan de standaardwaarden).
    expect((await as(owner, (c) => c.query("select * from public.evidence_caps_for_idea($1)", [A.idea]))).rowCount).toBe(0);

    await as(owner, (c) => c.query("insert into public.org_evidence_caps (org_id, opinion, problem, small_action, quote, deposit) values ($1, 0.35, 0.5, 0.6, 0.8, 0.9)", [A.org]));
    const stamped = (await db.query("select updated_by from public.org_evidence_caps where org_id = $1", [A.org])).rows[0];
    expect(stamped.updated_by).toBe(owner.id);

    // Een consultant (geen eigenaar) leest wel, maar schrijft niet.
    const seen = await as(editor, async (c) => (await c.query("select opinion::float from public.org_evidence_caps where org_id = $1", [A.org])).rows);
    expect(seen).toEqual([{ opinion: 0.35 }]);
    const updated = await as(editor, async (c) => (await c.query("update public.org_evidence_caps set opinion = 0.5 where org_id = $1", [A.org])).rowCount);
    expect(updated).toBe(0);
    const deleted = await as(editor, async (c) => (await c.query("delete from public.org_evidence_caps where org_id = $1", [A.org])).rowCount);
    expect(deleted).toBe(0);
    await expect(
      as(editor, (c) => c.query("insert into public.org_evidence_caps (org_id) values ($1) on conflict (org_id) do update set opinion = 0.6", [A.org])),
    ).rejects.toThrow(/row-level security/);

    // Buitenstaanders zien niets, ook niet via het dossier.
    expect((await as(outsider, (c) => c.query("select * from public.org_evidence_caps where org_id = $1", [A.org]))).rowCount).toBe(0);
    expect((await as(outsider, (c) => c.query("select * from public.evidence_caps_for_idea($1)", [A.idea]))).rowCount).toBe(0);

    // De opdrachtgever leest de tabel niet, maar rekent via het dossier met dezelfde plafonds.
    expect((await as(client, (c) => c.query("select * from public.org_evidence_caps where org_id = $1", [A.org]))).rowCount).toBe(0);
    const viaIdea = await as(client, async (c) => (await c.query("select opinion::float, quote::float from public.evidence_caps_for_idea($1)", [A.idea])).rows);
    expect(viaIdea).toEqual([{ opinion: 0.35, quote: 0.8 }]);

    // Oplopend per niveau, binnen 5–99%.
    await expect(as(owner, (c) => c.query("update public.org_evidence_caps set problem = 0.3 where org_id = $1", [A.org]))).rejects.toThrow(/org_evidence_caps_ascending/);
    await expect(as(owner, (c) => c.query("update public.org_evidence_caps set deposit = 1 where org_id = $1", [A.org]))).rejects.toThrow(/check/);

    // Elke wijziging staat in het auditspoor van de werkruimte.
    await as(owner, (c) => c.query("update public.org_evidence_caps set opinion = 0.3 where org_id = $1", [A.org]));
    const audit = await as(owner, async (c) => (await c.query("select action, detail from public.audit_events where table_name = 'org_evidence_caps' and org_id = $1 order by id", [A.org])).rows);
    expect(audit.map((r) => r.action)).toEqual(["insert", "update"]);
    expect(Number(audit[1].detail.old.opinion)).toBe(0.35);
    expect(Number(audit[1].detail.new.opinion)).toBe(0.3);
  });

  it("geeft per bevinding en observatie de bron waarmee signalen worden samengevoegd", async () => {
    const ids = await as(owner, async (c) => {
      const src = async (type: string, title: string) =>
        (await c.query("insert into public.sources (idea_id, title, source_type) values ($1, $2, $3) returning id", [A.idea, title, type])).rows[0].id as string;
      const claim = async (source: string | null) => {
        const id = (await c.query("insert into public.claims (idea_id, statement, evidence_type) values ($1, 'Bewering', 'qualitative_observation') returning id", [A.idea])).rows[0].id as string;
        if (source) await c.query("insert into public.claim_sources (claim_id, idea_id, source_id, quote) values ($1, $2, $3, 'citaat')", [id, A.idea, source]);
        return id;
      };
      const h = (await c.query("select id from public.hypotheses where idea_id = $1 limit 1", [A.idea])).rows[0].id;
      const survey = (await c.query("insert into public.experiments (idea_id, hypothesis_id, type, title) values ($1, $2, 'survey', 'Enquête X') returning id", [A.idea, h])).rows[0].id as string;
      const cbs = await src("official_statistic", "CBS Statline");
      const out1 = await src("outreach", "Expandi-antwoorden – Event-Q4 – 3 november 2026");
      const out2 = await src("outreach", "Expandi-antwoorden – Event-Q4 – 9 november 2026");
      const open = await src("survey", "Enquête – Enquête X – open antwoorden – 4 november 2026");
      const iv = (
        await c.query(
          `insert into public.interviews (experiment_id, idea_id, participant_label, dmu_role, recruited_via, held_on, record_type, transcript, consent_recorded)
           values ($1, $2, 'Eventmanager A', 'user', 'network', current_date, 'notes', 'Notities van het gesprek', true) returning id`,
          [survey, A.idea],
        )
      ).rows[0].id as string;
      const obs = (await c.query("insert into public.observations (idea_id, experiment_id, interview_id, kind, summary) values ($1, $2, $3, 'opinion', 'x') returning id", [A.idea, survey, iv])).rows[0].id as string;
      return { survey, cbs, iv, obs, c1: await claim(cbs), c2: await claim(out1), c3: await claim(out2), c4: await claim(open), c5: await claim(null) };
    });
    const refs = async (who: U) => {
      const rows = await as(who, async (c) => (await c.query("select * from public.evidence_source_refs($1)", [A.idea])).rows);
      return new Map(rows.map((r) => [r.item_id, r]));
    };
    const mine = await refs(owner);
    expect(mine.get(ids.c1)).toMatchObject({ item_type: "claim", source_id: ids.cbs, source_title: "CBS Statline" });
    expect(mine.get(ids.c2).campaign).toBe("Event-Q4");
    expect(mine.get(ids.c3).campaign).toBe("Event-Q4");
    expect(mine.get(ids.c4)).toMatchObject({ survey_experiment_id: ids.survey, experiment_title: "Enquête X" });
    expect(mine.get(ids.c5)).toMatchObject({ source_id: null });
    expect(mine.get(ids.obs)).toMatchObject({ item_type: "observation", experiment_id: ids.survey, interview_id: ids.iv, interview_label: "Eventmanager A" });

    // Wie alleen meekijkt, ziet geen campagnenamen, outreachtitels of interviewlabels, maar dezelfde groepering.
    const client = await user(`klant2-${randomUUID()}@example.com`);
    await as(owner, (c) => c.query("insert into public.idea_members (idea_id, email, role) values ($1, $2, 'client_viewer')", [A.idea, client.email]));
    await as(client, (c) => c.query("select public.claim_invitations()"));
    const theirs = await refs(client);
    expect(theirs.get(ids.c2).source_title).toBeNull();
    expect(theirs.get(ids.c2).campaign).toMatch(/^md5:/);
    expect(theirs.get(ids.c2).campaign).toBe(theirs.get(ids.c3).campaign);
    expect(theirs.get(ids.obs).interview_label).toBeNull();
    expect(theirs.get(ids.c1).source_title).toBe("CBS Statline");

    const outsider = await user(`ander2-${randomUUID()}@example.com`);
    expect((await as(outsider, (c) => c.query("select * from public.evidence_source_refs($1)", [A.idea]))).rowCount).toBe(0);
  });

  it("methodeversie: nieuwe dossiers op 2026-11-c, overstappen alleen vooruit en met audit", async () => {
    expect((await db.query("select method_version from public.ideas where id = $1", [A.idea])).rows[0].method_version).toBe("2026-11-c");
    const def = (await db.query("select column_default from information_schema.columns where table_schema = 'public' and table_name = 'ideas' and column_name = 'method_version'")).rows[0];
    expect(def.column_default).toMatch(/2026-11-c/);

    // Een bestaand dossier (van vóór de migratie) staat op 2026-11-a; hier nagebootst buiten de triggers om.
    const old = await newIdea(owner);
    await db.query("begin");
    await db.query("set local session_replication_role = replica");
    await db.query("update public.ideas set method_version = '2026-11-a' where id = $1", [old.idea]);
    await db.query("commit");

    const client = await user(`klant3-${randomUUID()}@example.com`);
    await as(owner, (c) => c.query("insert into public.idea_members (idea_id, email, role) values ($1, $2, 'client_decider')", [old.idea, client.email]));
    await as(client, (c) => c.query("select public.claim_invitations()"));
    await expect(as(client, (c) => c.query("select public.switch_method_version($1, '2026-11-b', '{}'::jsonb)", [old.idea]))).rejects.toThrow(/FORBIDDEN/);
    await expect(as(client, (c) => c.query("update public.ideas set method_version = '2026-11-b' where id = $1", [old.idea]).then((r) => r.rowCount))).resolves.toBe(0);

    const preview = { assumptions: [{ id: "x", from: 0.5, to: 0.4 }], tests: [] };
    const to = await as(owner, async (c) => (await c.query("select public.switch_method_version($1, '2026-11-b', $2::jsonb) as v", [old.idea, JSON.stringify(preview)])).rows[0].v);
    expect(to).toBe("2026-11-b");
    const audit = await as(owner, async (c) => (await c.query("select actor_id, detail from public.audit_events where idea_id = $1 and action = 'method_switch'", [old.idea])).rows);
    expect(audit).toHaveLength(1);
    expect(audit[0].actor_id).toBe(owner.id);
    expect(audit[0].detail).toMatchObject({ from: "2026-11-a", to: "2026-11-b", preview });

    // Nogmaals overstappen doet niets; terug kan niet, ook niet buiten de rijbeveiliging om.
    await as(owner, (c) => c.query("select public.switch_method_version($1, '2026-11-b', '{}'::jsonb)", [old.idea]));
    expect((await db.query("select count(*)::int as n from public.audit_events where idea_id = $1 and action = 'method_switch'", [old.idea])).rows[0].n).toBe(1);
    await expect(as(owner, (c) => c.query("update public.ideas set method_version = '2026-11-a' where id = $1", [old.idea]))).rejects.toThrow(/METHOD_VERSION/);
    await expect(db.query("update public.ideas set method_version = '2026-11-a' where id = $1", [old.idea])).rejects.toThrow(/METHOD_VERSION/);
    await expect(as(owner, (c) => c.query("select public.switch_method_version($1, '2026-11-a', '{}'::jsonb)", [old.idea]))).rejects.toThrow(/METHOD_VERSION/);
    await expect(db.query("update public.ideas set method_version = '2027-01-a' where id = $1", [A.idea])).rejects.toThrow(/check|METHOD_VERSION/);
  });

  it("accepteert alleen bekende beslisregels en een aantal bij de aantalregel", async () => {
    await expect(hypothesisWithRule(owner, A.idea, "onbekend" as "absolute")).rejects.toThrow(/check/);
    await expect(
      as(owner, async (c) => {
        const a = (await c.query("insert into public.assumptions (idea_id, statement, category, importance) values ($1, 'x x x', 'viability', 3) returning id", [A.idea])).rows[0].id;
        await c.query(
          `insert into public.hypotheses (idea_id, assumption_id, we_believe, target_group, test_method, metric_label, metric_numerator, metric_denominator,
             success_threshold_pct, min_sample, max_duration_days, decision_rule) values ($1, $2, 'w', 't', 'm', 'l', 'n', 'd', 20, 15, 21, 'absolute')`,
          [A.idea, a],
        );
      }),
    ).rejects.toThrow(/hypotheses_absolute_count/);
  });
});
