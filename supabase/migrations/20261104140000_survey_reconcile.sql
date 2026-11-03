-- Reconciles two migrations that both redefined submit_survey from the surveys.sql version:
--   20261104090000_survey_quality.sql      added p_qualified, p_quality (stored quality flags)
--   20261104100000_privacy_and_outreach.sql added p_content (post code of an open link)
-- After both ran, two overloads existed and the p_content one inserted no quality flags (NOT NULL columns). This
-- leaves exactly one submit_survey with all parameters, and counts the key metric per post code as well, using the
-- stored flags, so per-post survey numbers follow the same believability rule as the verdict.

drop function if exists public.submit_survey(text, text, text, text, jsonb, boolean, int, text, text);
drop function if exists public.submit_survey(text, text, text, text, jsonb, boolean, int, text, text, text);
drop function if exists public.submit_survey(text, text, text, text, jsonb, boolean, int, text, text, boolean, text);

-- p_qualified and p_quality: the outcome of assessResponse() in the app server (see 20261104090000). p_content: the
-- post code (utm_content) of an open link; never stored for invitations.
create function public.submit_survey(
  p_key text, p_slug text, p_visitor text, p_channel text, p_answers jsonb, p_consent boolean,
  p_duration_ms int, p_token_hash text, p_rate_bucket text, p_qualified boolean, p_quality text,
  p_content text default null)
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
  insert into public.survey_responses (experiment_id, idea_id, visitor_hash, invitation_id, source, channel, answers, consent_given, duration_ms, content, qualified, quality)
  values (e.id, e.idea_id, left(p_visitor, 64), inv.id,
          case when inv.id is null then 'open_link' else 'invitation' end,
          left(coalesce(nullif(p_channel, ''), case when inv.id is null then 'direct' else 'email' end), 40),
          p_answers, true, greatest(0, least(coalesce(p_duration_ms, 0), 86400000)),
          case when inv.id is null then public.clean_content(p_content) end,
          p_qualified, p_quality)
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

-- The key metric per source × channel × post code (content null: no post code). Same counting as before; callers
-- that do not need the post code sum over it.
drop function if exists public.survey_key_counts(uuid);
create function public.survey_key_counts(p_experiment uuid)
returns table (source text, channel text, content text, responses int, n int, successes int, too_fast int, screened_out int, failed_attention int, straightlining int)
language sql stable security definer set search_path = '' as $$
  with e as (
    select x.id, x.config ->> 'key_question' as key_q,
           array(select jsonb_array_elements_text(case when jsonb_typeof(x.config -> 'success_options') = 'array' then x.config -> 'success_options' else '[]'::jsonb end)) as success
    from public.experiments x
    where x.id = p_experiment and x.type = 'survey' and public.can_read_idea(x.idea_id)
  ), r as (
    select r.source, r.channel, r.content, r.qualified, r.quality,
           case jsonb_typeof(r.answers -> e.key_q)
             when 'string' then jsonb_build_array(r.answers -> e.key_q)
             when 'array' then r.answers -> e.key_q end as key_answer,
           e.success
    from public.survey_responses r join e on e.id = r.experiment_id
  )
  select r.source, r.channel, r.content,
         count(*)::int,
         count(*) filter (where r.qualified and r.quality = 'ok' and r.key_answer is not null)::int,
         count(*) filter (where r.qualified and r.quality = 'ok' and r.key_answer is not null and r.key_answer ?| r.success)::int,
         count(*) filter (where r.qualified and r.quality = 'too_fast')::int,
         count(*) filter (where not r.qualified)::int,
         count(*) filter (where r.qualified and r.quality = 'attention')::int,
         count(*) filter (where r.qualified and r.quality = 'straightlining')::int
  from r
  group by r.source, r.channel, r.content
  order by r.source, r.channel, r.content nulls first;
$$;

revoke execute on function public.submit_survey(text, text, text, text, jsonb, boolean, int, text, text, boolean, text, text) from public, authenticated;
grant execute on function public.submit_survey(text, text, text, text, jsonb, boolean, int, text, text, boolean, text, text) to anon;
revoke execute on function public.survey_key_counts(uuid) from public, anon;
grant execute on function public.survey_key_counts(uuid) to authenticated;
