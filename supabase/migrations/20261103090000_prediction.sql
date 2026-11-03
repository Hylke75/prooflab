-- Prediction core (research "ProofLab_Voorspelkracht_v1"): every dossier states a measurable outcome six months
-- after the decision, starts from a base rate, collects blind probability forecasts at fixed moments, and is
-- resolved against what really happened. Plus the research-method additions: support checks on quotes, review
-- of AI-coded observations, pre-mortem assumptions, ranges for market sizing and customer signals.

-- ---------------------------------------------------------------------------
-- 1. Outcome definition and base rate per idea
-- ---------------------------------------------------------------------------

alter table public.ideas
  add column if not exists outcome_statement text check (char_length(outcome_statement) <= 400),
  add column if not exists outcome_metric text check (char_length(outcome_metric) <= 160),
  add column if not exists outcome_target numeric check (outcome_target >= 0),
  add column if not exists outcome_due date,
  add column if not exists reference_class text,
  add column if not exists base_rate_low numeric check (base_rate_low between 0 and 1),
  add column if not exists base_rate_high numeric check (base_rate_high between 0 and 1),
  add column if not exists base_rate_note text check (char_length(base_rate_note) <= 600),
  add constraint ideas_base_rate_order check (base_rate_low is null or base_rate_high is null or base_rate_low <= base_rate_high);

-- External reference classes, read-only for everyone. Each has a source and a warning when its outcome
-- definition differs from ProofLab's own (six months after the decision).
create table public.reference_classes (
  id text primary key,
  label text not null,
  low numeric not null check (low between 0 and 1),
  high numeric not null check (high between 0 and 1 and high >= low),
  source_title text not null,
  source_url text not null,
  caveat text not null,
  position int not null default 0
);
alter table public.reference_classes enable row level security;
create policy reference_classes_read on public.reference_classes for select to authenticated using (true);

insert into public.reference_classes (id, label, low, high, source_title, source_url, caveat, position) values
  ('new_product', 'Nieuw product of nieuwe dienst (algemeen)', 0.10, 0.60,
   'Success factors of product innovation: an updated meta-analysis (Henard & Szymanski e.a.)',
   'https://research.aston.ac.uk/en/publications/success-factors-of-product-innovation-an-updated-meta-analysis',
   'Meestal genoemd: minder dan 25% slaagt. De spreiding is groot omdat sector en definitie van succes verschillen. Gaat over marktsucces op langere termijn, niet over een doel na zes maanden.', 1),
  ('new_business_nl', 'Nieuw bedrijf in Nederland, nog actief na 5 jaar', 0.52, 0.71,
   'CBS: 5-jarig overlevingspercentage van nieuwe bedrijven neemt toe (2022)',
   'https://www.cbs.nl/nl-nl/nieuws/2022/48/5-jarig-overlevingspercentage-van-nieuwe-bedrijven-neemt-toe',
   'Overleven is niet hetzelfde als het doel halen. Handel 52%, bouw 71%. Alleen bruikbaar als bovengrens voor nieuwe bedrijven.', 2),
  ('product_experiment', 'Gerichte productverbetering in een experiment', 0.10, 0.40,
   'The Base Rate for a Product Bet: experiment portfolios',
   'https://www.koji.so/docs/product-idea-base-rate-outside-view',
   'Praktijkbron, geen peer review. Gaat over losse verbeteringen in bestaande producten.', 3);

-- ---------------------------------------------------------------------------
-- 2. Blind forecasts at fixed moments
-- ---------------------------------------------------------------------------

create table public.forecasts (
  id uuid primary key default gen_random_uuid(),
  idea_id uuid not null references public.ideas(id) on delete cascade,
  moment text not null check (moment in ('intake', 'research', 'experiment', 'decision')),
  forecaster_kind text not null check (forecaster_kind in ('consultant', 'client', 'ai')),
  forecaster_id uuid references auth.users(id),
  probability numeric not null check (probability between 0.01 and 0.99),
  rationale text not null check (char_length(rationale) between 3 and 600),
  model text,
  created_at timestamptz not null default now(),
  check ((forecaster_kind = 'ai') = (forecaster_id is null))
);
create unique index forecasts_one_per_person on public.forecasts(idea_id, moment, forecaster_id) where forecaster_id is not null;
create unique index forecasts_one_ai on public.forecasts(idea_id, moment) where forecaster_kind = 'ai';
create index forecasts_idea_idx on public.forecasts(idea_id, moment);

alter table public.forecasts enable row level security;

-- Outcomes are created here already because forecast visibility depends on them (section 3).
create table public.idea_outcomes (
  idea_id uuid primary key references public.ideas(id) on delete cascade,
  achieved text not null check (achieved in ('yes', 'partial', 'no')),
  actual_value numeric,
  evidence text not null check (char_length(evidence) between 10 and 2000),
  resolved_by uuid not null default auth.uid() references auth.users(id),
  resolved_at timestamptz not null default now()
);
alter table public.idea_outcomes enable row level security;
create policy idea_outcomes_select on public.idea_outcomes for select to authenticated using (public.can_read_idea(idea_id));
create policy idea_outcomes_insert on public.idea_outcomes for insert to authenticated with check (public.can_write_idea(idea_id));
-- An outcome is a fact on the record: no update or delete policies.

-- You see the others' forecasts for a moment only after you made your own (no anchoring), or once the
-- outcome is known.
create or replace function public.forecast_visible(p_idea uuid, p_moment text, p_forecaster uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.can_read_idea(p_idea) and (
    p_forecaster = (select auth.uid())
    or exists (select 1 from public.forecasts f where f.idea_id = p_idea and f.moment = p_moment and f.forecaster_id = (select auth.uid()))
    or exists (select 1 from public.idea_outcomes o where o.idea_id = p_idea)
  );
$$;

create policy forecasts_select on public.forecasts for select to authenticated
  using (public.forecast_visible(idea_id, moment, forecaster_id));
-- People forecast as themselves, in their own role; AI forecasts are recorded by a consultant's session.
create policy forecasts_insert on public.forecasts for insert to authenticated
  with check (
    (forecaster_kind = 'consultant' and forecaster_id = (select auth.uid()) and public.can_write_idea(idea_id))
    or (forecaster_kind = 'client' and forecaster_id = (select auth.uid()) and not public.can_write_idea(idea_id) and public.can_read_idea(idea_id))
    or (forecaster_kind = 'ai' and forecaster_id is null and public.can_write_idea(idea_id))
  );
-- Forecasts are never edited or deleted: a changed opinion is a forecast at the next moment.

-- No forecasts after the outcome is known.
create or replace function public.guard_forecast()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.idea_outcomes o where o.idea_id = new.idea_id) then
    raise exception 'FORECAST_CLOSED: de uitkomst is al vastgelegd' using errcode = 'P0001';
  end if;
  new.created_at := now();
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- 3. Outcomes (resolution) and the interim check at three months
-- ---------------------------------------------------------------------------


create table public.outcome_checkins (
  id uuid primary key default gen_random_uuid(),
  idea_id uuid not null references public.ideas(id) on delete cascade,
  on_track text not null check (on_track in ('yes', 'unsure', 'no')),
  current_value numeric,
  note text not null check (char_length(note) between 3 and 1000),
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now()
);
create index outcome_checkins_idea_idx on public.outcome_checkins(idea_id, created_at desc);
alter table public.outcome_checkins enable row level security;
create policy outcome_checkins_select on public.outcome_checkins for select to authenticated using (public.can_read_idea(idea_id));
create policy outcome_checkins_insert on public.outcome_checkins for insert to authenticated with check (public.can_write_idea(idea_id));

create or replace function public.guard_outcome()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.ideas i where i.id = new.idea_id and i.outcome_statement is not null) then
    raise exception 'OUTCOME_UNDEFINED: leg eerst vast wat geslaagd betekent' using errcode = 'P0001';
  end if;
  new.resolved_by := auth.uid();
  new.resolved_at := now();
  return new;
end $$;

create trigger idea_outcomes_guard before insert on public.idea_outcomes
  for each row execute function public.guard_outcome();
create trigger forecasts_guard before insert on public.forecasts
  for each row execute function public.guard_forecast();

-- The outcome definition is fixed once the first forecast exists (no moving the goalposts).
create or replace function public.guard_outcome_definition()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  -- The due date (six months after the decision) may be filled in once, when the decision is taken.
  if ((new.outcome_statement, new.outcome_metric, new.outcome_target)
      is distinct from (old.outcome_statement, old.outcome_metric, old.outcome_target)
      or (old.outcome_due is not null and new.outcome_due is distinct from old.outcome_due))
     and exists (select 1 from public.forecasts f where f.idea_id = new.id) then
    raise exception 'OUTCOME_LOCKED: de uitkomstdefinitie ligt vast zodra er een voorspelling is' using errcode = 'P0001';
  end if;
  return new;
end $$;

create trigger ideas_outcome_lock before update of outcome_statement, outcome_metric, outcome_target, outcome_due on public.ideas
  for each row execute function public.guard_outcome_definition();

-- Scores per forecaster across the organisation: Brier score on resolved ideas (yes = 1, partial = 0.5, no = 0).
create or replace function public.forecast_scores(p_org uuid)
returns table (forecaster_kind text, forecaster_id uuid, forecasts bigint, brier numeric, mean_probability numeric, hit_rate numeric)
language sql stable security definer set search_path = '' as $$
  select f.forecaster_kind, f.forecaster_id, count(*),
         avg(power(f.probability - case o.achieved when 'yes' then 1 when 'partial' then 0.5 else 0 end, 2)),
         avg(f.probability),
         avg(case o.achieved when 'yes' then 1 when 'partial' then 0.5 else 0 end)
  from public.forecasts f
  join public.idea_outcomes o on o.idea_id = f.idea_id
  join public.ideas i on i.id = f.idea_id
  where i.org_id = p_org and public.is_org_member(p_org)
  group by f.forecaster_kind, f.forecaster_id;
$$;

-- Calibration buckets for the whole organisation (all resolved forecasts).
create or replace function public.forecast_calibration(p_org uuid)
returns table (bucket int, forecasts bigint, mean_probability numeric, observed numeric)
language sql stable security definer set search_path = '' as $$
  select least(9, floor(f.probability * 10))::int, count(*), avg(f.probability),
         avg(case o.achieved when 'yes' then 1 when 'partial' then 0.5 else 0 end)
  from public.forecasts f
  join public.idea_outcomes o on o.idea_id = f.idea_id
  join public.ideas i on i.id = f.idea_id
  where i.org_id = p_org and public.is_org_member(p_org)
  group by 1 order by 1;
$$;

-- Own base rate: share of resolved ideas of this organisation that reached their outcome, optionally per
-- project type. Returns nothing below the minimum number of resolved ideas.
create or replace function public.own_base_rate(p_org uuid, p_project_type text, p_min int default 10)
returns table (resolved bigint, achieved numeric)
language sql stable security definer set search_path = '' as $$
  select count(*), avg(case o.achieved when 'yes' then 1 when 'partial' then 0.5 else 0 end)
  from public.idea_outcomes o join public.ideas i on i.id = o.idea_id
  where i.org_id = p_org and public.is_org_member(p_org) and (p_project_type is null or i.project_type = p_project_type)
  having count(*) >= p_min;
$$;

-- ---------------------------------------------------------------------------
-- 4. Research methods: does the quote carry the claim, review of AI coding, pre-mortem
-- ---------------------------------------------------------------------------

alter table public.claim_sources
  add column if not exists support_check text not null default 'unchecked'
    check (support_check in ('supports', 'partial', 'not_supported', 'unchecked')),
  add column if not exists support_checked_by text check (support_checked_by in ('ai', 'consultant')),
  add column if not exists support_note text check (char_length(support_note) <= 600);

alter table public.observations
  add column if not exists review_status text check (review_status in ('accepted', 'rejected')),
  add column if not exists reviewed_by uuid references auth.users(id),
  add column if not exists reviewed_at timestamptz;

-- AI-coded observations may be reviewed (accepted/rejected) once by a consultant; nothing else changes.
create policy observations_review on public.observations for update to authenticated
  using (public.can_write_idea(idea_id) and origin = 'ai') with check (public.can_write_idea(idea_id) and origin = 'ai');

create or replace function public.guard_observation_review()
returns trigger language plpgsql set search_path = '' as $$
begin
  -- System jobs (retention purge) run without a user and may clear quotes.
  if auth.uid() is null then
    return new;
  end if;
  if (to_jsonb(new) - 'review_status' - 'reviewed_by' - 'reviewed_at') is distinct from (to_jsonb(old) - 'review_status' - 'reviewed_by' - 'reviewed_at') then
    raise exception 'OBSERVATION_LOCKED: een observatie wordt niet herschreven' using errcode = 'P0001';
  end if;
  new.reviewed_by := auth.uid();
  new.reviewed_at := now();
  return new;
end $$;

create trigger observations_review_guard before update on public.observations
  for each row execute function public.guard_observation_review();

alter table public.assumptions drop constraint if exists assumptions_origin_check;
alter table public.assumptions add constraint assumptions_origin_check check (origin in ('manual', 'ai', 'template', 'premortem'));

-- ---------------------------------------------------------------------------
-- 5. Ranges for market sizing (Monte Carlo) and customer signals
-- ---------------------------------------------------------------------------

alter table public.sizing_factors
  add column if not exists low_value numeric check (low_value >= 0),
  add column if not exists high_value numeric check (high_value >= 0),
  add constraint sizing_factors_range_order check (low_value is null or high_value is null or low_value <= high_value);

create table public.customer_signals (
  id uuid primary key default gen_random_uuid(),
  idea_id uuid not null references public.ideas(id) on delete cascade,
  kind text not null check (kind in ('job', 'pain', 'gain', 'objection')),
  label text not null check (char_length(label) between 3 and 300),
  mentions int not null check (mentions >= 1),
  quotes jsonb not null default '[]'::jsonb check (jsonb_typeof(quotes) = 'array' and pg_column_size(quotes) <= 40000),
  origin text not null default 'ai' check (origin in ('ai', 'manual')),
  created_at timestamptz not null default now()
);
create index customer_signals_idea_idx on public.customer_signals(idea_id);
alter table public.customer_signals enable row level security;
create policy customer_signals_select on public.customer_signals for select to authenticated using (public.can_read_idea(idea_id));
create policy customer_signals_insert on public.customer_signals for insert to authenticated with check (public.can_write_idea(idea_id));
create policy customer_signals_delete on public.customer_signals for delete to authenticated using (public.can_write_idea(idea_id));

-- ---------------------------------------------------------------------------
-- 6. Audit, indexes and grants
-- ---------------------------------------------------------------------------

do $$
declare t text;
begin
  foreach t in array array['forecasts', 'idea_outcomes', 'outcome_checkins', 'customer_signals'] loop
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function public.audit_row()', t || '_audit', t);
  end loop;
end $$;

create index if not exists forecasts_forecaster_fk on public.forecasts(forecaster_id);
create index if not exists idea_outcomes_resolved_by_fk on public.idea_outcomes(resolved_by);
create index if not exists outcome_checkins_created_by_fk on public.outcome_checkins(created_by);
create index if not exists observations_reviewed_by_fk on public.observations(reviewed_by);

revoke all on public.reference_classes, public.forecasts, public.idea_outcomes, public.outcome_checkins, public.customer_signals from anon;
grant select on public.reference_classes to authenticated;
grant select, insert on public.forecasts, public.idea_outcomes, public.outcome_checkins to authenticated;
grant select, insert, delete on public.customer_signals to authenticated;
revoke execute on function public.forecast_visible(uuid, text, uuid), public.forecast_scores(uuid), public.forecast_calibration(uuid),
  public.own_base_rate(uuid, text, int), public.guard_forecast(), public.guard_outcome(), public.guard_outcome_definition(),
  public.guard_observation_review() from public, anon;
grant execute on function public.forecast_visible(uuid, text, uuid), public.forecast_scores(uuid), public.forecast_calibration(uuid),
  public.own_base_rate(uuid, text, int) to authenticated;
