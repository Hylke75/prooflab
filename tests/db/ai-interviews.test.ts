import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { buildTranscript, type StoredTurn } from "@/lib/domain/ai-interview";

// AI-gemodereerde interviews (supabase/migrations/20261118090000_ai_interviews.sql). Draait tegen een wegwerp-Postgres
// (scripts/test-db.sh); overgeslagen zonder TEST_DATABASE_URL. Er wordt geen model aangeroepen: de tests spelen de
// app-server na met de publieke functies en de ingest-sleutel.
const url = process.env.TEST_DATABASE_URL;
const d = url ? describe : describe.skip;
const MIGRATION = readFileSync(path.join(process.cwd(), "supabase/migrations/20261118090000_ai_interviews.sql"), "utf8");

let db: Client;
// Dossiers van dit bestand: na afloop weg, zodat het idempotentie-test van oudere migraties (die hun eigen, smallere
// controle op source_format opnieuw zetten) niet op AI-interviews uit deze tests stuit.
const ideas: string[] = [];
type U = { id: string; email: string };
type Who = U | "anon";

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

async function user(email: string): Promise<U> {
  const id = randomUUID();
  await db.query("insert into auth.users (id, email, email_confirmed_at) values ($1, $2, now())", [id, email]);
  return { id, email };
}

const KEY = "test-ingest-key";
const GUIDE = [
  "Vertel eens over de laatste keer dat je het rooster van je team regelde.",
  "Hoe pakte je dat toen aan?",
  "Wat kostte dat je, in tijd of geld?",
];
const CONSENT = "Ik weet dat een AI dit gesprek voert en geef toestemming.";
const token = () => createHash("sha256").update(randomBytes(24)).digest("hex");

async function interviewTest(owner: U, o: { org?: string; maxTurns?: number } = {}) {
  return as(owner, async (c) => {
    const org = o.org ?? (await c.query("select public.create_organization('Bureau ' || $1) as id", [owner.email])).rows[0].id;
    const idea = (
      await c.query(
        `insert into public.ideas (org_id, title, decision_question, project_type, description, target_audience, region)
         values ($1, 'ClubPost', 'Investeren we?', 'new_product', 'Beschrijving', 'Sportclubs', 'Nederland') returning id`,
        [org],
      )
    ).rows[0].id as string;
    ideas.push(idea);
    const a = (await c.query("insert into public.assumptions (idea_id, statement, category, importance) values ($1, 'Roosters kosten clubs veel tijd', 'desirability', 5) returning id", [idea])).rows[0].id;
    const h = (
      await c.query(
        `insert into public.hypotheses (idea_id, assumption_id, we_believe, target_group, test_method, metric_label, metric_numerator, metric_denominator,
           success_threshold_pct, min_sample, max_duration_days)
         values ($1, $2, 'Clubs herkennen het probleem', 'Sportclubs', 'interview', 'Probleem herkend', 'herkend', 'gesprekken', 50, 8, 21) returning id`,
        [idea, a],
      )
    ).rows[0].id as string;
    const e = (
      await c.query("insert into public.experiments (idea_id, hypothesis_id, type, title, config) values ($1, $2, 'interview', 'Interviewronde', $3) returning id", [
        idea,
        h,
        JSON.stringify({ guide: GUIDE, screener: "", target_n: 8 }),
      ])
    ).rows[0].id as string;
    const cfg = (
      await c.query(
        `insert into public.ai_interview_configs (experiment_id, idea_id, guide, intro, privacy_contact, max_turns, screener)
         values ($1, $2, $3, 'Bedankt dat je mee wilt doen aan dit korte onderzoek over het regelen van teams.', 'privacy@bureau.nl', $4,
                 '[{"id":"s1","kind":"role","text":"Wat is je rol?","options":[{"label":"Bestuurslid","qualifies":true,"role":"decider"},{"label":"Lid","qualifies":false,"role":"other"}]}]')
         returning id, slug`,
        [e, idea, JSON.stringify(GUIDE), o.maxTurns ?? 16],
      )
    ).rows[0];
    return { org: org as string, idea, e, cfg: cfg.id as string, slug: cfg.slug as string };
  });
}

const setState = (who: U, e: string, ...states: string[]) => as(who, async (c) => {
  for (const s of states) await c.query("update public.experiments set state = $2 where id = $1", [e, s]);
});
const approve = (who: U, cfg: string) => as(who, (c) => c.query("update public.ai_interview_configs set status = 'approved' where id = $1", [cfg]));
const anon = async (sql: string, params: unknown[]) => (await as("anon", (c) => c.query(sql, params))).rows[0]?.r;
const start = (slug: string, visitor: string, hash: string, qualified = true) =>
  anon("select public.ai_interview_start($1, $2, $3, $4, 'linkedin', $5, '{\"s1\":0}'::jsonb, $6, 'decider', null, $7) as r", [KEY, slug, visitor, hash, CONSENT, qualified, `b-${visitor}`]);
const ask = (hash: string, kind: string, text: string, topic = 0, probes = 0, checks: unknown = null) =>
  anon("select public.ai_interview_ask($1, $2, $3, $4, $5, $6, $7) as r", [KEY, hash, kind, text, topic, probes, checks === null ? null : JSON.stringify(checks)]);
const answer = (hash: string, text: string, flags: string[] = [], bucket = `m-${hash.slice(0, 8)}`) =>
  anon("select public.ai_interview_answer($1, $2, $3, $4, '{}'::jsonb, $5) as r", [KEY, hash, text, flags, bucket]);
async function finish(hash: string, reason = "respondent") {
  const s = await anon("select public.ai_interview_state($1, $2) as r", [KEY, hash]);
  const { transcript, segments } = buildTranscript(s.turns as StoredTurn[], s.session.started_at);
  return anon("select public.ai_interview_finish($1, $2, $3, $4, $5, $6) as r", [KEY, hash, reason, transcript, JSON.stringify(segments), JSON.stringify({ labels: [], declined: 0 })]);
}

// Een volledig gesprek: opening, twee antwoorden (met een doorvraag), afronden.
async function conversation(slug: string, visitor: string, answers = ["Via drie appgroepen, en dat kost me elke week een avond.", "Met een gedeelde spreadsheet."]) {
  const hash = token();
  expect((await start(slug, visitor, hash)).status).toBe("ok");
  expect((await ask(hash, "intro", "Welkom, ik ben een AI-interviewer.")).status).toBe("ok");
  expect((await ask(hash, "guide", GUIDE[0])).status).toBe("ok");
  expect((await answer(hash, answers[0])).status).toBe("ok");
  expect((await ask(hash, "probe", "Wat gaat er mis in die appgroepen?", 0, 1, { deterministic: "ok", model: "ok" })).status).toBe("ok");
  if (answers[1]) expect((await answer(hash, answers[1])).status).toBe("ok");
  return hash;
}

d("AI-gemodereerde interviews", () => {
  let alice: U;
  let klant: U;
  let eve: U;

  beforeAll(async () => {
    db = new Client({ connectionString: url });
    await db.connect();
    await db.query("insert into public.ingest_keys (key_hash) values ($1) on conflict do nothing", [createHash("sha256").update(KEY).digest("hex")]);
    alice = await user(`alice-${randomUUID()}@example.com`);
    klant = await user(`klant-${randomUUID()}@example.com`);
    eve = await user(`eve-${randomUUID()}@example.com`);
  });
  afterAll(async () => {
    await db?.query("delete from public.ideas where id = any($1)", [ideas]);
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

  it("opzet: alleen bij een interviewtest, goedkeuren na de Test Card met precies haar leidraad, daarna vergrendeld", async () => {
    const t = await interviewTest(alice);
    // Test Card nog concept: goedkeuren kan niet.
    await expect(approve(alice, t.cfg)).rejects.toThrow(/AI_CONFIG_TEST/);
    await setState(alice, t.e, "ready_for_review", "approved");
    // Een leidraad die afwijkt van de Test Card wordt niet goedgekeurd.
    await as(alice, (c) => c.query("update public.ai_interview_configs set guide = $2 where id = $1", [t.cfg, JSON.stringify([...GUIDE.slice(0, 2), "Iets anders?"])]));
    await expect(approve(alice, t.cfg)).rejects.toThrow(/AI_CONFIG_GUIDE/);
    await as(alice, (c) => c.query("update public.ai_interview_configs set guide = $2 where id = $1", [t.cfg, JSON.stringify(GUIDE)]));
    await approve(alice, t.cfg);
    const row = (await db.query("select status, approved_by, approved_at from public.ai_interview_configs where id = $1", [t.cfg])).rows[0];
    expect(row).toMatchObject({ status: "approved", approved_by: alice.id });
    // Vergrendeld: alleen pauzeren of hervatten.
    await expect(as(alice, (c) => c.query("update public.ai_interview_configs set max_turns = 30 where id = $1", [t.cfg]))).rejects.toThrow(/AI_CONFIG_LOCKED/);
    await as(alice, (c) => c.query("update public.ai_interview_configs set paused = true where id = $1", [t.cfg]));
    await as(alice, (c) => c.query("update public.ai_interview_configs set paused = false where id = $1", [t.cfg]));
    // Intrekken kan zolang er geen gesprekken zijn.
    await as(alice, (c) => c.query("update public.ai_interview_configs set status = 'draft' where id = $1", [t.cfg]));
    expect((await db.query("select approved_at from public.ai_interview_configs where id = $1", [t.cfg])).rows[0].approved_at).toBeNull();
    // Een landingstest krijgt geen AI-interviewer.
    const land = await as(alice, async (c) => {
      const h = (await c.query("select hypothesis_id from public.experiments where id = $1", [t.e])).rows[0].hypothesis_id;
      return (await c.query("insert into public.experiments (idea_id, hypothesis_id, type, title, config) values ($1, $2, 'landing', 'L', '{}') returning id", [t.idea, h])).rows[0].id;
    });
    await expect(
      as(alice, (c) => c.query("insert into public.ai_interview_configs (experiment_id, idea_id, guide, intro, privacy_contact) values ($1, $2, $3, $4, 'a@b.nl')", [land, t.idea, JSON.stringify(GUIDE), "x".repeat(50)])),
    ).rejects.toThrow(/AI_CONFIG_TYPE/);
  });

  it("RLS: alleen het onderzoeksteam leest opzet, gesprekken en beurten; anon niets", async () => {
    const t = await interviewTest(alice);
    await setState(alice, t.e, "ready_for_review", "approved", "live");
    await approve(alice, t.cfg);
    await conversation(t.slug, "rls-visitor-1");
    await as(alice, (c) => c.query("insert into public.idea_members (idea_id, email, role) values ($1, $2, 'client_viewer')", [t.idea, klant.email]));
    await as(klant, (c) => c.query("select public.claim_invitations()"));
    for (const who of [klant, eve]) {
      for (const tbl of ["ai_interview_configs", "ai_interview_sessions", "ai_interview_turns"]) {
        expect((await as(who, (c) => c.query(`select * from public.${tbl} where idea_id = $1`, [t.idea]))).rows).toHaveLength(0);
      }
    }
    expect((await as(alice, (c) => c.query("select * from public.ai_interview_turns where idea_id = $1", [t.idea]))).rows.length).toBeGreaterThan(0);
    for (const tbl of ["ai_interview_configs", "ai_interview_sessions", "ai_interview_turns"]) {
      await expect(as("anon", (c) => c.query(`select * from public.${tbl}`))).rejects.toThrow(/permission denied/);
    }
    // Het team schrijft geen beurten of gesprekken zelf; een opdrachtgever wijzigt de opzet niet.
    await expect(as(alice, (c) => c.query("insert into public.ai_interview_turns (session_id, idea_id, seq, role, kind, text) select id, idea_id, 99, 'respondent', 'answer', 'x' from public.ai_interview_sessions limit 1"))).rejects.toThrow(/permission denied/);
    await expect(as(alice, (c) => c.query("update public.ai_interview_sessions set answers = 0 where idea_id = $1", [t.idea]))).rejects.toThrow(/permission denied/);
    expect((await as(klant, (c) => c.query("update public.ai_interview_configs set paused = true where id = $1 returning id", [t.cfg]))).rows).toHaveLength(0);
  });

  it("publieke functies alleen met de ingest-sleutel", async () => {
    const t = await interviewTest(alice);
    await expect(anon("select public.ai_interview_public('fout', $1) as r", [t.slug])).rejects.toThrow(/FORBIDDEN/);
    await expect(anon("select public.ai_interview_start('fout', $1, 'v-1234567', $2, 'direct', $3, '{}'::jsonb, true, 'user', null, 'b') as r", [t.slug, token(), CONSENT])).rejects.toThrow(/FORBIDDEN/);
    await expect(anon("select public.ai_interview_state('fout', $1) as r", [token()])).rejects.toThrow(/FORBIDDEN/);
    await expect(anon("select public.ai_interview_answer('fout', $1, 'x', '{}', '{}'::jsonb, 'b') as r", [token()])).rejects.toThrow(/FORBIDDEN/);
    await expect(anon("select public.ai_interview_ask('fout', $1, 'intro', 'x', 0, 0, null) as r", [token()])).rejects.toThrow(/FORBIDDEN/);
    await expect(anon("select public.ai_interview_log_run('fout', $1, 'ai_interview_probe', 'anthropic', 'm', 'v', 1, 1, 0.01, 'ok', null) as r", [token()])).rejects.toThrow(/FORBIDDEN/);
    // Het team kan de interne functie niet zelf aanroepen.
    await expect(as(alice, (c) => c.query("select public.ai_interview_materialize(gen_random_uuid(), 'x', '[]'::jsonb, '{}'::jsonb)"))).rejects.toThrow(/permission denied/);
  });

  it("beschikbaarheid, één gesprek per bezoeker, screener en de volgorde van de beurten", async () => {
    const t = await interviewTest(alice);
    expect(await anon("select public.ai_interview_public($1, $2) as r", [KEY, t.slug])).toBeNull(); // niet goedgekeurd
    await setState(alice, t.e, "ready_for_review", "approved");
    await approve(alice, t.cfg);
    expect((await anon("select public.ai_interview_public($1, $2) as r", [KEY, t.slug])).state).toBe("preview");
    expect((await start(t.slug, "visitor-pre", token())).status).toBe("closed");
    await setState(alice, t.e, "live");
    const pub = await anon("select public.ai_interview_public($1, $2) as r", [KEY, t.slug]);
    expect(pub).toMatchObject({ state: "available", max_turns: 16, retention_months: 12 });
    // Zonder toestemmingstekst geen gesprek.
    expect((await anon("select public.ai_interview_start($1, $2, 'v-noconsent', $3, 'direct', '', '{}'::jsonb, true, 'user', null, 'b-nc') as r", [KEY, t.slug, token()])).status).toBe("consent");
    // Buiten de doelgroep: bedankt, geen gesprek, telt niet mee.
    const out = token();
    expect((await start(t.slug, "visitor-out", out, false)).status).toBe("screened_out");
    expect((await ask(out, "intro", "Welkom")).status).toBe("ended");
    expect((await start(t.slug, "visitor-out", token())).status).toBe("duplicate");
    // In de doelgroep: opening, dan om en om.
    const h = token();
    expect((await start(t.slug, "visitor-in", h)).status).toBe("ok");
    expect((await answer(h, "te vroeg")).status).toBe("busy");
    expect((await ask(h, "guide", GUIDE[0])).status).toBe("busy"); // eerst de introductie
    expect((await ask(h, "intro", "Welkom")).status).toBe("ok");
    expect((await ask(h, "guide", "Een eigen vraag?")).status).toBe("invalid"); // leidraad letterlijk
    expect((await ask(h, "guide", GUIDE[0])).status).toBe("ok");
    expect((await ask(h, "probe", "Nog een vraag?", 0, 1)).status).toBe("busy");
    expect((await answer(h, "Via appgroepen.")).status).toBe("ok");
    expect((await answer(h, "Nog een antwoord")).status).toBe("busy");
    expect((await ask(h, "probe", "Wat ging er mis?", 0, 3)).status).toBe("invalid"); // hooguit max_probes
    expect((await ask(h, "probe", "Wat ging er mis?", 0, 1)).status).toBe("ok");
    const s = (await db.query("select status, dmu_role, answers, topic_index, probes_used, channel, consent_text from public.ai_interview_sessions where token_hash = $1", [h])).rows[0];
    expect(s).toMatchObject({ status: "active", dmu_role: "decider", answers: 1, topic_index: 0, probes_used: 1, channel: "linkedin", consent_text: CONSENT });
    // Gepauzeerd: geen nieuwe antwoorden.
    await as(alice, (c) => c.query("update public.ai_interview_configs set paused = true where id = $1", [t.cfg]));
    expect((await answer(h, "Nog iets")).status).toBe("closed");
    expect((await start(t.slug, "visitor-late", token())).status).toBe("closed");
  });

  it("harde grenzen: maximum aantal antwoorden, maximale duur en rate limit", async () => {
    const t = await interviewTest(alice, { maxTurns: 4 });
    await setState(alice, t.e, "ready_for_review", "approved", "live");
    await approve(alice, t.cfg);
    const h = token();
    await start(t.slug, "limit-visitor", h);
    await ask(h, "intro", "Welkom");
    await ask(h, "guide", GUIDE[0]);
    for (let i = 0; i < 4; i++) {
      expect((await answer(h, `Antwoord ${i}`)).status).toBe("ok");
      await ask(h, "probe", "Wat deed je toen?", 0, Math.min(i + 1, 2));
    }
    expect((await answer(h, "Nog een")).status).toBe("limit");
    // Te lang bezig (max_minutes 20, met 2 minuten marge).
    const h2 = token();
    await start(t.slug, "duration-visitor", h2);
    await ask(h2, "intro", "Welkom");
    await ask(h2, "guide", GUIDE[0]);
    await db.query("update public.ai_interview_sessions set started_at = now() - interval '25 minutes' where token_hash = $1", [h2]);
    expect((await answer(h2, "Laat antwoord")).status).toBe("expired");
    // Rate limit: hooguit 5 starts per minuut per netwerk.
    const bucket = `rate-${randomUUID()}`;
    const statuses: string[] = [];
    for (let i = 0; i < 6; i++) {
      statuses.push((await anon("select public.ai_interview_start($1, $2, $3, $4, 'direct', $5, '{}'::jsonb, true, 'user', null, $6) as r", [KEY, t.slug, `rate-v-${i}-${bucket}`, token(), CONSENT, bucket])).status);
    }
    expect(statuses.slice(0, 5).every((s) => s === "ok")).toBe(true);
    expect(statuses[5]).toBe("rate");
  });

  it("afronden: een AI-gemodereerd interview van de test; alleen respondentcitaten; nooit via een gewone insert", async () => {
    const t = await interviewTest(alice);
    await setState(alice, t.e, "ready_for_review", "approved", "live");
    await approve(alice, t.cfg);
    const h = await conversation(t.slug, "finish-visitor");
    expect(await finish(h)).toMatchObject({ status: "ok", interview: true });
    const s = (await db.query("select * from public.ai_interview_sessions where token_hash = $1", [h])).rows[0];
    expect(s).toMatchObject({ status: "completed", end_reason: "respondent" });
    const iv = (await as(alice, (c) => c.query("select * from public.interviews where id = $1", [s.interview_id]))).rows[0];
    expect(iv).toMatchObject({ ai_moderated: true, source_format: "ai_chat", consent_recorded: true, is_practice: false, experiment_id: t.e, dmu_role: "decider", recruited_via: "linkedin" });
    expect(iv.participant_label).toMatch(/^AI-interview [0-9A-F]{4}-[0-9A-F]{4}$/);
    expect(iv.pseudonymized_at).not.toBeNull();
    expect(iv.transcript).toMatch(/\] Respondent: Via drie appgroepen/);
    expect(iv.retention_until.toISOString().slice(0, 10)).toBe(s.retention_until.toISOString().slice(0, 10));
    // Twee keer afronden doet niets meer.
    expect((await finish(h)).status).toBe("ended");
    const segs = iv.segments as { s: string; a: number; b: number }[];
    const resp = segs.find((x) => x.s === "Respondent")!;
    const q = segs.find((x) => x.s === "AI-interviewer" && iv.transcript.slice(x.a, x.b).includes("appgroepen"))!;
    const insertObs = (start: number | null, end: number | null, quote: string) =>
      as(alice, (c) =>
        c.query(
          `insert into public.observations (idea_id, experiment_id, interview_id, kind, summary, quote, quote_check, quote_start, quote_end, origin)
           values ($1, $2, $3, 'problem_confirmed', 'Kost een avond per week', $4, 'exact', $5, $6, 'manual') returning ai_moderated`,
          [t.idea, t.e, s.interview_id, quote, start, end],
        ),
      );
    // Uit een antwoord van de respondent: mag, en is gemarkeerd.
    const ok = await insertObs(resp.a, resp.b, iv.transcript.slice(resp.a, resp.b));
    expect(ok.rows[0].ai_moderated).toBe(true);
    // Uit een vraag van de AI: nooit.
    await expect(insertObs(q.a, q.b, iv.transcript.slice(q.a, q.b))).rejects.toThrow(/AI_QUOTE_RESPONDENT/);
    await expect(insertObs(null, null, "Via drie appgroepen")).rejects.toThrow(/AI_QUOTE_POSITION/);
    // De markering en de rollen liggen vast.
    await expect(as(alice, (c) => c.query("update public.interviews set source_format = 'paste', ai_moderated = false where id = $1", [s.interview_id]))).rejects.toThrow(/LOCKED/);
    // Een gebruiker maakt geen AI-interview na.
    await expect(
      as(alice, (c) =>
        c.query(
          `insert into public.interviews (experiment_id, idea_id, participant_label, dmu_role, recruited_via, held_on, record_type, transcript, consent_recorded, source_format, ai_moderated)
           values ($1, $2, 'Nep', 'user', 'linkedin', current_date, 'transcript', 'Nep transcript dat lang genoeg is.', true, 'ai_chat', true)`,
          [t.e, t.idea],
        ),
      ),
    ).rejects.toThrow(/AI_INTERVIEW_INSERT/);
    // Een gesprek zonder antwoorden wordt geen interview.
    const empty = token();
    await start(t.slug, "finish-empty", empty);
    await ask(empty, "intro", "Welkom");
    expect(await finish(empty)).toMatchObject({ status: "ok", interview: false });
  });

  it("uitsluiten met reden en weer opnemen; alleen het team", async () => {
    const t = await interviewTest(alice);
    await setState(alice, t.e, "ready_for_review", "approved", "live");
    await approve(alice, t.cfg);
    const h = await conversation(t.slug, "exclude-visitor");
    await finish(h);
    const s = (await db.query("select id, interview_id from public.ai_interview_sessions where token_hash = $1", [h])).rows[0];
    await expect(as(eve, (c) => c.query("select public.ai_interview_exclude($1, 'Antwoorden lijken gegenereerd')", [s.id]))).rejects.toThrow(/FORBIDDEN/);
    await expect(as(alice, (c) => c.query("select public.ai_interview_exclude($1, 'kort')", [s.id]))).rejects.toThrow(/EXCLUSION_REASON/);
    await as(alice, (c) => c.query("select public.ai_interview_exclude($1, 'Antwoorden lijken gegenereerd')", [s.id]));
    expect((await db.query("select count(*)::int as n from public.interviews where id = $1", [s.interview_id])).rows[0].n).toBe(0);
    const after = (await db.query("select excluded_at, exclusion_reason, interview_id from public.ai_interview_sessions where id = $1", [s.id])).rows[0];
    expect(after).toMatchObject({ exclusion_reason: "Antwoorden lijken gegenereerd", interview_id: null });
    // Weer opnemen: het transcript komt opnieuw uit de beurten.
    const turns = (await as(alice, (c) => c.query("select seq, role, kind, text, created_at from public.ai_interview_turns where session_id = $1 order by seq", [s.id]))).rows;
    const started = (await db.query("select started_at from public.ai_interview_sessions where id = $1", [s.id])).rows[0].started_at.toISOString();
    const { transcript, segments } = buildTranscript(turns.map((x) => ({ ...x, created_at: x.created_at.toISOString() })), started);
    await expect(as(alice, (c) => c.query("select public.ai_interview_include($1, $2, '[]'::jsonb, '{}'::jsonb)", [s.id, transcript]))).rejects.toThrow(/AI_TRANSCRIPT/);
    const back = (await as(alice, (c) => c.query("select public.ai_interview_include($1, $2, $3, '{}'::jsonb) as id", [s.id, transcript, JSON.stringify(segments)]))).rows[0].id;
    expect((await db.query("select ai_moderated from public.interviews where id = $1", [back])).rows[0].ai_moderated).toBe(true);
    expect((await db.query("select excluded_at from public.ai_interview_sessions where id = $1", [s.id])).rows[0].excluded_at).toBeNull();
  });

  it("AI-kosten in het grootboek en het maandbudget, zonder tekst", async () => {
    const t = await interviewTest(alice);
    await setState(alice, t.e, "ready_for_review", "approved", "live");
    await approve(alice, t.cfg);
    const h = await conversation(t.slug, "cost-visitor");
    const before = Number((await as(alice, (c) => c.query("select * from public.org_ai_spend($1)", [t.idea]))).rows[0].spent);
    expect(await anon("select public.ai_interview_log_run($1, $2, 'ai_interview_probe', 'anthropic', 'claude-x', 'v1', 120, 30, 0.0123, 'ok', null) as r", [KEY, h])).toBe(true);
    expect(await anon("select public.ai_interview_log_run($1, $2, 'iets_anders', 'anthropic', 'claude-x', 'v1', 1, 1, 0.01, 'ok', null) as r", [KEY, h])).toBe(false);
    const after = Number((await as(alice, (c) => c.query("select * from public.org_ai_spend($1)", [t.idea]))).rows[0].spent);
    expect(after - before).toBeCloseTo(0.0123, 4);
    const run = (await db.query("select purpose, provider, created_by, idea_id from public.ai_runs where idea_id = $1 and purpose = 'ai_interview_probe'", [t.idea])).rows[0];
    expect(run).toMatchObject({ purpose: "ai_interview_probe", provider: "anthropic", created_by: null, idea_id: t.idea });
    expect(Number((await db.query("select cost_usd from public.ai_interview_sessions where token_hash = $1", [h])).rows[0].cost_usd)).toBeCloseTo(0.0123, 4);
    const budget = await anon("select public.ai_interview_public($1, $2) as r", [KEY, t.slug]);
    expect(Number(budget.budget.spent)).toBeGreaterThan(0);
  });

  it("opschoning, afgebroken gesprekken, auditspoor zonder tekst en privacyverzoeken", async () => {
    const t = await interviewTest(alice);
    await setState(alice, t.e, "ready_for_review", "approved", "live");
    await approve(alice, t.cfg);
    const secret = "Mijn adres staat nergens maar dit is een herkenbare zin 7319.";
    const h = await conversation(t.slug, "purge-visitor", [secret, "contact via jan.jansen@voorbeeld.nl"]);
    // Een vergeten gesprek: na een uur zonder activiteit afgebroken.
    const stale = token();
    await start(t.slug, "stale-visitor", stale);
    await ask(stale, "intro", "Welkom");
    await db.query("update public.ai_interview_sessions set last_activity_at = now() - interval '2 hours' where token_hash = $1", [stale]);
    // Privacyverzoek: een getypt adres wordt gevonden (de app vervangt het normaal al vóór opslag).
    const dsr = (await as(alice, (c) => c.query("select public.dsr_search($1, 'jan.jansen@voorbeeld.nl', '{}') as r", [t.org]))).rows[0].r;
    expect(dsr.ai_interviews).toHaveLength(1);
    expect(dsr.ai_interviews[0].code).toMatch(/^[0-9A-F]{4}-[0-9A-F]{4}$/);
    await finish(h);
    await db.query("update public.ai_interview_sessions set retention_until = current_date - 1 where token_hash = $1", [h]);
    await db.query("update public.interviews set retention_until = current_date - 1 where id = (select interview_id from public.ai_interview_sessions where token_hash = $1)", [h]);
    await db.query("select public.purge_expired_personal_data()");
    const texts = (await db.query("select t.text from public.ai_interview_turns t join public.ai_interview_sessions s on s.id = t.session_id where s.token_hash = $1", [h])).rows.map((r) => r.text);
    expect(new Set(texts)).toEqual(new Set(["[verwijderd na afloop van de bewaartermijn]"]));
    const iv = (await db.query("select i.transcript from public.interviews i join public.ai_interview_sessions s on s.interview_id = i.id where s.token_hash = $1", [h])).rows[0];
    expect(iv.transcript).toBe("[verwijderd na afloop van de bewaartermijn]");
    expect((await db.query("select status, end_reason from public.ai_interview_sessions where token_hash = $1", [stale])).rows[0]).toMatchObject({ status: "abandoned", end_reason: "inactive" });
    // In het auditspoor staat geen tekst van de respondent.
    const audit = JSON.stringify((await db.query("select detail from public.audit_events where idea_id = $1 or org_id = $2", [t.idea, t.org])).rows);
    expect(audit).not.toContain("7319");
    expect(audit).not.toContain("jan.jansen@voorbeeld.nl");
    expect(audit).toContain("\"status\":\"completed\"");
  });

  it("verwijderen op verzoek; de opzet blijft zolang er gesprekken zijn, behalve als de test verdwijnt", async () => {
    const t = await interviewTest(alice);
    await setState(alice, t.e, "ready_for_review", "approved", "live");
    await approve(alice, t.cfg);
    const h = await conversation(t.slug, "delete-visitor");
    await finish(h);
    await expect(as(alice, (c) => c.query("update public.ai_interview_configs set status = 'draft' where id = $1", [t.cfg]))).rejects.toThrow(/AI_CONFIG_IN_USE/);
    await expect(as(alice, (c) => c.query("delete from public.ai_interview_configs where id = $1", [t.cfg]))).rejects.toThrow(/AI_CONFIG_IN_USE/);
    const s = (await db.query("select id, interview_id from public.ai_interview_sessions where token_hash = $1", [h])).rows[0];
    await expect(as(klant, (c) => c.query("select public.ai_interview_delete($1)", [s.id]))).rejects.toThrow(/FORBIDDEN/);
    await as(alice, (c) => c.query("select public.ai_interview_delete($1)", [s.id]));
    expect((await db.query("select count(*)::int as n from public.ai_interview_turns where session_id = $1", [s.id])).rows[0].n).toBe(0);
    expect((await db.query("select count(*)::int as n from public.interviews where id = $1", [s.interview_id])).rows[0].n).toBe(0);
    // Het dossier verwijderen neemt alles mee (cascade), ook met gesprekken.
    await conversation(t.slug, "delete-visitor-2");
    await as(alice, (c) => c.query("delete from public.ideas where id = $1", [t.idea]));
    expect((await db.query("select count(*)::int as n from public.ai_interview_configs where id = $1", [t.cfg])).rows[0].n).toBe(0);
  });
});
