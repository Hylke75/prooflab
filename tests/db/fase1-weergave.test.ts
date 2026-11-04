import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

// Fase 1 · punt 1: Snel en Grondig (supabase/migrations/20261114090000_fase1_weergave.sql). Draait tegen een
// wegwerp-Postgres (scripts/test-db.sh); overgeslagen zonder TEST_DATABASE_URL.
const url = process.env.TEST_DATABASE_URL;
const d = url ? describe : describe.skip;
const MIGRATION = readFileSync(path.join(process.cwd(), "supabase/migrations/20261114090000_fase1_weergave.sql"), "utf8");

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
         values ($1, 'AI-communicatie voor sportclubs', 'Investeren we €25.000?', 'new_product', 'Beschrijving', 'Sportclubs', 'Nederland') returning id`,
        [org],
      )
    ).rows[0].id as string;
    return { org, idea };
  });
}

d("fase 1 · punt 1: Snel en Grondig in de database", () => {
  let owner: U;
  let client: U;

  beforeAll(async () => {
    db = new Client({ connectionString: url });
    await db.connect();
    owner = await user(`eigenaar-${randomUUID()}@example.com`);
    client = await user(`klant-${randomUUID()}@example.com`);
  });

  afterAll(async () => {
    await db?.end();
  });

  it("nieuwe dossiers staan op Snel; een onbekende stand weigert de database", async () => {
    const { idea } = await newIdea(owner);
    expect((await db.query("select detail_level from public.ideas where id = $1", [idea])).rows[0].detail_level).toBe("quick");
    await expect(as(owner, (c) => c.query("update public.ideas set detail_level = 'fast' where id = $1", [idea]))).rejects.toThrow(/ideas_detail_level_check/);
  });

  it("bestaande dossiers krijgen Grondig; opnieuw uitvoeren verandert gekozen standen niet", async () => {
    const { org } = await newIdea(owner);
    // In één transactie (teruggedraaid): de toestand vóór de migratie nabootsen en de migratie uitvoeren.
    await db.query("begin");
    try {
      await db.query("alter table public.ideas drop column detail_level");
      const old = (
        await db.query(
          `insert into public.ideas (org_id, title, decision_question, project_type, description, target_audience, region, created_by)
           values ($1, 'Oud dossier', 'Doorgaan?', 'new_product', 'x', 'y', 'Nederland', $2) returning id`,
          [org, owner.id],
        )
      ).rows[0].id;
      await db.query(MIGRATION);
      expect((await db.query("select detail_level from public.ideas where id = $1", [old])).rows[0].detail_level).toBe("thorough");
      const fresh = (
        await db.query(
          `insert into public.ideas (org_id, title, decision_question, project_type, description, target_audience, region, created_by)
           values ($1, 'Nieuw dossier', 'Doorgaan?', 'new_product', 'x', 'y', 'Nederland', $2) returning id`,
          [org, owner.id],
        )
      ).rows[0].id;
      expect((await db.query("select detail_level from public.ideas where id = $1", [fresh])).rows[0].detail_level).toBe("quick");
      // Idempotent: een tweede keer laat zowel het oude (thorough) als het nieuwe (quick) dossier staan.
      await db.query(MIGRATION);
      const rows = (await db.query("select id, detail_level from public.ideas where id = any($1)", [[old, fresh]])).rows;
      expect(Object.fromEntries(rows.map((r) => [r.id, r.detail_level]))).toEqual({ [old]: "thorough", [fresh]: "quick" });
    } finally {
      await db.query("rollback");
    }
  });

  it("wisselen van stand bumpt updated_at niet, maar staat wel in het auditspoor", async () => {
    const { idea } = await newIdea(owner);
    const before = (await db.query("select updated_at from public.ideas where id = $1", [idea])).rows[0].updated_at as Date;
    await as(owner, (c) => c.query("update public.ideas set detail_level = 'thorough' where id = $1", [idea]));
    const after = (await db.query("select updated_at, detail_level from public.ideas where id = $1", [idea])).rows[0];
    expect(after.detail_level).toBe("thorough");
    expect((after.updated_at as Date).toISOString()).toBe(before.toISOString());
    const audit = (
      await db.query("select detail from public.audit_events where idea_id = $1 and table_name = 'ideas' and action = 'update' order by id desc limit 1", [idea])
    ).rows[0];
    expect(audit.detail.changes.detail_level).toEqual({ old: "quick", new: "thorough" });
    // Een inhoudelijke wijziging zet updated_at wel (ook samen met een wissel).
    await as(owner, (c) => c.query("update public.ideas set title = 'Nieuwe titel', detail_level = 'quick' where id = $1", [idea]));
    const later = (await db.query("select updated_at from public.ideas where id = $1", [idea])).rows[0].updated_at as Date;
    expect(later.getTime()).toBeGreaterThan(before.getTime());
  });

  it("alleen schrijvers wisselen; een opdrachtgever niet", async () => {
    const { idea } = await newIdea(owner);
    await as(owner, (c) => c.query("insert into public.idea_members (idea_id, email, role) values ($1, $2, 'client_decider')", [idea, client.email]));
    await as(client, (c) => c.query("select public.claim_invitations()"));
    await as(client, (c) => c.query("update public.ideas set detail_level = 'thorough' where id = $1", [idea]));
    expect((await db.query("select detail_level from public.ideas where id = $1", [idea])).rows[0].detail_level).toBe("quick");
  });

  it("standaardwaarden staan met hun waarde in het auditspoor en veranderen niet na vergrendelen", async () => {
    const { idea } = await newIdea(owner);
    const { a, h } = await as(owner, async (c) => {
      const a = (
        await c.query(
          "insert into public.assumptions (idea_id, statement, category, importance, defaulted_fields) values ($1, 'Clubs willen AI-hulp bij communicatie', 'desirability', 5, '{prior}') returning id",
          [idea],
        )
      ).rows[0].id as string;
      const h = (
        await c.query(
          `insert into public.hypotheses (idea_id, assumption_id, we_believe, target_group, test_method, metric_label,
             metric_numerator, metric_denominator, success_threshold_pct, fail_threshold_pct, min_sample, max_duration_days, defaulted_fields)
           values ($1, $2, 'Clubs vragen een demo aan', 'Sportclubs', 'landingspagina', 'aanvraagratio',
             'unieke aanvragen', 'unieke relevante bezoekers', 15, 5, 80, 21, '{min_sample,max_duration_days,channels}') returning id`,
          [idea, a],
        )
      ).rows[0].id as string;
      return { a, h };
    });
    const events = (
      await db.query("select table_name, row_id, detail from public.audit_events where idea_id = $1 and action = 'defaulted_fields' order by id", [idea])
    ).rows;
    expect(events.map((e) => e.table_name)).toEqual(["assumptions", "hypotheses"]);
    expect(events[0].row_id).toBe(a);
    expect(events[1].detail.fields).toEqual(["min_sample", "max_duration_days", "channels"]);
    expect(events[1].detail.values).toEqual({ min_sample: 80, max_duration_days: 21 });
    // Een eigen startkans haalt 'prior' weg: audit_row legt de gewijzigde lijst vast.
    await as(owner, (c) => c.query("update public.assumptions set defaulted_fields = '{}' where id = $1", [a]));
    const change = (await db.query("select detail from public.audit_events where row_id = $1 and action = 'update' order by id desc limit 1", [a])).rows[0];
    expect(change.detail.changes.defaulted_fields).toEqual({ old: ["prior"], new: [] });
    // Vergrendeld: de lijst verandert niet meer stil.
    await db.query("update public.hypotheses set locked_at = now() where id = $1", [h]);
    await expect(as(owner, (c) => c.query("update public.hypotheses set defaulted_fields = '{}' where id = $1", [h]))).rejects.toThrow(/HYPOTHESIS_LOCKED/);
  });
});
