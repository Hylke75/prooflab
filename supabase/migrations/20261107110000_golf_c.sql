-- Golf C: onderzoek en herleidbaarheid (verbeterplan werkwijze, 3 november 2026).
-- Wijzigt geen eerdere migratie. RLS: alle nieuwe kolommen vallen onder de bestaande policies van hun tabel.

-- ---------------------------------------------------------------------------
-- Punt 7. Populatie, regio en peildatum per bevinding
-- ---------------------------------------------------------------------------
-- Elke bevinding draagt drie velden, elk ingevuld of expliciet 'onbekend'. De app vergelijkt ze met de intake
-- (doelgroep, regio, beslisdatum; lib/domain/claim-scope.ts) en legt in relevance vast of de bevinding direct
-- over dit idee gaat of 'indirect' is. De weging van 'indirect' (halve sterkte) hoort bij een nieuwe
-- methodeversie; de bestaande versies 2026-11-a en 2026-11-b lezen dit veld niet.

update public.claims set region = 'onbekend' where region is null or btrim(region) = '';
alter table public.claims
  alter column region set default 'onbekend',
  alter column region set not null,
  add column population text not null default 'onbekend' check (char_length(btrim(population)) between 1 and 200),
  -- 'JJJJ', 'JJJJ-MM', 'JJJJ-MM-DD' of 'onbekend'.
  add column reference_date text not null default 'onbekend'
    check (reference_date = 'onbekend' or reference_date ~ '^\d{4}(-(0[1-9]|1[0-2])(-(0[1-9]|[12]\d|3[01]))?)?$'),
  add column relevance text not null default 'direct' check (relevance in ('direct', 'indirect')),
  add constraint claims_region_filled check (char_length(btrim(region)) between 1 and 120);

-- Bestaande bevindingen: een jaartal in de oude periode wordt de peildatum (het laatste jaartal), anders 'onbekend'.
update public.claims
set reference_date = coalesce(
  (select max(m[1]) from regexp_matches(period, '(?<!\d)((?:19[5-9]|20\d)\d)(?!\d)', 'g') as m),
  'onbekend')
where period is not null;
