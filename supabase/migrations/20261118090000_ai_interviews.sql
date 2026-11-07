-- AI-gemodereerde interviews (tekstchat). Ontwerpregels: docs/ProofLab_Analyse_en_Verbeteringen_v1.1.md, "AI-gemodereerd
-- tekstinterview: ontwerpregels"; apart gelabeld en gescoord: docs/ProofLab_Voorspelkracht_v1.md 7.4. Uitleg en
-- teststappen: IMPLEMENTATION_STATUS.md, sectie "AI-gemodereerde interviews".
--
-- 1. interviews.ai_moderated en bronformaat 'ai_chat'; observations.ai_moderated (door de database gezet uit het
--    interview). Een AI-interview ontstaat alleen via de functies hieronder, nooit door een gewone insert.
-- 2. Een citaat uit een AI-interview moet binnen een respondentbeurt vallen: vragen van de AI tellen nooit als bewijs.
-- 3. ai_interview_configs: de opzet per interviewtest (leidraad = de vragen van de Test Card, grenzen, introductie,
--    opdrachtgever, bewaartermijn, screener). De consultant keurt expliciet goed; daarna ligt alles vast behalve pauzeren.
-- 4. ai_interview_sessions en ai_interview_turns: het gesprek met toestemming, screener en elke beurt met tijdstempel
--    en rol. Alleen het onderzoeksteam leest ze; schrijven gaat alleen via functies (publiek: met de ingest-sleutel).
-- 5. Publieke functies met de ingest-sleutel, rate limit en harde grenzen (beurten, duur, volgorde van de beurten);
--    AI-kosten in het bestaande grootboek ai_runs (maandbudget van de organisatie).
-- 6. Uitsluiten (met reden), weer opnemen en verwijderen (privacyverzoek) door het team, met auditspoor zonder tekst.
-- 7. Bewaartermijn (opschoning), afgebroken gesprekken en privacyverzoeken (dsr_search).
--
-- Idempotent: opnieuw uitvoeren verandert niets. Zonder deze migratie werkt de app zoals voorheen; de opzet meldt dat
-- de database moet worden bijgewerkt en de publieke pagina zegt dat het gesprek nu niet beschikbaar is.

begin;

-- ---------------------------------------------------------------------------
-- 1. Markering op interviews en observaties
-- ---------------------------------------------------------------------------

alter table public.interviews add column if not exists ai_moderated boolean not null default false;
alter table public.observations add column if not exists ai_moderated boolean not null default false;

alter table public.interviews drop constraint if exists interviews_source_format_check;
alter table public.interviews add constraint interviews_source_format_check
  check (source_format in ('paste', 'txt', 'md', 'docx', 'vtt', 'srt', 'fathom', 'ai_chat'));
alter table public.interviews drop constraint if exists interviews_ai_moderated_check;
alter table public.interviews add constraint interviews_ai_moderated_check check (ai_moderated = (source_format = 'ai_chat'));

create index if not exists interviews_ai_moderated_idx on public.interviews(experiment_id) where ai_moderated;
create index if not exists observations_ai_moderated_idx on public.observations(idea_id) where ai_moderated;

comment on column public.interviews.ai_moderated is
  'Gevoerd door de AI-interviewer (tekstchat). Apart gelabeld en geteld; alleen respondentbeurten kunnen citaat of bewijs zijn.';
comment on column public.observations.ai_moderated is
  'Uit een AI-gemodereerd interview (door de database gezet uit interviews.ai_moderated).';

-- Een AI-interview ontstaat alleen via ai_interview_materialize (die zet de vlag voor de duur van de insert). Een
-- gebruiker kan de markering, de bron en de rollen in het transcript niet veranderen.
create or replace function public.guard_interview_ai()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if (new.ai_moderated or new.source_format = 'ai_chat') and coalesce(current_setting('prooflab.ai_interview', true), '') <> 'on' then
      raise exception 'AI_INTERVIEW_INSERT: een AI-gemodereerd interview ontstaat alleen uit een gesprek met de AI-interviewer' using errcode = 'P0001';
    end if;
  elsif auth.uid() is not null and (new.ai_moderated, new.source_format) is distinct from (old.ai_moderated, old.source_format) then
    raise exception 'AI_INTERVIEW_LOCKED: de markering AI-gemodereerd ligt vast' using errcode = 'P0001';
  end if;
  -- Sprekers blijven AI-interviewer en Respondent: daarop rust de regel dat alleen de respondent citaat kan zijn.
  if new.ai_moderated and new.segments is not null and exists (
       select 1 from jsonb_array_elements(new.segments) s where coalesce(s->>'s', '') not in ('AI-interviewer', 'Respondent')) then
    raise exception 'AI_INTERVIEW_SPEAKERS: in een AI-interview zijn de sprekers AI-interviewer en Respondent' using errcode = 'P0001';
  end if;
  return new;
end $$;
drop trigger if exists interviews_ai_guard on public.interviews;
create trigger interviews_ai_guard before insert or update on public.interviews
  for each row execute function public.guard_interview_ai();

-- ---------------------------------------------------------------------------
-- 2. Observaties: markering en alleen respondentcitaten
-- ---------------------------------------------------------------------------

create or replace function public.stamp_observation_ai()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_ai boolean;
  v_segments jsonb;
begin
  select i.ai_moderated, i.segments into v_ai, v_segments from public.interviews i where i.id = new.interview_id;
  new.ai_moderated := coalesce(v_ai, false);
  if new.ai_moderated and new.quote is not null then
    if new.quote_start is null or new.quote_end is null then
      raise exception 'AI_QUOTE_POSITION: een citaat uit een AI-interview heeft een plek in het transcript' using errcode = 'P0001';
    end if;
    if not exists (
      select 1 from jsonb_array_elements(coalesce(v_segments, '[]'::jsonb)) s
      where s->>'s' = 'Respondent' and (s->>'a')::int <= new.quote_start and new.quote_end <= (s->>'b')::int) then
      raise exception 'AI_QUOTE_RESPONDENT: alleen een uitspraak van de respondent kan een citaat zijn; vragen van de AI tellen nooit als bewijs' using errcode = 'P0001';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists observations_ai_stamp on public.observations;
create trigger observations_ai_stamp before insert on public.observations
  for each row execute function public.stamp_observation_ai();

-- ---------------------------------------------------------------------------
-- 3. Opzet per interviewtest
-- ---------------------------------------------------------------------------

create table if not exists public.ai_interview_configs (
  id uuid primary key default gen_random_uuid(),
  experiment_id uuid not null references public.experiments(id) on delete cascade,
  idea_id uuid not null references public.ideas(id) on delete cascade,
  slug text not null default lower(substr(replace(gen_random_uuid()::text, '-', ''), 1, 14)) check (slug ~ '^[a-f0-9]{14}$'),
  guide jsonb not null check (jsonb_typeof(guide) = 'array' and jsonb_array_length(guide) between 3 and 12 and pg_column_size(guide) <= 8000),
  max_turns int not null default 16 check (max_turns between 4 and 40),
  max_minutes int not null default 20 check (max_minutes between 5 and 45),
  max_probes int not null default 2 check (max_probes between 0 and 2),
  intro text not null check (char_length(btrim(intro)) between 40 and 1200),
  sponsor_mode text not null default 'agency' check (sponsor_mode in ('client', 'agency')),
  sponsor_name text check (sponsor_name is null or char_length(sponsor_name) <= 120),
  privacy_contact text not null check (char_length(btrim(privacy_contact)) between 5 and 200),
  retention_months int not null default 12 check (retention_months between 1 and 12),
  screener jsonb not null default '[]'::jsonb check (jsonb_typeof(screener) = 'array' and jsonb_array_length(screener) <= 3 and pg_column_size(screener) <= 12000),
  status text not null default 'draft' check (status in ('draft', 'approved')),
  paused boolean not null default false,
  approved_by uuid references auth.users(id) on delete set null,
  approved_at timestamptz,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ai_interview_configs_approved check ((status = 'approved') = (approved_at is not null)),
  constraint ai_interview_configs_sponsor check (sponsor_mode = 'agency' or char_length(btrim(coalesce(sponsor_name, ''))) >= 2)
);
create unique index if not exists ai_interview_configs_experiment_uniq on public.ai_interview_configs(experiment_id);
create unique index if not exists ai_interview_configs_slug_uniq on public.ai_interview_configs(slug);
create index if not exists ai_interview_configs_idea_idx on public.ai_interview_configs(idea_id);
create index if not exists ai_interview_configs_approved_by_fk on public.ai_interview_configs(approved_by);
create index if not exists ai_interview_configs_created_by_fk on public.ai_interview_configs(created_by);

comment on table public.ai_interview_configs is
  'Opzet van de AI-interviewer per interviewtest. De leidraad is een kopie van de vragen van de goedgekeurde Test Card; na goedkeuring ligt alles vast behalve pauzeren.';

drop trigger if exists ai_interview_configs_refs on public.ai_interview_configs;
create trigger ai_interview_configs_refs before insert or update on public.ai_interview_configs
  for each row execute function public.check_idea_refs('experiment_id', 'experiments');

create or replace function public.guard_ai_interview_config()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  e public.experiments;
begin
  if tg_op = 'DELETE' then
    -- Verwijdert iemand de test of het dossier (cascade), dan is de test al weg en gaat alles mee.
    if exists (select 1 from public.experiments x where x.id = old.experiment_id)
       and exists (select 1 from public.ai_interview_sessions s where s.config_id = old.id) then
      raise exception 'AI_CONFIG_IN_USE: er zijn al gesprekken gevoerd; pauzeer de AI-interviewer in plaats van hem te verwijderen' using errcode = 'P0001';
    end if;
    return old;
  end if;
  select * into e from public.experiments where id = new.experiment_id;
  if tg_op = 'INSERT' then
    if e.id is null or e.type <> 'interview' then
      raise exception 'AI_CONFIG_TYPE: de AI-interviewer hoort bij een interviewtest' using errcode = 'P0001';
    end if;
    new.status := 'draft';
    new.paused := false;
    new.approved_by := null;
    new.approved_at := null;
    new.created_by := auth.uid();
    new.created_at := now();
    new.updated_at := now();
    return new;
  end if;
  if (new.experiment_id, new.idea_id, new.slug, new.created_by, new.created_at) is distinct from (old.experiment_id, old.idea_id, old.slug, old.created_by, old.created_at) then
    raise exception 'AI_CONFIG_LOCKED: test, dossier en adres van de AI-interviewer liggen vast' using errcode = 'P0001';
  end if;
  new.updated_at := now();
  if old.status = 'approved' and new.status = 'approved' then
    -- Na goedkeuring alleen pauzeren of hervatten.
    if (to_jsonb(new) - 'paused' - 'updated_at') is distinct from (to_jsonb(old) - 'paused' - 'updated_at') then
      raise exception 'AI_CONFIG_LOCKED: de goedgekeurde opzet ligt vast; alleen pauzeren of hervatten kan' using errcode = 'P0001';
    end if;
    return new;
  end if;
  if old.status = 'approved' and new.status = 'draft' then
    -- Goedkeuring intrekken kan alleen zolang er geen gesprekken zijn.
    if exists (select 1 from public.ai_interview_sessions s where s.config_id = old.id) then
      raise exception 'AI_CONFIG_IN_USE: er zijn al gesprekken gevoerd; de goedkeuring kan niet meer worden ingetrokken' using errcode = 'P0001';
    end if;
    new.approved_by := null;
    new.approved_at := null;
    new.paused := false;
    return new;
  end if;
  if new.status = 'approved' then
    -- Goedkeuren: de Test Card is goedgekeurd en de leidraad is precies die van de Test Card.
    if e.state not in ('approved', 'live', 'paused') then
      raise exception 'AI_CONFIG_TEST: keur eerst de Test Card goed' using errcode = 'P0001';
    end if;
    if new.guide is distinct from (e.config->'guide') then
      raise exception 'AI_CONFIG_GUIDE: de leidraad wijkt af van de interviewvragen van de Test Card' using errcode = 'P0001';
    end if;
    if auth.uid() is null then
      raise exception 'AI_CONFIG_APPROVAL: goedkeuren doet een consultant' using errcode = 'P0001';
    end if;
    new.approved_by := auth.uid();
    new.approved_at := now();
    new.paused := false;
    return new;
  end if;
  new.approved_by := null;
  new.approved_at := null;
  return new;
end $$;
drop trigger if exists ai_interview_configs_guard on public.ai_interview_configs;

-- ---------------------------------------------------------------------------
-- 4. Gesprekken en beurten
-- ---------------------------------------------------------------------------

create table if not exists public.ai_interview_sessions (
  id uuid primary key default gen_random_uuid(),
  config_id uuid not null references public.ai_interview_configs(id) on delete cascade,
  experiment_id uuid not null references public.experiments(id) on delete cascade,
  idea_id uuid not null references public.ideas(id) on delete cascade,
  token_hash text not null check (token_hash ~ '^[a-f0-9]{64}$'),
  visitor_hash text not null check (char_length(visitor_hash) between 8 and 64),
  channel text not null default 'direct' check (char_length(channel) between 1 and 40),
  status text not null default 'active' check (status in ('screened_out', 'active', 'completed', 'abandoned')),
  consent_text text not null check (char_length(consent_text) between 20 and 800),
  consented_at timestamptz not null default now(),
  screener_answers jsonb not null default '{}'::jsonb check (jsonb_typeof(screener_answers) = 'object' and pg_column_size(screener_answers) <= 2000),
  dmu_role text not null default 'user' check (dmu_role in ('user', 'buyer', 'payer', 'decider', 'influencer', 'other')),
  segment text check (segment is null or char_length(segment) <= 160),
  topic_index int not null default 0 check (topic_index between 0 and 11),
  probes_used int not null default 0 check (probes_used between 0 and 2),
  answers int not null default 0 check (answers between 0 and 40),
  injections int not null default 0 check (injections >= 0),
  fallbacks int not null default 0 check (fallbacks >= 0),
  sensitive_notices int not null default 0 check (sensitive_notices >= 0),
  pseudonym_map jsonb not null default '{}'::jsonb check (jsonb_typeof(pseudonym_map) = 'object' and pg_column_size(pseudonym_map) <= 20000),
  started_at timestamptz not null default now(),
  last_activity_at timestamptz not null default now(),
  ended_at timestamptz,
  end_reason text check (end_reason in ('respondent', 'max_turns', 'max_duration', 'guide_done', 'refused', 'test_closed', 'inactive')),
  interview_id uuid references public.interviews(id) on delete set null,
  excluded_at timestamptz,
  excluded_by uuid references auth.users(id) on delete set null,
  exclusion_reason text check (exclusion_reason is null or char_length(btrim(exclusion_reason)) between 10 and 400),
  cost_usd numeric(10,4) not null default 0 check (cost_usd >= 0),
  retention_until date not null,
  created_at timestamptz not null default now()
);
create unique index if not exists ai_interview_sessions_token_uniq on public.ai_interview_sessions(token_hash);
-- Eén gesprek per bezoeker per test (ook na screening: opnieuw proberen met andere antwoorden telt niet).
create unique index if not exists ai_interview_sessions_visitor_uniq on public.ai_interview_sessions(config_id, visitor_hash);
create index if not exists ai_interview_sessions_experiment_idx on public.ai_interview_sessions(experiment_id, created_at);
create index if not exists ai_interview_sessions_idea_idx on public.ai_interview_sessions(idea_id);
create index if not exists ai_interview_sessions_interview_fk on public.ai_interview_sessions(interview_id);
create index if not exists ai_interview_sessions_excluded_by_fk on public.ai_interview_sessions(excluded_by);
create index if not exists ai_interview_sessions_active_idx on public.ai_interview_sessions(last_activity_at) where status = 'active';

comment on table public.ai_interview_sessions is
  'Eén gesprek met de AI-interviewer: toestemming, screener, voortgang en (na afronding) het interview. Geen naam, e-mailadres of IP; de bezoekerscode is een HMAC per test.';
comment on column public.ai_interview_sessions.pseudonym_map is
  'Per gesprek: sleutel (HMAC van een gevonden naam of adres) → label, zodat dezelfde naam steeds hetzelfde label krijgt. Nooit de naam zelf; leeg na de bewaartermijn.';

create table if not exists public.ai_interview_turns (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.ai_interview_sessions(id) on delete cascade,
  idea_id uuid not null references public.ideas(id) on delete cascade,
  seq int not null check (seq between 1 and 200),
  role text not null check (role in ('interviewer', 'respondent')),
  kind text not null check (kind in ('intro', 'guide', 'probe', 'fallback', 'refusal', 'closing', 'answer')),
  topic_index int not null default 0 check (topic_index between 0 and 11),
  text text not null check (char_length(text) between 1 and 2000),
  checks jsonb check (checks is null or (jsonb_typeof(checks) = 'object' and pg_column_size(checks) <= 4000)),
  flags text[] not null default '{}' check (flags <@ array['injection', 'sensitive', 'pseudonymized']::text[]),
  created_at timestamptz not null default now(),
  constraint ai_interview_turns_role_kind check ((role = 'respondent') = (kind = 'answer'))
);
create unique index if not exists ai_interview_turns_seq_uniq on public.ai_interview_turns(session_id, seq);
create index if not exists ai_interview_turns_idea_idx on public.ai_interview_turns(idea_id);

comment on table public.ai_interview_turns is
  'Elke beurt van een AI-interview met tijdstempel en rol. checks: de controle van een voorgestelde doorvraag (vaste regels en tweede model). Alleen respondentbeurten kunnen citaat zijn.';

drop trigger if exists ai_interview_sessions_refs on public.ai_interview_sessions;
create trigger ai_interview_sessions_refs before insert or update on public.ai_interview_sessions
  for each row execute function public.check_idea_refs('experiment_id', 'experiments', 'config_id', 'ai_interview_configs', 'interview_id', 'interviews');
drop trigger if exists ai_interview_turns_refs on public.ai_interview_turns;
create trigger ai_interview_turns_refs before insert or update on public.ai_interview_turns
  for each row execute function public.check_idea_refs('session_id', 'ai_interview_sessions');

create trigger ai_interview_configs_guard before insert or update or delete on public.ai_interview_configs
  for each row execute function public.guard_ai_interview_config();

-- Auditspoor van een gesprek: alleen wat er met het gesprek gebeurt (start, afronding, uitsluiten, opnemen,
-- verwijderen), zonder tekst, zonder bezoekerscode en zonder de reden-tekst van de respondent. Losse beurten niet.
create or replace function public.audit_ai_interview_session()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  r public.ai_interview_sessions := case when tg_op = 'DELETE' then old else new end;
  v_org uuid := (select i.org_id from public.ideas i where i.id = r.idea_id);
begin
  if tg_op = 'UPDATE' and (new.status, new.excluded_at, new.interview_id) is not distinct from (old.status, old.excluded_at, old.interview_id) then
    return null;
  end if;
  insert into public.audit_events (idea_id, org_id, actor_id, table_name, row_id, action, detail)
  values (case when tg_op = 'DELETE' then null else r.idea_id end, v_org, auth.uid(), 'ai_interview_sessions', r.id::text, lower(tg_op),
          jsonb_build_object('experiment_id', r.experiment_id, 'status', r.status, 'answers', r.answers, 'end_reason', r.end_reason,
                             'excluded', r.excluded_at is not null, 'exclusion_reason', r.exclusion_reason,
                             'interview', r.interview_id is not null, 'injections', r.injections, 'fallbacks', r.fallbacks));
  return null;
end $$;
drop trigger if exists ai_interview_sessions_audit on public.ai_interview_sessions;
create trigger ai_interview_sessions_audit after insert or update or delete on public.ai_interview_sessions
  for each row execute function public.audit_ai_interview_session();

drop trigger if exists ai_interview_configs_audit on public.ai_interview_configs;
create trigger ai_interview_configs_audit after insert or update or delete on public.ai_interview_configs
  for each row execute function public.audit_row();

-- RLS: alleen het onderzoeksteam (kan schrijven in het dossier) leest opzet, gesprekken en beurten. Opdrachtgevers
-- zien de interviews zoals elk ander interview (gepseudonimiseerde citaten en aantallen), niet de chats.
alter table public.ai_interview_configs enable row level security;
alter table public.ai_interview_sessions enable row level security;
alter table public.ai_interview_turns enable row level security;

drop policy if exists ai_interview_configs_select on public.ai_interview_configs;
drop policy if exists ai_interview_configs_insert on public.ai_interview_configs;
drop policy if exists ai_interview_configs_update on public.ai_interview_configs;
drop policy if exists ai_interview_configs_delete on public.ai_interview_configs;
create policy ai_interview_configs_select on public.ai_interview_configs for select to authenticated using (public.can_write_idea(idea_id));
create policy ai_interview_configs_insert on public.ai_interview_configs for insert to authenticated with check (public.can_write_idea(idea_id));
create policy ai_interview_configs_update on public.ai_interview_configs for update to authenticated
  using (public.can_write_idea(idea_id)) with check (public.can_write_idea(idea_id));
create policy ai_interview_configs_delete on public.ai_interview_configs for delete to authenticated using (public.can_write_idea(idea_id));

drop policy if exists ai_interview_sessions_select on public.ai_interview_sessions;
create policy ai_interview_sessions_select on public.ai_interview_sessions for select to authenticated using (public.can_write_idea(idea_id));
drop policy if exists ai_interview_turns_select on public.ai_interview_turns;
create policy ai_interview_turns_select on public.ai_interview_turns for select to authenticated using (public.can_write_idea(idea_id));

revoke all on public.ai_interview_configs, public.ai_interview_sessions, public.ai_interview_turns from public, anon;
revoke insert, update, delete on public.ai_interview_sessions, public.ai_interview_turns from authenticated;
grant select, insert, update, delete on public.ai_interview_configs to authenticated;
grant select on public.ai_interview_sessions, public.ai_interview_turns to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Publieke functies (alleen de app-server, met de ingest-sleutel)
-- ---------------------------------------------------------------------------

-- Uitgaven en plafond van de organisatie deze maand (zelfde som als org_ai_spend), voor de server zonder sessie.
create or replace function public.ai_interview_budget(p_idea uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('spent', coalesce((
      select sum(r.cost_usd) from public.ai_runs r
      left join public.ideas i2 on i2.id = r.idea_id
      where (i2.org_id = o.id or (r.idea_id is null and r.org_id = o.id)) and r.created_at >= date_trunc('month', now())
    ), 0), 'cap', o.ai_monthly_cap_usd)
  from public.ideas i join public.organizations o on o.id = i.org_id
  where i.id = p_idea;
$$;

-- Beschikbaarheid van een AI-interview: beschikbaar, voorbeeld (Test Card goedgekeurd, ronde nog niet gestart),
-- gepauzeerd of afgerond. Null als er geen goedgekeurde opzet is.
create or replace function public.ai_interview_availability(c public.ai_interview_configs, e public.experiments)
returns text language sql stable security definer set search_path = '' as $$
  select case
    when c.status <> 'approved' then null
    when e.state in ('ended', 'analyzed', 'decided') or (e.ends_at is not null and now() >= e.ends_at) then 'closed'
    when c.guide is distinct from (e.config->'guide') then 'unavailable'
    when e.state = 'approved' then 'preview'
    when e.state = 'paused' or c.paused then 'paused'
    when e.state = 'live' then 'available'
    else 'unavailable' end;
$$;

-- Alles wat de server nodig heeft voor de publieke pagina (de browser krijgt alleen het publieke deel).
create or replace function public.ai_interview_public(p_key text, p_slug text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  c public.ai_interview_configs;
  e public.experiments;
  v_state text;
begin
  if not public.ingest_key_ok(p_key) then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  select * into c from public.ai_interview_configs where slug = p_slug;
  if c.id is null then
    return null;
  end if;
  select * into e from public.experiments where id = c.experiment_id;
  v_state := public.ai_interview_availability(c, e);
  if v_state is null then
    return null;
  end if;
  return jsonb_build_object(
    'state', v_state, 'idea_id', c.idea_id, 'guide', c.guide, 'max_turns', c.max_turns, 'max_minutes', c.max_minutes,
    'max_probes', c.max_probes, 'intro', c.intro, 'sponsor_mode', c.sponsor_mode, 'sponsor_name', c.sponsor_name,
    'privacy_contact', c.privacy_contact, 'retention_months', c.retention_months, 'screener', c.screener,
    'budget', public.ai_interview_budget(c.idea_id),
    'ai_settings', (select to_jsonb(s) - 'org_id' - 'updated_by' - 'updated_at' from public.org_ai_settings s join public.ideas i on i.org_id = s.org_id where i.id = c.idea_id));
end $$;

-- Start na toestemming en screener (door de server beoordeeld met de volledige opzet, zoals bij enquêtes).
create or replace function public.ai_interview_start(
  p_key text, p_slug text, p_visitor text, p_token_hash text, p_channel text, p_consent_text text,
  p_answers jsonb, p_qualified boolean, p_role text, p_segment text, p_rate_bucket text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  c public.ai_interview_configs;
  e public.experiments;
  v_id uuid;
begin
  if not public.ingest_key_ok(p_key) then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  select * into c from public.ai_interview_configs where slug = p_slug;
  if c.id is null then
    return jsonb_build_object('status', 'closed');
  end if;
  select * into e from public.experiments where id = c.experiment_id;
  if public.ai_interview_availability(c, e) is distinct from 'available' then
    return jsonb_build_object('status', 'closed');
  end if;
  if char_length(coalesce(p_consent_text, '')) < 20 then
    return jsonb_build_object('status', 'consent');
  end if;
  if p_token_hash !~ '^[a-f0-9]{64}$' or char_length(coalesce(p_visitor, '')) < 8 then
    return jsonb_build_object('status', 'invalid');
  end if;
  if not public.ingest_allowed(coalesce(p_rate_bucket, '') || ':ai-start:' || p_slug, 5)
     or not public.ingest_allowed('ai-start:' || p_slug, 60) then
    return jsonb_build_object('status', 'rate');
  end if;
  insert into public.ai_interview_sessions (config_id, experiment_id, idea_id, token_hash, visitor_hash, channel, status,
    consent_text, screener_answers, dmu_role, segment, retention_until)
  values (c.id, c.experiment_id, c.idea_id, p_token_hash, left(p_visitor, 64), left(coalesce(nullif(p_channel, ''), 'direct'), 40),
          case when coalesce(p_qualified, false) then 'active' else 'screened_out' end,
          left(p_consent_text, 800), coalesce(p_answers, '{}'::jsonb),
          case when p_role in ('user', 'buyer', 'payer', 'decider', 'influencer', 'other') then p_role else 'user' end,
          nullif(left(btrim(coalesce(p_segment, '')), 160), ''),
          (current_date + make_interval(months => c.retention_months))::date)
  on conflict (config_id, visitor_hash) do nothing
  returning id into v_id;
  if v_id is null then
    return jsonb_build_object('status', 'duplicate');
  end if;
  if not coalesce(p_qualified, false) then
    -- Buiten de doelgroep: geen gesprek, telt nergens mee; alleen dat er gescreend is.
    update public.ai_interview_sessions set ended_at = now() where id = v_id;
    return jsonb_build_object('status', 'screened_out');
  end if;
  return jsonb_build_object('status', 'ok', 'session_id', v_id);
end $$;

-- De stand van een gesprek met de beurten, de opzet en wat de server nodig heeft voor de volgende vraag.
create or replace function public.ai_interview_state(p_key text, p_token_hash text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  s public.ai_interview_sessions;
  c public.ai_interview_configs;
  e public.experiments;
begin
  if not public.ingest_key_ok(p_key) then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  select * into s from public.ai_interview_sessions where token_hash = p_token_hash;
  if s.id is null then
    return null;
  end if;
  select * into c from public.ai_interview_configs where id = s.config_id;
  select * into e from public.experiments where id = s.experiment_id;
  return jsonb_build_object(
    'session', jsonb_build_object('id', s.id, 'status', s.status, 'topic_index', s.topic_index, 'probes_used', s.probes_used,
      'answers', s.answers, 'injections', s.injections, 'started_at', s.started_at, 'pseudonym_map', s.pseudonym_map,
      'dmu_role', s.dmu_role, 'interview_id', s.interview_id),
    'config', jsonb_build_object('guide', c.guide, 'max_turns', c.max_turns, 'max_minutes', c.max_minutes, 'max_probes', c.max_probes,
      'intro', c.intro, 'sponsor_mode', c.sponsor_mode, 'sponsor_name', c.sponsor_name, 'privacy_contact', c.privacy_contact,
      'retention_months', c.retention_months, 'screener', c.screener, 'slug', c.slug),
    'availability', public.ai_interview_availability(c, e),
    'idea_id', s.idea_id,
    'product_names', jsonb_build_array((select i.title from public.ideas i where i.id = s.idea_id), e.config->>'product_name'),
    'budget', public.ai_interview_budget(s.idea_id),
    'ai_settings', (select to_jsonb(x) - 'org_id' - 'updated_by' - 'updated_at' from public.org_ai_settings x join public.ideas i on i.org_id = x.org_id where i.id = s.idea_id),
    'turns', coalesce((select jsonb_agg(jsonb_build_object('seq', t.seq, 'role', t.role, 'kind', t.kind, 'text', t.text, 'topic_index', t.topic_index,
                                                           'created_at', t.created_at) order by t.seq)
                       from public.ai_interview_turns t where t.session_id = s.id), '[]'::jsonb));
end $$;

-- Een antwoord van de respondent (al opgeschoond en gepseudonimiseerd door de server). Harde grenzen in de database:
-- het gesprek loopt, de interviewer is aan de beurt geweest, het maximum aantal antwoorden en de maximale duur (met
-- twee minuten marge voor wie aan het typen was) zijn niet overschreden, en de rate limit.
create or replace function public.ai_interview_answer(
  p_key text, p_token_hash text, p_text text, p_flags text[], p_pseudonym_map jsonb, p_rate_bucket text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  s public.ai_interview_sessions;
  c public.ai_interview_configs;
  e public.experiments;
  v_last text;
  v_seq int;
  v_flags text[] := coalesce(array(select f from unnest(coalesce(p_flags, '{}')) f where f in ('injection', 'sensitive', 'pseudonymized')), '{}');
begin
  if not public.ingest_key_ok(p_key) then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  select * into s from public.ai_interview_sessions where token_hash = p_token_hash for update;
  if s.id is null then
    return jsonb_build_object('status', 'not_found');
  end if;
  if s.status <> 'active' then
    return jsonb_build_object('status', 'ended');
  end if;
  select * into c from public.ai_interview_configs where id = s.config_id;
  select * into e from public.experiments where id = s.experiment_id;
  if public.ai_interview_availability(c, e) is distinct from 'available' then
    return jsonb_build_object('status', 'closed');
  end if;
  if char_length(coalesce(p_text, '')) not between 1 and 1500 then
    return jsonb_build_object('status', 'invalid');
  end if;
  if not public.ingest_allowed(coalesce(p_rate_bucket, '') || ':ai-msg', 20) then
    return jsonb_build_object('status', 'rate');
  end if;
  select t.role, t.seq into v_last, v_seq from public.ai_interview_turns t where t.session_id = s.id order by t.seq desc limit 1;
  if v_last is distinct from 'interviewer' then
    return jsonb_build_object('status', 'busy');
  end if;
  if s.answers >= c.max_turns then
    return jsonb_build_object('status', 'limit');
  end if;
  if now() > s.started_at + make_interval(mins => c.max_minutes + 2) then
    return jsonb_build_object('status', 'expired');
  end if;
  insert into public.ai_interview_turns (session_id, idea_id, seq, role, kind, topic_index, text, flags)
  values (s.id, s.idea_id, v_seq + 1, 'respondent', 'answer', s.topic_index, p_text, v_flags);
  update public.ai_interview_sessions
  set answers = answers + 1, last_activity_at = now(),
      injections = injections + case when 'injection' = any(v_flags) then 1 else 0 end,
      sensitive_notices = sensitive_notices + case when 'sensitive' = any(v_flags) then 1 else 0 end,
      pseudonym_map = case when jsonb_typeof(p_pseudonym_map) = 'object' and pg_column_size(p_pseudonym_map) <= 20000 then p_pseudonym_map else pseudonym_map end
  where id = s.id;
  return jsonb_build_object('status', 'ok', 'seq', v_seq + 1);
end $$;

-- Een beurt van de interviewer. De opening (introductie en eerste vraag) mag alleen aan het begin; daarna wisselen
-- interviewer en respondent elkaar af. Een afsluitende beurt sluit het gesprek nog niet: dat doet ai_interview_finish
-- (met het transcript), zodat een gesprek nooit half wordt opgeslagen.
create or replace function public.ai_interview_ask(
  p_key text, p_token_hash text, p_kind text, p_text text, p_topic_index int, p_probes_used int, p_checks jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  s public.ai_interview_sessions;
  c public.ai_interview_configs;
  v_last text;
  v_last_kind text;
  v_seq int;
begin
  if not public.ingest_key_ok(p_key) then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  select * into s from public.ai_interview_sessions where token_hash = p_token_hash for update;
  if s.id is null then
    return jsonb_build_object('status', 'not_found');
  end if;
  if s.status <> 'active' then
    return jsonb_build_object('status', 'ended');
  end if;
  select * into c from public.ai_interview_configs where id = s.config_id;
  if p_kind not in ('intro', 'guide', 'probe', 'fallback', 'refusal', 'closing') or char_length(coalesce(p_text, '')) not between 1 and 2000
     or p_topic_index is null or p_topic_index < 0 or p_topic_index >= jsonb_array_length(c.guide)
     or p_probes_used is null or p_probes_used < 0 or p_probes_used > c.max_probes then
    return jsonb_build_object('status', 'invalid');
  end if;
  select t.role, t.kind, t.seq into v_last, v_last_kind, v_seq from public.ai_interview_turns t where t.session_id = s.id order by t.seq desc limit 1;
  if p_kind = 'intro' then
    if v_seq is not null then return jsonb_build_object('status', 'busy'); end if;
  elsif v_seq is null then
    return jsonb_build_object('status', 'busy');
  elsif not (v_last = 'respondent' or (v_last_kind = 'intro' and p_kind = 'guide' and p_topic_index = 0)) then
    return jsonb_build_object('status', 'busy');
  end if;
  -- Een vraag uit de leidraad staat er letterlijk in.
  if p_kind in ('guide', 'fallback') and p_text is distinct from (c.guide->>p_topic_index) then
    return jsonb_build_object('status', 'invalid');
  end if;
  insert into public.ai_interview_turns (session_id, idea_id, seq, role, kind, topic_index, text, checks)
  values (s.id, s.idea_id, coalesce(v_seq, 0) + 1, 'interviewer', p_kind, p_topic_index, p_text,
          case when jsonb_typeof(p_checks) = 'object' and pg_column_size(p_checks) <= 4000 then p_checks else null end);
  update public.ai_interview_sessions
  set topic_index = p_topic_index, probes_used = p_probes_used, last_activity_at = now(),
      fallbacks = fallbacks + case when p_kind = 'fallback' then 1 else 0 end
  where id = s.id;
  return jsonb_build_object('status', 'ok', 'seq', coalesce(v_seq, 0) + 1);
end $$;

-- Het interview in de bestaande interviewtabel: AI-gemodereerd, gepseudonimiseerd, met toestemming, als echt gesprek,
-- gekoppeld aan de test, met de bewaartermijn van het gesprek. Niet zelf aan te roepen.
create or replace function public.ai_interview_materialize(p_session uuid, p_transcript text, p_segments jsonb, p_labels jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  s public.ai_interview_sessions;
  e public.experiments;
  v_id uuid;
  v_code text;
begin
  select * into s from public.ai_interview_sessions where id = p_session;
  select * into e from public.experiments where id = s.experiment_id;
  if char_length(coalesce(p_transcript, '')) not between 10 and 250000 or jsonb_typeof(p_segments) <> 'array'
     or jsonb_array_length(p_segments) <> (select count(*) from public.ai_interview_turns t where t.session_id = s.id) then
    raise exception 'AI_TRANSCRIPT: het transcript past niet bij de beurten van het gesprek' using errcode = 'P0001';
  end if;
  v_code := upper(substr(replace(s.id::text, '-', ''), 1, 4) || '-' || substr(replace(s.id::text, '-', ''), 5, 4));
  perform set_config('prooflab.ai_interview', 'on', true);
  insert into public.interviews (experiment_id, idea_id, participant_label, dmu_role, segment, recruited_via, is_acquaintance, held_on,
    record_type, transcript, consent_recorded, is_practice, source_format, segments, pseudonymized_at, pseudonym_labels,
    ai_moderated, recruitment_group)
  values (s.experiment_id, s.idea_id, 'AI-interview ' || v_code, s.dmu_role, s.segment, s.channel, false, s.started_at::date,
    'transcript', p_transcript, true, false, 'ai_chat', p_segments, now(),
    case when jsonb_typeof(p_labels) = 'object' and pg_column_size(p_labels) <= 20000 then p_labels else jsonb_build_object('labels', '[]'::jsonb, 'declined', 0) end,
    true, e.recruitment_group)
  returning id into v_id;
  perform set_config('prooflab.ai_interview', 'off', true);
  -- De bewaartermijn van het gesprek (de import-regel zet standaard 12 maanden na de gespreksdatum).
  update public.interviews set retention_until = s.retention_until where id = v_id;
  update public.ai_interview_sessions set interview_id = v_id where id = s.id;
  return v_id;
end $$;

-- Afronden: door de respondent, na de laatste vraag of bij een grens. Met minstens één antwoord en een lopende (of
-- gepauzeerde) ronde wordt het gesprek een interview van de test.
create or replace function public.ai_interview_finish(
  p_key text, p_token_hash text, p_reason text, p_transcript text, p_segments jsonb, p_labels jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  s public.ai_interview_sessions;
  e public.experiments;
  v_interview uuid;
begin
  if not public.ingest_key_ok(p_key) then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  select * into s from public.ai_interview_sessions where token_hash = p_token_hash for update;
  if s.id is null then
    return jsonb_build_object('status', 'not_found');
  end if;
  if s.status <> 'active' then
    return jsonb_build_object('status', 'ended', 'interview', s.interview_id is not null);
  end if;
  if p_reason not in ('respondent', 'max_turns', 'max_duration', 'guide_done', 'refused', 'test_closed') then
    return jsonb_build_object('status', 'invalid');
  end if;
  select * into e from public.experiments where id = s.experiment_id;
  update public.ai_interview_sessions set status = 'completed', ended_at = now(), end_reason = p_reason, last_activity_at = now() where id = s.id;
  if s.answers >= 1 and e.state in ('live', 'paused') then
    v_interview := public.ai_interview_materialize(s.id, p_transcript, p_segments, p_labels);
  end if;
  return jsonb_build_object('status', 'ok', 'interview', v_interview is not null);
end $$;

-- AI-kosten van een gesprek in het grootboek (telt mee in het maandbudget van de organisatie), zonder prompt of tekst.
create or replace function public.ai_interview_log_run(
  p_key text, p_token_hash text, p_purpose text, p_provider text, p_model text, p_prompt_version text,
  p_input_tokens int, p_output_tokens int, p_cost numeric, p_outcome text, p_detail text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  s public.ai_interview_sessions;
begin
  if not public.ingest_key_ok(p_key) then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  select * into s from public.ai_interview_sessions where token_hash = p_token_hash;
  if s.id is null or p_purpose not in ('ai_interview_probe', 'ai_interview_check') or p_outcome not in ('ok', 'rejected', 'refused', 'error')
     or coalesce(p_cost, 0) < 0 or coalesce(p_cost, 0) > 5 then
    return false;
  end if;
  insert into public.ai_runs (idea_id, purpose, provider, model, prompt_version, input_tokens, output_tokens, web_searches, cost_usd, outcome, detail, created_by)
  values (s.idea_id, p_purpose, case when p_provider in ('anthropic', 'openai', 'gemini') then p_provider end, left(coalesce(p_model, 'geen'), 120),
          left(coalesce(p_prompt_version, ''), 40), greatest(coalesce(p_input_tokens, 0), 0), greatest(coalesce(p_output_tokens, 0), 0), 0,
          round(coalesce(p_cost, 0), 4), p_outcome, left(p_detail, 500), null);
  update public.ai_interview_sessions set cost_usd = cost_usd + round(coalesce(p_cost, 0), 4) where id = s.id;
  return true;
end $$;

-- ---------------------------------------------------------------------------
-- 6. Het team: uitsluiten met reden, weer opnemen, verwijderen
-- ---------------------------------------------------------------------------

-- Uitsluiten: het interview verdwijnt uit alle tellingen (met zijn observaties); het gesprek en de reden blijven.
create or replace function public.ai_interview_exclude(p_session uuid, p_reason text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  s public.ai_interview_sessions;
begin
  select * into s from public.ai_interview_sessions where id = p_session for update;
  if s.id is null or auth.uid() is null or not public.can_write_idea(s.idea_id) then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if char_length(btrim(coalesce(p_reason, ''))) not between 10 and 400 then
    raise exception 'EXCLUSION_REASON: geef een reden van 10 tot 400 tekens' using errcode = 'P0001';
  end if;
  if s.status not in ('completed', 'abandoned') then
    raise exception 'AI_SESSION_STATE: alleen een afgerond of afgebroken gesprek kan worden uitgesloten' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.experiments e where e.id = s.experiment_id and e.state = 'decided') then
    raise exception 'AI_SESSION_DECIDED: over deze test is al besloten; de telling ligt vast' using errcode = 'P0001';
  end if;
  update public.ai_interview_sessions set excluded_at = now(), excluded_by = auth.uid(), exclusion_reason = btrim(p_reason), interview_id = null where id = s.id;
  if s.interview_id is not null then
    delete from public.interviews where id = s.interview_id;
  end if;
  return true;
end $$;

-- Weer opnemen (ook een afgebroken gesprek met antwoorden): het transcript komt opnieuw uit de beurten.
create or replace function public.ai_interview_include(p_session uuid, p_transcript text, p_segments jsonb, p_labels jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  s public.ai_interview_sessions;
  e public.experiments;
begin
  select * into s from public.ai_interview_sessions where id = p_session for update;
  if s.id is null or auth.uid() is null or not public.can_write_idea(s.idea_id) then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  select * into e from public.experiments where id = s.experiment_id;
  if s.interview_id is not null or s.status not in ('completed', 'abandoned', 'active') or s.answers < 1 then
    raise exception 'AI_SESSION_STATE: dit gesprek kan niet (opnieuw) worden opgenomen' using errcode = 'P0001';
  end if;
  if s.status = 'active' and s.last_activity_at > now() - interval '60 minutes' then
    raise exception 'AI_SESSION_STATE: het gesprek loopt nog' using errcode = 'P0001';
  end if;
  if e.state not in ('live', 'paused') then
    raise exception 'AI_SESSION_TEST: opnemen kan alleen terwijl de interviewronde loopt' using errcode = 'P0001';
  end if;
  update public.ai_interview_sessions
  set excluded_at = null, excluded_by = null, exclusion_reason = null,
      status = case when status = 'active' then 'abandoned' else status end,
      ended_at = coalesce(ended_at, last_activity_at), end_reason = coalesce(end_reason, 'inactive')
  where id = s.id;
  return public.ai_interview_materialize(s.id, p_transcript, p_segments, p_labels);
end $$;

-- Verwijderen (bijvoorbeeld op verzoek van de respondent, die zijn gesprekscode noemt): gesprek, beurten en interview.
create or replace function public.ai_interview_delete(p_session uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  s public.ai_interview_sessions;
begin
  select * into s from public.ai_interview_sessions where id = p_session for update;
  if s.id is null or auth.uid() is null or not public.can_write_idea(s.idea_id) then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if s.interview_id is not null then
    delete from public.interviews where id = s.interview_id;
  end if;
  delete from public.ai_interview_sessions where id = s.id;
  return true;
end $$;

-- ---------------------------------------------------------------------------
-- 7. Bewaartermijn, afgebroken gesprekken en privacyverzoeken
-- ---------------------------------------------------------------------------

-- Laatste versie uit 20261116090000_fase2_testen.sql; toegevoegd: AI-interviews. Na de bewaartermijn verdwijnen de
-- tekst van elke beurt, de voorgestelde doorvragen in de controle en de naamsleutels; status, aantallen en tijden
-- blijven. Een gesprek zonder activiteit na een uur heet afgebroken (telt niet mee, tenzij het team het opneemt). Het
-- interview zelf valt onder de bestaande regel voor interviews (transcript, segmenten en citaten).
create or replace function public.purge_expired_personal_data()
returns int language plpgsql security definer set search_path = '' as $$
declare v1 int; v2 int; v3 int; v4 int; v5 int; v6 int; v7 int; v8 int; v9 int; v10 int;
begin
  update public.test_submissions set email = null, answers = '{}'::jsonb
  where retention_until < current_date and (email is not null or answers <> '{}'::jsonb);
  get diagnostics v1 = row_count;
  update public.interviews set transcript = '[verwijderd na afloop van de bewaartermijn]', segments = null
  where retention_until < current_date and (transcript <> '[verwijderd na afloop van de bewaartermijn]' or segments is not null);
  get diagnostics v2 = row_count;
  update public.observations o set quote = null, quote_start = null, quote_end = null, segment_index = null
  from public.interviews i
  where o.interview_id = i.id and i.retention_until < current_date and (o.quote is not null or o.quote_start is not null or o.segment_index is not null);
  update public.outreach_events set message = null where retention_until < current_date and message is not null;
  get diagnostics v3 = row_count;
  update public.survey_invitations set email = 'verwijderd-' || id::text || '@invalid'
  where retention_until < current_date and email not like 'verwijderd-%';
  get diagnostics v4 = row_count;
  update public.survey_responses set answers = (
      select coalesce(jsonb_object_agg(k, case when jsonb_typeof(v) = 'string' and length(v #>> '{}') > 40 then to_jsonb('[verwijderd]'::text) else v end), '{}'::jsonb)
      from jsonb_each(answers) as t(k, v))
  where retention_until < current_date;
  -- Copies of outreach replies (180 days) and open survey answers (365 days) in the source library.
  delete from public.source_excerpts x using public.sources s
  where x.source_id = s.id
    and ((s.source_type = 'outreach' and s.created_at < now() - interval '180 days')
      or (s.source_type = 'survey' and s.created_at < now() - interval '365 days'));
  get diagnostics v5 = row_count;
  -- Signal quotes whose fragment is gone are removed; the label and count stay.
  update public.customer_signals cs set quotes = coalesce((
      select jsonb_agg(q) from jsonb_array_elements(cs.quotes) q
      where exists (select 1 from public.source_excerpts x where x.id::text = q->>'excerpt_id')), '[]'::jsonb)
  where exists (select 1 from jsonb_array_elements(cs.quotes) q
                where not exists (select 1 from public.source_excerpts x where x.id::text = q->>'excerpt_id'));
  -- Thema's, toewijzingen, labels van de pseudonimisering en de aantallen blijven: daar staan geen citaten in.
  -- Fase 2 · punt 4: toezeggingen zonder namen; het document verwijdert het team via de Storage-API (de app toont
  -- "verlopen"); de status (en dus de telling) blijft.
  update public.test_commitments set signer_name = null, signer_org = null, typed_name = null, ip_hash = null, purged_at = now()
  where retention_until < current_date and purged_at is null;
  get diagnostics v6 = row_count;
  update public.test_payments set person_key = encode(extensions.digest('purged|' || id::text, 'sha256'), 'hex'), purged_at = now()
  where retention_until < current_date and purged_at is null;
  get diagnostics v7 = row_count;
  update public.test_bookings set person_key = encode(extensions.digest('purged|' || id::text, 'sha256'), 'hex'), purged_at = now()
  where retention_until < current_date and purged_at is null;
  get diagnostics v8 = row_count;
  -- AI-gemodereerde interviews: beurten en naamsleutels na de bewaartermijn; afgebroken gesprekken vastleggen.
  update public.ai_interview_turns t set text = '[verwijderd na afloop van de bewaartermijn]', checks = case when t.checks is null then null else t.checks - 'proposed' end
  from public.ai_interview_sessions s
  where t.session_id = s.id and s.retention_until < current_date and t.text <> '[verwijderd na afloop van de bewaartermijn]';
  get diagnostics v9 = row_count;
  update public.ai_interview_sessions set pseudonym_map = '{}'::jsonb
  where retention_until < current_date and pseudonym_map <> '{}'::jsonb;
  update public.ai_interview_sessions set status = 'abandoned', ended_at = last_activity_at, end_reason = 'inactive'
  where status = 'active' and last_activity_at < now() - interval '60 minutes';
  get diagnostics v10 = row_count;
  return v1 + v2 + v3 + v4 + v5 + v6 + v7 + v8 + v9 + v10;
end $$;

-- Laatste versie uit 20261116090000_fase2_testen.sql; toegevoegd: AI-gemodereerde gesprekken waarin de respondent dit
-- adres letterlijk typte (de server vervangt e-mailadressen meestal al vóór opslag door een label; vind je niets,
-- vraag dan naar de gesprekscode).
create or replace function public.dsr_search(p_org uuid, p_email text, p_hashes text[])
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_hashes text[];
  out jsonb;
begin
  if (select auth.uid()) is null or not public.is_org_owner(p_org) then
    raise exception 'FORBIDDEN: alleen eigenaren van de werkruimte behandelen privacyverzoeken' using errcode = 'P0001';
  end if;
  if char_length(v_email) > 254 or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'INVALID_EMAIL' using errcode = 'P0001';
  end if;
  v_hashes := coalesce(array(select h from unnest(coalesce(p_hashes, '{}')) h where h ~ '^[a-f0-9]{64}$' limit 10), '{}');

  out := jsonb_build_object(
    'email', v_email,
    'searched_at', now(),
    'survey_invitations', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', i.id, 'idea', d.title, 'experiment', e.title, 'email', i.email, 'status', i.status,
        'delivery_issue', i.delivery_issue, 'error', i.error, 'created_at', i.created_at, 'sent_at', i.sent_at,
        'reminded_at', i.reminded_at, 'responded_at', i.responded_at, 'retention_until', i.retention_until,
        'response', (select jsonb_build_object('id', r.id, 'created_at', r.created_at, 'source', r.source,
                       'channel', r.channel, 'answers', r.answers, 'retention_until', r.retention_until)
                     from public.survey_responses r where r.invitation_id = i.id)
      ) order by i.created_at), '[]'::jsonb)
      from public.survey_invitations i
      join public.ideas d on d.id = i.idea_id
      join public.experiments e on e.id = i.experiment_id
      where d.org_id = p_org and (i.email = v_email or i.email_hash = any(v_hashes))),
    'test_submissions', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', s.id, 'idea', d.title, 'experiment', e.title, 'email', s.email, 'answers', s.answers,
        'channel', s.channel, 'consent_text', s.consent_text, 'created_at', s.created_at, 'retention_until', s.retention_until
      ) order by s.created_at), '[]'::jsonb)
      from public.test_submissions s
      join public.ideas d on d.id = s.idea_id
      join public.experiments e on e.id = s.experiment_id
      where d.org_id = p_org and s.email = v_email),
    'email_suppressions', (
      select coalesce(jsonb_agg(jsonb_build_object('created_at', x.created_at, 'reason', x.reason) order by x.created_at), '[]'::jsonb)
      from public.email_suppressions x where x.org_id = p_org and x.email_hash = any(v_hashes)),
    'interviews', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', iv.id, 'idea', d.title, 'experiment', coalesce(e.title, 'Verkennend interview'), 'participant_label', iv.participant_label,
        'held_on', iv.held_on, 'label_is_email', lower(iv.participant_label) = v_email,
        'transcript_mentions_email', strpos(lower(iv.transcript), v_email) > 0,
        'pseudonymized', iv.pseudonymized_at is not null
      ) order by iv.held_on), '[]'::jsonb)
      from public.interviews iv
      join public.ideas d on d.id = iv.idea_id
      left join public.experiments e on e.id = iv.experiment_id
      where d.org_id = p_org and (lower(iv.participant_label) = v_email or strpos(lower(iv.transcript), v_email) > 0)),
    'ai_interviews', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', s.id, 'idea', d.title, 'experiment', e.title, 'status', s.status, 'started_at', s.started_at,
        'code', upper(substr(replace(s.id::text, '-', ''), 1, 4) || '-' || substr(replace(s.id::text, '-', ''), 5, 4)),
        'has_interview', s.interview_id is not null, 'retention_until', s.retention_until
      ) order by s.started_at), '[]'::jsonb)
      from public.ai_interview_sessions s
      join public.ideas d on d.id = s.idea_id
      join public.experiments e on e.id = s.experiment_id
      where d.org_id = p_org and exists (
        select 1 from public.ai_interview_turns t where t.session_id = s.id and t.role = 'respondent' and strpos(lower(t.text), v_email) > 0)),
    'test_payments', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', p.id, 'idea', d.title, 'experiment', e.title, 'mollie_id', p.mollie_id, 'amount', p.amount, 'currency', p.currency,
        'status', p.status, 'mode', p.mode, 'created_at', p.created_at, 'paid_at', p.paid_at, 'refunded_at', p.refunded_at,
        'retention_until', p.retention_until
      ) order by p.created_at), '[]'::jsonb)
      from public.test_payments p join public.ideas d on d.id = p.idea_id join public.experiments e on e.id = p.experiment_id
      where d.org_id = p_org and p.person_key = any(v_hashes)),
    'test_bookings', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', b.id, 'idea', d.title, 'experiment', e.title, 'provider', b.provider, 'status', b.status,
        'booked_at', b.booked_at, 'scheduled_for', b.scheduled_for, 'retention_until', b.retention_until
      ) order by b.booked_at), '[]'::jsonb)
      from public.test_bookings b join public.ideas d on d.id = b.idea_id join public.experiments e on e.id = b.experiment_id
      where d.org_id = p_org and b.person_key = any(v_hashes)),
    'test_commitments', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', c.id, 'idea', d.title, 'experiment', e.title, 'method', c.method, 'status', c.status,
        'signer_name', c.signer_name, 'signer_org', c.signer_org, 'signed_at', c.signed_at,
        'has_document', c.document_path is not null, 'retention_until', c.retention_until
      ) order by c.created_at), '[]'::jsonb)
      from public.test_commitments c join public.ideas d on d.id = c.idea_id join public.experiments e on e.id = c.experiment_id
      where d.org_id = p_org and c.person_key = any(v_hashes)),
    'team_account', (
      select coalesce(jsonb_agg(jsonb_build_object('full_name', p.full_name, 'role', m.role, 'member_since', m.created_at)), '[]'::jsonb)
      from public.profiles p join public.organization_members m on m.user_id = p.user_id and m.org_id = p_org
      where lower(p.email) = v_email),
    'client_access', (
      select coalesce(jsonb_agg(jsonb_build_object('idea', d.title, 'role', im.role, 'invited_at', im.created_at,
                                                   'account_linked', im.user_id is not null) order by im.created_at), '[]'::jsonb)
      from public.idea_members im join public.ideas d on d.id = im.idea_id
      where d.org_id = p_org and lower(im.email) = v_email)
  );
  -- The request itself is logged, without the address.
  insert into public.audit_events (org_id, actor_id, table_name, row_id, action, detail)
  values (p_org, auth.uid(), 'privacy_requests', gen_random_uuid()::text, 'dsr_search', jsonb_build_object(
    'invitations', jsonb_array_length(out->'survey_invitations'), 'submissions', jsonb_array_length(out->'test_submissions'),
    'suppressions', jsonb_array_length(out->'email_suppressions'), 'interviews', jsonb_array_length(out->'interviews'),
    'ai_interviews', jsonb_array_length(out->'ai_interviews'),
    'payments', jsonb_array_length(out->'test_payments'), 'bookings', jsonb_array_length(out->'test_bookings'),
    'commitments', jsonb_array_length(out->'test_commitments')));
  return out;
end $$;

-- ---------------------------------------------------------------------------
-- Rechten op functies
-- ---------------------------------------------------------------------------

revoke execute on function
  public.guard_interview_ai(), public.stamp_observation_ai(), public.guard_ai_interview_config(), public.audit_ai_interview_session(),
  public.ai_interview_budget(uuid), public.ai_interview_availability(public.ai_interview_configs, public.experiments),
  public.ai_interview_materialize(uuid, text, jsonb, jsonb),
  public.ai_interview_public(text, text),
  public.ai_interview_start(text, text, text, text, text, text, jsonb, boolean, text, text, text),
  public.ai_interview_state(text, text),
  public.ai_interview_answer(text, text, text, text[], jsonb, text),
  public.ai_interview_ask(text, text, text, text, int, int, jsonb),
  public.ai_interview_finish(text, text, text, text, jsonb, jsonb),
  public.ai_interview_log_run(text, text, text, text, text, text, int, int, numeric, text, text),
  public.ai_interview_exclude(uuid, text), public.ai_interview_include(uuid, text, jsonb, jsonb), public.ai_interview_delete(uuid)
  from public, anon, authenticated;
-- Met de ingest-sleutel (alleen op de app-server): de publieke chatpagina en haar API.
grant execute on function
  public.ai_interview_public(text, text),
  public.ai_interview_start(text, text, text, text, text, text, jsonb, boolean, text, text, text),
  public.ai_interview_state(text, text),
  public.ai_interview_answer(text, text, text, text[], jsonb, text),
  public.ai_interview_ask(text, text, text, text, int, int, jsonb),
  public.ai_interview_finish(text, text, text, text, jsonb, jsonb),
  public.ai_interview_log_run(text, text, text, text, text, text, int, int, numeric, text, text)
  to anon, authenticated;
-- Het onderzoeksteam (de functies controleren can_write_idea zelf).
grant execute on function public.ai_interview_exclude(uuid, text), public.ai_interview_include(uuid, text, jsonb, jsonb), public.ai_interview_delete(uuid)
  to authenticated;

commit;
