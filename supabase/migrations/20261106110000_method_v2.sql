-- Methode 2026-11-b (docs/ProofLab_Voorspelkracht_v1.md, hoofdstuk 9): beslisregels per testtype, bewijsfactoren
-- tegen dubbeltellen, plafonds per bewijsniveau en een methodeversie per dossier.
--
--   1. Beslisregel en vooraf berekend aantal deelnemers op de Test Card (hypotheses), vergrendeld na goedkeuring.

-- ---------------------------------------------------------------------------
-- 1. Beslisregel op de Test Card
-- ---------------------------------------------------------------------------

-- decision_rule: 'absolute' (vast aantal sterke handelingen, success_count) of 'probability' (kansregel).
-- Leeg bij Test Cards van vóór deze methode: die rekenen met de intervalregel van methode 2026-11-a, en onder
-- 2026-11-b met de kansregel. expected_pct en available_per_week zijn de aannames waarmee required_n vooraf is
-- berekend; ze horen bij de vooraf vastgelegde regel en worden mee vergrendeld.
alter table public.hypotheses
  add column if not exists decision_rule text check (decision_rule in ('absolute', 'probability')),
  add column if not exists success_count int check (success_count >= 1),
  add column if not exists required_n int check (required_n >= 1),
  add column if not exists expected_pct numeric check (expected_pct > 0 and expected_pct <= 100),
  add column if not exists available_per_week int check (available_per_week >= 0);

alter table public.hypotheses drop constraint if exists hypotheses_absolute_count;
alter table public.hypotheses add constraint hypotheses_absolute_count
  check (decision_rule is distinct from 'absolute' or success_count is not null);

-- Een vergrendelde hypothese kan alleen worden opgevolgd, nooit stil gewijzigd: nu ook de beslisregel en de
-- vooraf berekende aantallen.
create or replace function public.guard_hypothesis_lock()
returns trigger language plpgsql set search_path = '' as $$
begin
  if old.locked_at is not null then
    if (new.we_believe, new.target_group, new.test_method, new.metric_label, new.metric_numerator,
        new.metric_denominator, new.success_threshold_pct, new.fail_threshold_pct, new.min_sample,
        new.max_duration_days, new.assumption_id, new.version, new.locked_at,
        new.decision_rule, new.success_count, new.required_n, new.expected_pct, new.available_per_week)
       is distinct from
       (old.we_believe, old.target_group, old.test_method, old.metric_label, old.metric_numerator,
        old.metric_denominator, old.success_threshold_pct, old.fail_threshold_pct, old.min_sample,
        old.max_duration_days, old.assumption_id, old.version, old.locked_at,
        old.decision_rule, old.success_count, old.required_n, old.expected_pct, old.available_per_week) then
      raise exception 'HYPOTHESIS_LOCKED: deze hypothese is vergrendeld; maak een nieuwe versie met motivering'
        using errcode = 'P0001';
    end if;
  end if;
  return new;
end $$;
