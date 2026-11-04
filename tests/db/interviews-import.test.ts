import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import { randomUUID, createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

// Fase 1 · punt 3: interviews importeren (supabase/migrations/20261115090000_interviews_import.sql). Draait tegen een
// wegwerp-Postgres (scripts/test-db.sh); overgeslagen zonder TEST_DATABASE_URL.
const url = process.env.TEST_DATABASE_URL;
const d = url ? describe : describe.skip;
const MIGRATION = readFileSync(path.join(process.cwd(), "supabase/migrations/20261115090000_interviews_import.sql"), "utf8");

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

async function interviewTest(owner: U, idea: string) {
  return as(owner, async (c) => {
    const a = (await c.query("insert into public.assumptions (idea_id, statement, category, importance) values ($1, 'Clubs verliezen tijd aan communicatie', 'desirability', 5) returning id", [idea])).rows[0].id as string;
    const h = (
      await c.query(
        `insert into public.hypotheses (idea_id, assumption_id, we_believe, target_group, test_method, metric_label,
           metric_numerator, metric_denominator, success_threshold_pct, fail_threshold_pct, min_sample, max_duration_days)
         values ($1, $2, 'Bestuurders herkennen het probleem', 'Sportclubs', 'interviews', 'herkend', 'geïnterviewden die het herkennen', 'geïnterviewden', 50, null, 5, 21) returning id`,
        [idea, a],
      )
    ).rows[0].id as string;
    const e = (await c.query("insert into public.experiments (idea_id, hypothesis_id, type, title, recruitment_group) values ($1, $2, 'interview', 'Interviews', 'warm') returning id", [idea, h])).rows[0].id as string;
    return { assumption: a, experiment: e };
  });
}

const hash = (s: string) => createHash("sha256").update(s).digest("hex");
const TRANSCRIPT = "[00:00:01] Spreker A: Hoe communiceren jullie nu?\n[00:00:05] Spreker B: Via de app van Club 1, dat kost ons elke week twee uur.";

async function importInterview(
  owner: U,
  idea: string,
  opts: { experiment?: string | null; practice?: boolean | null; consent?: boolean; role?: string; group?: string | null; known?: boolean; source?: string; heldOn?: string } = {},
) {
  return as(owner, async (c) =>
    (
      await c.query(
        `insert into public.interviews (experiment_id, idea_id, participant_label, dmu_role, recruited_via, held_on, record_type, transcript,
           consent_recorded, is_practice, recruitment_group, is_acquaintance, source_format, source_hash, segments, pseudonymized_at, pseudonym_labels)
         values ($1, $2, 'Deelnemer', $3, 'network', $4::date, 'transcript', $5, $6, $7, $8, $9, 'vtt', $10,
           '[{"s":"Spreker A","t0":1000,"t1":5000,"a":22,"b":47},{"s":"Spreker B","t0":5000,"t1":null,"a":71,"b":125}]'::jsonb,
           now(), '{"labels":[{"label":"Spreker A","kind":"speaker","count":1}],"declined":0}'::jsonb)
         returning id, retention_until, pseudonymized_by`,
        [
          opts.experiment ?? null,
          idea,
          opts.role ?? "user",
          opts.heldOn ?? "2026-10-01",
          TRANSCRIPT,
          opts.consent ?? true,
          opts.practice === undefined ? false : opts.practice,
          opts.group ?? null,
          opts.known ?? false,
          hash(opts.source ?? randomUUID()),
        ],
      )
    ).rows[0] as { id: string; retention_until: Date; pseudonymized_by: string },
  );
}

d("fase 1 · punt 3: interviews importeren in de database", () => {
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

  it("is idempotent", async () => {
    await db.query("begin");
    try {
      await db.query(MIGRATION.replace(/^begin;|commit;\s*$/gm, ""));
      await db.query(MIGRATION.replace(/^begin;|commit;\s*$/gm, ""));
    } finally {
      await db.query("rollback");
    }
  });

  it("import: pseudonimisering gestempeld, bewaartermijn vanaf de gespreksdatum, dubbele import geweigerd", async () => {
    const t = await interviewTest(owner, A.idea);
    const iv = await importInterview(owner, A.idea, { experiment: t.experiment, source: "gesprek-1", heldOn: "2026-03-10" });
    expect(iv.pseudonymized_by).toBe(owner.id);
    expect(new Date(iv.retention_until).toISOString().slice(0, 10)).toBe("2027-03-10");
    await expect(importInterview(owner, A.idea, { experiment: t.experiment, source: "gesprek-1" })).rejects.toThrow(/interviews_source_hash_uniq/);
    // Ook als verkennend interview niet nog een keer.
    await expect(importInterview(owner, A.idea, { source: "gesprek-1" })).rejects.toThrow(/interviews_source_hash_uniq/);
    const audit = (await db.query("select detail from public.audit_events where row_id = $1 and action = 'import'", [iv.id])).rows[0];
    expect(audit.detail).toMatchObject({ source_format: "vtt", segments: 2, pseudonymized: true, exploratory: false });
    expect(JSON.stringify(audit.detail)).not.toMatch(/Club 1, dat kost/);
    await expect(
      as(owner, (c) => c.query("update public.interviews set source_format = 'srt' where id = $1", [iv.id])),
    ).rejects.toThrow(/INTERVIEW_LOCKED/);
  });

  it("auditspoor: een kort transcript en een vervangen naam komen er alleen als md5 in", async () => {
    const t = await interviewTest(owner, A.idea);
    const iv = await importInterview(owner, A.idea, { experiment: t.experiment, source: "gesprek-audit" });
    // "Een gemiste naam vervangen": korter dan 300 tekens, dus vroeger letterlijk in het spoor.
    await as(owner, (c) => c.query("update public.interviews set transcript = replace(transcript, 'Club 1', 'Club 2') where id = $1", [iv.id]));
    const rows = (await db.query("select detail from public.audit_events where row_id = $1 and action = 'update'", [iv.id])).rows;
    const change = rows.map((r) => r.detail?.changes?.transcript).find(Boolean);
    expect(change).toBeTruthy();
    expect(String(change.old)).toMatch(/^md5:/);
    expect(String(change.new)).toMatch(/^md5:/);
    expect(JSON.stringify(rows)).not.toMatch(/Club 1|Club 2/);
  });

  it("betaler los van inkoper; een onbekende rol weigert de database", async () => {
    const iv = await importInterview(owner, A.idea, { role: "payer" });
    expect(iv.id).toBeTruthy();
    await expect(importInterview(owner, A.idea, { role: "sponsor" })).rejects.toThrow(/interviews_dmu_role_check/);
  });

  it("verkennend interview: geen koppeling aan een aanname, en nooit achteraf in een test", async () => {
    const t = await interviewTest(owner, A.idea);
    const iv = await importInterview(owner, A.idea);
    const obs = await as(owner, async (c) =>
      (await c.query("insert into public.observations (idea_id, interview_id, kind, summary, quote, quote_start, quote_end, segment_index) values ($1, $2, 'problem_confirmed', 'Twee uur per week', 'dat kost ons elke week twee uur', 94, 125, 1) returning id", [A.idea, iv.id])).rows[0].id as string,
    );
    await expect(
      as(owner, (c) => c.query("insert into public.assumption_observations (assumption_id, observation_id, idea_id, relation) values ($1, $2, $3, 'supports')", [t.assumption, obs, A.idea])),
    ).rejects.toThrow(/EXPLORATORY_INTERVIEW/);
    await expect(as(owner, (c) => c.query("update public.interviews set experiment_id = $2 where id = $1", [iv.id, t.experiment]))).rejects.toThrow(/INTERVIEW_LOCKED/);
  });

  it("citaatposities: einde na begin; na markeren verandert het transcript niet meer", async () => {
    const t = await interviewTest(owner, A.idea);
    const iv = await importInterview(owner, A.idea, { experiment: t.experiment });
    // Vóór het markeren mag een extra naam nog worden vervangen.
    await as(owner, (c) => c.query("update public.interviews set transcript = replace(transcript, 'Club 1', 'Club 2') where id = $1", [iv.id]));
    await expect(
      as(owner, (c) => c.query("insert into public.observations (idea_id, experiment_id, interview_id, kind, summary, quote, quote_start, quote_end) values ($1, $2, $3, 'other', 'x', 'y', 10, 10)", [A.idea, t.experiment, iv.id])),
    ).rejects.toThrow(/observations_quote_position_check/);
    const o = await as(owner, async (c) =>
      (await c.query("insert into public.observations (idea_id, experiment_id, interview_id, kind, summary, quote, quote_start, quote_end, segment_index) values ($1, $2, $3, 'problem_confirmed', 'x', 'elke week twee uur', 100, 118, 1) returning id", [A.idea, t.experiment, iv.id])).rows[0].id as string,
    );
    await as(owner, (c) => c.query("insert into public.assumption_observations (assumption_id, observation_id, idea_id, relation) values ($1, $2, $3, 'supports')", [t.assumption, o, A.idea]));
    await expect(as(owner, (c) => c.query("update public.interviews set transcript = transcript || ' Persoon 3' where id = $1", [iv.id]))).rejects.toThrow(/INTERVIEW_MARKED/);
    // Een handmatige observatie wordt nooit herschreven (geen update-policy): de positie blijft staan.
    expect((await as(owner, (c) => c.query("update public.observations set quote_start = 0 where id = $1", [o]))).rowCount).toBe(0);
    expect((await db.query("select quote_start from public.observations where id = $1", [o])).rows[0].quote_start).toBe(100);
  });

  it("thema-citaten tellen nergens mee: geen koppeling aan een aanname en niet in observations_for_idea", async () => {
    const t = await interviewTest(owner, A.idea);
    const iv = await importInterview(owner, A.idea, { experiment: t.experiment });
    const o = await as(owner, async (c) =>
      (await c.query("insert into public.observations (idea_id, experiment_id, interview_id, kind, summary, quote, origin, theme_only) values ($1, $2, $3, 'other', 'Tijdverlies', 'elke week twee uur', 'ai', true) returning id", [A.idea, t.experiment, iv.id])).rows[0].id as string,
    );
    await expect(
      as(owner, (c) => c.query("insert into public.assumption_observations (assumption_id, observation_id, idea_id, relation) values ($1, $2, $3, 'supports')", [t.assumption, o, A.idea])),
    ).rejects.toThrow(/THEME_ONLY/);
    const visible = await as(owner, async (c) => (await c.query("select id from public.observations_for_idea($1)", [A.idea])).rows.map((r) => r.id));
    expect(visible).not.toContain(o);
    await expect(
      as(owner, (c) => c.query("insert into public.observations (idea_id, interview_id, kind, summary, theme_only) values ($1, $2, 'problem_confirmed', 'x', true)", [A.idea, iv.id])),
    ).rejects.toThrow(/observations_theme_only_check/);
  });

  it("thema's: AI-voorstel één keer beoordeeld, toewijzingen alleen beoordeeld; X van N zonder oefeningen, voor de opdrachtgever zonder citaten", async () => {
    const B = await newIdea(owner);
    const t = await interviewTest(owner, B.idea);
    const real1 = await importInterview(owner, B.idea, { experiment: t.experiment, role: "payer", group: "cold" });
    const real2 = await importInterview(owner, B.idea, { experiment: t.experiment, role: "user", known: true });
    const real3 = await importInterview(owner, B.idea, { role: "user" }); // verkennend
    const practice = await importInterview(owner, B.idea, { experiment: t.experiment, practice: true, consent: false });
    await importInterview(owner, B.idea, { experiment: t.experiment, consent: false }); // zonder toestemming: buiten N

    const ids = await as(owner, async (c) => {
      const code = async (label: string, origin: string) => (await c.query("insert into public.interview_codes (idea_id, label, origin, status) values ($1, $2, $3, 'accepted') returning id, status", [B.idea, label, origin])).rows[0];
      const manual = await code("Tijdverlies door appgroepen", "manual");
      const ai = await code("Zorgen over privacy", "ai");
      const obs = async (iv: string, exp: string | null) =>
        (await c.query("insert into public.observations (idea_id, experiment_id, interview_id, kind, summary) values ($1, $2, $3, 'other', 'x') returning id", [B.idea, exp, iv])).rows[0].id as string;
      const o1 = await obs(real1.id, t.experiment);
      const o2 = await obs(real2.id, t.experiment);
      const o3 = await obs(real3.id, null);
      const op = await obs(practice.id, t.experiment);
      const assign = (o: string, code: string, origin: string) => c.query("insert into public.observation_codes (observation_id, code_id, idea_id, origin, review_status) values ($1, $2, $3, $4, 'accepted')", [o, code, B.idea, origin]);
      await assign(o1, manual.id, "manual");
      await assign(o3, manual.id, "manual");
      await assign(op, manual.id, "manual");
      await assign(o2, ai.id, "ai");
      return { manual: manual as { id: string; status: string }, ai: ai as { id: string; status: string }, o1, o2 };
    });
    // De database zet de status: een AI-thema begint als voorstel, ook als de app iets anders stuurt.
    expect(ids.manual.status).toBe("accepted");
    expect(ids.ai.status).toBe("proposed");

    const counts = async (who: U) =>
      (await as(who, async (c) => (await c.query("select * from public.interview_theme_counts($1)", [B.idea])).rows)) as {
        item_type: string;
        item_id: string;
        dimension: string;
        bucket: string;
        mentioned: string;
        total: string;
      }[];
    const pick = (rows: Awaited<ReturnType<typeof counts>>, id: string, dim = "all", bucket = "all") => {
      const r = rows.find((x) => x.item_id === id && x.dimension === dim && x.bucket === bucket);
      return r ? [Number(r.mentioned), Number(r.total)] : null;
    };
    let rows = await counts(owner);
    // N = drie echte gesprekken met toestemming (ook het verkennende), zonder de oefening en zonder toestemming.
    expect(pick(rows, ids.manual.id)).toEqual([2, 3]);
    expect(pick(rows, ids.manual.id, "role", "payer")).toEqual([1, 1]);
    expect(pick(rows, ids.manual.id, "recruitment", "own_network")).toEqual([0, 1]);
    // Een voorgesteld AI-thema telt nog niet; de AI-toewijzing ook niet zonder beoordeling.
    expect(pick(rows, ids.ai.id)).toBeNull();

    await as(owner, (c) => c.query("update public.interview_codes set status = 'accepted' where id = $1", [ids.ai.id]));
    await expect(as(owner, (c) => c.query("update public.interview_codes set status = 'rejected' where id = $1", [ids.ai.id]))).rejects.toThrow(/CODE_REVIEWED/);
    expect(pick(await counts(owner), ids.ai.id)).toEqual([0, 3]);
    await as(owner, (c) => c.query("update public.observation_codes set review_status = 'accepted' where observation_id = $1 and code_id = $2", [ids.o2, ids.ai.id]));
    await expect(
      as(owner, (c) => c.query("update public.observation_codes set review_status = 'rejected' where observation_id = $1 and code_id = $2", [ids.o2, ids.ai.id])),
    ).rejects.toThrow(/CODE_ASSIGNMENT_LOCKED/);
    rows = await counts(owner);
    expect(pick(rows, ids.ai.id)).toEqual([1, 3]);
    expect(pick(rows, ids.ai.id, "recruitment", "own_network")).toEqual([1, 1]);

    // Aanname: een handmatige, gekoppelde observatie uit een echt gesprek.
    await as(owner, (c) => c.query("insert into public.assumption_observations (assumption_id, observation_id, idea_id, relation) values ($1, $2, $3, 'supports')", [t.assumption, ids.o1, B.idea]));
    expect(pick(await counts(owner), t.assumption)).toEqual([1, 3]);

    // Opdrachtgever: dezelfde aantallen via de functie, maar geen toewijzingen (citaten) en geen interviews.
    const client = await user(`klant-${randomUUID()}@example.com`);
    await as(owner, (c) => c.query("insert into public.idea_members (idea_id, email, role) values ($1, $2, 'client_viewer')", [B.idea, client.email]));
    await as(client, (c) => c.query("select public.claim_invitations()"));
    expect(pick(await counts(client), ids.manual.id)).toEqual([2, 3]);
    expect((await as(client, (c) => c.query("select * from public.observation_codes where idea_id = $1", [B.idea]))).rowCount).toBe(0);
    expect((await as(client, (c) => c.query("select label from public.interview_codes where idea_id = $1", [B.idea]))).rowCount).toBe(2);
    await expect(as(client, (c) => c.query("insert into public.interview_codes (idea_id, label) values ($1, 'Nieuw thema')", [B.idea]))).rejects.toThrow();
    const outsider = await user(`buiten-${randomUUID()}@example.com`);
    expect(await counts(outsider)).toEqual([]);

    // Auditspoor op de nieuwe tabellen.
    const audited = (await db.query("select distinct table_name from public.audit_events where idea_id = $1", [B.idea])).rows.map((r) => r.table_name);
    expect(audited).toEqual(expect.arrayContaining(["interview_codes", "observation_codes"]));
  });

  it("bewaartermijn: transcript, segmenten en citaatposities weg; aantallen en labels blijven", async () => {
    const C = await newIdea(owner);
    const t = await interviewTest(owner, C.idea);
    const iv = await importInterview(owner, C.idea, { experiment: t.experiment, heldOn: "2024-01-15" });
    const o = await as(owner, async (c) => {
      const obs = (await c.query("insert into public.observations (idea_id, experiment_id, interview_id, kind, summary, quote, quote_start, quote_end, segment_index) values ($1, $2, $3, 'problem_confirmed', 'x', 'elke week twee uur', 100, 118, 1) returning id", [C.idea, t.experiment, iv.id])).rows[0].id as string;
      const code = (await c.query("insert into public.interview_codes (idea_id, label) values ($1, 'Tijdverlies') returning id", [C.idea])).rows[0].id as string;
      await c.query("insert into public.observation_codes (observation_id, code_id, idea_id) values ($1, $2, $3)", [obs, code, C.idea]);
      return { obs, code };
    });
    await db.query("select public.purge_expired_personal_data()");
    const ivRow = (await db.query("select transcript, segments, pseudonym_labels from public.interviews where id = $1", [iv.id])).rows[0];
    expect(ivRow.transcript).toBe("[verwijderd na afloop van de bewaartermijn]");
    expect(ivRow.segments).toBeNull();
    expect(ivRow.pseudonym_labels.labels[0].label).toBe("Spreker A");
    const obsRow = (await db.query("select quote, quote_start, quote_end, segment_index from public.observations where id = $1", [o.obs])).rows[0];
    expect(obsRow).toEqual({ quote: null, quote_start: null, quote_end: null, segment_index: null });
    const rows = await as(owner, async (c) => (await c.query("select mentioned, total from public.interview_theme_counts($1) where item_id = $2 and dimension = 'all'", [C.idea, o.code])).rows);
    expect(rows.map((r) => [Number(r.mentioned), Number(r.total)])).toEqual([[1, 1]]);
  });

  it("privacyverzoek vindt ook een verkennend interview", async () => {
    const D = await newIdea(owner);
    const mail = `sanne-${randomUUID().slice(0, 8)}@example.com`;
    await as(owner, (c) =>
      c.query(
        `insert into public.interviews (idea_id, participant_label, dmu_role, recruited_via, held_on, record_type, transcript, consent_recorded, is_practice)
         values ($1, 'Deelnemer', 'user', 'network', current_date, 'notes', $2, true, false)`,
        [D.idea, `Notities: mail later naar ${mail} voor de uitnodiging.`],
      ),
    );
    const out = await as(owner, async (c) => (await c.query("select public.dsr_search($1, $2, '{}') as r", [D.org, mail])).rows[0].r);
    expect(out.interviews).toHaveLength(1);
    expect(out.interviews[0]).toMatchObject({ experiment: "Verkennend interview", transcript_mentions_email: true, pseudonymized: false });
  });

  it("Fathom-sleutel: per werkruimte, nooit direct leesbaar, niet voor opdrachtgevers, niet in het auditspoor", async () => {
    const E = await newIdea(owner);
    const key = "fathom_test_key_0123456789abcd";
    await as(owner, (c) => c.query("select public.set_fathom_api_key($1, $2)", [E.org, key]));
    const status = await as(owner, async (c) => (await c.query("select * from public.transcript_settings_status($1)", [E.org])).rows[0]);
    expect(status).toMatchObject({ fathom_connected: true, fathom_key_hint: "abcd" });
    expect(await as(owner, async (c) => (await c.query("select public.fathom_api_key_for_idea($1) as k", [E.idea])).rows[0].k)).toBe(key);
    await expect(as(owner, (c) => c.query("select * from public.org_transcript_settings"))).rejects.toThrow(/permission denied/);
    await expect(as(owner, (c) => c.query("select public.set_fathom_api_key($1, 'kort')", [E.org]))).rejects.toThrow(/INVALID_KEY/);
    const client = await user(`klant-${randomUUID()}@example.com`);
    await as(owner, (c) => c.query("insert into public.idea_members (idea_id, email, role) values ($1, $2, 'client_viewer')", [E.idea, client.email]));
    await as(client, (c) => c.query("select public.claim_invitations()"));
    expect(await as(client, async (c) => (await c.query("select public.fathom_api_key_for_idea($1) as k", [E.idea])).rows[0].k)).toBeNull();
    await expect(as(client, (c) => c.query("select public.set_fathom_api_key($1, $2)", [E.org, key]))).rejects.toThrow(/FORBIDDEN/);
    const audit = (await db.query("select action, detail from public.audit_events where org_id = $1 and table_name = 'org_transcript_settings'", [E.org])).rows;
    expect(audit.map((a) => a.action)).toEqual(["fathom_key_set"]);
    expect(JSON.stringify(audit)).not.toContain(key);
    await as(owner, (c) => c.query("select public.set_fathom_api_key($1, null)", [E.org]));
    expect((await as(owner, async (c) => (await c.query("select * from public.transcript_settings_status($1)", [E.org])).rows[0])).fathom_connected).toBe(false);
  });
});
