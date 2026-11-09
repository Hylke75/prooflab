import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import { randomUUID, createHash } from "node:crypto";

// Coach notes and outreach webhooks against the real schema (see scripts/test-db.sh). Helper pattern copied
// from rls.test.ts. Skipped when TEST_DATABASE_URL is not set.
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

const ingestKey = "test-ingest-key";
const sha = (s: string) => createHash("sha256").update(s).digest("hex");

async function newIdea(owner: { id: string; email: string }) {
  return as(owner, async (c) => {
    const org = (await c.query("select public.create_organization('Bureau ' || $1) as id", [owner.email])).rows[0].id;
    return (
      await c.query(
        `insert into public.ideas (org_id, title, decision_question, project_type, description, target_audience, region)
         values ($1, 'Coachidee', 'Investeren we €25.000?', 'new_product', 'Beschrijving', 'Eventmanagers', 'Nederland') returning id`,
        [org],
      )
    ).rows[0].id as string;
  });
}

const note = (c: Client, idea: string, code: string, audience = "consultant") =>
  c.query(
    "insert into public.coach_notes (idea_id, code, kind, title, body, href, source, audience) values ($1, $2, 'tip', 'Een titel', 'Een uitleg met waarom.', $3, 'rules', $4) returning id",
    [idea, code, `/app/ideas/${idea}/research`, audience],
  );

d("trajectory coach and outreach signals", () => {
  let alice: { id: string; email: string };
  let bob: { id: string; email: string };
  let client: { id: string; email: string };
  let idea: string;

  beforeAll(async () => {
    db = new Client({ connectionString: url });
    await db.connect();
    await db.query("insert into public.ingest_keys (key_hash) values ($1) on conflict do nothing", [sha(ingestKey)]);
    alice = await user(`alice-${randomUUID()}@example.com`);
    bob = await user(`bob-${randomUUID()}@example.com`);
    client = await user(`klant-${randomUUID()}@example.com`);
    idea = await newIdea(alice);
    await newIdea(bob);
    await as(alice, (c) => c.query("insert into public.idea_members (idea_id, email, role) values ($1, $2, 'client_decider')", [idea, client.email]));
    await as(client, (c) => c.query("select public.claim_invitations()"));
  });

  afterAll(async () => {
    await db?.end();
  });

  it("keeps one open note per code; a closed code can be posted again", async () => {
    const id = (await as(alice, (c) => note(c, idea, "alternatives_missing"))).rows[0].id;
    await expect(as(alice, (c) => note(c, idea, "alternatives_missing"))).rejects.toThrow(/duplicate key/);
    await as(alice, (c) => c.query("update public.coach_notes set status = 'done' where id = $1", [id]));
    const again = await as(alice, (c) => note(c, idea, "alternatives_missing"));
    expect(again.rowCount).toBe(1);
  });

  it("only lets the status of a note change and stamps who resolved it", async () => {
    const id = (await as(alice, (c) => note(c, idea, "status_only"))).rows[0].id;
    await expect(as(alice, (c) => c.query("update public.coach_notes set body = 'Herschreven tekst' where id = $1", [id]))).rejects.toThrow(/COACH_NOTE_LOCKED/);
    await as(alice, (c) => c.query("update public.coach_notes set status = 'dismissed' where id = $1", [id]));
    const row = (await db.query("select status, resolved_at, resolved_by from public.coach_notes where id = $1", [id])).rows[0];
    expect(row.status).toBe("dismissed");
    expect(row.resolved_at).not.toBeNull();
    expect(row.resolved_by).toBe(alice.id);
  });

  it("shows clients only notes meant for everyone, and nothing to other organisations", async () => {
    await as(alice, (c) => note(c, idea, "decision_confirm:x", "everyone"));
    const seen = await as(client, async (c) => (await c.query("select audience from public.coach_notes where idea_id = $1", [idea])).rows);
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every((r) => r.audience === "everyone")).toBe(true);
    await expect(as(client, (c) => note(c, idea, "client_note"))).rejects.toThrow(/row-level security/);
    expect(await as(bob, async (c) => (await c.query("select id from public.coach_notes where idea_id = $1", [idea])).rowCount)).toBe(0);
    expect(await as(client, async (c) => (await c.query("select * from public.coach_reviews where idea_id = $1", [idea])).rowCount)).toBe(0);
  });

  it("claims a review with a conditional update, so parallel reviews do not both run", async () => {
    await as(alice, (c) => c.query("insert into public.coach_reviews (idea_id, fingerprint, reviewed_at) values ($1, 'v1', now() - interval '5 minutes')", [idea]));
    const claim = () =>
      as(alice, async (c) => (await c.query("update public.coach_reviews set reviewed_at = now() where idea_id = $1 and reviewed_at < now() - interval '2 minutes' returning idea_id", [idea])).rowCount);
    expect(await claim()).toBe(1);
    expect(await claim()).toBe(0);
  });

  it("records outreach events through the guarded function only, deduplicated per endpoint", async () => {
    const token = "tok-" + randomUUID();
    const endpoint = (
      await as(alice, (c) => c.query("insert into public.integration_endpoints (idea_id, provider, label, token_hash) values ($1, 'expandi', 'Expandi', $2) returning id", [idea, sha(token)]))
    ).rows[0].id;
    const rec = (key: string, tokenHash: string, dedupe: string, event = "reply") =>
      as("anon", async (c) =>
        (await c.query("select public.record_outreach_event($1, $2, $3, 'hash1', 'Q4', 'Klinkt interessant', $4) as ok", [key, tokenHash, event, dedupe])).rows[0].ok,
      );
    expect(await rec(ingestKey, sha(token), "evt1")).toBe("ok");
    expect(await rec(ingestKey, sha(token), "evt1")).toBe("duplicate");
    expect(await rec(ingestKey, sha("onbekend"), "evt2")).toBe("unknown");
    await expect(rec("fout", sha(token), "evt3")).rejects.toThrow(/FORBIDDEN/);
    expect(await rec(ingestKey, sha(token), "evt4", "iets_vreemds")).toBe("ok");
    const rows = await as(alice, async (c) => (await c.query("select event_type from public.outreach_events where endpoint_id = $1 order by id", [endpoint])).rows);
    expect(rows.map((r) => r.event_type)).toEqual(["reply", "other"]);
    await expect(as("anon", (c) => c.query("insert into public.outreach_events (idea_id, endpoint_id, event_type, contact_hash, dedupe_key) values ($1, $2, 'reply', 'h', 'x')", [idea, endpoint]))).rejects.toThrow(/permission denied/);
    expect(await as(client, async (c) => (await c.query("select * from public.outreach_events where idea_id = $1", [idea])).rowCount)).toBe(0);
    expect(await as(client, async (c) => (await c.query("select * from public.integration_endpoints where idea_id = $1", [idea])).rowCount)).toBe(0);

    await as(alice, (c) => c.query("update public.integration_endpoints set active = false where id = $1", [endpoint]));
    expect(await rec(ingestKey, sha(token), "evt5")).toBe("unknown");
  });

  it("accepts the new source types for customer signals", async () => {
    const r = await as(alice, (c) =>
      c.query("insert into public.sources (idea_id, title, source_type) values ($1, 'Outreach-antwoorden', 'outreach'), ($1, 'Forumdraad', 'forum') returning id", [idea]),
    );
    expect(r.rowCount).toBe(2);
  });
});
