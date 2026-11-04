-- Fase 1 · punt 3: interviews importeren en analyseren over alle interviews heen (IMPLEMENTATION_STATUS.md, sectie
-- "Fase 1 · punt 3: Interviews importeren en analyseren"). Door de product owner goedgekeurd.
--
-- 1. interviews: bronformaat, vingerafdruk tegen dubbele import, segmenten (sprekers en posities, zonder tekst),
--    pseudonimisering (wanneer, door wie, alleen labels met aantallen) en een verkennend interview zonder test
--    (experiment_id leeg). Een verkennend interview beslist nooit over status of kans: de database weigert een
--    koppeling van zijn waarnemingen aan een aanname.
-- 2. observations: de positie van een gemarkeerd citaat in het transcript (quote_start/quote_end/segment_index) en
--    theme_only voor citaten die alleen bij een thema horen (AI-themavoorstel). Die tellen nergens mee: niet in de
--    kans, niet in het aantal deelnemers van een test, niet als ontdekkingsbewijs.
-- 3. Rollen in het koopproces: 'payer' (betaler) los van 'buyer' (inkoper).
-- 4. Thema's: interview_codes en observation_codes, met beoordeling en auditspoor. Thema's tellen nooit mee in de kans.
-- 5. interview_theme_counts(p_idea): aantallen per thema en per aanname (X van N geïnterviewden), per rol en
--    wervingsgroep, zonder citaten, voor iedereen die het dossier mag lezen.
-- 6. Bewaartermijn: na retention_until verdwijnen ook segmenten en citaatposities; de aantallen blijven.
-- 7. Privacyverzoeken: verkennende interviews (zonder test) worden ook gevonden.
-- 8. Fathom: een API-sleutel per werkruimte, alleen via functies leesbaar en nooit in het auditspoor.
--
-- Idempotent: opnieuw uitvoeren verandert niets. Zonder deze migratie werkt de app zoals voorheen: importeren meldt
-- dat de database nog moet worden bijgewerkt, plakken blijft werken, thema's zijn niet beschikbaar.

begin;

-- ---------------------------------------------------------------------------
-- 1. interviews
-- ---------------------------------------------------------------------------

alter table public.interviews alter column experiment_id drop not null;
alter table public.interviews
  add column if not exists source_format text not null default 'paste',
  add column if not exists source_hash text,
  add column if not exists segments jsonb,
  add column if not exists pseudonymized_at timestamptz,
  add column if not exists pseudonymized_by uuid references auth.users(id) on delete set null,
  add column if not exists pseudonym_labels jsonb;

alter table public.interviews drop constraint if exists interviews_source_format_check;
alter table public.interviews add constraint interviews_source_format_check
  check (source_format in ('paste', 'txt', 'md', 'docx', 'vtt', 'srt', 'fathom'));
alter table public.interviews drop constraint if exists interviews_source_hash_check;
alter table public.interviews add constraint interviews_source_hash_check check (source_hash is null or source_hash ~ '^[a-f0-9]{64}$');
alter table public.interviews drop constraint if exists interviews_segments_check;
alter table public.interviews add constraint interviews_segments_check
  check (segments is null or (jsonb_typeof(segments) = 'array' and pg_column_size(segments) <= 600000));
alter table public.interviews drop constraint if exists interviews_pseudonym_labels_check;
alter table public.interviews add constraint interviews_pseudonym_labels_check
  check (pseudonym_labels is null or (jsonb_typeof(pseudonym_labels) = 'object' and pg_column_size(pseudonym_labels) <= 20000));

-- Hetzelfde transcript wordt per dossier één keer geïmporteerd (de vingerafdruk is een SHA-256 van de originele
-- tekst; de tekst zelf wordt niet bewaard). Eén gesprek in twee tests zou dezelfde persoon twee keer laten tellen.
create unique index if not exists interviews_source_hash_uniq on public.interviews(idea_id, source_hash) where source_hash is not null;
create index if not exists interviews_pseudonymized_by_fk on public.interviews(pseudonymized_by);

-- Langere transcripten (was 100.000 tekens; de app staat 200.000 toe, pseudoniemen kunnen iets langer zijn).
alter table public.interviews drop constraint if exists interviews_transcript_len;
alter table public.interviews add constraint interviews_transcript_len check (char_length(transcript) <= 250000) not valid;

-- 3. Betaler los van inkoper.
alter table public.interviews drop constraint if exists interviews_dmu_role_check;
alter table public.interviews add constraint interviews_dmu_role_check
  check (dmu_role in ('user', 'buyer', 'payer', 'decider', 'influencer', 'other'));

comment on column public.interviews.experiment_id is
  'De interviewtest. Leeg = verkennend interview (geïmporteerd vanuit Markt): beslist nooit over status of kans.';
comment on column public.interviews.segments is
  'Segmenten als [{s: spreker (pseudoniem), t0/t1: tijd in ms, a/b: positie in transcript}], zonder tekst. Leeg na de bewaartermijn.';
comment on column public.interviews.pseudonym_labels is
  'Alleen labels, soorten en aantallen ({labels: [{label, kind, count}], declined}); nooit de originele namen.';
comment on column public.interviews.source_hash is
  'SHA-256 van de originele tekst, tegen dubbele import. Het originele bestand wordt niet bewaard.';

-- Pseudonimisering en bewaartermijn bij import, en wat daarna vastligt.
-- - Insert met pseudonymized_at: de database zet tijd en gebruiker, en de bewaartermijn telt vanaf de gespreksdatum
--   (held_on + 12 maanden).
-- - Update door een gebruiker: bron, vingerafdruk, pseudonimisering en de test liggen vast (een verkennend interview
--   wordt nooit achteraf bewijs in een test). Transcript en segmenten veranderen alleen zolang er nog geen enkele
--   observatie aan het interview hangt: daarna zouden citaten en posities niet meer kloppen.
-- - De opschoontaak (zonder gebruiker) mag alles wissen.
create or replace function public.stamp_interview_import()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if new.pseudonymized_at is not null then
      new.pseudonymized_at := now();
      new.pseudonymized_by := auth.uid();
      new.retention_until := (new.held_on + interval '12 months')::date;
    else
      new.pseudonymized_by := null;
    end if;
    return new;
  end if;
  if auth.uid() is null then
    return new;
  end if;
  if (new.source_format, new.source_hash, new.pseudonymized_by) is distinct from (old.source_format, old.source_hash, old.pseudonymized_by)
     or new.experiment_id is distinct from old.experiment_id then
    raise exception 'INTERVIEW_LOCKED: bron, pseudonimisering en test van een interview liggen vast' using errcode = 'P0001';
  end if;
  if (new.transcript, new.segments, new.pseudonym_labels) is distinct from (old.transcript, old.segments, old.pseudonym_labels) then
    if exists (select 1 from public.observations o where o.interview_id = old.id) then
      raise exception 'INTERVIEW_MARKED: het transcript verandert niet meer zodra er observaties aan hangen' using errcode = 'P0001';
    end if;
    if old.pseudonymized_at is not null then
      new.pseudonymized_at := now();
    end if;
  elsif new.pseudonymized_at is distinct from old.pseudonymized_at then
    new.pseudonymized_at := old.pseudonymized_at;
  end if;
  return new;
end $$;
drop trigger if exists interviews_import_stamp on public.interviews;
create trigger interviews_import_stamp before insert or update on public.interviews
  for each row execute function public.stamp_interview_import();

-- Een eigen auditregel bij een geïmporteerd interview: bronformaat, aantal segmenten en de labels met aantallen.
create or replace function public.audit_interview_import()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.pseudonymized_at is null and new.source_format = 'paste' then
    return null;
  end if;
  insert into public.audit_events (idea_id, org_id, actor_id, table_name, row_id, action, detail)
  values (new.idea_id, (select i.org_id from public.ideas i where i.id = new.idea_id), auth.uid(), 'interviews', new.id::text, 'import',
          jsonb_build_object('source_format', new.source_format, 'segments', coalesce(jsonb_array_length(new.segments), 0),
                             'pseudonymized', new.pseudonymized_at is not null, 'labels', coalesce(new.pseudonym_labels, '{}'::jsonb),
                             'exploratory', new.experiment_id is null, 'retention_until', new.retention_until));
  return null;
end $$;
drop trigger if exists interviews_import_audit on public.interviews;
create trigger interviews_import_audit after insert on public.interviews
  for each row execute function public.audit_interview_import();

-- ---------------------------------------------------------------------------
-- 2. observations: positie van het citaat en thema-citaten
-- ---------------------------------------------------------------------------

alter table public.observations
  add column if not exists quote_start int,
  add column if not exists quote_end int,
  add column if not exists segment_index int,
  add column if not exists theme_only boolean not null default false;

alter table public.observations drop constraint if exists observations_quote_position_check;
alter table public.observations add constraint observations_quote_position_check
  check ((quote_start is null and quote_end is null) or (quote_start >= 0 and quote_end > quote_start));
alter table public.observations drop constraint if exists observations_segment_index_check;
alter table public.observations add constraint observations_segment_index_check check (segment_index is null or segment_index >= 0);
alter table public.observations drop constraint if exists observations_theme_only_check;
alter table public.observations add constraint observations_theme_only_check
  check (not theme_only or (kind = 'other' and interview_id is not null and origin in ('ai', 'manual')));

comment on column public.observations.quote_start is 'Begin (in tekens) van het gemarkeerde citaat in interviews.transcript; leeg na de bewaartermijn.';
comment on column public.observations.theme_only is
  'Citaat dat alleen bij een thema hoort (AI-themavoorstel). Telt nergens mee: niet in de kans, niet als deelnemer, niet als ontdekkingsbewijs.';

-- Alleen observaties uit een interviewtest kunnen aan een aanname worden gekoppeld. Waarnemingen uit een verkennend
-- interview (zonder test) en thema-citaten beslissen nooit over status of kans.
create or replace function public.guard_assumption_observation_scope()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_theme boolean;
  v_interview uuid;
  v_exp uuid;
begin
  select o.theme_only, o.interview_id into v_theme, v_interview from public.observations o where o.id = new.observation_id;
  if v_theme then
    raise exception 'THEME_ONLY: een thema-citaat telt niet mee in de kans' using errcode = 'P0001';
  end if;
  if v_interview is not null then
    select i.experiment_id into v_exp from public.interviews i where i.id = v_interview;
    if v_exp is null then
      raise exception 'EXPLORATORY_INTERVIEW: een verkennend interview beslist niet over een aanname' using errcode = 'P0001';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists assumption_observations_scope on public.assumption_observations;
create trigger assumption_observations_scope before insert or update on public.assumption_observations
  for each row execute function public.guard_assumption_observation_scope();

-- Opdrachtgevers (en de kansberekening) lezen observaties via deze functie: zonder citaat, en zonder thema-citaten.
create or replace function public.observations_for_idea(p_idea uuid)
returns table (
  id uuid, idea_id uuid, experiment_id uuid, interview_id uuid, kind text, summary text, quote text,
  quote_check text, is_fact boolean, is_behaviour boolean, is_real_context boolean, is_costly boolean,
  is_synthetic boolean, origin text, review_status text, created_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select o.id, o.idea_id, o.experiment_id, o.interview_id, o.kind, o.summary,
         case when public.can_write_idea(o.idea_id) then o.quote else null end,
         o.quote_check, o.is_fact, o.is_behaviour, o.is_real_context, o.is_costly, o.is_synthetic,
         o.origin, o.review_status, o.created_at
  from public.observations o
  where o.idea_id = p_idea and public.can_read_idea(p_idea) and not o.theme_only;
$$;
revoke execute on function public.observations_for_idea(uuid) from public, anon;
grant execute on function public.observations_for_idea(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Thema's
-- ---------------------------------------------------------------------------

create table if not exists public.interview_codes (
  id uuid primary key default gen_random_uuid(),
  idea_id uuid not null references public.ideas(id) on delete cascade,
  label text not null check (char_length(btrim(label)) between 3 and 80),
  description text check (char_length(description) <= 400),
  origin text not null default 'manual' check (origin in ('ai', 'manual')),
  status text not null default 'accepted' check (status in ('proposed', 'accepted', 'rejected')),
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create unique index if not exists interview_codes_label_uniq on public.interview_codes(idea_id, lower(btrim(label)));
create index if not exists interview_codes_reviewed_by_fk on public.interview_codes(reviewed_by);
create index if not exists interview_codes_created_by_fk on public.interview_codes(created_by);

create table if not exists public.observation_codes (
  observation_id uuid not null references public.observations(id) on delete cascade,
  code_id uuid not null references public.interview_codes(id) on delete cascade,
  idea_id uuid not null references public.ideas(id) on delete cascade,
  origin text not null default 'manual' check (origin in ('ai', 'manual')),
  review_status text check (review_status in ('accepted', 'rejected')),
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (observation_id, code_id)
);
create index if not exists observation_codes_code_idx on public.observation_codes(code_id);
create index if not exists observation_codes_idea_idx on public.observation_codes(idea_id);
create index if not exists observation_codes_reviewed_by_fk on public.observation_codes(reviewed_by);

comment on table public.interview_codes is
  'Thema''s over interviews heen. Een AI-thema is een voorstel tot een consultant het accepteert. Thema''s tellen nooit mee in de kans.';
comment on table public.observation_codes is
  'Toewijzing van een thema aan een interviewcitaat. Telt mee in "X van N geïnterviewden" als hij handmatig is, of van de AI en geaccepteerd.';

drop trigger if exists observation_codes_refs on public.observation_codes;
create trigger observation_codes_refs before insert or update on public.observation_codes
  for each row execute function public.check_idea_refs('observation_id', 'observations', 'code_id', 'interview_codes');

-- Een AI-thema begint als voorstel en wordt één keer beoordeeld; een handmatig thema is meteen geaccepteerd. Herkomst,
-- dossier en maker liggen vast; label en omschrijving mag een consultant verbeteren.
create or replace function public.guard_interview_code()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
    new.created_at := now();
    new.status := case when new.origin = 'ai' then 'proposed' else 'accepted' end;
    new.reviewed_by := null;
    new.reviewed_at := null;
    return new;
  end if;
  if auth.uid() is null then
    return new;
  end if;
  if (new.idea_id, new.origin, new.created_by, new.created_at) is distinct from (old.idea_id, old.origin, old.created_by, old.created_at) then
    raise exception 'CODE_LOCKED: herkomst en dossier van een thema liggen vast' using errcode = 'P0001';
  end if;
  if new.status is distinct from old.status then
    if old.status <> 'proposed' or new.status not in ('accepted', 'rejected') then
      raise exception 'CODE_REVIEWED: een thema wordt één keer beoordeeld' using errcode = 'P0001';
    end if;
    new.reviewed_by := auth.uid();
    new.reviewed_at := now();
  else
    new.reviewed_by := old.reviewed_by;
    new.reviewed_at := old.reviewed_at;
  end if;
  return new;
end $$;
drop trigger if exists interview_codes_guard on public.interview_codes;
create trigger interview_codes_guard before insert or update on public.interview_codes
  for each row execute function public.guard_interview_code();

-- Een toewijzing hoort bij een interviewcitaat. Een AI-toewijzing wordt één keer beoordeeld; verder verandert niets.
create or replace function public.guard_observation_code()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if not exists (select 1 from public.observations o where o.id = new.observation_id and o.interview_id is not null) then
      raise exception 'CODE_SCOPE: thema''s horen bij citaten uit een interview' using errcode = 'P0001';
    end if;
    new.review_status := null;
    new.reviewed_by := null;
    new.reviewed_at := null;
    new.created_at := now();
    return new;
  end if;
  if auth.uid() is null then
    return new;
  end if;
  if (to_jsonb(new) - 'review_status' - 'reviewed_by' - 'reviewed_at') is distinct from (to_jsonb(old) - 'review_status' - 'reviewed_by' - 'reviewed_at')
     or old.origin <> 'ai' or old.review_status is not null or new.review_status is null then
    raise exception 'CODE_ASSIGNMENT_LOCKED: een toewijzing wordt alleen (één keer) beoordeeld' using errcode = 'P0001';
  end if;
  new.reviewed_by := auth.uid();
  new.reviewed_at := now();
  return new;
end $$;
drop trigger if exists observation_codes_guard on public.observation_codes;
create trigger observation_codes_guard before insert or update on public.observation_codes
  for each row execute function public.guard_observation_code();

alter table public.interview_codes enable row level security;
alter table public.observation_codes enable row level security;
drop policy if exists interview_codes_select on public.interview_codes;
drop policy if exists interview_codes_insert on public.interview_codes;
drop policy if exists interview_codes_update on public.interview_codes;
drop policy if exists interview_codes_delete on public.interview_codes;
-- Thema's zelf bevatten geen citaten: iedereen die het dossier mag lezen, ziet ze.
create policy interview_codes_select on public.interview_codes for select to authenticated using (public.can_read_idea(idea_id));
create policy interview_codes_insert on public.interview_codes for insert to authenticated with check (public.can_write_idea(idea_id));
create policy interview_codes_update on public.interview_codes for update to authenticated
  using (public.can_write_idea(idea_id)) with check (public.can_write_idea(idea_id));
create policy interview_codes_delete on public.interview_codes for delete to authenticated using (public.can_write_idea(idea_id));
-- Toewijzingen wijzen naar citaten: alleen het onderzoeksteam. Opdrachtgevers krijgen de aantallen via de functie.
drop policy if exists observation_codes_select on public.observation_codes;
drop policy if exists observation_codes_insert on public.observation_codes;
drop policy if exists observation_codes_update on public.observation_codes;
drop policy if exists observation_codes_delete on public.observation_codes;
create policy observation_codes_select on public.observation_codes for select to authenticated using (public.can_write_idea(idea_id));
create policy observation_codes_insert on public.observation_codes for insert to authenticated with check (public.can_write_idea(idea_id));
create policy observation_codes_update on public.observation_codes for update to authenticated
  using (public.can_write_idea(idea_id)) with check (public.can_write_idea(idea_id));
create policy observation_codes_delete on public.observation_codes for delete to authenticated using (public.can_write_idea(idea_id));

revoke all on public.interview_codes, public.observation_codes from anon;
grant select, insert, update, delete on public.interview_codes, public.observation_codes to authenticated;

do $$
declare t text;
begin
  foreach t in array array['interview_codes', 'observation_codes'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_audit', t);
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function public.audit_row()', t || '_audit', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 5. X van N geïnterviewden, zonder citaten
-- ---------------------------------------------------------------------------

-- N: echte gesprekken (is_practice = false) met vastgelegde toestemming, ook verkennende. X: verschillende van die
-- gesprekken met minstens één meetellende toewijzing. Voor een thema: het thema is geaccepteerd (handmatig of AI na
-- beoordeling) en de toewijzing is handmatig, of van de AI en geaccepteerd. Voor een aanname: een gekoppelde
-- observatie die handmatig is, of van de AI en geaccepteerd. Per dimensie: alles, rol in het koopproces en
-- wervingsgroep (een bekende is eigen netwerk; zonder groep die van de test, anders onbekend). Oefeningen en
-- niet-aangegeven gesprekken vallen buiten N en X. Zelfde regel als lib/domain/theme-counts.ts.
create or replace function public.interview_theme_counts(p_idea uuid)
returns table (item_type text, item_id uuid, label text, dimension text, bucket text, mentioned bigint, total bigint)
language sql stable security definer set search_path = '' as $$
  with base as (
    select i.id, i.dmu_role,
           coalesce(case when i.is_acquaintance then 'own_network' end, i.recruitment_group, e.recruitment_group, 'unknown') as grp
    from public.interviews i
    left join public.experiments e on e.id = i.experiment_id
    where i.idea_id = p_idea and i.is_practice is false and i.consent_recorded and public.can_read_idea(p_idea)
  ),
  dims as (
    select id, 'all'::text as dimension, 'all'::text as bucket from base
    union all select id, 'role', dmu_role from base
    union all select id, 'recruitment', grp from base
  ),
  totals as (select d.dimension, d.bucket, count(*) as total from dims d group by d.dimension, d.bucket),
  items as (
    select 'theme'::text as item_type, c.id as item_id, c.label
    from public.interview_codes c where c.idea_id = p_idea and c.status = 'accepted'
    union all
    select 'assumption', a.id, a.statement from public.assumptions a where a.idea_id = p_idea
  ),
  hits as (
    select distinct 'theme'::text as item_type, c.id as item_id, o.interview_id
    from public.interview_codes c
    join public.observation_codes oc on oc.code_id = c.id
    join public.observations o on o.id = oc.observation_id
    where c.idea_id = p_idea and c.status = 'accepted' and (oc.origin = 'manual' or oc.review_status = 'accepted')
    union
    select distinct 'assumption', ao.assumption_id, o.interview_id
    from public.assumption_observations ao
    join public.observations o on o.id = ao.observation_id
    where ao.idea_id = p_idea and o.interview_id is not null and not o.is_synthetic
      and (o.origin = 'manual' or (o.origin = 'ai' and o.review_status = 'accepted'))
  )
  select it.item_type, it.item_id, it.label, t.dimension, t.bucket,
         (select count(distinct h.interview_id) from hits h join dims d on d.id = h.interview_id
          where h.item_type = it.item_type and h.item_id = it.item_id and d.dimension = t.dimension and d.bucket = t.bucket),
         t.total
  from items it cross join totals t
  where public.can_read_idea(p_idea);
$$;
revoke execute on function public.interview_theme_counts(uuid) from public, anon;
grant execute on function public.interview_theme_counts(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Bewaartermijn: segmenten en citaatposities verdwijnen mee met het transcript
-- ---------------------------------------------------------------------------

create or replace function public.purge_expired_personal_data()
returns int language plpgsql security definer set search_path = '' as $$
declare v1 int; v2 int; v3 int; v4 int; v5 int;
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
  return v1 + v2 + v3 + v4 + v5;
end $$;

-- ---------------------------------------------------------------------------
-- 7. Privacyverzoeken: ook verkennende interviews (zonder test)
-- ---------------------------------------------------------------------------

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
    'suppressions', jsonb_array_length(out->'email_suppressions'), 'interviews', jsonb_array_length(out->'interviews')));
  return out;
end $$;

-- ---------------------------------------------------------------------------
-- 8. Fathom: API-sleutel per werkruimte
-- ---------------------------------------------------------------------------

-- Geen policies: de tabel is alleen via de functies hieronder te gebruiken. Opdrachtgevers (geen lid van de
-- werkruimte) kunnen niets; consultants zien alleen of er een sleutel is en de laatste vier tekens. De sleutel komt
-- niet in het auditspoor (geen audit_row-trigger; de functies leggen vast wie hem zette of verwijderde).
create table if not exists public.org_transcript_settings (
  org_id uuid primary key references public.organizations(id) on delete cascade,
  fathom_api_key text check (fathom_api_key is null or char_length(fathom_api_key) between 16 and 400),
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);
create index if not exists org_transcript_settings_updated_by_fk on public.org_transcript_settings(updated_by);
alter table public.org_transcript_settings enable row level security;
revoke all on public.org_transcript_settings from public, anon, authenticated;

create or replace function public.transcript_settings_status(p_org uuid)
returns table (fathom_connected boolean, fathom_key_hint text, updated_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select s.fathom_api_key is not null, case when s.fathom_api_key is not null then right(s.fathom_api_key, 4) end, s.updated_at
  from public.org_transcript_settings s
  where s.org_id = p_org and public.is_org_member(p_org);
$$;

create or replace function public.set_fathom_api_key(p_org uuid, p_key text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_key text := nullif(btrim(coalesce(p_key, '')), '');
begin
  if auth.uid() is null or not public.is_org_member(p_org) then
    raise exception 'FORBIDDEN: alleen leden van de werkruimte stellen Fathom in' using errcode = 'P0001';
  end if;
  if v_key is not null and (char_length(v_key) < 16 or char_length(v_key) > 400 or v_key ~ '\s') then
    raise exception 'INVALID_KEY: dit lijkt geen Fathom-API-sleutel' using errcode = 'P0001';
  end if;
  insert into public.org_transcript_settings (org_id, fathom_api_key, updated_by, updated_at)
  values (p_org, v_key, auth.uid(), now())
  on conflict (org_id) do update set fathom_api_key = excluded.fathom_api_key, updated_by = excluded.updated_by, updated_at = excluded.updated_at;
  insert into public.audit_events (org_id, actor_id, table_name, row_id, action, detail)
  values (p_org, auth.uid(), 'org_transcript_settings', p_org::text, case when v_key is null then 'fathom_key_removed' else 'fathom_key_set' end,
          case when v_key is null then null else jsonb_build_object('hint', right(v_key, 4)) end);
end $$;

-- De sleutel zelf, alleen op de server en alleen voor wie het dossier mag bewerken.
create or replace function public.fathom_api_key_for_idea(p_idea uuid)
returns text language sql stable security definer set search_path = '' as $$
  select s.fathom_api_key
  from public.ideas i join public.org_transcript_settings s on s.org_id = i.org_id
  where i.id = p_idea and public.can_write_idea(p_idea);
$$;

revoke execute on function public.transcript_settings_status(uuid), public.set_fathom_api_key(uuid, text), public.fathom_api_key_for_idea(uuid) from public, anon;
grant execute on function public.transcript_settings_status(uuid), public.set_fathom_api_key(uuid, text), public.fathom_api_key_for_idea(uuid) to authenticated;
revoke execute on function public.stamp_interview_import(), public.audit_interview_import(), public.guard_assumption_observation_scope(),
  public.guard_interview_code(), public.guard_observation_code() from public, anon, authenticated;

commit;
