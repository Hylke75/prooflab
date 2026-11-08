import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

// Experimentencatalogus (supabase/migrations/20261118100000_experiment_catalog.sql): testtype manual en handmatig
// ingevoerde resultaten. Draait tegen een wegwerp-Postgres (scripts/test-db.sh); overgeslagen zonder TEST_DATABASE_URL.
const url = process.env.TEST_DATABASE_URL;
const d = url ? describe : describe.skip;
const MIGRATION = readFileSync(path.join(process.cwd(), "supabase/migrations/20261118100000_experiment_catalog.sql"), "utf8");

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

const MANUAL_CONFIG = { catalog_method_id: "concierge", observation_kind: "demo_request", method_name: "Conciërgetest", checklist: { before: ["a"], during: ["b"], after: ["c"] }, extra_steps: [], unit: { one: "klant", many: "klanten" } };

async function manualTest(owner: U, o: { config?: Record<string, unknown>; type?: string; live?: boolean } = {}) {
  return as(owner, async (c) => {
    const org = (await c.query("select public.create_organization('Bureau ' || $1) as id", [owner.email])).rows[0].id as string;
    const idea = (
      await c.query(
        `insert into public.ideas (org_id, title, decision_question, project_type, description, target_audience, region)
         values ($1, 'Vrijwilligersplanning voor sportclubs', 'Investeren we?', 'new_product', 'Beschrijving', 'Sportclubs', 'Nederland') returning id`,
        [org],
      )
    ).rows[0].id as string;
    const a = (await c.query("insert into public.assumptions (idea_id, statement, category, importance) values ($1, 'Clubs gebruiken een handmatige planningsdienst opnieuw', 'desirability', 5) returning id", [idea])).rows[0].id;
    const h = (
      await c.query(
        `insert into public.hypotheses (idea_id, assumption_id, we_believe, target_group, test_method, metric_label, metric_numerator, metric_denominator,
           success_threshold_pct, fail_threshold_pct, min_sample, max_duration_days, decision_rule)
         values ($1, $2, 'Clubs nemen de dienst een tweede keer af', 'Sportclubs', 'conciërgetest', 'Opnieuw afgenomen', 'klanten opnieuw', 'klanten', 50, 20, 5, 28, 'probability') returning id`,
        [idea, a],
      )
    ).rows[0].id as string;
    const e = (
      await c.query("insert into public.experiments (idea_id, hypothesis_id, type, title, config) values ($1, $2, $3, 'Conciërgetest', $4) returning id", [
        idea,
        h,
        o.type ?? "manual",
        JSON.stringify(o.config ?? MANUAL_CONFIG),
      ])
    ).rows[0].id as string;
    if (o.live !== false) for (const s of ["ready_for_review", "approved", "live"]) await c.query("update public.experiments set state = $2 where id = $1", [e, s]);
    return { org, idea, h, e };
  });
}

const addResult = (who: U, t: { idea: string; e: string }, v: Partial<{ observed_on: string; units: number; successes: number; note: string; evidence_path: string | null; evidence_mime: string | null }> = {}) =>
  as(who, (c) =>
    c.query(
      `insert into public.manual_results (experiment_id, idea_id, observed_on, units, successes, note, evidence_path, evidence_mime, created_by)
       values ($1, $2, coalesce($3::date, current_date), $4, $5, $6, $7, $8, gen_random_uuid()) returning *`,
      [t.e, t.idea, v.observed_on ?? null, v.units ?? 3, v.successes ?? 1, v.note ?? "Klant K1 en K2 en K3 bediend", v.evidence_path ?? null, v.evidence_mime ?? null],
    ),
  );

d("experimentencatalogus: handmatige sjablonen", () => {
  let alice: U;
  let klant: U;
  let bob: U;

  beforeAll(async () => {
    db = new Client({ connectionString: url });
    await db.connect();
    alice = await user(`alice-${randomUUID()}@example.com`);
    klant = await user(`klant-${randomUUID()}@example.com`);
    bob = await user(`bob-${randomUUID()}@example.com`);
  });
  afterAll(async () => {
    await db?.end();
  });

  it("de migratie is idempotent", async () => {
    await db.query("begin");
    try {
      await db.query(MIGRATION.replace(/^begin;|commit;\s*$/gm, ""));
      await db.query(MIGRATION.replace(/^begin;|commit;\s*$/gm, ""));
    } finally {
      await db.query("rollback");
    }
  });

  it("een handmatige test noemt zijn catalogusmethode en een soort waarneming van hooguit een kleine handeling", async () => {
    await expect(manualTest(alice, { config: { observation_kind: "demo_request" }, live: false })).rejects.toThrow(/experiments_manual_catalog/);
    await expect(manualTest(alice, { config: { ...MANUAL_CONFIG, observation_kind: "deposit" }, live: false })).rejects.toThrow(/experiments_manual_catalog/);
    await expect(manualTest(alice, { config: { ...MANUAL_CONFIG, catalog_method_id: "Geen Id!" }, live: false })).rejects.toThrow(/experiments_manual_catalog/);
    await expect(manualTest(alice, { type: "onbekend", live: false })).rejects.toThrow(/experiments_type_check/);
    const t = await manualTest(alice, { live: false });
    expect((await db.query("select type, state from public.experiments where id = $1", [t.e])).rows[0]).toEqual({ type: "manual", state: "draft" });
  });

  it("de configuratie (draaiboek en bewijssoort) ligt vast na goedkeuring", async () => {
    const t = await manualTest(alice, { live: false });
    await as(alice, (c) => c.query("update public.experiments set config = $2 where id = $1", [t.e, JSON.stringify({ ...MANUAL_CONFIG, extra_steps: ["nog een stap"] })]));
    await as(alice, (c) => c.query("update public.experiments set state = 'ready_for_review' where id = $1", [t.e]));
    await as(alice, (c) => c.query("update public.experiments set state = 'approved' where id = $1", [t.e]));
    await expect(as(alice, (c) => c.query("update public.experiments set config = $2 where id = $1", [t.e, JSON.stringify({ ...MANUAL_CONFIG, observation_kind: "opinion" })]))).rejects.toThrow(/EXPERIMENT_LOCKED/);
    // Geen publieke testpagina voor een handmatig sjabloon.
    expect((await db.query("select public_slug from public.experiments where id = $1", [t.e])).rows[0].public_slug).toBeNull();
  });

  it("resultaten alleen terwijl de test loopt, met een datum tussen de start en vandaag", async () => {
    const draft = await manualTest(alice, { live: false });
    await expect(addResult(alice, draft)).rejects.toThrow(/MANUAL_RESULT_CLOSED/);
    const t = await manualTest(alice);
    const r = (await addResult(alice, t, { units: 4, successes: 2 })).rows[0];
    // De database zet zelf wie en wanneer; een meegestuurde maker telt niet.
    expect(r.created_by).toBe(alice.id);
    expect(r.withdrawn_at).toBeNull();
    await expect(addResult(alice, t, { observed_on: "2999-01-01" })).rejects.toThrow(/MANUAL_RESULT_DATE/);
    await expect(addResult(alice, t, { observed_on: "2020-01-01" })).rejects.toThrow(/MANUAL_RESULT_DATE/);
    await expect(addResult(alice, t, { units: 2, successes: 3 })).rejects.toThrow(/manual_results_successes/);
    await expect(addResult(alice, t, { note: " " })).rejects.toThrow();
    // Gepauzeerd mag nog; afgerond niet meer.
    await as(alice, (c) => c.query("update public.experiments set state = 'paused' where id = $1", [t.e]));
    await addResult(alice, t, { units: 1, successes: 1 });
    await as(alice, (c) => c.query("update public.experiments set state = 'ended' where id = $1", [t.e]));
    await expect(addResult(alice, t)).rejects.toThrow(/MANUAL_RESULT_CLOSED/);
    const sum = (await db.query("select sum(units)::int as n, sum(successes)::int as s from public.manual_results where experiment_id = $1 and withdrawn_at is null", [t.e])).rows[0];
    expect(sum).toEqual({ n: 5, s: 3 });
  });

  it("alleen bij een handmatig sjabloon", async () => {
    const t = await manualTest(alice, { type: "interview", config: { guide: ["a", "b", "c"], screener: "", target_n: 5 } });
    await expect(addResult(alice, t)).rejects.toThrow(/MANUAL_RESULT_TYPE/);
  });

  it("een resultaat ligt vast: alleen intrekken met reden terwijl de test loopt; verwijderen kan niemand", async () => {
    const t = await manualTest(alice);
    const r = (await addResult(alice, t, { units: 5, successes: 5 })).rows[0];
    await expect(as(alice, (c) => c.query("update public.manual_results set successes = 1 where id = $1", [r.id]))).rejects.toThrow(/MANUAL_RESULT_LOCKED/);
    await expect(as(alice, (c) => c.query("update public.manual_results set withdraw_reason = 'te kort' where id = $1", [r.id]))).rejects.toThrow();
    await expect(as(alice, (c) => c.query("delete from public.manual_results where id = $1", [r.id]))).rejects.toThrow(/permission denied/);
    await as(alice, (c) => c.query("update public.manual_results set withdraw_reason = 'Dubbel ingevoerd, zie de regel van maandag', withdrawn_at = '2000-01-01' where id = $1", [r.id]));
    const w = (await db.query("select withdrawn_by, withdrawn_at > now() - interval '1 minute' as recent from public.manual_results where id = $1", [r.id])).rows[0];
    expect(w).toEqual({ withdrawn_by: alice.id, recent: true });
    await expect(as(alice, (c) => c.query("update public.manual_results set withdraw_reason = 'Nog een keer intrekken' where id = $1", [r.id]))).rejects.toThrow(/MANUAL_RESULT_LOCKED/);
    // Na het afronden kan ook intrekken niet meer.
    const r2 = (await addResult(alice, t)).rows[0];
    await as(alice, (c) => c.query("update public.experiments set state = 'ended' where id = $1", [t.e]));
    await expect(as(alice, (c) => c.query("update public.manual_results set withdraw_reason = 'Achteraf toch niet goed' where id = $1", [r2.id]))).rejects.toThrow(/MANUAL_RESULT_LOCKED/);
    // Het auditspoor legt toevoegen en intrekken vast.
    const audit = (await db.query("select action from public.audit_events where table_name = 'manual_results' and row_id = $1 order by id", [r.id])).rows.map((x) => x.action);
    expect(audit).toEqual(["insert", "update"]);
  });

  it("RLS: de opdrachtgever leest mee maar voert niets in; een buitenstaander ziet niets", async () => {
    const t = await manualTest(alice);
    await addResult(alice, t, { units: 2, successes: 1 });
    await as(alice, (c) => c.query("insert into public.idea_members (idea_id, email, role) values ($1, $2, 'client_viewer')", [t.idea, klant.email]));
    await as(klant, (c) => c.query("select public.claim_invitations()"));
    expect((await as(klant, (c) => c.query("select units, successes, note from public.manual_results where experiment_id = $1", [t.e]))).rows).toHaveLength(1);
    await expect(addResult(klant, t)).rejects.toThrow(/row-level security/);
    expect((await as(bob, (c) => c.query("select * from public.manual_results where experiment_id = $1", [t.e]))).rows).toHaveLength(0);
    await expect(addResult(bob, t)).rejects.toThrow(/row-level security/);
  });

  it("een bewijsbestand hoort bij deze test, staat in de privé bucket en is alleen voor het team", async () => {
    const t = await manualTest(alice);
    const file = `${t.idea}/${t.e}/${randomUUID()}-telformulier.pdf`;
    await expect(addResult(alice, t, { evidence_path: file, evidence_mime: "application/pdf" })).rejects.toThrow(/MANUAL_RESULT_EVIDENCE/);
    await as(alice, (c) => c.query("insert into storage.objects (bucket_id, name, owner) values ('manual-evidence', $1, $2)", [file, alice.id]));
    // Een pad onder een ander experiment telt niet.
    const other = await manualTest(alice);
    await expect(addResult(alice, other, { evidence_path: file, evidence_mime: "application/pdf" })).rejects.toThrow();
    await addResult(alice, t, { evidence_path: file, evidence_mime: "application/pdf" });
    await as(alice, (c) => c.query("insert into public.idea_members (idea_id, email, role) values ($1, $2, 'client_decider')", [t.idea, klant.email]));
    await as(klant, (c) => c.query("select public.claim_invitations()"));
    expect((await as(klant, (c) => c.query("select * from storage.objects where bucket_id = 'manual-evidence'"))).rows).toHaveLength(0);
    expect((await as(bob, (c) => c.query("select * from storage.objects where bucket_id = 'manual-evidence'"))).rows).toHaveLength(0);
    // Een gekoppeld bestand kan niet worden verwijderd.
    expect((await as(alice, (c) => c.query("delete from storage.objects where bucket_id = 'manual-evidence' and name = $1 returning name", [file]))).rows).toHaveLength(0);
    // Een buitenstaander kan geen bestand onder dit idee plaatsen.
    await expect(as(bob, (c) => c.query("insert into storage.objects (bucket_id, name, owner) values ('manual-evidence', $1, $2)", [`${t.idea}/${t.e}/${randomUUID()}-x.pdf`, bob.id]))).rejects.toThrow(/row-level security/);
  });

  it("de bestaande testtypes blijven toegestaan", async () => {
    for (const type of ["landing", "interview", "pricing", "survey"]) {
      const t = await manualTest(alice, { type, config: { headline: "x" }, live: false });
      expect((await db.query("select type from public.experiments where id = $1", [t.e])).rows[0].type).toBe(type);
    }
  });
});
