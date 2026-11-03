import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import { randomUUID } from "node:crypto";

// Golf A (supabase/migrations/20261107090000_golf_a.sql): methode 2026-11-c en de database-afspraken rond bewijs
// en testen. Draait tegen een wegwerp-Postgres (scripts/test-db.sh); overgeslagen zonder TEST_DATABASE_URL.
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
         values ($1, 'Golf A', 'Investeren we €25.000?', 'new_product', 'Beschrijving', 'Eventmanagers', 'Nederland') returning id`,
        [org],
      )
    ).rows[0].id as string;
    return { org, idea };
  });
}

// Zet de methodeversie buiten de triggers om, zoals een dossier van vóór de migratie.
async function forceVersion(idea: string, v: string) {
  await db.query("begin");
  await db.query("set local session_replication_role = replica");
  await db.query("update public.ideas set method_version = $2 where id = $1", [idea, v]);
  await db.query("commit");
}

// Een aanname met een Test Card en een experiment (concept).
async function testFor(owner: U, idea: string, type: string, extra: { assumption?: string; recruitment?: string | null } = {}) {
  return as(owner, async (c) => {
    const a =
      extra.assumption ??
      ((await c.query("insert into public.assumptions (idea_id, statement, category, importance) values ($1, 'Eventmanagers willen dit', 'desirability', 5) returning id", [idea])).rows[0].id as string);
    const h = (
      await c.query(
        `insert into public.hypotheses (idea_id, assumption_id, we_believe, target_group, test_method, metric_label,
           metric_numerator, metric_denominator, success_threshold_pct, fail_threshold_pct, min_sample, max_duration_days)
         values ($1, $2, 'Eventmanagers vragen een demo aan', 'NL eventmanagers', 'landingpagina', 'aanvragen',
           'bezoekers met aanvraag', 'bezoekers', 20, null, 20, 21) returning id`,
        [idea, a],
      )
    ).rows[0].id as string;
    const e = (
      await c.query("insert into public.experiments (idea_id, hypothesis_id, type, title, recruitment_group) values ($1, $2, $3, 'Test', $4) returning id", [
        idea,
        h,
        type,
        extra.recruitment ?? null,
      ])
    ).rows[0].id as string;
    return { assumption: a, hypothesis: h, experiment: e };
  });
}

d("golf A", () => {
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

  it("methode 2026-11-c: standaard voor nieuwe dossiers; overstappen van a of b naar c, nooit terug", async () => {
    expect((await db.query("select method_version from public.ideas where id = $1", [A.idea])).rows[0].method_version).toBe("2026-11-c");
    const a = await newIdea(owner);
    const b = await newIdea(owner);
    await forceVersion(a.idea, "2026-11-a");
    await forceVersion(b.idea, "2026-11-b");
    expect(await as(owner, async (c) => (await c.query("select public.switch_method_version($1, '2026-11-c', '{}'::jsonb) as v", [a.idea])).rows[0].v)).toBe("2026-11-c");
    expect(await as(owner, async (c) => (await c.query("select public.switch_method_version($1, '2026-11-c', '{}'::jsonb) as v", [b.idea])).rows[0].v)).toBe("2026-11-c");
    const audit = (await db.query("select detail from public.audit_events where idea_id = $1 and action = 'method_switch'", [b.idea])).rows;
    expect(audit[0].detail).toMatchObject({ from: "2026-11-b", to: "2026-11-c" });
    await expect(as(owner, (c) => c.query("select public.switch_method_version($1, '2026-11-b', '{}'::jsonb)", [A.idea]))).rejects.toThrow(/METHOD_VERSION/);
    await expect(db.query("update public.ideas set method_version = '2026-11-a' where id = $1", [b.idea])).rejects.toThrow(/METHOD_VERSION/);
    await expect(db.query("update public.ideas set method_version = '2026-11-d' where id = $1", [A.idea])).rejects.toThrow(/check|METHOD_VERSION/);
  });

  it("punt 3: aantal opgeloste dossiers van de werkruimte, ook voor de opdrachtgever, niet voor buitenstaanders", async () => {
    const count = async (who: U) => Number(await as(who, async (c) => (await c.query("select public.resolved_dossiers_for_idea($1) as n", [A.idea])).rows[0].n));
    expect(await count(owner)).toBe(0);
    // Twee andere dossiers van dezelfde werkruimte met een uitkomst (buiten de triggers om vastgelegd).
    for (let i = 0; i < 2; i++) {
      const other = await as(owner, async (c) =>
        (await c.query(
          `insert into public.ideas (org_id, title, decision_question, project_type, description, target_audience, region)
           values ($1, 'Opgelost', 'Vraag?', 'new_product', 'x', 'y', 'Nederland') returning id`,
          [A.org],
        )).rows[0].id as string,
      );
      await db.query("begin");
      await db.query("set local session_replication_role = replica");
      await db.query("insert into public.idea_outcomes (idea_id, achieved, evidence, resolved_by) values ($1, 'yes', 'Tien klanten', $2)", [other, owner.id]);
      await db.query("commit");
    }
    expect(await count(owner)).toBe(2);
    const client = await user(`klant-${randomUUID()}@example.com`);
    await as(owner, (c) => c.query("insert into public.idea_members (idea_id, email, role) values ($1, $2, 'client_viewer')", [A.idea, client.email]));
    await as(client, (c) => c.query("select public.claim_invitations()"));
    expect(await count(client)).toBe(2);
    expect(await count(await user(`buiten-${randomUUID()}@example.com`))).toBe(0);
  });

  it("punten 4 en 13: wervingsgroep per test en signaal, vergrendeld na goedkeuring, bekende = eigen netwerk", async () => {
    await expect(testFor(owner, A.idea, "landing", { recruitment: "vrienden" })).rejects.toThrow(/check/);
    const t = await testFor(owner, A.idea, "landing", { recruitment: "own_network" });
    // In concept nog aan te passen.
    await as(owner, (c) => c.query("update public.experiments set recruitment_group = 'cold' where id = $1", [t.experiment]));
    await as(owner, async (c) => {
      for (const s of ["ready_for_review", "approved"]) await c.query("update public.experiments set state = $2 where id = $1", [t.experiment, s]);
    });
    await expect(as(owner, (c) => c.query("update public.experiments set recruitment_group = 'paid_panel' where id = $1", [t.experiment]))).rejects.toThrow(/EXPERIMENT_RECRUITMENT/);
    expect((await db.query("select recruitment_group from public.experiments where id = $1", [t.experiment])).rows[0].recruitment_group).toBe("cold");

    // Interviews: een bekende is altijd eigen netwerk; anders de vastgelegde groep, dan die van de test.
    const iv = await testFor(owner, A.idea, "interview", { recruitment: "warm" });
    const ids = await as(owner, async (c) => {
      const interview = async (known: boolean, group: string | null) =>
        (
          await c.query(
            `insert into public.interviews (experiment_id, idea_id, participant_label, dmu_role, recruited_via, held_on, record_type, transcript, consent_recorded, is_acquaintance, recruitment_group)
             values ($1, $2, 'Eventmanager', 'user', 'network', current_date, 'notes', 'Notities van het gesprek', true, $3, $4) returning id, recruitment_group`,
            [iv.experiment, A.idea, known, group],
          )
        ).rows[0];
      const known = await interview(true, "cold");
      const cold = await interview(false, "cold");
      const plain = await interview(false, null);
      const obs = async (interviewId: string | null, experimentId: string | null) =>
        (await c.query("insert into public.observations (idea_id, experiment_id, interview_id, kind, summary) values ($1, $2, $3, 'problem_confirmed', 'x') returning id", [A.idea, experimentId, interviewId])).rows[0].id as string;
      return {
        knownGroup: known.recruitment_group as string,
        o1: await obs(known.id, iv.experiment),
        o2: await obs(cold.id, iv.experiment),
        o3: await obs(plain.id, iv.experiment),
        o4: await obs(null, t.experiment),
        o5: await obs(null, null),
      };
    });
    expect(ids.knownGroup).toBe("own_network");
    const refs = async (who: U) =>
      new Map((await as(who, async (c) => (await c.query("select * from public.evidence_recruitment_refs($1)", [A.idea])).rows)).map((r) => [r.item_id, r.recruitment_group]));
    const mine = await refs(owner);
    expect(mine.get(ids.o1)).toBe("own_network");
    expect(mine.get(ids.o2)).toBe("cold");
    expect(mine.get(ids.o3)).toBe("warm");
    expect(mine.get(ids.o4)).toBe("cold");
    expect(mine.get(ids.o5)).toBeNull();

    // De opdrachtgever rekent met dezelfde groepen; een buitenstaander krijgt niets.
    const client = await user(`klant4-${randomUUID()}@example.com`);
    await as(owner, (c) => c.query("insert into public.idea_members (idea_id, email, role) values ($1, $2, 'client_viewer')", [A.idea, client.email]));
    await as(client, (c) => c.query("select public.claim_invitations()"));
    expect([...(await refs(client)).entries()].sort()).toEqual([...mine.entries()].sort());
    expect((await refs(await user(`buiten2-${randomUUID()}@example.com`))).size).toBe(0);
  });
});
