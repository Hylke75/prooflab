import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

// Fase 2 · punt 5: werving bijhouden (supabase/migrations/20261117090000_fase2_werving.sql). Draait tegen een
// wegwerp-Postgres (scripts/test-db.sh); overgeslagen zonder TEST_DATABASE_URL.
const url = process.env.TEST_DATABASE_URL;
const d = url ? describe : describe.skip;
const MIGRATION = readFileSync(path.join(process.cwd(), "supabase/migrations/20261117090000_fase2_werving.sql"), "utf8");

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

async function newTest(owner: U, idea: string, type = "interview", state = "live") {
  const e = await as(owner, async (c) => {
    const a = (await c.query("insert into public.assumptions (idea_id, statement, category, importance) values ($1, 'Clubs zijn te bereiken via LinkedIn', 'desirability', 5) returning id", [idea])).rows[0].id as string;
    const h = (
      await c.query(
        `insert into public.hypotheses (idea_id, assumption_id, we_believe, target_group, test_method, metric_label,
           metric_numerator, metric_denominator, success_threshold_pct, fail_threshold_pct, min_sample, max_duration_days)
         values ($1, $2, 'Bestuurders herkennen het probleem', 'Sportclubs', 'interviews', 'herkend', 'geïnterviewden die het herkennen', 'geïnterviewden', 50, null, 8, 21) returning id`,
        [idea, a],
      )
    ).rows[0].id as string;
    return (await c.query("insert into public.experiments (idea_id, hypothesis_id, type, title) values ($1, $2, $3, 'Interviews sportclubs') returning id", [idea, h, type])).rows[0].id as string;
  });
  // De statusovergang zelf is elders getest; hier alleen de toestand waarin werving wordt bijgehouden.
  if (state !== "draft") await db.query("alter table public.experiments disable trigger user");
  try {
    if (state !== "draft") await db.query("update public.experiments set state = $2, started_at = now() where id = $1", [e, state]);
  } finally {
    if (state !== "draft") await db.query("alter table public.experiments enable trigger user");
  }
  return e;
}

const entry = (idea: string, exp: string, over: Record<string, unknown> = {}) => ({
  idea_id: idea,
  experiment_id: exp,
  entry_date: new Date().toISOString().slice(0, 10),
  channel: "linkedin",
  step: "approached",
  quantity: 10,
  note: null as string | null,
  corrects_id: null as string | null,
  ...over,
});

async function insertEntry(who: U, e: ReturnType<typeof entry>) {
  return as(who, async (c) =>
    (
      await c.query(
        `insert into public.recruitment_entries (idea_id, experiment_id, entry_date, channel, step, quantity, note, corrects_id)
         values ($1, $2, $3, $4, $5, $6, $7, $8) returning id, created_by`,
        [e.idea_id, e.experiment_id, e.entry_date, e.channel, e.step, e.quantity, e.note, e.corrects_id],
      )
    ).rows[0] as { id: string; created_by: string },
  );
}

d("fase 2 · punt 5: werving bijhouden in de database", () => {
  let owner: U;

  beforeAll(async () => {
    db = new Client({ connectionString: url });
    await db.connect();
    owner = await user(`eigenaar-${randomUUID()}@example.com`);
  });

  afterAll(async () => {
    await db?.end();
  });

  it("de migratie is idempotent", async () => {
    await db.query("begin");
    try {
      await db.query(MIGRATION);
      await db.query(MIGRATION);
    } finally {
      await db.query("rollback");
    }
  });

  it("RLS: alleen het onderzoeksteam leest en schrijft; opdrachtgevers en buitenstaanders niet", async () => {
    const { idea } = await newIdea(owner);
    const exp = await newTest(owner, idea);
    const row = await insertEntry(owner, entry(idea, exp));
    expect(row.created_by).toBe(owner.id);

    const client = await user(`klant-${randomUUID()}@example.com`);
    await as(owner, (c) => c.query("insert into public.idea_members (idea_id, email, role) values ($1, $2, 'client_viewer')", [idea, client.email]));
    await as(client, (c) => c.query("select public.claim_invitations()"));
    expect((await as(client, (c) => c.query("select id from public.recruitment_entries where idea_id = $1", [idea]))).rowCount).toBe(0);
    // Geweigerd door de guard (de test is voor hen niet zichtbaar) of door RLS.
    await expect(insertEntry(client, entry(idea, exp))).rejects.toThrow(/row-level security|RECRUITMENT_TEST/);

    const outsider = await user(`buiten-${randomUUID()}@example.com`);
    expect((await as(outsider, (c) => c.query("select id from public.recruitment_entries where idea_id = $1", [idea]))).rowCount).toBe(0);
    await expect(insertEntry(outsider, entry(idea, exp))).rejects.toThrow(/row-level security|RECRUITMENT_TEST/);

    // Campagnes: idem.
    await as(owner, (c) => c.query("insert into public.recruitment_campaigns (idea_id, experiment_id, campaign) values ($1, $2, ' Sportclubs Q4 ')", [idea, exp]));
    expect((await as(owner, (c) => c.query("select campaign from public.recruitment_campaigns where idea_id = $1", [idea]))).rows).toEqual([{ campaign: "Sportclubs Q4" }]);
    expect((await as(client, (c) => c.query("select id from public.recruitment_campaigns where idea_id = $1", [idea]))).rowCount).toBe(0);
    await expect(as(client, (c) => c.query("insert into public.recruitment_campaigns (idea_id, experiment_id, campaign) values ($1, $2, 'X')", [idea, exp]))).rejects.toThrow();
  });

  it("alleen toevoegen: wijzigen en verwijderen kan niet, ook niet met rechten op de tabel", async () => {
    const { idea } = await newIdea(owner);
    const exp = await newTest(owner, idea);
    const { id } = await insertEntry(owner, entry(idea, exp));
    await expect(as(owner, (c) => c.query("update public.recruitment_entries set quantity = 99 where id = $1", [id]))).rejects.toThrow(/permission denied/);
    await expect(as(owner, (c) => c.query("delete from public.recruitment_entries where id = $1", [id]))).rejects.toThrow(/permission denied/);
    // Ook de beheerder (zonder RLS) stuit op de guard.
    await expect(db.query("update public.recruitment_entries set quantity = 99 where id = $1", [id])).rejects.toThrow(/RECRUITMENT_APPEND_ONLY/);
    await expect(db.query("delete from public.recruitment_entries where id = $1", [id])).rejects.toThrow(/RECRUITMENT_APPEND_ONLY/);
  });

  it("correctie = nieuwe regel met reden; netto nooit onder nul; tegenboeking bij dezelfde stap", async () => {
    const { idea } = await newIdea(owner);
    const exp = await newTest(owner, idea);
    const first = await insertEntry(owner, entry(idea, exp, { quantity: 10 }));
    await expect(insertEntry(owner, entry(idea, exp, { quantity: -3 }))).rejects.toThrow(/RECRUITMENT_REASON/);
    await expect(insertEntry(owner, entry(idea, exp, { quantity: -11, note: "dubbel geteld" }))).rejects.toThrow(/RECRUITMENT_NEGATIVE/);
    await expect(insertEntry(owner, entry(idea, exp, { step: "responded", quantity: -1, note: "verkeerde stap", corrects_id: first.id }))).rejects.toThrow(/RECRUITMENT_CORRECTION|RECRUITMENT_NEGATIVE/);
    await insertEntry(owner, entry(idea, exp, { quantity: -10, note: "tegenboeking: dubbel ingevoerd", corrects_id: first.id }));
    const net = (await db.query("select sum(quantity)::int as n, count(*)::int as rows from public.recruitment_entries where experiment_id = $1", [exp])).rows[0];
    expect(net).toEqual({ n: 0, rows: 2 });
    // Beide regels staan in het auditspoor, met wie ze vastlegde.
    const audit = (await db.query("select actor_id, action from public.audit_events where idea_id = $1 and table_name = 'recruitment_entries'", [idea])).rows;
    expect(audit).toHaveLength(2);
    expect(audit.every((a) => a.actor_id === owner.id && a.action === "insert")).toBe(true);
  });

  it("vaste regels: geen afspraak bij een niet-interviewtest, geen conceptfase, geen toekomstige datum", async () => {
    const { idea } = await newIdea(owner);
    const landing = await newTest(owner, idea, "landing");
    await expect(insertEntry(owner, entry(idea, landing, { step: "appointment" }))).rejects.toThrow(/RECRUITMENT_STEP/);
    await expect(insertEntry(owner, entry(idea, landing, { step: "held" }))).rejects.toThrow(/recruitment_entries_step_check/);
    await insertEntry(owner, entry(idea, landing, { channel: "email" }));
    const draft = await newTest(owner, idea, "interview", "draft");
    await expect(insertEntry(owner, entry(idea, draft))).rejects.toThrow(/RECRUITMENT_STATE/);
    const live = await newTest(owner, idea);
    await expect(insertEntry(owner, entry(idea, live, { entry_date: "2099-01-01" }))).rejects.toThrow(/RECRUITMENT_DATE/);
    await expect(insertEntry(owner, entry(idea, live, { channel: "fax" }))).rejects.toThrow(/recruitment_entries_channel_check/);
    // Een test uit een ander dossier kan niet.
    const other = await newIdea(owner);
    await expect(insertEntry(owner, entry(other.idea, live))).rejects.toThrow(/IDEA_MISMATCH/);
  });

  it("één campagne per dossier, ontkoppelen staat in het auditspoor", async () => {
    const { idea } = await newIdea(owner);
    const a = await newTest(owner, idea);
    const b = await newTest(owner, idea);
    await as(owner, (c) => c.query("insert into public.recruitment_campaigns (idea_id, experiment_id, campaign) values ($1, $2, 'Q4')", [idea, a]));
    await expect(as(owner, (c) => c.query("insert into public.recruitment_campaigns (idea_id, experiment_id, campaign) values ($1, $2, 'Q4')", [idea, b]))).rejects.toThrow(/recruitment_campaigns_uniq/);
    await expect(as(owner, (c) => c.query("update public.recruitment_campaigns set campaign = 'Q5' where idea_id = $1", [idea]))).rejects.toThrow(/permission denied/);
    await as(owner, (c) => c.query("delete from public.recruitment_campaigns where idea_id = $1", [idea]));
    const actions = (await db.query("select action from public.audit_events where idea_id = $1 and table_name = 'recruitment_campaigns' order by id", [idea])).rows.map((r) => r.action);
    expect(actions).toEqual(["insert", "delete"]);
  });

  it("brontype eigen wervingsregistratie: nooit primair, nooit officiële statistiek of primaire bron, type ligt vast", async () => {
    const { idea } = await newIdea(owner);
    const src = await as(owner, async (c) =>
      (await c.query("insert into public.sources (idea_id, title, source_type, publisher) values ($1, 'Eigen wervingsregistratie – test', 'recruitment_log', 'ProofLab') returning id", [idea])).rows[0].id as string,
    );
    await expect(as(owner, (c) => c.query("insert into public.sources (idea_id, title, source_type, is_primary) values ($1, 'x', 'recruitment_log', true)", [idea]))).rejects.toThrow(/sources_recruitment_log_not_primary/);
    await expect(as(owner, (c) => c.query("update public.sources set source_type = 'official_statistic' where id = $1", [src]))).rejects.toThrow(/RECRUITMENT_LOG_TYPE/);
    const other = await as(owner, async (c) => (await c.query("insert into public.sources (idea_id, title, source_type) values ($1, 'Blog', 'blog') returning id", [idea])).rows[0].id as string);
    await expect(as(owner, (c) => c.query("update public.sources set source_type = 'recruitment_log' where id = $1", [other]))).rejects.toThrow(/RECRUITMENT_LOG_TYPE/);

    const ex = await as(owner, async (c) =>
      (await c.query("insert into public.source_excerpts (source_id, idea_id, text) values ($1, $2, 'Kanaal LinkedIn levert 23% respons (n = 30)') returning id", [src, idea])).rows[0].id as string,
    );
    const claim = async (type: string) =>
      as(owner, async (c) => (await c.query("insert into public.claims (idea_id, statement, evidence_type, section) values ($1, 'Kanaal LinkedIn levert 23% respons (n = 30).', $2, 'customers') returning id", [idea, type])).rows[0].id as string);
    const link = (claimId: string) =>
      as(owner, (c) => c.query("insert into public.claim_sources (claim_id, idea_id, source_id, excerpt_id, quote) values ($1, $2, $3, $4, 'Kanaal LinkedIn levert 23% respons (n = 30)')", [claimId, idea, src, ex]));
    for (const t of ["official_statistic", "primary_document"]) {
      await expect(link(await claim(t))).rejects.toThrow(/RECRUITMENT_LOG_EVIDENCE/);
    }
    const ok = await claim("observed_action");
    await link(ok);
    await expect(as(owner, (c) => c.query("update public.claims set evidence_type = 'official_statistic' where id = $1", [ok]))).rejects.toThrow(/RECRUITMENT_LOG_EVIDENCE/);
    await as(owner, (c) => c.query("update public.claims set evidence_type = 'qualitative_observation' where id = $1", [ok]));
  });

  it("een dossier verwijderen neemt de regels mee (cascade); het auditspoor blijft", async () => {
    const { idea } = await newIdea(owner);
    const exp = await newTest(owner, idea);
    await insertEntry(owner, entry(idea, exp));
    await as(owner, (c) => c.query("insert into public.recruitment_campaigns (idea_id, experiment_id, campaign) values ($1, $2, 'Q4')", [idea, exp]));
    await db.query("delete from public.ideas where id = $1", [idea]);
    expect((await db.query("select id from public.recruitment_entries where idea_id = $1", [idea])).rowCount).toBe(0);
    expect((await db.query("select id from public.audit_events where idea_id = $1 and table_name = 'recruitment_entries'", [idea])).rowCount).toBeGreaterThan(0);
  });
});
