-- Intake, succescriterium en coach (6 november).

-- ---------------------------------------------------------------------------
-- 1. Beslisvraag: wat staat er op het spel?
-- ---------------------------------------------------------------------------
-- De inzet is een bedrag (euro), tijd (uren) of capaciteit (fte). Verplicht in de intake, maar optioneel in de
-- database: bestaande ideeën blijven geldig. decision_stakes houdt de leesbare tekst ("€ 25.000"),
-- budget_eur blijft gevuld bij een bedrag (rapport).

alter table public.ideas
  add column if not exists stake_kind text check (stake_kind in ('amount', 'time', 'capacity')),
  add column if not exists stake_value numeric check (stake_value >= 0);

alter table public.ideas drop constraint if exists ideas_stake_pair;
alter table public.ideas add constraint ideas_stake_pair check ((stake_kind is null) = (stake_value is null));

-- ---------------------------------------------------------------------------
-- 2. Succescriterium: naast het aantal ook een waarde, en een geplande meetdatum
-- ---------------------------------------------------------------------------
-- Een minimumbedrag per klant en/of een omzetdoel (euro). De app vraagt minstens één van beide voor nieuwe
-- definities; bestaande definities blijven geldig. De meetdatum ligt na de beslisdatum en binnen zes maanden
-- daarna (gecontroleerd in de app); bij het besluit wordt hij de uitkomstdatum als hij dan nog in dat venster past.

alter table public.ideas
  add column if not exists outcome_min_value_per_customer numeric check (outcome_min_value_per_customer >= 0),
  add column if not exists outcome_revenue_target numeric check (outcome_revenue_target >= 0),
  add column if not exists outcome_measure_date date;

-- De vergrendeling geldt ook voor de nieuwe onderdelen van de definitie.
create or replace function public.guard_outcome_definition()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  -- The definition and the base rate it starts from are fixed once forecasts exist. The due date (six
  -- months after the decision) and the decision date that starts the clock may be filled in once.
  if ((new.outcome_statement, new.outcome_metric, new.outcome_target, new.outcome_min_value_per_customer,
       new.outcome_revenue_target, new.outcome_measure_date, new.reference_class, new.base_rate_low, new.base_rate_high)
      is distinct from (old.outcome_statement, old.outcome_metric, old.outcome_target, old.outcome_min_value_per_customer,
       old.outcome_revenue_target, old.outcome_measure_date, old.reference_class, old.base_rate_low, old.base_rate_high)
      or (old.outcome_due is not null and new.outcome_due is distinct from old.outcome_due)
      or (old.outcome_clock_start is not null and new.outcome_clock_start is distinct from old.outcome_clock_start))
     and exists (select 1 from public.forecasts f where f.idea_id = new.id) then
    raise exception 'OUTCOME_LOCKED: de uitkomstdefinitie ligt vast zodra er een voorspelling is' using errcode = 'P0001';
  end if;
  return new;
end $$;

drop trigger if exists ideas_outcome_lock on public.ideas;
create trigger ideas_outcome_lock before update of outcome_statement, outcome_metric, outcome_target, outcome_due,
  outcome_clock_start, outcome_min_value_per_customer, outcome_revenue_target, outcome_measure_date,
  reference_class, base_rate_low, base_rate_high on public.ideas
  for each row execute function public.guard_outcome_definition();
