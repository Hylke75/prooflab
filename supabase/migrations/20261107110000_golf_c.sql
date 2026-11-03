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

-- ---------------------------------------------------------------------------
-- Punt 8. Jaar en regio per sizing-factor
-- ---------------------------------------------------------------------------
-- Null betekent onbekend. Wijken de factoren van één scenario meer dan 2 jaar of in regio af, dan toont de app een
-- waarschuwing en verbreedt de Monte Carlo-simulatie de bandbreedtes (lib/domain/sizing.ts, factorConsistency).

alter table public.sizing_factors
  add column year int check (year between 1950 and 2100),
  add column region text check (region is null or char_length(btrim(region)) between 1 and 120);

-- ---------------------------------------------------------------------------
-- Punt 10. Verplichte zoekopdracht naar tegenbewijs
-- ---------------------------------------------------------------------------
-- Per onderzoeksvraag een eigen stap 'counter' (zoeken naar tegenbewijs, daarna uitlezen met dezelfde citaatcontrole).
-- Het zoeklogboek onderscheidt gewone zoekopdrachten (kind 'search') van zoekopdrachten naar tegenbewijs ('counter');
-- hergebruik binnen 7 dagen gebeurt alleen binnen hetzelfde soort. RLS en alleen-toevoegen blijven ongewijzigd.

alter table public.research_tasks drop constraint research_tasks_kind_check;
alter table public.research_tasks add constraint research_tasks_kind_check
  check (kind in ('plan', 'search', 'extract', 'counter', 'competitors', 'sizing', 'reality_check'));

alter table public.research_search_log
  add column kind text not null default 'search' check (kind in ('search', 'counter'));
create index research_search_log_kind_idx on public.research_search_log(idea_id, kind, created_at desc);

-- ---------------------------------------------------------------------------
-- Punt 19. Momentopname van aantallen bij elk rapport
-- ---------------------------------------------------------------------------
-- Geen nieuwe tabel: elk rapport bewaart in reports.snapshot het veld 'tallies' (lib/domain/report-counts.ts) met
-- geanonimiseerde aantallen per test, bron, kanaal en wervingsgroep, en de kernvraag van enquêtes per bron. Rapporten
-- zijn onveranderlijk (reports_guard) en purge_expired_personal_data raakt de tabel niet; na de bewaartermijn kan
-- herleiding dus alleen op deze aantallen.

comment on column public.reports.snapshot is
  'Onveranderlijke momentopname van het dossier. Het veld tallies bevat geanonimiseerde aantallen (n en successen per test, bron, kanaal en wervingsgroep; kernvraag van enquêtes per bron) en valt niet onder de bewaartermijn.';
