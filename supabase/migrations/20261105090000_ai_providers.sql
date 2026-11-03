-- Three AI providers (Claude, ChatGPT, Gemini): per-organisation provider choice, provider on the AI ledger,
-- which provider found a web source, and one AI forecast per model (an ensemble) instead of one per moment.
-- API keys never enter the database: they live in the server environment only.

-- ---------------------------------------------------------------------------
-- 1. Provider choice per organisation
-- ---------------------------------------------------------------------------
-- One default provider and an optional choice per task (null = the default). "ensemble" lets web research and
-- the AI forecast use every connected provider; the monthly cap (org_ai_spend) still covers all of them together.

create table public.org_ai_settings (
  org_id uuid primary key references public.organizations(id) on delete cascade,
  default_provider text not null default 'anthropic' check (default_provider in ('anthropic', 'openai', 'gemini')),
  research_provider text check (research_provider in ('anthropic', 'openai', 'gemini')),
  coach_provider text check (coach_provider in ('anthropic', 'openai', 'gemini')),
  survey_provider text check (survey_provider in ('anthropic', 'openai', 'gemini')),
  promo_provider text check (promo_provider in ('anthropic', 'openai', 'gemini')),
  forecast_provider text check (forecast_provider in ('anthropic', 'openai', 'gemini')),
  ensemble boolean not null default true,
  updated_by uuid default auth.uid() references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

alter table public.org_ai_settings enable row level security;

-- Readable by the organisation's consultants and owners (clients are never organisation members); they can
-- also change it. Nobody can delete the row: going back to the defaults is an update.
create policy org_ai_settings_select on public.org_ai_settings for select to authenticated
  using (public.is_org_member(org_id));
create policy org_ai_settings_insert on public.org_ai_settings for insert to authenticated
  with check (public.is_org_member(org_id));
create policy org_ai_settings_update on public.org_ai_settings for update to authenticated
  using (public.is_org_member(org_id)) with check (public.is_org_member(org_id));

create or replace function public.stamp_org_ai_settings()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'UPDATE' then
    new.org_id := old.org_id;
  end if;
  new.updated_by := auth.uid();
  new.updated_at := now();
  return new;
end $$;

create trigger org_ai_settings_stamp before insert or update on public.org_ai_settings
  for each row execute function public.stamp_org_ai_settings();

revoke all on public.org_ai_settings from anon;
revoke delete on public.org_ai_settings from authenticated;
grant select, insert, update on public.org_ai_settings to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Provider on the AI ledger
-- ---------------------------------------------------------------------------
-- Older rows were all Anthropic calls; new rows say which provider was used. Null only when a call failed before a
-- provider was chosen (for example: no key at all).

alter table public.ai_runs add column if not exists provider text
  check (provider in ('anthropic', 'openai', 'gemini'));
update public.ai_runs set provider = 'anthropic' where provider is null and model like 'claude%';

-- ---------------------------------------------------------------------------
-- 3. Which provider found a web source
-- ---------------------------------------------------------------------------
-- Information only: two providers finding the same page does not make its quotes count more. A quote still
-- counts only when it is literally in the stored passage.

alter table public.sources add column if not exists found_by text[] not null default '{}'
  check (found_by <@ array['anthropic', 'openai', 'gemini']::text[]);
update public.sources set found_by = array['anthropic'] where origin = 'ai_search' and found_by = '{}';

-- ---------------------------------------------------------------------------
-- 4. AI forecasts: one per model per moment (ensemble), at most three
-- ---------------------------------------------------------------------------
-- The blind rules (forecast_visible, forecasts_select) and the server-only recording are unchanged.

drop index if exists public.forecasts_one_ai;
create unique index forecasts_one_ai_per_model on public.forecasts(idea_id, moment, coalesce(model, ''))
  where forecaster_kind = 'ai';

create or replace function public.record_ai_forecast(p_key text, p_idea uuid, p_moment text, p_probability numeric, p_rationale text, p_model text)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if not public.ingest_key_ok(p_key) or not public.can_write_idea(p_idea) then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if p_model is null or char_length(trim(p_model)) = 0 then
    raise exception 'MODEL_REQUIRED' using errcode = 'P0001';
  end if;
  -- One per provider: never more than three AI forecasters for one moment.
  if (select count(*) from public.forecasts f where f.idea_id = p_idea and f.moment = p_moment and f.forecaster_kind = 'ai') >= 3 then
    return false;
  end if;
  insert into public.forecasts (idea_id, moment, forecaster_kind, forecaster_id, probability, rationale, model)
  values (p_idea, p_moment, 'ai', null, greatest(0.01, least(0.99, p_probability)), left(p_rationale, 600), left(p_model, 80))
  on conflict do nothing;
  return found;
end $$;

revoke execute on function public.record_ai_forecast(text, uuid, text, numeric, text, text) from public, anon;
grant execute on function public.record_ai_forecast(text, uuid, text, numeric, text, text) to authenticated;
