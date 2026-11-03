-- Golf B: besluit en voorspelling (7 november; docs/VERBETERPLAN_WERKWIJZE.md, punten 1, 2, 6, 15, 18 en 20).
--
--   1. Na een stop- of pauzebesluit vervalt de uitkomstvraag; na zes maanden volgt "Was stoppen achteraf terecht?".
--      Deze dossiers tellen niet mee in de kalibratie van slagingskansen en de eigen basisrate.
--
-- De kalibratiefuncties staan onderaan (laatste sectie), omdat ze naar tabellen uit meerdere punten verwijzen.

-- ---------------------------------------------------------------------------
-- 1. Uitkomst na stop of pauze
-- ---------------------------------------------------------------------------
-- outcome_question: welke vraag zes maanden na het definitieve besluit wordt gesteld.
--   success     : is het doel uit de uitkomstdefinitie gehaald? (idea_outcomes, gescoord in de kalibratie)
--   stop_review : was stoppen of pauzeren achteraf terecht? (stop_reviews, eigen telling "terechte stops")
-- De database bepaalt de vraag zelf op het moment dat de uitkomstklok start, aan de hand van het laatste besluit.

alter table public.ideas add column if not exists outcome_question text not null default 'success'
  check (outcome_question in ('success', 'stop_review'));

-- Bestaande dossiers waarvan de klok door een stop- of pauzebesluit is gestart, krijgen de stopvraag. Een al
-- vastgelegde uitkomst blijft bewaard, maar telt (net als bij nieuwe stopdossiers) niet mee in de kalibratie.
update public.ideas i set outcome_question = 'stop_review'
where i.outcome_clock_start is not null
  and (select d.action from public.decisions d
       where d.idea_id = i.id and d.action in ('continue', 'stop', 'pause')
         and (d.decided_at at time zone 'Europe/Amsterdam')::date <= i.outcome_clock_start
       order by d.decided_at desc, d.id desc limit 1) in ('stop', 'pause');

-- De klok start eenmalig (guard_outcome_definition). Op dat moment legt de database de uitkomstvraag vast. Bij een
-- stop of pauze is de uitkomstdatum altijd zes maanden na het besluit: de geplande meetdatum hoort bij de vervallen
-- succesvraag. Daarna verandert de vraag nooit meer.
create or replace function public.stamp_outcome_question()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_action text;
begin
  if tg_op = 'INSERT' then
    new.outcome_question := 'success';
    return new;
  end if;
  if old.outcome_clock_start is null and new.outcome_clock_start is not null then
    select d.action into v_action from public.decisions d
    where d.idea_id = new.id order by d.decided_at desc, d.id desc limit 1;
    if v_action in ('stop', 'pause') then
      new.outcome_question := 'stop_review';
      new.outcome_due := (new.outcome_clock_start + interval '6 months')::date;
    else
      new.outcome_question := 'success';
    end if;
  elsif new.outcome_question is distinct from old.outcome_question then
    raise exception 'OUTCOME_QUESTION_LOCKED: de uitkomstvraag ligt vast bij de start van de klok' using errcode = 'P0001';
  end if;
  return new;
end $$;

drop trigger if exists ideas_outcome_question on public.ideas;
create trigger ideas_outcome_question before insert or update on public.ideas
  for each row execute function public.stamp_outcome_question();

-- "Was stoppen achteraf terecht?" Eén keer per dossier, met bewijs; daarna een vast feit (geen update of delete).
create table if not exists public.stop_reviews (
  idea_id uuid primary key references public.ideas(id) on delete cascade,
  justified text not null check (justified in ('yes', 'no', 'unknown')),
  evidence text not null check (char_length(evidence) between 10 and 2000),
  reviewed_by uuid not null default auth.uid() references auth.users(id),
  reviewed_at timestamptz not null default now()
);
create index if not exists stop_reviews_reviewed_by_fk on public.stop_reviews(reviewed_by);
alter table public.stop_reviews enable row level security;
drop policy if exists stop_reviews_select on public.stop_reviews;
create policy stop_reviews_select on public.stop_reviews for select to authenticated using (public.can_read_idea(idea_id));
drop policy if exists stop_reviews_insert on public.stop_reviews;
create policy stop_reviews_insert on public.stop_reviews for insert to authenticated with check (public.can_write_idea(idea_id));

create or replace function public.guard_stop_review()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.ideas i where i.id = new.idea_id and i.outcome_question = 'stop_review') then
    raise exception 'STOP_REVIEW_NOT_APPLICABLE: de stopvraag hoort bij een dossier dat met stoppen of pauzeren is afgesloten' using errcode = 'P0001';
  end if;
  new.reviewed_by := auth.uid();
  new.reviewed_at := now();
  return new;
end $$;
drop trigger if exists stop_reviews_guard on public.stop_reviews;
create trigger stop_reviews_guard before insert on public.stop_reviews
  for each row execute function public.guard_stop_review();
drop trigger if exists stop_reviews_audit on public.stop_reviews;
create trigger stop_reviews_audit after insert or update or delete on public.stop_reviews
  for each row execute function public.audit_row();

-- De oorspronkelijke uitkomstvraag vervalt na een stop of pauze: geen idea_outcomes meer voor die dossiers.
create or replace function public.guard_outcome()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_question text;
begin
  select outcome_question into v_question from public.ideas i where i.id = new.idea_id and i.outcome_statement is not null;
  if v_question is null then
    raise exception 'OUTCOME_UNDEFINED: leg eerst vast wat geslaagd betekent' using errcode = 'P0001';
  end if;
  if v_question = 'stop_review' then
    raise exception 'OUTCOME_STOPPED: na een stop- of pauzebesluit vervalt de uitkomstvraag; leg vast of stoppen terecht was' using errcode = 'P0001';
  end if;
  new.resolved_by := auth.uid();
  new.resolved_at := now();
  return new;
end $$;

-- Na de stop geen nieuwe voorspellingen meer: er is geen slagingskans meer om te voorspellen. Verder dezelfde regel
-- als in review_fixes (lib/domain/forecast.ts openMoment).
create or replace function public.open_forecast_moment(p_idea uuid)
returns text language sql stable security definer set search_path = '' as $$
  select case
    when not exists (select 1 from public.ideas i where i.id = p_idea and i.outcome_statement is not null) then null
    when exists (select 1 from public.ideas i where i.id = p_idea and i.outcome_question = 'stop_review') then null
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

-- Voorspellingen worden voor iedereen zichtbaar zodra het dossier is afgesloten: met een uitkomst of met de stopvraag.
create or replace function public.forecast_visible(p_idea uuid, p_moment text, p_forecaster uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.can_read_idea(p_idea) and (
    p_forecaster = (select auth.uid())
    or exists (select 1 from public.forecasts f where f.idea_id = p_idea and f.moment = p_moment and f.forecaster_id = (select auth.uid()))
    or exists (select 1 from public.idea_outcomes o where o.idea_id = p_idea)
    or exists (select 1 from public.stop_reviews s where s.idea_id = p_idea)
  );
$$;

-- Telling "terechte stops" per werkruimte: ja, nee, onbekend en nog open (stopvraag zonder antwoord).
create or replace function public.stop_review_counts(p_org uuid)
returns table (stopped bigint, justified bigint, not_justified bigint, unknown bigint, open bigint)
language sql stable security definer set search_path = '' as $$
  select count(*),
         count(*) filter (where s.justified = 'yes'),
         count(*) filter (where s.justified = 'no'),
         count(*) filter (where s.justified = 'unknown'),
         count(*) filter (where s.idea_id is null)
  from public.ideas i left join public.stop_reviews s on s.idea_id = i.id
  where i.org_id = p_org and public.is_org_member(p_org) and i.outcome_question = 'stop_review';
$$;

revoke all on public.stop_reviews from anon;
grant select, insert on public.stop_reviews to authenticated;
revoke execute on function public.stamp_outcome_question(), public.guard_stop_review(), public.stop_review_counts(uuid) from public, anon;
revoke execute on function public.stamp_outcome_question(), public.guard_stop_review() from authenticated;
grant execute on function public.stop_review_counts(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Kalibratie: alleen dossiers met de succesvraag
-- ---------------------------------------------------------------------------
-- Dossiers met de stopvraag hebben geen slagingskans om te scoren: hun voorspellingen worden niet gescoord en ze tellen
-- niet mee in de eigen basisrate. Bestaande grants blijven staan (create or replace behoudt ze).

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
  where i.org_id = p_org and public.is_org_member(p_org) and i.outcome_question = 'success'
  group by f.forecaster_kind, f.forecaster_id;
$$;

create or replace function public.forecast_calibration(p_org uuid)
returns table (bucket int, forecasts bigint, mean_probability numeric, observed numeric)
language sql stable security definer set search_path = '' as $$
  select least(9, floor(f.probability * 10))::int, count(*), avg(f.probability),
         avg(case o.achieved when 'yes' then 1 when 'partial' then 0.5 else 0 end)
  from public.forecasts f
  join public.idea_outcomes o on o.idea_id = f.idea_id
  join public.ideas i on i.id = f.idea_id
  where i.org_id = p_org and public.is_org_member(p_org) and i.outcome_question = 'success'
  group by 1 order by 1;
$$;

create or replace function public.own_base_rate(p_org uuid, p_project_type text, p_min int default 10)
returns table (resolved bigint, achieved numeric)
language sql stable security definer set search_path = '' as $$
  select count(*), avg(case o.achieved when 'yes' then 1 when 'partial' then 0.5 else 0 end)
  from public.idea_outcomes o join public.ideas i on i.id = o.idea_id
  where i.org_id = p_org and public.is_org_member(p_org) and (p_project_type is null or i.project_type = p_project_type)
    and i.outcome_question = 'success'
  having count(*) >= p_min;
$$;
