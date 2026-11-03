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

  it("punt 5: startkans met onderbouwing, vergrendeld zodra er bewijs hangt, wijzigen alleen met een geaudite reden", async () => {
    const a = await as(owner, async (c) => (await c.query("insert into public.assumptions (idea_id, statement, category, importance) values ($1, 'Bureaus betalen vooraf', 'viability', 4) returning id", [A.idea])).rows[0].id as string);
    // Een afwijking van 50% zonder onderbouwing: geweigerd, ook bij aanmaken.
    await expect(as(owner, (c) => c.query("update public.assumptions set prior = 0.8 where id = $1", [a]))).rejects.toThrow(/PRIOR_RATIONALE/);
    await expect(
      as(owner, (c) => c.query("insert into public.assumptions (idea_id, statement, category, importance, prior) values ($1, 'x x x x x x', 'viability', 3, 0.7)", [A.idea])),
    ).rejects.toThrow(/PRIOR_RATIONALE/);
    await as(owner, (c) => c.query("update public.assumptions set prior = 0.5 where id = $1", [a]));
    await as(owner, (c) => c.query("select public.change_assumption_prior($1, 0.35, 'Basispercentage van vergelijkbare diensten', '')", [a]));
    // Zelf vergrendelen of ontgrendelen kan niet.
    await as(owner, (c) => c.query("update public.assumptions set prior_locked_at = now() where id = $1", [a]));
    expect((await db.query("select prior_locked_at from public.assumptions where id = $1", [a])).rows[0].prior_locked_at).toBeNull();

    // Bewijs koppelen vergrendelt de startkans.
    await as(owner, async (c) => {
      const o = (await c.query("insert into public.observations (idea_id, kind, summary) values ($1, 'opinion', 'Leuk idee') returning id", [A.idea])).rows[0].id;
      await c.query("insert into public.assumption_observations (assumption_id, observation_id, idea_id, relation) values ($1, $2, $3, 'supports')", [a, o, A.idea]);
    });
    expect((await db.query("select prior_locked_at from public.assumptions where id = $1", [a])).rows[0].prior_locked_at).not.toBeNull();
    await expect(as(owner, (c) => c.query("update public.assumptions set prior = 0.65, prior_rationale = 'Nieuwe inschatting na gesprek' where id = $1", [a]))).rejects.toThrow(/PRIOR_LOCKED/);
    await expect(as(owner, (c) => c.query("select public.change_assumption_prior($1, 0.65, 'Nieuwe inschatting na gesprek', 'kort')", [a]))).rejects.toThrow(/PRIOR_LOCKED/);
    // Andere velden blijven gewoon te wijzigen.
    await as(owner, (c) => c.query("update public.assumptions set importance = 5 where id = $1", [a]));
    await as(owner, (c) => c.query("select public.change_assumption_prior($1, 0.65, 'Basispercentage uit CBS-cijfers 2025', 'Verkeerde referentieklasse gebruikt')", [a]));
    expect(Number((await db.query("select prior from public.assumptions where id = $1", [a])).rows[0].prior)).toBe(0.65);
    const audit = (await db.query("select actor_id, detail from public.audit_events where row_id = $1 and action = 'prior_change' order by id", [a])).rows;
    expect(audit.at(-1).actor_id).toBe(owner.id);
    expect(audit.at(-1).detail).toMatchObject({ from: 0.35, to: 0.65, locked: true, reason: "Verkeerde referentieklasse gebruikt" });
    // De reden geldt alleen voor die ene wijziging.
    await expect(as(owner, (c) => c.query("update public.assumptions set prior = 0.5 where id = $1", [a]))).rejects.toThrow(/PRIOR_LOCKED/);

    // Wie alleen meekijkt, kan de startkans niet wijzigen.
    const client = await user(`klant5-${randomUUID()}@example.com`);
    await as(owner, (c) => c.query("insert into public.idea_members (idea_id, email, role) values ($1, $2, 'client_decider')", [A.idea, client.email]));
    await as(client, (c) => c.query("select public.claim_invitations()"));
    await expect(as(client, (c) => c.query("select public.change_assumption_prior($1, 0.4, 'Andere inschatting van de klant', 'Ik denk er anders over')", [a]))).rejects.toThrow(/NOT_FOUND|permission/);
  });

  it("punt 11: één hoofdtest per aanname, van die aanname, aan te wijzen vóór de goedkeuring en daarna vast", async () => {
    const t1 = await testFor(owner, A.idea, "landing", { recruitment: "cold" });
    const t2 = await testFor(owner, A.idea, "survey", { assumption: t1.assumption, recruitment: "warm" });
    const other = await testFor(owner, A.idea, "pricing", { recruitment: "cold" });
    const setPrimary = (e: string | null) => as(owner, (c) => c.query("update public.assumptions set primary_experiment_id = $2 where id = $1", [t1.assumption, e]));
    await expect(setPrimary(other.experiment)).rejects.toThrow(/PRIMARY_TEST/);
    await setPrimary(t1.experiment);
    await setPrimary(t2.experiment); // beide nog concept: omwisselen mag
    await setPrimary(t1.experiment);
    await as(owner, async (c) => {
      for (const s of ["ready_for_review", "approved"]) await c.query("update public.experiments set state = $2 where id = $1", [t1.experiment, s]);
    });
    await expect(setPrimary(t2.experiment)).rejects.toThrow(/al goedgekeurd of gestart/);
    await expect(setPrimary(null)).rejects.toThrow(/PRIMARY_TEST/);
    const audit = (await db.query("select detail from public.audit_events where row_id = $1 and action = 'primary_test' order by id", [t1.assumption])).rows;
    expect(audit.map((r) => r.detail.to)).toEqual([t1.experiment, t2.experiment, t1.experiment]);

    // Een goedgekeurde test kan niet achteraf hoofdtest worden.
    await as(owner, async (c) => {
      for (const s of ["ready_for_review", "approved"]) await c.query("update public.experiments set state = $2 where id = $1", [other.experiment, s]);
    });
    await expect(as(owner, (c) => c.query("update public.assumptions set primary_experiment_id = $2 where id = $1", [other.assumption, other.experiment]))).rejects.toThrow(
      /vóór de goedkeuring/,
    );

    // Een verwijderde concepttest laat geen hoofdtest achter.
    const t3 = await testFor(owner, A.idea, "landing", { recruitment: "cold" });
    await as(owner, (c) => c.query("update public.assumptions set primary_experiment_id = $2 where id = $1", [t3.assumption, t3.experiment]));
    await as(owner, (c) => c.query("delete from public.experiments where id = $1", [t3.experiment]));
    expect((await db.query("select primary_experiment_id from public.assumptions where id = $1", [t3.assumption])).rows[0].primary_experiment_id).toBeNull();

    // Wie alleen meekijkt, wijst niets aan.
    const client = await user(`klant6-${randomUUID()}@example.com`);
    await as(owner, (c) => c.query("insert into public.idea_members (idea_id, email, role) values ($1, $2, 'client_decider')", [A.idea, client.email]));
    await as(client, (c) => c.query("select public.claim_invitations()"));
    const t4 = await testFor(owner, A.idea, "landing", { recruitment: "cold" });
    const n = await as(client, async (c) => (await c.query("update public.assumptions set primary_experiment_id = $2 where id = $1", [t4.assumption, t4.experiment])).rowCount);
    expect(n).toBe(0);
  });

  it("punt 17: het AI-origineel blijft bewaard en onveranderd; een enquête-origineel hoort bij hetzelfde dossier", async () => {
    const q = await as(owner, async (c) =>
      (
        await c.query(
          "insert into public.research_questions (idea_id, position, question, done_criterion, origin, ai_original) values ($1, 5, 'Hoeveel bureaus?', 'Eén aantal', 'ai', $2) returning id",
          [A.idea, "Hoeveel bureaus?\nEén aantal"],
        )
      ).rows[0].id as string,
    );
    await as(owner, (c) => c.query("update public.research_questions set question = 'Hoeveel eventbureaus in NL?', origin = 'manual', ai_original = 'vervalst' where id = $1", [q]));
    const row = (await db.query("select question, ai_original from public.research_questions where id = $1", [q])).rows[0];
    expect(row).toEqual({ question: "Hoeveel eventbureaus in NL?", ai_original: "Hoeveel bureaus?\nEén aantal" });

    // AI-opzet van een enquête: alleen schrijvers maken hem, iedereen die meeleest ziet hem, niemand wijzigt hem.
    const draft = await as(owner, async (c) => (await c.query("insert into public.ai_drafts (idea_id, kind, content) values ($1, 'survey', $2) returning id, created_by", [A.idea, JSON.stringify({ title: "AI" })])).rows[0]);
    expect(draft.created_by).toBe(owner.id);
    await expect(as(owner, (c) => c.query("update public.ai_drafts set content = '{}' where id = $1", [draft.id]))).rejects.toThrow(/permission denied/);
    await expect(as(owner, (c) => c.query("delete from public.ai_drafts where id = $1", [draft.id]))).rejects.toThrow(/permission denied/);
    expect((await db.query("select count(*)::int as n from public.ai_drafts where id = $1", [draft.id])).rows[0].n).toBe(1);
    const viewer = await user(`klant7-${randomUUID()}@example.com`);
    await as(owner, (c) => c.query("insert into public.idea_members (idea_id, email, role) values ($1, $2, 'client_viewer')", [A.idea, viewer.email]));
    await as(viewer, (c) => c.query("select public.claim_invitations()"));
    expect((await as(viewer, (c) => c.query("select id from public.ai_drafts where id = $1", [draft.id]))).rowCount).toBe(1);
    await expect(as(viewer, (c) => c.query("insert into public.ai_drafts (idea_id, kind, content) values ($1, 'survey', '{}')", [A.idea]))).rejects.toThrow(/row-level security/);
    expect((await as(await user(`buiten3-${randomUUID()}@example.com`), (c) => c.query("select id from public.ai_drafts where id = $1", [draft.id]))).rowCount).toBe(0);

    // Gekoppeld aan een test van hetzelfde dossier, en daarna vast.
    const t = await testFor(owner, A.idea, "survey", { recruitment: "cold" });
    await as(owner, (c) => c.query("update public.experiments set ai_draft_id = $2 where id = $1", [t.experiment, draft.id]));
    expect((await db.query("select ai_draft_id from public.experiments where id = $1", [t.experiment])).rows[0].ai_draft_id).toBeNull();
    const B = await newIdea(owner);
    const foreign = await as(owner, async (c) => (await c.query("insert into public.ai_drafts (idea_id, kind, content) values ($1, 'survey', '{}') returning id", [B.idea])).rows[0].id);
    const h = (await db.query("select hypothesis_id from public.experiments where id = $1", [t.experiment])).rows[0].hypothesis_id;
    await expect(
      as(owner, (c) => c.query("insert into public.experiments (idea_id, hypothesis_id, type, title, ai_draft_id) values ($1, $2, 'survey', 'Enquête', $3)", [A.idea, h, foreign])),
    ).rejects.toThrow(/AI_DRAFT/);
    const ok = await as(owner, async (c) => (await c.query("insert into public.experiments (idea_id, hypothesis_id, type, title, ai_draft_id) values ($1, $2, 'survey', 'Enquête', $3) returning ai_draft_id", [A.idea, h, draft.id])).rows[0]);
    expect(ok.ai_draft_id).toBe(draft.id);
  });

  it("een dossier met hoofdtest, vergrendelde startkans en AI-origineel kan nog steeds worden verwijderd", async () => {
    const D = await newIdea(owner);
    const draft = await as(owner, async (c) => (await c.query("insert into public.ai_drafts (idea_id, kind, content) values ($1, 'survey', '{}') returning id", [D.idea])).rows[0].id as string);
    const t = await testFor(owner, D.idea, "survey", { recruitment: "cold" });
    await as(owner, async (c) => {
      await c.query("update public.assumptions set primary_experiment_id = $2 where id = $1", [t.assumption, t.experiment]);
      const o = (await c.query("insert into public.observations (idea_id, kind, summary) values ($1, 'opinion', 'x') returning id", [D.idea])).rows[0].id;
      await c.query("insert into public.assumption_observations (assumption_id, observation_id, idea_id, relation) values ($1, $2, $3, 'supports')", [t.assumption, o, D.idea]);
      const h = (await c.query("select hypothesis_id from public.experiments where id = $1", [t.experiment])).rows[0].hypothesis_id;
      await c.query("insert into public.experiments (idea_id, hypothesis_id, type, title, ai_draft_id) values ($1, $2, 'survey', 'Enquête', $3)", [D.idea, h, draft]);
    });
    await as(owner, (c) => c.query("delete from public.ideas where id = $1", [D.idea]));
    expect((await db.query("select count(*)::int as n from public.ideas where id = $1", [D.idea])).rows[0].n).toBe(0);
  });
});
