-- Golf B: besluit en voorspelling (7 november; docs/VERBETERPLAN_WERKWIJZE.md, punten 1, 2, 6, 15, 18 en 20).
--
--   1. Na een stop- of pauzebesluit vervalt de uitkomstvraag; na zes maanden volgt "Was stoppen achteraf terecht?".
--      Deze dossiers tellen niet mee in de kalibratie van slagingskansen en de eigen basisrate.
--   2. Bij de uitkomst ook de inzet: gestart ja/nee, uren en budget ten opzichte van plan. Onvoldoende uitvoering wordt
--      gemarkeerd; een consultant kan zo'n dossier met reden uit de kalibratie halen (calibration_exclusions, geaudit).
--   6. Beslisregel van bewijs naar besluit (decision_rules): welke aannames boven welke kans moeten uitkomen en welke
--      hoofdtest moet slagen. Vergrendeld bij de eerste goedgekeurde test; afwijken bij het besluit vraagt een motivering.
--  15. Eerst voorspellen: de vergrendeling van kansen zit in de app; hier telt de AI in de kalibratie als één stem
--      (het gemiddelde van de modellen per dossier en moment).
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
-- 2. Inzet bij de uitkomst
-- ---------------------------------------------------------------------------
-- De uitkomst meet ook uitvoering: een goed idee dat nooit is gestart, zegt niets over de voorspelling. Nullable, zodat
-- bestaande uitkomsten geldig blijven (inzet onbekend); de app vraagt de inzet bij elke nieuwe uitkomst.
--   started            : is het besluit uitgevoerd (gestart)?
--   effort_hours       : bestede uren
--   budget_pct_of_plan : besteed budget als percentage van het plan (100 = volgens plan)
--   execution_insufficient : berekend door de database (zelfde regel als lib/domain/effort.ts)

alter table public.idea_outcomes
  add column if not exists started boolean,
  add column if not exists effort_hours numeric check (effort_hours >= 0 and effort_hours <= 100000),
  add column if not exists budget_pct_of_plan numeric check (budget_pct_of_plan >= 0 and budget_pct_of_plan <= 1000),
  add column if not exists execution_insufficient boolean;

-- Onvoldoende uitvoering: niet gestart, minder dan de helft van het geplande budget besteed, of (als de inzet in de
-- intake in uren is opgegeven) minder dan de helft van die uren. Onbekend (null) als niet is vastgelegd of er is gestart.
create or replace function public.execution_insufficient(p_started boolean, p_hours numeric, p_budget_pct numeric, p_stake_kind text, p_stake_value numeric)
returns boolean language sql immutable set search_path = '' as $$
  select case
    when p_started is null then null
    when not p_started then true
    when p_budget_pct is not null and p_budget_pct < 50 then true
    when p_stake_kind = 'time' and p_stake_value > 0 and p_hours is not null and p_hours < p_stake_value / 2 then true
    else false
  end;
$$;

create or replace function public.stamp_outcome_effort()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_kind text;
  v_value numeric;
begin
  select stake_kind, stake_value into v_kind, v_value from public.ideas where id = new.idea_id;
  new.execution_insufficient := public.execution_insufficient(new.started, new.effort_hours, new.budget_pct_of_plan, v_kind, v_value);
  return new;
end $$;
drop trigger if exists idea_outcomes_effort on public.idea_outcomes;
create trigger idea_outcomes_effort before insert on public.idea_outcomes
  for each row execute function public.stamp_outcome_effort();

-- Uit de kalibratie halen: alleen bij een uitkomst met onvoldoende uitvoering, alleen door een consultant van de
-- werkruimte, met reden. Weer meetellen kan (delete); beide staan in het auditspoor (audit_row, met de reden).
create table if not exists public.calibration_exclusions (
  idea_id uuid primary key references public.ideas(id) on delete cascade,
  reason text not null check (char_length(btrim(reason)) between 10 and 600),
  excluded_by uuid not null default auth.uid() references auth.users(id),
  excluded_at timestamptz not null default now()
);
create index if not exists calibration_exclusions_excluded_by_fk on public.calibration_exclusions(excluded_by);
alter table public.calibration_exclusions enable row level security;
drop policy if exists calibration_exclusions_select on public.calibration_exclusions;
create policy calibration_exclusions_select on public.calibration_exclusions for select to authenticated using (public.can_read_idea(idea_id));
drop policy if exists calibration_exclusions_insert on public.calibration_exclusions;
create policy calibration_exclusions_insert on public.calibration_exclusions for insert to authenticated with check (public.can_write_idea(idea_id));
drop policy if exists calibration_exclusions_delete on public.calibration_exclusions;
create policy calibration_exclusions_delete on public.calibration_exclusions for delete to authenticated using (public.can_write_idea(idea_id));

create or replace function public.guard_calibration_exclusion()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.idea_outcomes o where o.idea_id = new.idea_id and o.execution_insufficient) then
    raise exception 'EXCLUSION_NOT_ALLOWED: alleen een uitkomst met onvoldoende uitvoering kan uit de kalibratie worden gehaald' using errcode = 'P0001';
  end if;
  new.reason := btrim(new.reason);
  new.excluded_by := auth.uid();
  new.excluded_at := now();
  return new;
end $$;
drop trigger if exists calibration_exclusions_guard on public.calibration_exclusions;
create trigger calibration_exclusions_guard before insert on public.calibration_exclusions
  for each row execute function public.guard_calibration_exclusion();

-- audit_row legt bij een insert alleen wie en wanneer vast; de reden moet ook in het spoor, ook na weer meetellen.
create or replace function public.audit_calibration_exclusion()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  r public.calibration_exclusions;
begin
  r := case when tg_op = 'DELETE' then old else new end;
  insert into public.audit_events (idea_id, org_id, actor_id, table_name, row_id, action, detail)
  values (r.idea_id, (select i.org_id from public.ideas i where i.id = r.idea_id), auth.uid(), 'calibration_exclusions', r.idea_id::text,
          case when tg_op = 'DELETE' then 'calibration_include' else 'calibration_exclude' end,
          jsonb_build_object('reason', r.reason, 'excluded_by', r.excluded_by, 'excluded_at', r.excluded_at));
  return null;
end $$;
drop trigger if exists calibration_exclusions_audit on public.calibration_exclusions;
create trigger calibration_exclusions_audit after insert or delete on public.calibration_exclusions
  for each row execute function public.audit_calibration_exclusion();

revoke all on public.calibration_exclusions from anon;
grant select, insert, delete on public.calibration_exclusions to authenticated;
revoke execute on function public.stamp_outcome_effort(), public.guard_calibration_exclusion(), public.audit_calibration_exclusion() from public, anon, authenticated;
revoke execute on function public.execution_insufficient(boolean, numeric, numeric, text, numeric) from public, anon;
grant execute on function public.execution_insufficient(boolean, numeric, numeric, text, numeric) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Beslisregel van bewijs naar besluit
-- ---------------------------------------------------------------------------
-- Eén regel per dossier, vooraf vastgelegd: "doorgaan als deze aannames boven deze kans uitkomen en deze hoofdtest
-- slaagt". De hoofdtest is een experiment-id (primary_experiment_id). Golf A voegt parallel een veld is_primary toe
-- (één hoofdtest per aanname); deze generieke structuur kiest het experiment dat voor het besluit de doorslag geeft en
-- staat daar los van. Na samenvoegen hoort de hoofdtest van de regel een is_primary-test te zijn (te controleren in de app).
--
-- Vergrendeling: zodra de eerste test van het dossier is goedgekeurd (experiments.state = 'approved'), of uiterlijk bij
-- het eerste definitieve besluit. Een regel die pas na de eerste goedgekeurde test wordt vastgelegd, is meteen
-- vergrendeld en heet "achteraf vastgelegd" (recorded_late), zodat niemand de regel op de uitkomsten kan afstemmen.

create table if not exists public.decision_rules (
  idea_id uuid primary key references public.ideas(id) on delete cascade,
  primary_experiment_id uuid references public.experiments(id) on delete set null,
  note text check (char_length(note) <= 600),
  created_by uuid default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  locked_at timestamptz,
  recorded_late boolean not null default false
);
create index if not exists decision_rules_primary_experiment_fk on public.decision_rules(primary_experiment_id);
create index if not exists decision_rules_created_by_fk on public.decision_rules(created_by);

create table if not exists public.decision_rule_assumptions (
  idea_id uuid not null references public.decision_rules(idea_id) on delete cascade,
  assumption_id uuid not null references public.assumptions(id) on delete cascade,
  min_probability numeric not null check (min_probability between 0.05 and 0.95),
  primary key (idea_id, assumption_id)
);
create index if not exists decision_rule_assumptions_assumption_fk on public.decision_rule_assumptions(assumption_id);

alter table public.decision_rules enable row level security;
alter table public.decision_rule_assumptions enable row level security;
drop policy if exists decision_rules_select on public.decision_rules;
create policy decision_rules_select on public.decision_rules for select to authenticated using (public.can_read_idea(idea_id));
drop policy if exists decision_rule_assumptions_select on public.decision_rule_assumptions;
create policy decision_rule_assumptions_select on public.decision_rule_assumptions for select to authenticated using (public.can_read_idea(idea_id));
-- Geen insert-, update- of delete-policies: vastleggen gaat in één keer via save_decision_rule (hieronder), zodat regel,
-- voorwaarden en vergrendeling altijd samen kloppen.

-- Verwijzingen blijven binnen hetzelfde dossier.
drop trigger if exists decision_rules_refs on public.decision_rules;
create trigger decision_rules_refs before insert or update on public.decision_rules
  for each row execute function public.check_idea_refs('primary_experiment_id', 'experiments');
drop trigger if exists decision_rule_assumptions_refs on public.decision_rule_assumptions;
create trigger decision_rule_assumptions_refs before insert or update on public.decision_rule_assumptions
  for each row execute function public.check_idea_refs('assumption_id', 'assumptions');

create or replace function public.guard_decision_rule()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
    new.created_at := now();
    new.updated_at := now();
    new.locked_at := null;
    new.recorded_late := false;
    return new;
  end if;
  if tg_op = 'DELETE' then
    -- Bij het verwijderen van het hele dossier (cascade) is het idee al weg.
    if old.locked_at is not null and exists (select 1 from public.ideas i where i.id = old.idea_id) then
      raise exception 'DECISION_RULE_LOCKED: de beslisregel ligt vast sinds de eerste goedgekeurde test' using errcode = 'P0001';
    end if;
    return old;
  end if;
  if old.locked_at is not null then
    raise exception 'DECISION_RULE_LOCKED: de beslisregel ligt vast sinds de eerste goedgekeurde test' using errcode = 'P0001';
  end if;
  new.idea_id := old.idea_id;
  new.created_by := old.created_by;
  new.created_at := old.created_at;
  -- "Achteraf vastgelegd" wordt alleen samen met de vergrendeling gezet (save_decision_rule).
  if new.locked_at is null then
    new.recorded_late := old.recorded_late;
  end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists decision_rules_guard on public.decision_rules;
create trigger decision_rules_guard before insert or update or delete on public.decision_rules
  for each row execute function public.guard_decision_rule();

create or replace function public.guard_decision_rule_assumption()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_idea uuid := case when tg_op = 'DELETE' then old.idea_id else new.idea_id end;
begin
  if exists (select 1 from public.decision_rules r where r.idea_id = v_idea and r.locked_at is not null)
     and exists (select 1 from public.ideas i where i.id = v_idea) then
    raise exception 'DECISION_RULE_LOCKED: de beslisregel ligt vast sinds de eerste goedgekeurde test' using errcode = 'P0001';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  update public.decision_rules set updated_at = now() where idea_id = v_idea and locked_at is null;
  return new;
end $$;
drop trigger if exists decision_rule_assumptions_guard on public.decision_rule_assumptions;
create trigger decision_rule_assumptions_guard before insert or update or delete on public.decision_rule_assumptions
  for each row execute function public.guard_decision_rule_assumption();

-- De eerste goedgekeurde test vergrendelt de regel.
create or replace function public.lock_decision_rule_on_approval()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.state = 'approved' and old.state is distinct from 'approved' then
    update public.decision_rules set locked_at = now() where idea_id = new.idea_id and locked_at is null;
  end if;
  return null;
end $$;
drop trigger if exists experiments_lock_decision_rule on public.experiments;
create trigger experiments_lock_decision_rule after update of state on public.experiments
  for each row execute function public.lock_decision_rule_on_approval();

-- Regel en voorwaarden in één keer vastleggen (alleen consultants, alleen zolang de regel open is). p_conditions is een
-- lijst [{"assumption_id": ..., "min_probability": 0.6}]. Is er al een test goedgekeurd, dan is de regel meteen
-- vergrendeld en "achteraf vastgelegd". Geeft 'open', 'locked_late' terug.
create or replace function public.save_decision_rule(p_idea uuid, p_primary uuid, p_note text, p_conditions jsonb)
returns text language plpgsql security definer set search_path = '' as $$
declare
  v_locked timestamptz;
  v_exists boolean;
  v_late boolean;
begin
  if auth.uid() is null or not public.can_write_idea(p_idea) then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if jsonb_typeof(coalesce(p_conditions, '[]'::jsonb)) <> 'array' then
    raise exception 'DECISION_RULE_INVALID: voorwaarden horen in een lijst' using errcode = 'P0001';
  end if;
  if p_primary is null and jsonb_array_length(coalesce(p_conditions, '[]'::jsonb)) = 0 then
    raise exception 'DECISION_RULE_INVALID: kies minstens één aanname of een hoofdtest' using errcode = 'P0001';
  end if;
  perform 1 from public.ideas where id = p_idea for update;
  select true, locked_at into v_exists, v_locked from public.decision_rules where idea_id = p_idea;
  if v_locked is not null then
    raise exception 'DECISION_RULE_LOCKED: de beslisregel ligt vast sinds de eerste goedgekeurde test' using errcode = 'P0001';
  end if;
  if coalesce(v_exists, false) then
    update public.decision_rules set primary_experiment_id = p_primary, note = nullif(btrim(p_note), '') where idea_id = p_idea;
    delete from public.decision_rule_assumptions where idea_id = p_idea;
  else
    insert into public.decision_rules (idea_id, primary_experiment_id, note) values (p_idea, p_primary, nullif(btrim(p_note), ''));
  end if;
  insert into public.decision_rule_assumptions (idea_id, assumption_id, min_probability)
  select p_idea, (c->>'assumption_id')::uuid, (c->>'min_probability')::numeric
  from jsonb_array_elements(coalesce(p_conditions, '[]'::jsonb)) c;
  -- Al een test goedgekeurd: meteen vergrendeld en achteraf vastgelegd.
  v_late := exists (select 1 from public.experiments e where e.idea_id = p_idea
                    and (e.approved_at is not null or e.state not in ('draft', 'ready_for_review')));
  if v_late then
    update public.decision_rules set locked_at = now(), recorded_late = true where idea_id = p_idea;
    return 'locked_late';
  end if;
  return 'open';
end $$;

do $$
declare t text;
begin
  foreach t in array array['decision_rules', 'decision_rule_assumptions'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_audit', t);
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function public.audit_row()', t || '_audit', t);
  end loop;
end $$;

-- Het besluit legt de toets aan de regel vast: per voorwaarde gehaald of niet (rule_evaluation, door de app berekend
-- met de kansen van dat moment), het oordeel (rule_met) en bij afwijken de motivering. Afwijken = doorgaan terwijl de
-- regel niet is gehaald, of stoppen/pauzeren terwijl hij wel is gehaald. De database controleert wat ze zelf kan zien:
-- een hoofdtest zonder goedgekeurde geslaagde Learning Card kan de regel niet "gehaald" maken.
alter table public.decisions
  add column if not exists rule_met boolean,
  add column if not exists rule_evaluation jsonb check (rule_evaluation is null or (jsonb_typeof(rule_evaluation) = 'object' and pg_column_size(rule_evaluation) <= 20000)),
  add column if not exists rule_deviation_reason text check (char_length(rule_deviation_reason) <= 2000);

create or replace function public.guard_decision_against_rule()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  r public.decision_rules;
  v_pass boolean;
begin
  select * into r from public.decision_rules where idea_id = new.idea_id;
  if r.idea_id is null or new.action not in ('continue', 'stop', 'pause') then
    new.rule_met := null;
    new.rule_evaluation := null;
    new.rule_deviation_reason := null;
    return new;
  end if;
  if new.rule_met is null or new.rule_evaluation is null then
    raise exception 'DECISION_RULE_EVAL: een definitief besluit wordt getoetst aan de beslisregel van dit dossier' using errcode = 'P0001';
  end if;
  if r.primary_experiment_id is not null and new.rule_met then
    select lc.verdict = 'pass' into v_pass from public.learning_cards lc
    where lc.experiment_id = r.primary_experiment_id and lc.status = 'approved'
    order by lc.version desc, lc.created_at desc limit 1;
    if not coalesce(v_pass, false) then
      raise exception 'DECISION_RULE_EVAL: de hoofdtest is niet (goedgekeurd) geslaagd, dus de regel is niet gehaald' using errcode = 'P0001';
    end if;
  end if;
  if (not new.rule_met and new.action = 'continue') or (new.rule_met and new.action in ('stop', 'pause')) then
    if char_length(btrim(coalesce(new.rule_deviation_reason, ''))) < 15 then
      raise exception 'DECISION_RULE_DEVIATION: dit besluit wijkt af van de beslisregel; motiveer waarom' using errcode = 'P0001';
    end if;
    new.rule_deviation_reason := btrim(new.rule_deviation_reason);
  else
    new.rule_deviation_reason := null;
  end if;
  -- Uiterlijk bij het eerste definitieve besluit ligt de regel vast.
  update public.decision_rules set locked_at = now() where idea_id = new.idea_id and locked_at is null;
  return new;
end $$;
drop trigger if exists decisions_rule_guard on public.decisions;
create trigger decisions_rule_guard before insert on public.decisions
  for each row execute function public.guard_decision_against_rule();

-- Afwijken van de regel komt met de motivering in het auditspoor (audit_row legt bij een insert geen inhoud vast).
create or replace function public.audit_rule_deviation()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.rule_deviation_reason is not null then
    insert into public.audit_events (idea_id, org_id, actor_id, table_name, row_id, action, detail)
    values (new.idea_id, (select i.org_id from public.ideas i where i.id = new.idea_id), auth.uid(), 'decisions', new.id::text, 'rule_deviation',
            jsonb_build_object('action', new.action, 'rule_met', new.rule_met, 'reason', new.rule_deviation_reason));
  end if;
  return null;
end $$;
drop trigger if exists decisions_rule_deviation_audit on public.decisions;
create trigger decisions_rule_deviation_audit after insert on public.decisions
  for each row execute function public.audit_rule_deviation();

-- Een vastgelegd besluit verandert niet: ook de toets aan de regel niet.
create or replace function public.guard_decision()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'UPDATE' then
    if (new.action, new.rationale, new.next_step, new.decided_by, new.decided_at, new.reality_check_id, new.experiment_id,
        new.rule_met, new.rule_evaluation, new.rule_deviation_reason)
       is distinct from
       (old.action, old.rationale, old.next_step, old.decided_by, old.decided_at, old.reality_check_id, old.experiment_id,
        old.rule_met, old.rule_evaluation, old.rule_deviation_reason) then
      raise exception 'DECISION_LOCKED: een vastgelegd besluit kan niet worden gewijzigd' using errcode = 'P0001';
    end if;
  end if;
  return new;
end $$;

revoke all on public.decision_rules, public.decision_rule_assumptions from anon;
grant select on public.decision_rules, public.decision_rule_assumptions to authenticated;
revoke execute on function public.guard_decision_rule(), public.guard_decision_rule_assumption(), public.lock_decision_rule_on_approval(),
  public.guard_decision_against_rule(), public.audit_rule_deviation() from public, anon, authenticated;
revoke execute on function public.save_decision_rule(uuid, uuid, text, jsonb) from public, anon;
grant execute on function public.save_decision_rule(uuid, uuid, text, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- Kalibratie: alleen dossiers met de succesvraag en zonder uitsluiting
-- ---------------------------------------------------------------------------
-- Dossiers met de stopvraag hebben geen slagingskans om te scoren: hun voorspellingen worden niet gescoord en ze tellen
-- niet mee in de eigen basisrate. Hetzelfde geldt voor dossiers die een consultant wegens onvoldoende uitvoering uit
-- de kalibratie heeft gehaald. Bestaande grants blijven staan (create or replace behoudt ze).

-- Punt 15: de AI telt als één stem. Per dossier en moment worden de AI-voorspellingen (één per model) gemiddeld tot één
-- voorspelling; mensen blijven elk een eigen stem. Intern, zonder toegangscontrole: alleen via de functies hieronder.
create or replace function public.calibration_votes_internal(p_org uuid)
returns table (idea_id uuid, moment text, forecaster_kind text, forecaster_id uuid, probability numeric, outcome numeric)
language sql stable security definer set search_path = '' as $$
  with scored as (
    select i.id as idea_id, case o.achieved when 'yes' then 1 when 'partial' then 0.5 else 0 end::numeric as outcome
    from public.ideas i join public.idea_outcomes o on o.idea_id = i.id
    where i.org_id = p_org and i.outcome_question = 'success'
      and not exists (select 1 from public.calibration_exclusions x where x.idea_id = i.id)
  )
  select f.idea_id, f.moment, f.forecaster_kind, f.forecaster_id, f.probability, s.outcome
  from public.forecasts f join scored s on s.idea_id = f.idea_id
  where f.forecaster_kind <> 'ai'
  union all
  select f.idea_id, f.moment, 'ai', null::uuid, avg(f.probability), s.outcome
  from public.forecasts f join scored s on s.idea_id = f.idea_id
  where f.forecaster_kind = 'ai'
  group by f.idea_id, f.moment, s.outcome;
$$;

create or replace function public.forecast_scores(p_org uuid)
returns table (forecaster_kind text, forecaster_id uuid, forecasts bigint, brier numeric, mean_probability numeric, hit_rate numeric)
language sql stable security definer set search_path = '' as $$
  select v.forecaster_kind, v.forecaster_id, count(*), avg(power(v.probability - v.outcome, 2)), avg(v.probability), avg(v.outcome)
  from public.calibration_votes_internal(p_org) v
  where public.is_org_member(p_org)
  group by v.forecaster_kind, v.forecaster_id;
$$;

create or replace function public.forecast_calibration(p_org uuid)
returns table (bucket int, forecasts bigint, mean_probability numeric, observed numeric)
language sql stable security definer set search_path = '' as $$
  select least(9, floor(v.probability * 10))::int, count(*), avg(v.probability), avg(v.outcome)
  from public.calibration_votes_internal(p_org) v
  where public.is_org_member(p_org)
  group by 1 order by 1;
$$;

revoke execute on function public.calibration_votes_internal(uuid) from public, anon, authenticated;

create or replace function public.own_base_rate(p_org uuid, p_project_type text, p_min int default 10)
returns table (resolved bigint, achieved numeric)
language sql stable security definer set search_path = '' as $$
  select count(*), avg(case o.achieved when 'yes' then 1 when 'partial' then 0.5 else 0 end)
  from public.idea_outcomes o join public.ideas i on i.id = o.idea_id
  where i.org_id = p_org and public.is_org_member(p_org) and (p_project_type is null or i.project_type = p_project_type)
    and i.outcome_question = 'success'
    and not exists (select 1 from public.calibration_exclusions x where x.idea_id = i.id)
  having count(*) >= p_min;
$$;
