import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import { randomUUID } from "node:crypto";

// Research-method features (chapter 7) against a throwaway local Postgres with the Supabase shim and all
// migrations (see scripts/test-db.sh). Skipped when TEST_DATABASE_URL is not set.
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

async function user(email: string) {
  const id = randomUUID();
  await db.query("insert into auth.users (id, email, email_confirmed_at) values ($1, $2, now())", [id, email]);
  return { id, email };
}

d("research methods: support checks, customer signals, AI review, red team", () => {
  let alice: Who;
  let client: Who;
  let idea: string;
  let claimSource: string;
  let source: string;
  let excerpt: string;

  beforeAll(async () => {
    db = new Client({ connectionString: url });
    await db.connect();
    alice = await user(`alice-${randomUUID()}@example.com`);
    client = await user(`klant-${randomUUID()}@example.com`);
    idea = await as(alice, async (c) => {
      const org = (await c.query("select public.create_organization('Bureau methodes') as id")).rows[0].id;
      return (
        await c.query(
          `insert into public.ideas (org_id, title, decision_question, project_type, description, target_audience, region)
           values ($1, 'EventMatch', 'Investeren we €25.000?', 'new_product', 'Beschrijving', 'Eventmanagers', 'Nederland') returning id`,
          [org],
        )
      ).rows[0].id;
    });
    await as(alice, (c) => c.query("insert into public.idea_members (idea_id, email, role) values ($1, $2, 'client_viewer')", [idea, client.email]));
    await as(client, (c) => c.query("select public.claim_invitations()"));
    ({ source, excerpt, claimSource } = await as(alice, async (c) => {
      const s = (await c.query("insert into public.sources (idea_id, title, source_type, url) values ($1, 'Reviews concurrent', 'forum', 'https://forum.example.nl/draad') returning id", [idea])).rows[0].id;
      const e = (await c.query("insert into public.source_excerpts (source_id, idea_id, text) values ($1, $2, 'Offertes vergelijken kost me elke keer twee dagen.') returning id", [s, idea])).rows[0].id;
      const cl = (await c.query("insert into public.claims (idea_id, statement, evidence_type, origin) values ($1, 'Offertes vergelijken kost eventmanagers dagen', 'qualitative_observation', 'ai') returning id", [idea])).rows[0].id;
      const cs = (
        await c.query(
          "insert into public.claim_sources (claim_id, idea_id, source_id, excerpt_id, quote, quote_check, support_check, support_checked_by, support_note) values ($1, $2, $3, $4, 'Offertes vergelijken kost me elke keer twee dagen', 'exact', 'partial', 'ai', 'Gaat over één persoon') returning id",
          [cl, idea, s, e],
        )
      ).rows[0].id;
      return { source: s, excerpt: e, claimSource: cs };
    }));
  });

  afterAll(async () => {
    await db?.end();
  });

  it("accepts the new source types for customer signals", async () => {
    const n = await as(alice, async (c) => (await c.query("insert into public.sources (idea_id, title, source_type) values ($1, 'Outreach', 'outreach')", [idea])).rowCount);
    expect(n).toBe(1);
    expect(source).toBeTruthy();
  });

  it("lets a consultant override the AI support check and keeps the AI verdict in the note; a client cannot", async () => {
    await as(alice, (c) =>
      c.query("update public.claim_sources set support_check = 'supports', support_checked_by = 'consultant', support_note = '[ai:partial] klopt toch' where id = $1", [claimSource]),
    );
    const row = await as(alice, async (c) => (await c.query("select support_check, support_checked_by, support_note from public.claim_sources where id = $1", [claimSource])).rows[0]);
    expect(row).toEqual({ support_check: "supports", support_checked_by: "consultant", support_note: "[ai:partial] klopt toch" });
    const changed = await as(client, async (c) => (await c.query("update public.claim_sources set support_check = 'not_supported' where id = $1", [claimSource])).rowCount);
    expect(changed).toBe(0);
    await expect(as(alice, (c) => c.query("update public.claim_sources set support_check = 'maybe' where id = $1", [claimSource]))).rejects.toThrow(/check constraint/);
  });

  it("stores customer signals with quotes; clients read them but cannot add or delete", async () => {
    const quotes = JSON.stringify([{ text: "Offertes vergelijken kost me elke keer twee dagen", excerpt_id: excerpt, source_id: source, source_title: "Reviews concurrent" }]);
    const id = await as(alice, async (c) =>
      (await c.query("insert into public.customer_signals (idea_id, kind, label, mentions, quotes, origin) values ($1, 'pain', 'Offertes vergelijken kost tijd', 1, $2::jsonb, 'ai') returning id", [idea, quotes])).rows[0].id,
    );
    const seen = await as(client, async (c) => (await c.query("select quotes from public.customer_signals where idea_id = $1", [idea])).rows);
    expect(seen).toHaveLength(1);
    expect(seen[0].quotes[0].text).toContain("twee dagen");
    await expect(
      as(client, (c) => c.query("insert into public.customer_signals (idea_id, kind, label, mentions) values ($1, 'pain', 'Klant voegt toe', 1)", [idea])),
    ).rejects.toThrow(/row-level security/);
    expect(await as(client, async (c) => (await c.query("delete from public.customer_signals where id = $1", [id])).rowCount)).toBe(0);
    expect(await as(alice, async (c) => (await c.query("delete from public.customer_signals where id = $1", [id])).rowCount)).toBe(1);
  });

  it("turns a pain into an AI-origin assumption and links a red-team finding as contradicting", async () => {
    const { assumption, claim } = await as(alice, async (c) => {
      const a = (await c.query("insert into public.assumptions (idea_id, statement, category, importance, origin) values ($1, 'Eventmanagers verliezen dagen aan offertes', 'desirability', 4, 'ai') returning id", [idea])).rows[0].id;
      const cl = (await c.query("select claim_id from public.claim_sources where id = $1", [claimSource])).rows[0].claim_id;
      await c.query("insert into public.assumption_claims (assumption_id, claim_id, idea_id, relation) values ($1, $2, $3, 'contradicts')", [a, cl, idea]);
      return { assumption: a, claim: cl };
    });
    const rel = await as(client, async (c) => (await c.query("select relation from public.assumption_claims where assumption_id = $1 and claim_id = $2", [assumption, claim])).rows[0].relation);
    expect(rel).toBe("contradicts");
  });

  it("rejecting an AI coding stamps the reviewer and its evidence link can be removed", async () => {
    const { obs, assumption } = await as(alice, async (c) => {
      const a = (await c.query("insert into public.assumptions (idea_id, statement, category) values ($1, 'Klanten betalen voor snelheid', 'viability') returning id", [idea])).rows[0].id;
      const o = (await c.query("insert into public.observations (idea_id, kind, summary, quote, origin) values ($1, 'objection', 'Te duur', 'Dat is te duur voor ons', 'ai') returning id", [idea])).rows[0].id;
      await c.query("insert into public.assumption_observations (assumption_id, observation_id, idea_id, relation) values ($1, $2, $3, 'contradicts')", [a, o, idea]);
      return { obs: o, assumption: a };
    });
    await as(alice, async (c) => {
      const r = await c.query("update public.observations set review_status = 'rejected' where id = $1 and origin = 'ai' and review_status is null returning id", [obs]);
      expect(r.rowCount).toBe(1);
      await c.query("delete from public.assumption_observations where observation_id = $1 and idea_id = $2", [obs, idea]);
    });
    const row = await as(alice, async (c) => (await c.query("select review_status, reviewed_by, reviewed_at from public.observations where id = $1", [obs])).rows[0]);
    expect(row.review_status).toBe("rejected");
    expect(row.reviewed_by).toBe(alice.id);
    expect(row.reviewed_at).toBeTruthy();
    const links = await as(alice, async (c) => (await c.query("select 1 from public.assumption_observations where assumption_id = $1", [assumption])).rowCount);
    expect(links).toBe(0);
    // The observation itself stays on record.
    expect(await as(alice, async (c) => (await c.query("delete from public.observations where id = $1", [obs])).rowCount)).toBe(0);
  });

  it("records the competitor recheck time and the recheck note on the source", async () => {
    await as(alice, async (c) => {
      const comp = (await c.query("insert into public.competitors (idea_id, name, kind) values ($1, 'Locatiezoeker', 'direct') returning id", [idea])).rows[0].id;
      await c.query("update public.competitors set last_checked_at = now() where id = $1", [comp]);
      await c.query("update public.sources set access_note = $2 where id = $1", [source, "Hercontrole 2026-11-03: 1 van 1 citaten niet meer gevonden op de pagina [0a1b2c3d]."]);
    });
    const note = await as(client, async (c) => (await c.query("select access_note from public.sources where id = $1", [source])).rows[0].access_note);
    expect(note).toMatch(/^Hercontrole 2026-11-03/);
  });
});
