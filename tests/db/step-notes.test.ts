import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import { randomUUID } from "node:crypto";

// Notities en documenten per stap (migratie 20261110130000) tegen een lokale Postgres met de Supabase-shim en alle
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

let owner: Who;
let editor: Who;
let client: Who;
let outsider: Who;
let idea: string;

beforeAll(async () => {
  if (!url) return;
  db = new Client({ connectionString: url });
  await db.connect();
  owner = await user(`eigenaar-${randomUUID()}@example.com`);
  editor = await user(`collega-${randomUUID()}@example.com`);
  client = await user(`klant-${randomUUID()}@example.com`);
  outsider = await user(`buiten-${randomUUID()}@example.com`);
  const org = await as(owner, async (c) => (await c.query("select public.create_organization('Bureau notities') as id")).rows[0].id as string);
  await db.query("insert into public.organization_members (org_id, user_id, role) values ($1, $2, 'editor')", [org, editor.id]);
  await db.query("insert into public.profiles (user_id, email, full_name) values ($1, $2, 'Eva Eigenaar')", [owner.id, owner.email]);
  idea = await as(owner, async (c) =>
    (
      await c.query(
        `insert into public.ideas (org_id, title, decision_question, project_type, description, target_audience, region)
         values ($1, 'Notitiedossier', 'Investeren we?', 'new_product', 'Beschrijving', 'Zakelijke klanten (B2B)', 'Nederland') returning id`,
        [org],
      )
    ).rows[0].id as string,
  );
  await as(owner, (c) => c.query("insert into public.idea_members (idea_id, email, role) values ($1, $2, 'client_viewer')", [idea, client.email]));
  await as(client, (c) => c.query("select public.claim_invitations()"));
});

afterAll(async () => {
  await db?.end();
});

const path = (step = "market", name = "rapport.pdf") => `${idea}/${step}/${randomUUID()}-${name}`;

d("notities per stap", () => {
  it("de database legt auteur en tijd vast; de opdrachtgever leest, maar schrijft niet", async () => {
    const note = await as(owner, async (c) =>
      (await c.query("insert into public.step_notes (idea_id, step, title, body, created_by, author_name) values ($1, 'market', 'Gesprek', 'Tekst', $2, 'Iemand anders') returning *", [idea, outsider.id])).rows[0],
    );
    expect(note.created_by).toBe(owner.id);
    expect(note.author_name).toBe("Eva Eigenaar");
    const seen = await as(client, async (c) => (await c.query("select id from public.step_notes where idea_id = $1", [idea])).rows);
    expect(seen.map((r) => r.id)).toContain(note.id);
    await expect(as(client, (c) => c.query("insert into public.step_notes (idea_id, step, body) values ($1, 'market', 'Mag niet')", [idea]))).rejects.toThrow();
    const none = await as(outsider, async (c) => (await c.query("select id from public.step_notes where idea_id = $1", [idea])).rows);
    expect(none).toHaveLength(0);
  });

  it("weigert een onbekende stap, een lege tekst en te lange tekst", async () => {
    await expect(as(owner, (c) => c.query("insert into public.step_notes (idea_id, step, body) values ($1, 'report', 'x')", [idea]))).rejects.toThrow();
    await expect(as(owner, (c) => c.query("insert into public.step_notes (idea_id, step, body) values ($1, 'market', '   ')", [idea]))).rejects.toThrow();
    await expect(as(owner, (c) => c.query("insert into public.step_notes (idea_id, step, body) values ($1, 'market', $2)", [idea, "x".repeat(20001)]))).rejects.toThrow();
  });

  it("bewerken en verwijderen: eigen notitie, of als eigenaar; een collega niet die van een ander", async () => {
    const mine = await as(editor, async (c) => (await c.query("insert into public.step_notes (idea_id, step, body) values ($1, 'test', 'Van de collega') returning id", [idea])).rows[0].id as string);
    const ofOwner = await as(owner, async (c) => (await c.query("insert into public.step_notes (idea_id, step, body) values ($1, 'test', 'Van de eigenaar') returning id", [idea])).rows[0].id as string);
    const upd = (who: Who, id: string) => as(who, async (c) => (await c.query("update public.step_notes set body = 'Gewijzigd', step = 'decide' where id = $1 returning step", [id])).rows);
    expect(await upd(editor, ofOwner)).toHaveLength(0);
    expect(await upd(editor, mine)).toEqual([{ step: "test" }]);
    expect(await upd(owner, mine)).toHaveLength(1);
    expect(await as(client, async (c) => (await c.query("delete from public.step_notes where id = $1 returning id", [mine])).rows)).toHaveLength(0);
    expect(await as(editor, async (c) => (await c.query("delete from public.step_notes where id = $1 returning id", [ofOwner])).rows)).toHaveLength(0);
    expect(await as(owner, async (c) => (await c.query("delete from public.step_notes where id = $1 returning id", [mine])).rows)).toHaveLength(1);
    const audit = (await db.query("select action from public.audit_events where table_name = 'step_notes' and row_id = $1 order by id", [mine])).rows.map((r) => r.action);
    expect(audit).toEqual(["insert", "update", "update", "delete"]);
  });
});

d("documenten per stap", () => {
  it("rij en object horen bij hetzelfde idee en dezelfde stap", async () => {
    const p = path("market");
    const row = await as(owner, async (c) =>
      (await c.query("insert into public.step_documents (idea_id, step, storage_path, file_name, mime_type, size_bytes) values ($1, 'market', $2, 'Rapport.pdf', 'application/pdf', 1200) returning created_by, author_name", [idea, p])).rows[0],
    );
    expect(row).toEqual({ created_by: owner.id, author_name: "Eva Eigenaar" });
    await expect(
      as(owner, (c) => c.query("insert into public.step_documents (idea_id, step, storage_path, file_name, mime_type, size_bytes) values ($1, 'test', $2, 'x.pdf', 'application/pdf', 10)", [idea, path("market")])),
    ).rejects.toThrow();
    await expect(
      as(owner, (c) => c.query("insert into public.step_documents (idea_id, step, storage_path, file_name, mime_type, size_bytes) values ($1, 'market', $2, 'x.html', 'text/html', 10)", [idea, path("market", "x.html")])),
    ).rejects.toThrow();
    await expect(
      as(owner, (c) => c.query("insert into public.step_documents (idea_id, step, storage_path, file_name, mime_type, size_bytes) values ($1, 'market', $2, 'x.pdf', 'application/pdf', 20971521)", [idea, path("market")])),
    ).rejects.toThrow();
  });

  it("de bucket is privé met een grens van 20 MB", async () => {
    const b = (await db.query("select public, file_size_limit from storage.buckets where id = 'step-documents'")).rows[0];
    expect(b).toEqual({ public: false, file_size_limit: "20971520" });
  });

  it("storage-policies: lezen wie het dossier leest, uploaden wie schrijft, verwijderen de uploader of de eigenaar", async () => {
    const insertObj = (who: Who, name: string) =>
      as(who, (c) => c.query("insert into storage.objects (bucket_id, name, owner, owner_id) values ('step-documents', $1, $2::uuid, $2::text) returning id", [name, who.id]));
    const p = path("decide");
    await insertObj(editor, p);
    await expect(insertObj(client, path("decide"))).rejects.toThrow();
    await expect(insertObj(outsider, path("decide"))).rejects.toThrow();
    // Afwijkend pad: geen idee te herleiden, dus geweigerd.
    await expect(insertObj(owner, `${idea}/market/../${randomUUID()}-x.pdf`)).rejects.toThrow();
    await expect(insertObj(owner, `${idea}/rapport/${randomUUID()}-x.pdf`)).rejects.toThrow();
    const read = (who: Who) => as(who, async (c) => (await c.query("select name from storage.objects where bucket_id = 'step-documents' and name = $1", [p])).rows);
    expect(await read(client)).toHaveLength(1);
    expect(await read(outsider)).toHaveLength(0);
    const del = (who: Who, name: string) => as(who, async (c) => (await c.query("delete from storage.objects where name = $1 returning id", [name])).rows);
    expect(await del(client, p)).toHaveLength(0);
    const p2 = path("decide");
    await insertObj(owner, p2);
    expect(await del(editor, p2)).toHaveLength(0);
    expect(await del(editor, p)).toHaveLength(1);
    expect(await del(owner, p2)).toHaveLength(1);
  });
});
