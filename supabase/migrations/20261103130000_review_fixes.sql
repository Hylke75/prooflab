-- Fixes from the independent review of 3 November 2026.

-- ---------------------------------------------------------------------------
-- 1. Forecasts only at the open moment; AI forecasts only from the app server
-- ---------------------------------------------------------------------------
-- The moment that is open follows the dossier: intake → research (findings and current alternatives mapped)
-- → experiment (a test has ended) → decision (a Reality Check exists; closes 14 days after the decision that
-- started the six-month clock). Same rule as lib/domain/forecast.ts openMoment.

create or replace function public.open_forecast_moment(p_idea uuid)
returns text language sql stable security definer set search_path = '' as $$
  select case
    when not exists (select 1 from public.ideas i where i.id = p_idea and i.outcome_statement is not null) then null
    when exists (select 1 from public.idea_outcomes o where o.idea_id = p_idea) then null
    when exists (select 1 from public.reality_checks r where r.idea_id = p_idea) then
      case when exists (select 1 from public.ideas i where i.id = p_idea and i.outcome_clock_start is not null
                        and current_date > i.outcome_clock_start + 14) then null else 'decision' end
    when exists (select 1 from public.experiments e where e.idea_id = p_idea and e.state in ('ended', 'analyzed', 'decided')) then 'experiment'
    when exists (select 1 from public.claims c where c.idea_id = p_idea)
      and exists (select 1 from public.competitors c where c.idea_id = p_idea and c.kind in ('alternative', 'status_quo')) then 'research'
    else 'intake'
  end;
$$;

create or replace function public.guard_forecast()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_open text;
begin
  if exists (select 1 from public.idea_outcomes o where o.idea_id = new.idea_id) then
    raise exception 'FORECAST_CLOSED: de uitkomst is al vastgelegd' using errcode = 'P0001';
  end if;
  v_open := public.open_forecast_moment(new.idea_id);
  if v_open is null or v_open <> new.moment then
    raise exception 'FORECAST_MOMENT: voorspellen kan nu alleen bij het open moment (%)', coalesce(v_open, 'geen') using errcode = 'P0001';
  end if;
  new.created_at := now();
  return new;
end $$;

drop policy if exists forecasts_insert on public.forecasts;
create policy forecasts_insert on public.forecasts for insert to authenticated
  with check (
    (forecaster_kind = 'consultant' and forecaster_id = (select auth.uid()) and public.can_write_idea(idea_id))
    or (forecaster_kind = 'client' and forecaster_id = (select auth.uid()) and not public.can_write_idea(idea_id) and public.can_read_idea(idea_id))
  );

-- The app server records the AI forecast after its own model call (guarded by the ingest secret, so a user
-- cannot type in an "AI" forecast through the API).
create or replace function public.record_ai_forecast(p_key text, p_idea uuid, p_moment text, p_probability numeric, p_rationale text, p_model text)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if not public.ingest_key_ok(p_key) or not public.can_write_idea(p_idea) then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  insert into public.forecasts (idea_id, moment, forecaster_kind, forecaster_id, probability, rationale, model)
  values (p_idea, p_moment, 'ai', null, greatest(0.01, least(0.99, p_probability)), left(p_rationale, 600), left(p_model, 80))
  on conflict do nothing;
  return found;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Outreach webhook: say why an event was not recorded, and allow campaign bursts
-- ---------------------------------------------------------------------------

create or replace function public.ingest_allowed(p_bucket text, p_limit int)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_hits int;
begin
  insert into public.ingest_rate as r (bucket, hits, window_start) values (left(p_bucket, 128), 1, now())
  on conflict (bucket) do update set
    hits = case when r.window_start < now() - interval '1 minute' then 1 else r.hits + 1 end,
    window_start = case when r.window_start < now() - interval '1 minute' then now() else r.window_start end
  returning hits into v_hits;
  delete from public.ingest_rate where window_start < now() - interval '1 hour';
  return v_hits <= p_limit;
end $$;

create or replace function public.ingest_allowed(p_bucket text)
returns boolean language sql security definer set search_path = '' as $$
  select public.ingest_allowed(p_bucket, 30);
$$;

drop function if exists public.record_outreach_event(text, text, text, text, text, text, text);
-- Returns ok, duplicate, unknown (token) or rate (try again later).
create or replace function public.record_outreach_event(
  p_key text, p_token_hash text, p_event text, p_contact_hash text, p_campaign text, p_message text, p_dedupe text)
returns text language plpgsql security definer set search_path = '' as $$
declare
  ep public.integration_endpoints;
  v_rows int;
begin
  if not public.ingest_key_ok(p_key) then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  select * into ep from public.integration_endpoints where token_hash = p_token_hash and active;
  if ep.id is null then
    return 'unknown';
  end if;
  if exists (select 1 from public.outreach_events o where o.endpoint_id = ep.id and o.dedupe_key = left(p_dedupe, 200)) then
    return 'duplicate';
  end if;
  -- A campaign launch can send hundreds of events at once; 600 per minute per endpoint.
  if not public.ingest_allowed('outreach:' || ep.id::text, 600) then
    return 'rate';
  end if;
  insert into public.outreach_events (idea_id, endpoint_id, event_type, contact_hash, campaign, message, dedupe_key)
  values (ep.idea_id, ep.id,
          case when p_event in ('connection_request', 'connection_accepted', 'message_sent', 'reply') then p_event else 'other' end,
          left(p_contact_hash, 64), left(p_campaign, 200), left(p_message, 4000), left(p_dedupe, 200))
  on conflict (endpoint_id, dedupe_key) do nothing;
  get diagnostics v_rows = row_count;
  update public.integration_endpoints set last_event_at = now() where id = ep.id;
  return case when v_rows > 0 then 'ok' else 'duplicate' end;
end $$;

-- ---------------------------------------------------------------------------
-- 3. Personal texts (outreach replies, open survey answers) stay with consultants and expire
-- ---------------------------------------------------------------------------

drop policy if exists source_excerpts_select on public.source_excerpts;
create policy source_excerpts_select on public.source_excerpts for select to authenticated
  using (
    public.can_write_idea(idea_id)
    or (public.can_read_idea(idea_id)
        and not exists (select 1 from public.sources s where s.id = source_excerpts.source_id and s.source_type in ('outreach', 'survey')))
  );

-- Customer signals quote people literally; clients see the summary in the report, not the quotes.
drop policy if exists customer_signals_select on public.customer_signals;
create policy customer_signals_select on public.customer_signals for select to authenticated using (public.can_write_idea(idea_id));

create or replace function public.purge_expired_personal_data()
returns int language plpgsql security definer set search_path = '' as $$
declare v1 int; v2 int; v3 int; v4 int; v5 int;
begin
  update public.test_submissions set email = null, answers = '{}'::jsonb
  where retention_until < current_date and (email is not null or answers <> '{}'::jsonb);
  get diagnostics v1 = row_count;
  update public.interviews set transcript = '[verwijderd na afloop van de bewaartermijn]'
  where retention_until < current_date and transcript <> '[verwijderd na afloop van de bewaartermijn]';
  get diagnostics v2 = row_count;
  update public.observations o set quote = null
  from public.interviews i
  where o.interview_id = i.id and i.retention_until < current_date and o.quote is not null;
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
  return v1 + v2 + v3 + v4 + v5;
end $$;

-- Clients compute the same probabilities as consultants: the scoring fields (and the review status of AI
-- coding) are readable for everyone on the dossier; the literal quote stays with consultants.
drop function if exists public.observations_for_idea(uuid);
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
  where o.idea_id = p_idea and public.can_read_idea(p_idea);
$$;
revoke execute on function public.observations_for_idea(uuid) from public, anon;
grant execute on function public.observations_for_idea(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

revoke execute on function public.open_forecast_moment(uuid), public.record_ai_forecast(text, uuid, text, numeric, text, text),
  public.ingest_allowed(text, int), public.record_outreach_event(text, text, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.open_forecast_moment(uuid), public.record_ai_forecast(text, uuid, text, numeric, text, text) to authenticated;
grant execute on function public.record_outreach_event(text, text, text, text, text, text, text) to anon;
revoke execute on function public.ingest_allowed(text) from public, anon, authenticated;
