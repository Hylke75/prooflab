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
