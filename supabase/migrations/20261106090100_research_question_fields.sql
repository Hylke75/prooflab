-- Onderzoeksvragen zijn enkelvoudig en meetbaar: per vraag een meeteenheid en het soort bron dat het antwoord
-- moet leveren (lib/domain/research-plan.ts EXPECTED_SOURCES). De runner haalt bij vragen met verwachte bron
-- "Officiële statistiek" over marktomvang automatisch CBS-cijfers op (lib/integrations/cbs.ts).

alter table public.research_questions add column if not exists unit text check (unit is null or char_length(unit) <= 120);
alter table public.research_questions add column if not exists expected_source text check (expected_source is null or expected_source in
  ('official_statistic', 'industry_report', 'pricing_page', 'customer_research', 'company_page', 'internal_data', 'other'));
