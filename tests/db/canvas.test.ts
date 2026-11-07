import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

// Propositie- en businessmodelcanvas (migratie 20261118110000) tegen een lokale Postgres met de Supabase-shim en alle
// migraties (zie scripts/test-db.sh). Overgeslagen zonder TEST_DATABASE_URL.
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

async function newIdea(who: Who, org: string, title: string) {
  return as(who, async (c) =>
    (
      await c.query(
        `insert into public.ideas (org_id, title, decision_question, project_type, description, target_audience, region)
         values ($1, $2, 'Investeren we?', 'new_product', 'Beschrijving', 'Zakelijke klanten (B2B)', 'Nederland') returning id`,
        [org, title],
      )
    ).rows[0].id as string,
  );
}

let owner: Who;
let client: Who;
let outsider: Who;
let idea: string;
let otherIdea: string;
let assumption: string;
let otherAssumption: string;

const insertItem = (who: Who, values: Record<string, unknown>) =>
  as(who, async (c) => {
    const cols = Object.keys(values);
    const res = await c.query(`insert into public.canvas_items (${cols.join(", ")}) values (${cols.map((_, i) => `$${i + 1}`).join(", ")}) returning *`, Object.values(values));
    return res.rows[0];
  });

beforeAll(async () => {
  if (!url) return;
  db = new Client({ connectionString: url });
  await db.connect();
  owner = await user(`eigenaar-${randomUUID()}@example.com`);
  client = await user(`klant-${randomUUID()}@example.com`);
  outsider = await user(`buiten-${randomUUID()}@example.com`);
  const org = await as(owner, async (c) => (await c.query("select public.create_organization('Bureau canvas') as id")).rows[0].id as string);
  const otherOrg = await as(outsider, async (c) => (await c.query("select public.create_organization('Ander bureau') as id")).rows[0].id as string);
  await db.query("insert into public.profiles (user_id, email, full_name) values ($1, $2, 'Eva Eigenaar')", [owner.id, owner.email]);
  idea = await newIdea(owner, org, "Canvasdossier");
  otherIdea = await newIdea(outsider, otherOrg, "Ander dossier");
  await as(owner, (c) => c.query("insert into public.idea_members (idea_id, email, role) values ($1, $2, 'client_viewer')", [idea, client.email]));
  await as(client, (c) => c.query("select public.claim_invitations()"));
  assumption = await as(owner, async (c) =>
    (await c.query("insert into public.assumptions (idea_id, statement, category, importance, origin) values ($1, 'Clubs betalen € 20 per maand', 'viability', 5, 'manual') returning id", [idea])).rows[0].id as string,
  );
  otherAssumption = await as(outsider, async (c) =>
    (await c.query("insert into public.assumptions (idea_id, statement, category, importance, origin) values ($1, 'Iets anders', 'viability', 3, 'manual') returning id", [otherIdea])).rows[0].id as string,
  );
});

afterAll(async () => {
  await db?.end();
});

d("canvas: migratie", () => {
  it("is idempotent (tweede keer uitvoeren gaat goed)", async () => {
    const sql = readFileSync(path.join(process.cwd(), "supabase/migrations/20261118110000_canvas.sql"), "utf8");
    await db.query(sql);
    await db.query(sql);
  });
});

d("canvas: onderdelen", () => {
  it("de database zet maker en tijd; bouwsteen moet bij het canvas horen", async () => {
    const row = await insertItem(owner, { idea_id: idea, canvas: "business", block: "channels", body: "Via de sportbonden", created_by: outsider.id });
    expect(row.created_by).toBe(owner.id);
    expect(row.origin).toBe("manual");
    await expect(insertItem(owner, { idea_id: idea, canvas: "value", block: "channels", body: "Fout canvas" })).rejects.toThrow();
    await expect(insertItem(owner, { idea_id: idea, canvas: "business", block: "channels", body: "   " })).rejects.toThrow();
    await expect(insertItem(owner, { idea_id: idea, canvas: "business", block: "channels", body: "x".repeat(501) })).rejects.toThrow();
  });

  it("opdrachtgever leest maar schrijft niet; een ander bureau ziet en wijzigt niets", async () => {
    const row = await insertItem(owner, { idea_id: idea, canvas: "business", block: "customer_segments", body: "Amateurvoetbalclubs" });
    const seen = await as(client, async (c) => (await c.query("select id from public.canvas_items where idea_id = $1", [idea])).rows.map((r) => r.id));
    expect(seen).toContain(row.id);
    await expect(insertItem(client, { idea_id: idea, canvas: "business", block: "channels", body: "Mag niet" })).rejects.toThrow();
    expect(await as(client, async (c) => (await c.query("update public.canvas_items set body = 'Gewijzigd' where id = $1 returning id", [row.id])).rows)).toHaveLength(0);
    expect(await as(client, async (c) => (await c.query("delete from public.canvas_items where id = $1 returning id", [row.id])).rows)).toHaveLength(0);
    // Cross-tenant
    expect(await as(outsider, async (c) => (await c.query("select id from public.canvas_items where idea_id = $1", [idea])).rows)).toHaveLength(0);
    expect(await as(outsider, async (c) => (await c.query("update public.canvas_items set body = 'Overgenomen' where id = $1 returning id", [row.id])).rows)).toHaveLength(0);
    await expect(insertItem(outsider, { idea_id: idea, canvas: "business", block: "channels", body: "Inbraak" })).rejects.toThrow();
    const after = (await db.query("select body from public.canvas_items where id = $1", [row.id])).rows[0];
    expect(after.body).toBe("Amateurvoetbalclubs");
  });

  it("een aanname van een ander idee kan niet gekoppeld worden; herkomst en canvas veranderen niet", async () => {
    const row = await insertItem(owner, { idea_id: idea, canvas: "business", block: "revenue_streams", body: "€ 20 per maand", origin: "intake", source_ref: "intake:price" });
    await expect(as(owner, (c) => c.query("update public.canvas_items set assumption_id = $1 where id = $2", [otherAssumption, row.id]))).rejects.toThrow(/CANVAS_ASSUMPTION_IDEA/);
    const upd = await as(owner, async (c) => (await c.query("update public.canvas_items set assumption_id = $1, origin = 'manual', canvas = 'value', source_ref = null where id = $2 returning *", [assumption, row.id])).rows[0]);
    expect(upd).toMatchObject({ assumption_id: assumption, origin: "intake", canvas: "business", source_ref: "intake:price" });
    // Dezelfde bron één keer per idee.
    await expect(insertItem(owner, { idea_id: idea, canvas: "business", block: "revenue_streams", body: "Dubbel", origin: "intake", source_ref: "intake:price" })).rejects.toThrow();
    const ignored = await as(owner, async (c) =>
      (await c.query("insert into public.canvas_items (idea_id, canvas, block, body, origin, source_ref) values ($1, 'business', 'revenue_streams', 'Dubbel', 'intake', 'intake:price') on conflict (idea_id, source_ref) do nothing returning id", [idea])).rows,
    );
    expect(ignored).toHaveLength(0);
    // Aanname verwijderd: de koppeling vervalt, het onderdeel blijft.
    const tmp = await as(owner, async (c) => (await c.query("insert into public.assumptions (idea_id, statement, category, importance, origin) values ($1, 'Tijdelijke aanname', 'viability', 2, 'manual') returning id", [idea])).rows[0].id as string);
    const linked = await insertItem(owner, { idea_id: idea, canvas: "business", block: "key_partners", body: "KNVB", assumption_id: tmp });
    await as(owner, (c) => c.query("delete from public.assumptions where id = $1", [tmp]));
    expect((await db.query("select assumption_id from public.canvas_items where id = $1", [linked.id])).rows[0].assumption_id).toBeNull();
  });

  it("AI-voorstel: start niet geaccepteerd, hangt pas na akkoord aan een aanname; accepteren één keer en alleen bij AI", async () => {
    const ai = await insertItem(owner, { idea_id: idea, canvas: "value", block: "pains", body: "Geen tijd voor nieuwsbrieven", origin: "ai", accepted_at: new Date().toISOString(), accepted_by: owner.id });
    expect(ai.accepted_at).toBeNull();
    expect(ai.accepted_by).toBeNull();
    await expect(as(owner, (c) => c.query("update public.canvas_items set assumption_id = $1 where id = $2", [assumption, ai.id]))).rejects.toThrow();
    await expect(insertItem(owner, { idea_id: idea, canvas: "value", block: "pains", body: "Direct gekoppeld", origin: "ai", assumption_id: assumption })).rejects.toThrow();
    const accepted = await as(owner, async (c) => (await c.query("update public.canvas_items set accepted_at = '2000-01-01', accepted_by = $1 where id = $2 returning *", [outsider.id, ai.id])).rows[0]);
    expect(accepted.accepted_by).toBe(owner.id);
    expect(new Date(accepted.accepted_at).getFullYear()).toBeGreaterThan(2020);
    // Daarna wel koppelen; de acceptatie kan niet worden teruggedraaid of verplaatst.
    const again = await as(owner, async (c) => (await c.query("update public.canvas_items set assumption_id = $1, accepted_at = null where id = $2 returning *", [assumption, ai.id])).rows[0]);
    expect(again.assumption_id).toBe(assumption);
    expect(again.accepted_at).not.toBeNull();
    const manual = await insertItem(owner, { idea_id: idea, canvas: "value", block: "gains", body: "Meer vrijwilligers" });
    await expect(as(owner, (c) => c.query("update public.canvas_items set accepted_at = now() where id = $1", [manual.id]))).rejects.toThrow(/CANVAS_ACCEPT_NOT_AI/);
  });
});

d("canvas: versies", () => {
  it("opslaan via de functie: doorlopend nummer, auteur, momentopname met aanname en status", async () => {
    const v1 = await as(owner, async (c) => (await c.query("select * from public.save_canvas_version($1, $2)", [idea, "Eerste opzet"])).rows[0]);
    const v2 = await as(owner, async (c) => (await c.query("select * from public.save_canvas_version($1, $2)", [idea, ""])).rows[0]);
    expect([v1.version_no, v2.version_no]).toEqual([1, 2]);
    const row = (await db.query("select * from public.canvas_versions where id = $1", [v1.id])).rows[0];
    expect(row).toMatchObject({ idea_id: idea, note: "Eerste opzet", author_name: "Eva Eigenaar", created_by: owner.id });
    const items = row.items as { body: string; assumption_id: string | null; assumption_statement: string | null; assumption_status: string | null; accepted: boolean; origin: string }[];
    expect(items.find((i) => i.body === "€ 20 per maand")).toMatchObject({ assumption_id: assumption, assumption_statement: "Clubs betalen € 20 per maand", assumption_status: "untested" });
    expect(items.find((i) => i.body === "Geen tijd voor nieuwsbrieven")).toMatchObject({ origin: "ai", accepted: true });
    // De opdrachtgever leest de versies.
    expect(await as(client, async (c) => (await c.query("select version_no from public.canvas_versions where idea_id = $1 order by version_no", [idea])).rows.map((r) => r.version_no))).toEqual([1, 2]);
  });

  it("alleen het team slaat op; opdrachtgever en ander bureau niet; direct invoegen kan niemand", async () => {
    await expect(as(client, (c) => c.query("select * from public.save_canvas_version($1, 'x')", [idea]))).rejects.toThrow(/CANVAS_NOT_ALLOWED/);
    await expect(as(outsider, (c) => c.query("select * from public.save_canvas_version($1, 'x')", [idea]))).rejects.toThrow(/CANVAS_NOT_ALLOWED/);
    expect(await as(outsider, async (c) => (await c.query("select id from public.canvas_versions where idea_id = $1", [idea])).rows)).toHaveLength(0);
    await expect(as(owner, (c) => c.query("insert into public.canvas_versions (idea_id, version_no, items) values ($1, 99, '[]')", [idea]))).rejects.toThrow();
    await expect(as(owner, (c) => c.query("select * from public.save_canvas_version($1, $2)", [idea, "x".repeat(1001)]))).rejects.toThrow(/CANVAS_NOTE_TOO_LONG/);
  });

  it("onveranderlijk: niet bij te werken of te verwijderen, ook niet door de eigenaar of de databasebeheerder", async () => {
    const id = (await db.query("select id from public.canvas_versions where idea_id = $1 and version_no = 1", [idea])).rows[0].id as string;
    // Geen schrijfrechten voor ingelogde gebruikers (ook niet de eigenaar van de werkruimte).
    await expect(as(owner, (c) => c.query("update public.canvas_versions set note = 'Herschreven' where id = $1", [id]))).rejects.toThrow(/permission denied/);
    await expect(as(owner, (c) => c.query("delete from public.canvas_versions where id = $1", [id]))).rejects.toThrow(/permission denied/);
    await expect(db.query("update public.canvas_versions set note = 'Herschreven' where id = $1", [id])).rejects.toThrow(/CANVAS_VERSION_LOCKED/);
    await expect(db.query("update public.canvas_versions set items = '[]' where id = $1", [id])).rejects.toThrow(/CANVAS_VERSION_LOCKED/);
    await expect(db.query("delete from public.canvas_versions where id = $1", [id])).rejects.toThrow(/CANVAS_VERSION_LOCKED/);
    expect((await db.query("select note from public.canvas_versions where id = $1", [id])).rows[0].note).toBe("Eerste opzet");
  });

  it("een verwijderd account en een verwijderd idee blokkeren niets", async () => {
    const temp = await user(`tijdelijk-${randomUUID()}@example.com`);
    const org = await as(temp, async (c) => (await c.query("select public.create_organization('Tijdelijk') as id")).rows[0].id as string);
    const tIdea = await newIdea(temp, org, "Tijdelijk dossier");
    await insertItem(temp, { idea_id: tIdea, canvas: "business", block: "channels", body: "Kanaal" });
    await as(temp, (c) => c.query("select * from public.save_canvas_version($1, 'v1')", [tIdea]));
    // Wat "on delete set null" doet als het account verdwijnt: alleen created_by wordt leeg, de rest blijft.
    await db.query("update public.canvas_versions set created_by = null where idea_id = $1", [tIdea]);
    expect((await db.query("select created_by, note from public.canvas_versions where idea_id = $1", [tIdea])).rows[0]).toEqual({ created_by: null, note: "v1" });
    await expect(db.query("update public.canvas_versions set created_by = $2 where idea_id = $1", [tIdea, temp.id])).rejects.toThrow(/CANVAS_VERSION_LOCKED/);
    await db.query("delete from public.ideas where id = $1", [tIdea]);
    expect((await db.query("select count(*)::int as n from public.canvas_versions where idea_id = $1", [tIdea])).rows[0].n).toBe(0);
  });
});

d("canvas: auditspoor", () => {
  it("onderdelen en versies staan in audit_events", async () => {
    const row = await insertItem(owner, { idea_id: idea, canvas: "business", block: "cost_structure", body: "Hosting" });
    await as(owner, (c) => c.query("update public.canvas_items set body = 'Hosting en support' where id = $1", [row.id]));
    await as(owner, (c) => c.query("delete from public.canvas_items where id = $1", [row.id]));
    const audit = (await db.query("select action, actor_id, detail from public.audit_events where table_name = 'canvas_items' and row_id = $1 order by id", [row.id])).rows;
    expect(audit.map((r) => r.action)).toEqual(["insert", "update", "delete"]);
    expect(audit[0].actor_id).toBe(owner.id);
    expect(audit[1].detail.changes.body).toEqual({ old: "Hosting", new: "Hosting en support" });
    const versions = (await db.query("select count(*)::int as n from public.audit_events where table_name = 'canvas_versions' and idea_id = $1 and action = 'insert'", [idea])).rows[0].n;
    expect(versions).toBeGreaterThanOrEqual(2);
  });
});
