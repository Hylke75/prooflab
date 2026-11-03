-- Survey quality: screening, attention checks, straightlining, key-metric counting in the database and
-- per-question summaries that consultants can share with clients.
--
-- One source of truth for "believable": the TypeScript rule assessResponse() in lib/domain/survey.ts. The submit
-- route validates the answers against the locked survey, applies that rule and passes the outcome to
-- submit_survey(), which stores it in survey_responses.qualified and .quality. The database never re-implements
-- the rule: survey_key_counts() only counts the stored flags (and the pre-registered success options of the key
-- question). Rows stored before this migration are backfilled once below with the duration rule they were
-- judged by until now (two seconds per question, at least eight seconds).

-- ---------------------------------------------------------------------------
-- 1. Stored quality flags
-- ---------------------------------------------------------------------------

alter table public.survey_responses
  add column qualified boolean,
  add column quality text check (quality in ('ok', 'too_fast', 'attention', 'straightlining'));

update public.survey_responses r
set qualified = true,
    quality = case
      when r.duration_ms is not null
       and r.duration_ms < greatest(8000, coalesce(jsonb_array_length(e.config -> 'questions'), 0) * 2000) then 'too_fast'
      else 'ok' end
from public.experiments e
where e.id = r.experiment_id and r.quality is null;

alter table public.survey_responses alter column qualified set not null, alter column quality set not null;

-- ---------------------------------------------------------------------------
-- 2. Public RPCs
-- ---------------------------------------------------------------------------

-- The respondent's view: also without the qualifying screening answers and the correct answer of attention checks.
create or replace function public.get_public_survey(p_slug text, p_token_hash text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', e.id, 'state', e.state,
    'config', (e.config - 'key_question' - 'success_options') #- '{screening,qualifying}'
      || jsonb_build_object('questions', coalesce((
           select jsonb_agg(q.value - 'attention' order by q.ordinality)
           from jsonb_array_elements(case when jsonb_typeof(e.config -> 'questions') = 'array' then e.config -> 'questions' else '[]'::jsonb end)
             with ordinality as q(value, ordinality)), '[]'::jsonb)),
    'ends_at', e.ends_at,
    'invitation', case when p_token_hash is null then null else (
      select jsonb_build_object('status', i.status) from public.survey_invitations i
      where i.token_hash = p_token_hash and i.experiment_id = e.id) end)
  from public.experiments e
  where e.public_slug = p_slug and e.type = 'survey' and e.state in ('approved', 'live', 'paused', 'ended', 'analyzed', 'decided');
$$;

-- The complete, locked survey for the app server (ingest secret), which validates and assesses answers with it.
create or replace function public.get_survey_config(p_key text, p_slug text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.ingest_key_ok(p_key) then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  return (select e.config from public.experiments e
          where e.public_slug = p_slug and e.type = 'survey' and e.state in ('approved', 'live', 'paused', 'ended', 'analyzed', 'decided'));
end $$;

drop function public.submit_survey(text, text, text, text, jsonb, boolean, int, text, text);

-- p_qualified and p_quality: the outcome of assessResponse() in the app server (see the header of this file).
create function public.submit_survey(
  p_key text, p_slug text, p_visitor text, p_channel text, p_answers jsonb, p_consent boolean,
  p_duration_ms int, p_token_hash text, p_rate_bucket text, p_qualified boolean, p_quality text)
returns text language plpgsql security definer set search_path = '' as $$
declare
  e public.experiments;
  inv public.survey_invitations;
  v_rows int;
begin
  if not public.ingest_key_ok(p_key) then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  select * into e from public.experiments where public_slug = p_slug and type = 'survey';
  if e.id is null or e.state <> 'live' or (e.ends_at is not null and now() > e.ends_at) then
    return 'closed';
  end if;
  if not coalesce(p_consent, false) then
    return 'consent';
  end if;
  if pg_column_size(coalesce(p_answers, '{}'::jsonb)) > 20000 or jsonb_typeof(coalesce(p_answers, '{}'::jsonb)) <> 'object'
     or p_qualified is null or p_quality is null or p_quality not in ('ok', 'too_fast', 'attention', 'straightlining') then
    return 'invalid';
  end if;
  if not public.ingest_allowed(coalesce(p_rate_bucket, '') || ':survey:' || p_slug) then
    return 'rate';
  end if;
  if p_token_hash is not null then
    select * into inv from public.survey_invitations where token_hash = p_token_hash and experiment_id = e.id;
    if inv.id is null or inv.status in ('unsubscribed') then
      return 'invalid';
    end if;
    if inv.status = 'responded' then
      return 'duplicate';
    end if;
  end if;
  insert into public.survey_responses (experiment_id, idea_id, visitor_hash, invitation_id, source, channel, answers, consent_given, duration_ms, qualified, quality)
  values (e.id, e.idea_id, left(p_visitor, 64), inv.id,
          case when inv.id is null then 'open_link' else 'invitation' end,
          left(coalesce(nullif(p_channel, ''), case when inv.id is null then 'direct' else 'email' end), 40),
          p_answers, true, greatest(0, least(coalesce(p_duration_ms, 0), 86400000)), p_qualified, p_quality)
  on conflict do nothing;
  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    return 'duplicate';
  end if;
  if inv.id is not null then
    update public.survey_invitations set status = 'responded', responded_at = now() where id = inv.id;
  end if;
  return 'ok';
end $$;

-- ---------------------------------------------------------------------------
-- 3. The key metric, counted in the database
-- ---------------------------------------------------------------------------

-- Per source × channel: all responses, believable answers to the key question (n) and how many chose a success
-- option, plus the excluded responses by reason. Readable for everyone who can read the dossier (clients too):
-- counts only, no answers. Replaces loading every row through survey_key_answers() on each page view.
create or replace function public.survey_key_counts(p_experiment uuid)
returns table (source text, channel text, responses int, n int, successes int, too_fast int, screened_out int, failed_attention int, straightlining int)
language sql stable security definer set search_path = '' as $$
  with e as (
    select x.id, x.config ->> 'key_question' as key_q,
           array(select jsonb_array_elements_text(case when jsonb_typeof(x.config -> 'success_options') = 'array' then x.config -> 'success_options' else '[]'::jsonb end)) as success
    from public.experiments x
    where x.id = p_experiment and x.type = 'survey' and public.can_read_idea(x.idea_id)
  ), r as (
    select r.source, r.channel, r.qualified, r.quality,
           case jsonb_typeof(r.answers -> e.key_q)
             when 'string' then jsonb_build_array(r.answers -> e.key_q)
             when 'array' then r.answers -> e.key_q end as key_answer,
           e.success
    from public.survey_responses r join e on e.id = r.experiment_id
  )
  select r.source, r.channel,
         count(*)::int,
         count(*) filter (where r.qualified and r.quality = 'ok' and r.key_answer is not null)::int,
         count(*) filter (where r.qualified and r.quality = 'ok' and r.key_answer is not null and r.key_answer ?| r.success)::int,
         count(*) filter (where r.qualified and r.quality = 'too_fast')::int,
         count(*) filter (where not r.qualified)::int,
         count(*) filter (where r.qualified and r.quality = 'attention')::int,
         count(*) filter (where r.qualified and r.quality = 'straightlining')::int
  from r
  group by r.source, r.channel
  order by r.source, r.channel;
$$;

-- ---------------------------------------------------------------------------
-- 4. Sharing per-question summaries with clients
-- ---------------------------------------------------------------------------

-- Which closed questions (choice, scale, number; never open text) the research team shows to clients. A separate
-- table because experiments.config is locked after approval, while sharing is decided when results come in.
create table public.survey_shares (
  id uuid primary key default gen_random_uuid(),
  experiment_id uuid not null unique references public.experiments(id) on delete cascade,
  idea_id uuid not null references public.ideas(id) on delete cascade,
  questions text[] not null default '{}' check (cardinality(questions) <= 25),
  updated_by uuid not null default auth.uid() references auth.users(id),
  updated_at timestamptz not null default now()
);
create index survey_shares_idea_idx on public.survey_shares(idea_id);
create index survey_shares_updated_by_fk on public.survey_shares(updated_by);
alter table public.survey_shares enable row level security;
create policy survey_shares_select on public.survey_shares for select to authenticated using (public.can_read_idea(idea_id));
create policy survey_shares_insert on public.survey_shares for insert to authenticated with check (public.can_write_idea(idea_id));
create policy survey_shares_update on public.survey_shares for update to authenticated
  using (public.can_write_idea(idea_id)) with check (public.can_write_idea(idea_id));
create policy survey_shares_delete on public.survey_shares for delete to authenticated using (public.can_write_idea(idea_id));
-- Who changed the sharing and when is set by the database, not by the client.
create or replace function public.stamp_survey_share()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_by := coalesce(auth.uid(), new.updated_by);
  new.updated_at := now();
  if tg_op = 'UPDATE' then
    new.experiment_id := old.experiment_id;
    new.idea_id := old.idea_id;
  end if;
  return new;
end $$;
create trigger survey_shares_stamp before insert or update on public.survey_shares
  for each row execute function public.stamp_survey_share();
create trigger survey_shares_refs before insert or update on public.survey_shares
  for each row execute function public.check_idea_refs('experiment_id', 'experiments');
create trigger survey_shares_audit after insert or update or delete on public.survey_shares
  for each row execute function public.audit_row();

-- Counts per answer value for the shared closed questions, over believable responses from the target group only.
-- Open answers, attention checks and questions that were not shared never leave the database this way. Below
-- five believable answers a shared question returns nothing (a single answer could be recognised; the app uses
-- the same minimum: SHARE_MIN_N in lib/domain/survey-results.ts).
create or replace function public.survey_shared_summaries(p_experiment uuid)
returns table (question_id text, value text, answers int, count int)
language sql stable security definer set search_path = '' as $$
  with e as (
    select x.id, x.config from public.experiments x
    where x.id = p_experiment and x.type = 'survey' and public.can_read_idea(x.idea_id)
  ), q as (
    select qq ->> 'id' as qid
    from e, jsonb_array_elements(case when jsonb_typeof(e.config -> 'questions') = 'array' then e.config -> 'questions' else '[]'::jsonb end) qq
    where qq ->> 'type' in ('single', 'multi', 'scale', 'number') and not (qq ? 'attention')
      and (qq ->> 'id') = any (select unnest(s.questions) from public.survey_shares s where s.experiment_id = e.id)
  ), a as (
    select q.qid, r.answers -> q.qid as v
    from public.survey_responses r join e on e.id = r.experiment_id cross join q
    where r.qualified and r.quality = 'ok' and jsonb_typeof(r.answers -> q.qid) in ('string', 'number', 'array')
  ), n as (
    select a.qid, count(*)::int as answers from a group by a.qid having count(*) >= 5
  ), vals as (
    select a.qid, x.value from a cross join lateral jsonb_array_elements_text(a.v) x where jsonb_typeof(a.v) = 'array'
    union all
    select a.qid, a.v #>> '{}' from a where jsonb_typeof(a.v) <> 'array'
  )
  select vals.qid, vals.value, n.answers, count(*)::int
  from vals join n on n.qid = vals.qid
  group by vals.qid, vals.value, n.answers
  order by vals.qid, vals.value;
$$;

-- ---------------------------------------------------------------------------
-- 5. Grants
-- ---------------------------------------------------------------------------

revoke execute on function public.stamp_survey_share() from public, anon, authenticated;
revoke all on public.survey_shares from anon;
grant select, insert, update, delete on public.survey_shares to authenticated;

revoke execute on function public.get_survey_config(text, text),
  public.submit_survey(text, text, text, text, jsonb, boolean, int, text, text, boolean, text) from public, authenticated;
grant execute on function public.get_survey_config(text, text),
  public.submit_survey(text, text, text, text, jsonb, boolean, int, text, text, boolean, text) to anon;

revoke execute on function public.survey_key_counts(uuid), public.survey_shared_summaries(uuid) from public, anon;
grant execute on function public.survey_key_counts(uuid), public.survey_shared_summaries(uuid) to authenticated;
