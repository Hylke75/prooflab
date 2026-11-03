-- ProofLab: alle migraties sinds 5 november (6 november + golf A, B en C) in één keer, voor de SQL Editor van Supabase.
-- Plak dit hele bestand in Supabase → SQL Editor en klik op Run. Alles gebeurt in één transactie:
-- gaat er iets mis, dan verandert er niets. Vervangt apply_2026-11-06.sql (niet allebei uitvoeren).
begin;

-- ===== 20261106090000_research_search_log =====
-- Zoeklogboek van onderzoeksruns: per zoekopdracht de zoekterm, de gevonden URL's met wat ProofLab ermee deed
-- (bewaard of de reden waarom niet) en het aantal bewaarde letterlijke passages. Zo raakt geen gevonden bron
-- ongemerkt kwijt, en kan ProofLab zoekresultaten van dezelfde vraag binnen 7 dagen hergebruiken in plaats van
-- opnieuw te betalen.
--
-- Alleen het onderzoeksteam (can_write_idea) leest en schrijft het logboek; de opdrachtgever niet. Het logboek is
-- alleen-toevoegen: er zijn geen update- of delete-policies (rijen verdwijnen met de run of het idee).

create table public.research_search_log (
  id uuid primary key default gen_random_uuid(),
  run_id uuid references public.research_runs(id) on delete cascade,
  task_id uuid references public.research_tasks(id) on delete set null,
  idea_id uuid not null references public.ideas(id) on delete cascade,
  question_id uuid references public.research_questions(id) on delete set null,
  -- De onderzoeksvraag zoals die op het moment van zoeken luidde (sleutel voor hergebruik binnen 7 dagen).
  question text,
  provider text not null check (provider in ('anthropic', 'openai', 'gemini', 'prooflab')),
  query text not null check (char_length(query) between 1 and 500),
  -- [{ url, title, status, reason }], status: bewaard | pdf_geen_tekst | lege_pagina | geblokkeerd |
  -- geen_relevante_alinea | citaat_niet_letterlijk | niet_opgehaald
  urls jsonb not null default '[]'::jsonb check (jsonb_typeof(urls) = 'array'),
  passages int not null default 0 check (passages >= 0),
  -- true wanneer deze rij een eerder (betaald) resultaat hergebruikt in plaats van opnieuw te zoeken.
  reused boolean not null default false,
  created_at timestamptz not null default now()
);

create index research_search_log_idea_idx on public.research_search_log(idea_id, created_at desc);
create index research_search_log_run_idx on public.research_search_log(run_id);

alter table public.research_search_log enable row level security;

create policy research_search_log_select on public.research_search_log for select to authenticated
  using (public.can_write_idea(idea_id));
create policy research_search_log_insert on public.research_search_log for insert to authenticated
  with check (public.can_write_idea(idea_id));

-- Verwijzingen blijven binnen hetzelfde idee (zie 20261029090000_integrity.sql).
create trigger research_search_log_refs before insert or update on public.research_search_log
  for each row execute function public.check_idea_refs('run_id', 'research_runs', 'task_id', 'research_tasks', 'question_id', 'research_questions');

revoke all on public.research_search_log from anon;
revoke update, delete on public.research_search_log from authenticated;
grant select, insert on public.research_search_log to authenticated;


-- ===== 20261106090100_research_question_fields =====
-- Onderzoeksvragen zijn enkelvoudig en meetbaar: per vraag een meeteenheid en het soort bron dat het antwoord
-- moet leveren (lib/domain/research-plan.ts EXPECTED_SOURCES). De runner haalt bij vragen met verwachte bron
-- "Officiële statistiek" over marktomvang automatisch CBS-cijfers op (lib/integrations/cbs.ts).

alter table public.research_questions add column if not exists unit text check (unit is null or char_length(unit) <= 120);
alter table public.research_questions add column if not exists expected_source text check (expected_source is null or expected_source in
  ('official_statistic', 'industry_report', 'pricing_page', 'customer_research', 'company_page', 'internal_data', 'other'));


-- ===== 20261106100000_intake_coach =====
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

-- ---------------------------------------------------------------------------
-- 3. Referentieklasse "Nieuwe B2B-dienst / bureau-aanbod, klanten binnen 6 maanden"
-- ---------------------------------------------------------------------------
-- Niet toegevoegd aan reference_classes: er is (op 3 november 2026) geen betrouwbare, citeerbare bron gevonden met
-- een letterlijk percentage voor deze klasse. Een referentie staat nooit zonder bron. In plaats daarvan kan de
-- consultant een voorstel per dossier laten zoeken (hieronder).

-- Door AI voorgestelde referenties, per dossier. Alleen de app-server legt ze vast (ingest-sleutel), en alleen
-- nadat ProofLab de pagina zelf ophaalde en het citaat met het percentage er letterlijk op terugvond.
create table if not exists public.reference_proposals (
  id uuid primary key default gen_random_uuid(),
  idea_id uuid not null references public.ideas(id) on delete cascade,
  label text not null check (char_length(label) between 2 and 160),
  rate numeric not null check (rate between 0 and 1),
  source_url text not null check (source_url ~* '^https?://' and char_length(source_url) <= 2000),
  source_title text not null check (char_length(source_title) between 1 and 300),
  quote text not null check (char_length(quote) between 8 and 1000),
  passage text not null check (char_length(passage) between 8 and 1500),
  model text check (char_length(model) <= 80),
  created_by uuid default auth.uid() references auth.users(id),
  created_at timestamptz not null default now()
);
create index if not exists reference_proposals_idea_idx on public.reference_proposals(idea_id, created_at desc);
create index if not exists reference_proposals_created_by_fk on public.reference_proposals(created_by);

alter table public.reference_proposals enable row level security;
drop policy if exists reference_proposals_select on public.reference_proposals;
create policy reference_proposals_select on public.reference_proposals for select to authenticated
  using (public.can_read_idea(idea_id));
-- Geen insert-, update- of delete-policies: vastleggen kan alleen via record_reference_proposal.

create or replace function public.record_reference_proposal(
  p_key text, p_idea uuid, p_label text, p_rate numeric, p_url text, p_title text, p_quote text, p_passage text, p_model text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if not public.ingest_key_ok(p_key) or not public.can_write_idea(p_idea) then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  -- De controle van het citaat op de pagina gebeurt in de app (lib/domain/reference-proposal.ts); de ingest-sleutel
  -- garandeert dat alleen de app-server hier komt, niet een gebruiker met een eigen 'citaat'.
  insert into public.reference_proposals (idea_id, label, rate, source_url, source_title, quote, passage, model)
  values (p_idea, left(p_label, 160), p_rate, p_url, left(p_title, 300), p_quote, p_passage, left(p_model, 80))
  returning id into v_id;
  return v_id;
end $$;

revoke execute on function public.record_reference_proposal(text, uuid, text, numeric, text, text, text, text, text) from public, anon;
grant execute on function public.record_reference_proposal(text, uuid, text, numeric, text, text, text, text, text) to authenticated;

revoke all on public.reference_proposals from anon;
grant select on public.reference_proposals to authenticated;

create trigger reference_proposals_audit after insert or update or delete on public.reference_proposals
  for each row execute function public.audit_row();

-- ---------------------------------------------------------------------------
-- 4. Coachnotities: "Gedaan" zonder zichtbare data
-- ---------------------------------------------------------------------------
-- Ziet ProofLab nog niet dat het werk gedaan is, dan vraagt de app om bevestiging. Sluit de consultant de notitie
-- toch, dan staat confirmed_without_data op true; de audit (audit_row) legt de wijziging vast.

alter table public.coach_notes add column if not exists confirmed_without_data boolean not null default false;

create or replace function public.guard_coach_note()
returns trigger language plpgsql set search_path = '' as $$
begin
  if (to_jsonb(new) - 'status' - 'resolved_at' - 'resolved_by' - 'helpful' - 'confirmed_without_data')
     is distinct from (to_jsonb(old) - 'status' - 'resolved_at' - 'resolved_by' - 'helpful' - 'confirmed_without_data') then
    raise exception 'COACH_NOTE_LOCKED: alleen de status van een coachnotitie verandert' using errcode = 'P0001';
  end if;
  if new.status <> 'open' and old.status = 'open' then
    new.resolved_at := now();
    new.resolved_by := auth.uid();
    -- Alleen bij het afronden als "gedaan" kan de bevestiging zonder data worden gezet.
    new.confirmed_without_data := new.status = 'done' and coalesce(new.confirmed_without_data, false);
  else
    new.confirmed_without_data := old.confirmed_without_data;
    if new.status is not distinct from old.status then
      new.resolved_at := old.resolved_at;
      new.resolved_by := old.resolved_by;
    end if;
  end if;
  return new;
end $$;


-- ===== 20261106110000_method_v2 =====
-- Methode 2026-11-b (docs/ProofLab_Voorspelkracht_v1.md, hoofdstuk 9): beslisregels per testtype, bewijsfactoren
-- tegen dubbeltellen, plafonds per bewijsniveau en een methodeversie per dossier.
--
--   1. Beslisregel en vooraf berekend aantal deelnemers op de Test Card (hypotheses), vergrendeld na goedkeuring.
--   2. Plafonds per bewijsniveau per werkruimte (org_evidence_caps): leden lezen, eigenaren schrijven.
--   3. Herkomst van bewijs per bevinding en observatie (evidence_source_refs), voor één factor per bron.
--   4. Methodeversie per dossier (ideas.method_version): bestaande dossiers '2026-11-a', nieuwe '2026-11-b';
--      overstappen alleen vooruit en met audit (switch_method_version).

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

-- ---------------------------------------------------------------------------
-- 2. Plafonds per bewijsniveau, per werkruimte
-- ---------------------------------------------------------------------------

-- Zonder rij gelden de standaardwaarden (lib/domain/evidence.ts DEFAULT_CAPS): 0,40 / 0,50 / 0,60 / 0,75 / 0,90.
-- Herhaalaankoop heeft geen plafond. Leden lezen, eigenaren schrijven; de database legt vast wie en wanneer.
create table if not exists public.org_evidence_caps (
  org_id uuid primary key references public.organizations(id) on delete cascade,
  opinion numeric not null default 0.40 check (opinion between 0.05 and 0.99),
  problem numeric not null default 0.50 check (problem between 0.05 and 0.99),
  small_action numeric not null default 0.60 check (small_action between 0.05 and 0.99),
  quote numeric not null default 0.75 check (quote between 0.05 and 0.99),
  deposit numeric not null default 0.90 check (deposit between 0.05 and 0.99),
  updated_by uuid default auth.uid() references auth.users(id),
  updated_at timestamptz not null default now(),
  constraint org_evidence_caps_ascending check (opinion <= problem and problem <= small_action and small_action <= quote and quote <= deposit)
);
create index if not exists org_evidence_caps_updated_by_fk on public.org_evidence_caps(updated_by);
alter table public.org_evidence_caps enable row level security;

drop policy if exists org_evidence_caps_select on public.org_evidence_caps;
create policy org_evidence_caps_select on public.org_evidence_caps for select to authenticated
  using (public.is_org_member(org_id));
drop policy if exists org_evidence_caps_insert on public.org_evidence_caps;
create policy org_evidence_caps_insert on public.org_evidence_caps for insert to authenticated
  with check (public.is_org_owner(org_id));
drop policy if exists org_evidence_caps_update on public.org_evidence_caps;
create policy org_evidence_caps_update on public.org_evidence_caps for update to authenticated
  using (public.is_org_owner(org_id)) with check (public.is_org_owner(org_id));
drop policy if exists org_evidence_caps_delete on public.org_evidence_caps;
create policy org_evidence_caps_delete on public.org_evidence_caps for delete to authenticated
  using (public.is_org_owner(org_id));
revoke all on public.org_evidence_caps from public, anon, authenticated;
grant select, insert, update, delete on public.org_evidence_caps to authenticated;

create or replace function public.stamp_evidence_caps()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_by := auth.uid();
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists org_evidence_caps_stamp on public.org_evidence_caps;
create trigger org_evidence_caps_stamp before insert or update on public.org_evidence_caps
  for each row execute function public.stamp_evidence_caps();

-- Elke wijziging komt in het auditspoor van de werkruimte.
create or replace function public.audit_evidence_caps()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.audit_events (idea_id, org_id, actor_id, table_name, row_id, action, detail)
  values (null, coalesce(new.org_id, old.org_id), auth.uid(), 'org_evidence_caps', coalesce(new.org_id, old.org_id)::text, lower(tg_op),
          jsonb_build_object('old', case when tg_op = 'INSERT' then null else to_jsonb(old) - 'updated_by' - 'updated_at' end,
                             'new', case when tg_op = 'DELETE' then null else to_jsonb(new) - 'updated_by' - 'updated_at' end));
  return null;
end $$;
drop trigger if exists org_evidence_caps_audit on public.org_evidence_caps;
create trigger org_evidence_caps_audit after insert or update or delete on public.org_evidence_caps
  for each row execute function public.audit_evidence_caps();

-- De plafonds die gelden voor één dossier: dezelfde voor consultant en opdrachtgever (een opdrachtgever is
-- geen lid van de werkruimte en leest de tabel zelf niet). Geen rij = null: dan gelden de standaardwaarden.
create or replace function public.evidence_caps_for_idea(p_idea uuid)
returns table (opinion numeric, problem numeric, small_action numeric, quote numeric, deposit numeric)
language sql stable security definer set search_path = '' as $$
  select c.opinion, c.problem, c.small_action, c.quote, c.deposit
  from public.ideas i join public.org_evidence_caps c on c.org_id = i.org_id
  where i.id = p_idea and public.can_read_idea(p_idea);
$$;

-- ---------------------------------------------------------------------------
-- 3. Herkomst van bewijs: "dezelfde bron" per bevinding en observatie
-- ---------------------------------------------------------------------------

-- Per gekoppelde bevinding en observatie van een dossier de gegevens waarmee lib/domain/evidence.ts
-- (evidenceSourceKey) bepaalt welke signalen uit dezelfde bron komen. Een bevinding hoort bij haar eerste
-- bron (bij voorkeur een letterlijk gecontroleerd citaat). Wie alleen meekijkt, krijgt van bronnen die alleen
-- voor consultants zijn (outreach, enquête-antwoorden) en van interviews geen titels, maar wel dezelfde
-- sleutels, zodat iedereen dezelfde kans ziet.
create or replace function public.evidence_source_refs(p_idea uuid)
returns table (
  item_type text, item_id uuid, source_id uuid, source_type text, source_title text, campaign text,
  survey_experiment_id uuid, experiment_id uuid, experiment_title text, interview_id uuid, interview_label text)
language sql stable security definer set search_path = '' as $$
  with access as (select public.can_read_idea(p_idea) as can_read, public.can_write_idea(p_idea) as can_write),
  claim_src as (
    select distinct on (cs.claim_id) cs.claim_id, s.id as source_id, s.source_type, s.title
    from public.claim_sources cs join public.sources s on s.id = cs.source_id
    where cs.idea_id = p_idea
    order by cs.claim_id, (cs.quote_check = 'exact') desc, cs.created_at, cs.id
  ),
  claims as (
    select c.id as claim_id, cs.source_id, cs.source_type, cs.title,
           case when cs.source_type = 'outreach' then substring(cs.title from '^Expandi-antwoorden – (.+) – [^–]+$') end as campaign,
           case when cs.source_type = 'survey' then (
             select e.id from public.experiments e
             where e.idea_id = p_idea and e.type = 'survey' and starts_with(cs.title, 'Enquête – ' || e.title || ' – open antwoorden – ')
             order by length(e.title) desc limit 1) end as survey_experiment_id
    from public.claims c left join claim_src cs on cs.claim_id = c.id
    where c.idea_id = p_idea
  )
  select 'claim', c.claim_id, c.source_id, c.source_type,
         case when a.can_write or c.source_type not in ('outreach', 'survey') then c.title end,
         case when c.campaign is null then null when a.can_write then c.campaign else 'md5:' || md5(c.campaign) end,
         c.survey_experiment_id, null::uuid,
         case when c.survey_experiment_id is not null then (select e.title from public.experiments e where e.id = c.survey_experiment_id) end,
         null::uuid, null::text
  from claims c cross join access a
  where a.can_read
  union all
  select 'observation', o.id, null, null, null, null, null, o.experiment_id, e.title, o.interview_id,
         case when a.can_write then i.participant_label end
  from public.observations o
  cross join access a
  left join public.experiments e on e.id = o.experiment_id
  left join public.interviews i on i.id = o.interview_id
  where o.idea_id = p_idea and a.can_read;
$$;

revoke execute on function public.stamp_evidence_caps(), public.audit_evidence_caps(), public.evidence_caps_for_idea(uuid),
  public.evidence_source_refs(uuid) from public, anon;
revoke execute on function public.stamp_evidence_caps(), public.audit_evidence_caps() from authenticated;
grant execute on function public.evidence_caps_for_idea(uuid), public.evidence_source_refs(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Methodeversie per dossier
-- ---------------------------------------------------------------------------

-- Bestaande dossiers houden de rekenwijze waarmee ze zijn begonnen ('2026-11-a'); nieuwe dossiers starten op
-- '2026-11-b'. De kolom wordt eerst met '2026-11-a' gevuld en daarna krijgt hij de nieuwe standaardwaarde.
alter table public.ideas add column if not exists method_version text not null default '2026-11-a'
  check (method_version in ('2026-11-a', '2026-11-b'));
alter table public.ideas alter column method_version set default '2026-11-b';

-- Overstappen kan alleen vooruit (2026-11-a → 2026-11-b), nooit terug: zo blijft elk rapport reproduceerbaar.
create or replace function public.guard_method_version()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.method_version is distinct from old.method_version
     and not (old.method_version = '2026-11-a' and new.method_version = '2026-11-b') then
    raise exception 'METHOD_VERSION: een dossier kan alleen overstappen van methode 2026-11-a naar 2026-11-b'
      using errcode = 'P0001';
  end if;
  return new;
end $$;
drop trigger if exists ideas_method_version on public.ideas;
create trigger ideas_method_version before update of method_version on public.ideas
  for each row execute function public.guard_method_version();

-- Overstappen met audit: wie, wanneer, van welke naar welke versie, en het overzicht (kans oud/nieuw per
-- aanname, uitkomst oud/nieuw per test) dat vóór de bevestiging is getoond. Alleen consultants van het dossier.
create or replace function public.switch_method_version(p_idea uuid, p_to text, p_preview jsonb)
returns text language plpgsql security definer set search_path = '' as $$
declare
  v_from text;
  v_org uuid;
begin
  if auth.uid() is null or not public.can_write_idea(p_idea) then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  select method_version, org_id into v_from, v_org from public.ideas where id = p_idea for update;
  if v_from is null then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  if v_from = p_to then
    return v_from;
  end if;
  update public.ideas set method_version = p_to where id = p_idea;
  insert into public.audit_events (idea_id, org_id, actor_id, table_name, row_id, action, detail)
  values (p_idea, v_org, auth.uid(), 'ideas', p_idea::text, 'method_switch',
          jsonb_build_object('from', v_from, 'to', p_to, 'preview', coalesce(p_preview, '{}'::jsonb)));
  return p_to;
end $$;

revoke execute on function public.guard_method_version(), public.switch_method_version(uuid, text, jsonb) from public, anon;
revoke execute on function public.guard_method_version() from authenticated;
grant execute on function public.switch_method_version(uuid, text, jsonb) to authenticated;


-- ===== 20261107090000_golf_a =====
-- Golf A: bewijs en testen (docs/VERBETERPLAN_WERKWIJZE.md, docs/ProofLab_Voorspelkracht_v1.md hoofdstuk 10).
--
--   0. Methodeversie 2026-11-c naast 2026-11-a en 2026-11-b; nieuwe dossiers starten op 2026-11-c. Overstappen
--      kan alleen vooruit (a → b → c, of a → c) en met audit.
--   3. Aantal opgeloste dossiers per werkruimte, voor de weergave "niet gekalibreerd".
--   4/13. Wervingsgroep per test, interview en observatie (vergrendeld na goedkeuring; een bekende is eigen
--      netwerk) en evidence_recruitment_refs voor de afnemende factor van methode 2026-11-c.
--   5. Startkans van een aanname: onderbouwing bij een afwijking van 50%, vergrendeld bij het eerste bewijs,
--      daarna alleen wijzigen met een reden (change_assumption_prior), elke wijziging in het auditspoor.
--   11. Hoofdtest per aanname (assumptions.primary_experiment_id), aan te wijzen vóór de goedkeuring.
--   17. AI-concepten: het AI-origineel van onderzoeksvragen, promoberichten en enquêtes (ai_drafts) blijft bewaard.
--
-- Bestaande dossiers houden hun methodeversie en rekenen dus niet anders.

-- ---------------------------------------------------------------------------
-- 0. Methodeversie 2026-11-c
-- ---------------------------------------------------------------------------

alter table public.ideas drop constraint if exists ideas_method_version_check;
alter table public.ideas add constraint ideas_method_version_check
  check (method_version in ('2026-11-a', '2026-11-b', '2026-11-c'));
alter table public.ideas alter column method_version set default '2026-11-c';

-- Volgorde van de versies; een onbekende versie heeft geen plek (null).
create or replace function public.method_version_rank(p_version text)
returns int language sql immutable set search_path = '' as $$
  select case p_version when '2026-11-a' then 1 when '2026-11-b' then 2 when '2026-11-c' then 3 end;
$$;

-- Overstappen kan alleen vooruit, nooit terug: zo blijft elk rapport reproduceerbaar.
create or replace function public.guard_method_version()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.method_version is distinct from old.method_version
     and not coalesce(public.method_version_rank(new.method_version) > public.method_version_rank(old.method_version), false) then
    raise exception 'METHOD_VERSION: een dossier kan alleen overstappen naar een latere methodeversie (2026-11-a → 2026-11-b → 2026-11-c)'
      using errcode = 'P0001';
  end if;
  return new;
end $$;

revoke execute on function public.method_version_rank(text) from public, anon;
grant execute on function public.method_version_rank(text) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Kansen tonen in banden zolang er geen eigen kalibratie is
-- ---------------------------------------------------------------------------

-- Hoeveel dossiers van de werkruimte van dit dossier een vastgelegde uitkomst hebben. Daarmee bepaalt het scherm
-- of kansen "niet gekalibreerd" zijn (minder dan 10, lib/domain/probability-display.ts). Alleen een aantal; ook
-- leesbaar voor wie het dossier alleen mag inzien (opdrachtgever), zodat iedereen dezelfde weergave krijgt.
create or replace function public.resolved_dossiers_for_idea(p_idea uuid)
returns bigint language sql stable security definer set search_path = '' as $$
  select count(*)
  from public.ideas i
  join public.ideas o on o.org_id = i.org_id
  join public.idea_outcomes r on r.idea_id = o.id
  where i.id = p_idea and public.can_read_idea(p_idea);
$$;
revoke execute on function public.resolved_dossiers_for_idea(uuid) from public, anon;
grant execute on function public.resolved_dossiers_for_idea(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 4 en 13. Wervingsgroep per test en per signaal
-- ---------------------------------------------------------------------------

-- Via welke weg zijn de deelnemers geworven (lib/domain/recruitment.ts): eigen netwerk, warm contact, koud,
-- betaald panel of onbekend. Per test (experiments), per interview en per losse observatie. Leeg bij tests van
-- vóór golf A: die tellen als onbekend. Verplicht op de Test Card bij enquête-, landing- en prijstests (de app);
-- in de database alleen geldige waarden, en na goedkeuring vast.
alter table public.experiments
  add column if not exists recruitment_group text
    check (recruitment_group in ('own_network', 'warm', 'cold', 'paid_panel', 'unknown'));
alter table public.interviews
  add column if not exists recruitment_group text
    check (recruitment_group in ('own_network', 'warm', 'cold', 'paid_panel', 'unknown'));
alter table public.observations
  add column if not exists recruitment_group text
    check (recruitment_group in ('own_network', 'warm', 'cold', 'paid_panel', 'unknown'));

-- De wervingsgroep hoort bij de vooraf vastgelegde opzet: na goedkeuring kan hij niet meer veranderen.
create or replace function public.guard_experiment_recruitment()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.recruitment_group is distinct from old.recruitment_group and old.state not in ('draft', 'ready_for_review') then
    raise exception 'EXPERIMENT_RECRUITMENT: de wervingsgroep is na goedkeuring vergrendeld' using errcode = 'P0001';
  end if;
  return new;
end $$;
drop trigger if exists experiments_recruitment_lock on public.experiments;
create trigger experiments_recruitment_lock before update of recruitment_group on public.experiments
  for each row execute function public.guard_experiment_recruitment();

-- Een bekende (interviews.is_acquaintance) is altijd eigen netwerk.
create or replace function public.stamp_interview_recruitment()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.is_acquaintance then
    new.recruitment_group := 'own_network';
  end if;
  return new;
end $$;
drop trigger if exists interviews_recruitment on public.interviews;
create trigger interviews_recruitment before insert or update on public.interviews
  for each row execute function public.stamp_interview_recruitment();

-- Per gekoppelde bevinding en observatie van een dossier de wervingsgroep waarmee methode 2026-11-c herhaling
-- binnen dezelfde groep afnemend laat meetellen. Volgorde: de groep van het signaal zelf, dan het interview
-- (een bekende = eigen netwerk), dan de test; een signaal uit een test of interview zonder groep is onbekend.
-- Bevindingen tellen alleen mee als ze uit open enquêteantwoorden komen (de groep van die enquête); bureau-
-- onderzoek is niet geworven en heeft geen groep. Dezelfde uitkomst voor consultant en opdrachtgever.
create or replace function public.evidence_recruitment_refs(p_idea uuid)
returns table (item_type text, item_id uuid, recruitment_group text)
language sql stable security definer set search_path = '' as $$
  select r.item_type, r.item_id,
         case
           when r.item_type = 'claim' then
             case when r.survey_experiment_id is not null then
               coalesce((select e.recruitment_group from public.experiments e where e.id = r.survey_experiment_id), 'unknown')
             end
           else coalesce(
             o.recruitment_group,
             case when i.is_acquaintance then 'own_network' end,
             i.recruitment_group,
             e.recruitment_group,
             case when o.experiment_id is not null or o.interview_id is not null then 'unknown' end)
         end
  from public.evidence_source_refs(p_idea) r
  left join public.observations o on r.item_type = 'observation' and o.id = r.item_id
  left join public.interviews i on i.id = o.interview_id
  left join public.experiments e on e.id = o.experiment_id;
$$;

revoke execute on function public.guard_experiment_recruitment(), public.stamp_interview_recruitment(),
  public.evidence_recruitment_refs(uuid) from public, anon;
revoke execute on function public.guard_experiment_recruitment(), public.stamp_interview_recruitment() from authenticated;
grant execute on function public.evidence_recruitment_refs(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Startkans van een aanname: onderbouwing en vergrendeling
-- ---------------------------------------------------------------------------

-- prior_rationale: korte onderbouwing van een startkans anders dan 50%. prior_locked_at: het moment waarop het
-- eerste bewijs aan de aanname werd gekoppeld; daarna kan de startkans alleen met een reden veranderen.
alter table public.assumptions
  add column if not exists prior_rationale text check (char_length(prior_rationale) <= 600),
  add column if not exists prior_locked_at timestamptz;

-- Bestaande aannames met bewijs zijn vanaf nu vergrendeld (de kans zelf verandert niet).
update public.assumptions a set prior_locked_at = now()
where a.prior_locked_at is null
  and (exists (select 1 from public.assumption_claims x where x.assumption_id = a.id)
       or exists (select 1 from public.assumption_observations x where x.assumption_id = a.id));

-- Zodra bewijs wordt gekoppeld, wordt de startkans vergrendeld (blijvend, ook als het bewijs later wordt ontkoppeld).
create or replace function public.lock_assumption_prior()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update public.assumptions set prior_locked_at = now() where id = new.assumption_id and prior_locked_at is null;
  return null;
end $$;
drop trigger if exists assumption_claims_lock_prior on public.assumption_claims;
create trigger assumption_claims_lock_prior after insert on public.assumption_claims
  for each row execute function public.lock_assumption_prior();
drop trigger if exists assumption_observations_lock_prior on public.assumption_observations;
create trigger assumption_observations_lock_prior after insert on public.assumption_observations
  for each row execute function public.lock_assumption_prior();

-- Handhaving in de database (en in de app, lib/domain/prior.ts):
-- - een startkans anders dan 50% heeft een onderbouwing van minimaal 10 tekens;
-- - na vergrendeling kan de startkans alleen veranderen met een reden (change_assumption_prior), die samen met de
--   oude en nieuwe waarde in het auditspoor komt; elke wijziging van de startkans wordt geaudit;
-- - prior_locked_at zet alleen de database (lock_assumption_prior), nooit een gebruiker.
create or replace function public.guard_assumption_prior()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_reason text := nullif(btrim(coalesce(current_setting('prooflab.prior_change_reason', true), '')), '');
  v_org uuid;
begin
  if tg_op = 'INSERT' then
    if pg_trigger_depth() = 1 then
      new.prior_locked_at := null;
    end if;
  elsif pg_trigger_depth() = 1 then
    new.prior_locked_at := old.prior_locked_at;
  end if;

  if (tg_op = 'INSERT' or new.prior is distinct from old.prior or new.prior_rationale is distinct from old.prior_rationale)
     and new.prior is not null and abs(new.prior - 0.5) > 0.000001
     and char_length(btrim(coalesce(new.prior_rationale, ''))) < 10 then
    raise exception 'PRIOR_RATIONALE: een startkans anders dan 50%% vraagt een onderbouwing van minimaal 10 tekens'
      using errcode = 'P0001';
  end if;

  if tg_op = 'UPDATE' and coalesce(new.prior, 0.5) is distinct from coalesce(old.prior, 0.5) then
    if old.prior_locked_at is not null and char_length(coalesce(v_reason, '')) < 10 then
      raise exception 'PRIOR_LOCKED: er hangt bewijs aan deze aanname; wijzig de startkans alleen met een reden'
        using errcode = 'P0001';
    end if;
    select org_id into v_org from public.ideas where id = old.idea_id;
    insert into public.audit_events (idea_id, org_id, actor_id, table_name, row_id, action, detail)
    values (old.idea_id, v_org, auth.uid(), 'assumptions', old.id::text, 'prior_change',
            jsonb_build_object('from', coalesce(old.prior, 0.5), 'to', coalesce(new.prior, 0.5), 'locked', old.prior_locked_at is not null,
                               'reason', v_reason, 'rationale', new.prior_rationale));
  end if;
  return new;
end $$;
drop trigger if exists assumptions_prior_guard on public.assumptions;
create trigger assumptions_prior_guard before insert or update on public.assumptions
  for each row execute function public.guard_assumption_prior();

-- Startkans wijzigen met onderbouwing en (na vergrendeling) een reden. Rekent met de rechten van de aanroeper
-- (rijbeveiliging); de reden gaat alleen voor deze transactie mee naar guard_assumption_prior.
create or replace function public.change_assumption_prior(p_assumption uuid, p_prior numeric, p_rationale text, p_reason text)
returns void language plpgsql security invoker set search_path = '' as $$
begin
  perform set_config('prooflab.prior_change_reason', coalesce(p_reason, ''), true);
  update public.assumptions set prior = p_prior, prior_rationale = nullif(btrim(coalesce(p_rationale, '')), '')
  where id = p_assumption;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  perform set_config('prooflab.prior_change_reason', '', true);
end $$;

revoke execute on function public.lock_assumption_prior(), public.guard_assumption_prior(),
  public.change_assumption_prior(uuid, numeric, text, text) from public, anon;
revoke execute on function public.lock_assumption_prior(), public.guard_assumption_prior() from authenticated;
grant execute on function public.change_assumption_prior(uuid, numeric, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 11. Hoofdtest per aanname
-- ---------------------------------------------------------------------------

-- Per aanname één vooraf aangewezen hoofdtest; de andere tests van de aanname zijn verkennend
-- (lib/domain/primary-test.ts). Aanwijzen kan zolang de test een concept is of ter review ligt, en alleen als de
-- huidige hoofdtest dat ook nog is: daarna ligt de keuze vast. Elke wijziging komt in het auditspoor.
alter table public.assumptions
  add column if not exists primary_experiment_id uuid references public.experiments(id) on delete set null;
create index if not exists assumptions_primary_experiment_fk on public.assumptions(primary_experiment_id);

create or replace function public.guard_assumption_primary()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_new_state text;
  v_new_assumption uuid;
  v_old_state text;
  v_org uuid;
begin
  if tg_op = 'UPDATE' and new.primary_experiment_id is not distinct from old.primary_experiment_id then
    return new;
  end if;
  if new.primary_experiment_id is not null then
    select e.state, h.assumption_id into v_new_state, v_new_assumption
    from public.experiments e join public.hypotheses h on h.id = e.hypothesis_id
    where e.id = new.primary_experiment_id and e.idea_id = new.idea_id;
    if v_new_assumption is distinct from new.id then
      raise exception 'PRIMARY_TEST: de hoofdtest moet een test van deze aanname zijn' using errcode = 'P0001';
    end if;
    if v_new_state not in ('draft', 'ready_for_review') then
      raise exception 'PRIMARY_TEST: een hoofdtest wijs je aan vóór de goedkeuring' using errcode = 'P0001';
    end if;
  end if;
  if tg_op = 'UPDATE' and old.primary_experiment_id is not null then
    select state into v_old_state from public.experiments where id = old.primary_experiment_id;
    -- Een verwijderde test (concept) laat geen vastgelegde keuze achter.
    if v_old_state is not null and v_old_state not in ('draft', 'ready_for_review') then
      raise exception 'PRIMARY_TEST: de hoofdtest van deze aanname is al goedgekeurd of gestart; die keuze ligt vast' using errcode = 'P0001';
    end if;
  end if;
  -- Geen audit als de hoofdtest wegvalt doordat de (concept)test zelf is verwijderd.
  if tg_op = 'UPDATE' and (new.primary_experiment_id is not null or v_old_state is not null) then
    select org_id into v_org from public.ideas where id = old.idea_id;
    insert into public.audit_events (idea_id, org_id, actor_id, table_name, row_id, action, detail)
    values (old.idea_id, v_org, auth.uid(), 'assumptions', old.id::text, 'primary_test',
            jsonb_build_object('from', old.primary_experiment_id, 'to', new.primary_experiment_id));
  end if;
  return new;
end $$;
drop trigger if exists assumptions_primary_guard on public.assumptions;
create trigger assumptions_primary_guard before insert or update of primary_experiment_id on public.assumptions
  for each row execute function public.guard_assumption_primary();

revoke execute on function public.guard_assumption_primary() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 17. AI-concepten: het AI-origineel bewaren
-- ---------------------------------------------------------------------------

-- Bij AI-concepten blijft het origineel bewaard, zodat zichtbaar is wat de mens heeft aangepast
-- (lib/domain/ai-draft.ts). Onderzoeksvragen en promoberichten krijgen het origineel als tekst bij het aanmaken;
-- een AI-opzet voor een enquête wordt bij het voorstellen als ai_draft bewaard en bij het opslaan van de Test Card
-- aan de test gekoppeld. Het origineel verandert nooit meer.
alter table public.research_questions
  add column if not exists ai_original text check (char_length(ai_original) <= 4000);
alter table public.promo_posts
  add column if not exists ai_original text check (char_length(ai_original) <= 4000);

create table if not exists public.ai_drafts (
  id uuid primary key default gen_random_uuid(),
  idea_id uuid not null references public.ideas(id) on delete cascade,
  kind text not null check (kind in ('survey')),
  content jsonb not null,
  created_by uuid default auth.uid() references auth.users(id),
  created_at timestamptz not null default now()
);
create index if not exists ai_drafts_idea_fk on public.ai_drafts(idea_id);
create index if not exists ai_drafts_created_by_fk on public.ai_drafts(created_by);
alter table public.ai_drafts enable row level security;
drop policy if exists ai_drafts_select on public.ai_drafts;
create policy ai_drafts_select on public.ai_drafts for select to authenticated using (public.can_read_idea(idea_id));
drop policy if exists ai_drafts_insert on public.ai_drafts;
create policy ai_drafts_insert on public.ai_drafts for insert to authenticated with check (public.can_write_idea(idea_id));
-- Geen update- of verwijderbeleid: een AI-origineel is onveranderlijk.
revoke all on public.ai_drafts from public, anon, authenticated;
grant select, insert on public.ai_drafts to authenticated;

alter table public.experiments
  add column if not exists ai_draft_id uuid references public.ai_drafts(id) on delete set null;
create index if not exists experiments_ai_draft_fk on public.experiments(ai_draft_id);

create or replace function public.stamp_ai_draft()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.created_by := auth.uid();
  new.created_at := now();
  return new;
end $$;
drop trigger if exists ai_drafts_stamp on public.ai_drafts;
create trigger ai_drafts_stamp before insert on public.ai_drafts
  for each row execute function public.stamp_ai_draft();

-- Het AI-origineel wordt bij het aanmaken vastgelegd en daarna nooit meer gewijzigd. Een gekoppeld enquête-
-- origineel hoort bij hetzelfde dossier.
create or replace function public.keep_ai_original()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_table_name = 'experiments' then
    if tg_op = 'UPDATE' then
      -- Alleen als het origineel nog bestaat (bij het verwijderen van een dossier valt het weg).
      if old.ai_draft_id is null or exists (select 1 from public.ai_drafts d where d.id = old.ai_draft_id) then
        new.ai_draft_id := old.ai_draft_id;
      end if;
    elsif new.ai_draft_id is not null
          and not exists (select 1 from public.ai_drafts d where d.id = new.ai_draft_id and d.idea_id = new.idea_id and d.kind = 'survey') then
      raise exception 'AI_DRAFT: dit AI-concept hoort niet bij dit dossier' using errcode = 'P0001';
    end if;
  elsif tg_op = 'UPDATE' then
    new.ai_original := old.ai_original;
  end if;
  return new;
end $$;
drop trigger if exists research_questions_ai_original on public.research_questions;
create trigger research_questions_ai_original before update on public.research_questions
  for each row execute function public.keep_ai_original();
drop trigger if exists promo_posts_ai_original on public.promo_posts;
create trigger promo_posts_ai_original before update on public.promo_posts
  for each row execute function public.keep_ai_original();
drop trigger if exists experiments_ai_draft on public.experiments;
create trigger experiments_ai_draft before insert or update on public.experiments
  for each row execute function public.keep_ai_original();

revoke execute on function public.stamp_ai_draft(), public.keep_ai_original() from public, anon, authenticated;


-- ===== 20261107100000_golf_b =====
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
--  18. De opdrachtgever bevestigt een besluit pas na de samenvatting "Wat ging tegen" (reviewed_against_summary).
--  20. Verlengde testfase: het tussenbesluit "extend" (2 tot 8 weken). Het definitieve besluit en de uitkomstklok
--      starten pas daarna.
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
-- 18. Opdrachtgever bevestigt na "Wat ging tegen"
-- ---------------------------------------------------------------------------
-- Bij het bevestigen ziet de opdrachtgever verplicht wat tegen ging: mislukte tests, tegenbewijs, begrensde aannames
-- (plafond actief) en afwijkingen van de beslisregel. De app stelt die samenvatting samen (lib/domain/against.ts); de
-- database eist dat ze is meegegeven en bevestigd, en controleert wat ze zelf kan tellen: het aantal mislukte tests
-- (laatste goedgekeurde Learning Card per test = 'fail') en de afwijking van de beslisregel bij dit besluit.

alter table public.decisions
  add column if not exists reviewed_against_summary jsonb
    check (reviewed_against_summary is null or (jsonb_typeof(reviewed_against_summary) = 'object' and pg_column_size(reviewed_against_summary) <= 60000));

-- De oude bevestiging zonder samenvatting verdwijnt: bevestigen kan alleen nog met de samenvatting.
drop function if exists public.confirm_decision(uuid, text);

create or replace function public.confirm_decision(p_decision uuid, p_comment text, p_reviewed_against_summary jsonb)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  d public.decisions;
  v_org uuid;
  v_failed int;
  k text;
begin
  select * into d from public.decisions where id = p_decision;
  if d.id is null then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  select org_id into v_org from public.ideas where id = d.idea_id;
  if public.is_org_member(v_org) or not exists (
    select 1 from public.idea_members im
    where im.idea_id = d.idea_id and im.user_id = auth.uid() and im.role = 'client_decider'
  ) then
    raise exception 'FORBIDDEN: alleen de opdrachtgever kan dit besluit bevestigen' using errcode = 'P0001';
  end if;
  if d.client_confirmed_at is not null then
    return false;
  end if;
  if p_reviewed_against_summary is null or jsonb_typeof(p_reviewed_against_summary) <> 'object'
     or coalesce((p_reviewed_against_summary->>'acknowledged')::boolean, false) is not true then
    raise exception 'REVIEW_REQUIRED: bekijk eerst de samenvatting "Wat ging tegen"' using errcode = 'P0001';
  end if;
  foreach k in array array['failed_tests', 'counter_evidence', 'capped_assumptions', 'rule_deviations'] loop
    if jsonb_typeof(p_reviewed_against_summary->k) is distinct from 'array' then
      raise exception 'REVIEW_REQUIRED: de samenvatting mist het onderdeel %', k using errcode = 'P0001';
    end if;
  end loop;
  select count(*) into v_failed from public.experiments e
  where e.idea_id = d.idea_id
    and (select lc.verdict from public.learning_cards lc where lc.experiment_id = e.id and lc.status = 'approved'
         order by lc.version desc, lc.created_at desc limit 1) = 'fail';
  if jsonb_array_length(p_reviewed_against_summary->'failed_tests') < v_failed then
    raise exception 'REVIEW_INCOMPLETE: de samenvatting noemt niet alle mislukte tests' using errcode = 'P0001';
  end if;
  if d.rule_deviation_reason is not null and jsonb_array_length(p_reviewed_against_summary->'rule_deviations') = 0 then
    raise exception 'REVIEW_INCOMPLETE: de samenvatting noemt de afwijking van de beslisregel niet' using errcode = 'P0001';
  end if;
  update public.decisions
  set client_confirmed_by = auth.uid(), client_confirmed_at = now(), client_comment = left(nullif(btrim(p_comment), ''), 2000),
      reviewed_against_summary = p_reviewed_against_summary || jsonb_build_object('reviewed_at', now())
  where id = p_decision;
  return true;
end $$;

revoke execute on function public.confirm_decision(uuid, text, jsonb) from public, anon;
grant execute on function public.confirm_decision(uuid, text, jsonb) to authenticated;

-- De samenvatting hoort bij de bevestiging: bij een nieuw besluit is ze leeg, en daarna verandert ze niet meer.
create or replace function public.guard_decision_summary()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    new.reviewed_against_summary := null;
  elsif old.reviewed_against_summary is not null and new.reviewed_against_summary is distinct from old.reviewed_against_summary then
    raise exception 'DECISION_LOCKED: de bevestigde samenvatting verandert niet meer' using errcode = 'P0001';
  end if;
  return new;
end $$;
drop trigger if exists decisions_summary_guard on public.decisions;
create trigger decisions_summary_guard before insert or update on public.decisions
  for each row execute function public.guard_decision_summary();
revoke execute on function public.guard_decision_summary() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 20. Verlengde testfase
-- ---------------------------------------------------------------------------
-- Gedragsbewijs past niet altijd in de sprint. Na de sprint kan het team één keer een verlengde testfase van 2 tot 8
-- weken nemen, met het tussenbesluit "extend" (doorgaan met testen). Zolang die loopt, kan er geen definitief besluit
-- (doorgaan, stoppen, pauzeren) worden genomen en start de uitkomstklok niet. Daarna gaat alles zoals gewoonlijk.

alter table public.decisions drop constraint if exists decisions_action_check;
alter table public.decisions add constraint decisions_action_check
  check (action in ('continue', 'adjust', 'test_more', 'extend', 'pause', 'stop'));
alter table public.decisions add column if not exists extend_weeks int check (extend_weeks between 2 and 8);
alter table public.decisions drop constraint if exists decisions_extend_weeks;
alter table public.decisions add constraint decisions_extend_weeks check ((action = 'extend') = (extend_weeks is not null));

-- Einddatum van de lopende verlengde testfase: het laatste extend-besluit zonder definitief besluit erna, plus het
-- aantal weken (kalenderdatum in Nederland). Null als er geen verlengde fase loopt of liep.
create or replace function public.extended_phase_end(p_idea uuid)
returns date language sql stable security definer set search_path = '' as $$
  select (d.decided_at at time zone 'Europe/Amsterdam')::date + d.extend_weeks * 7
  from public.decisions d
  where d.idea_id = p_idea and d.action = 'extend' and public.can_read_idea(p_idea)
    and not exists (select 1 from public.decisions f where f.idea_id = p_idea and f.action in ('continue', 'stop', 'pause') and f.decided_at > d.decided_at)
  order by d.decided_at desc, d.id desc limit 1;
$$;

create or replace function public.guard_decision_extend()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_end date;
  v_today date := (now() at time zone 'Europe/Amsterdam')::date;
begin
  if new.action = 'extend' then
    if exists (select 1 from public.decisions d where d.idea_id = new.idea_id and d.action = 'extend') then
      raise exception 'EXTEND_ONCE: een dossier krijgt één verlengde testfase' using errcode = 'P0001';
    end if;
    if exists (select 1 from public.ideas i where i.id = new.idea_id and i.outcome_clock_start is not null) then
      raise exception 'EXTEND_AFTER_FINAL: na een definitief besluit is er geen verlengde testfase meer' using errcode = 'P0001';
    end if;
  elsif new.action in ('continue', 'stop', 'pause') then
    select (d.decided_at at time zone 'Europe/Amsterdam')::date + d.extend_weeks * 7 into v_end
    from public.decisions d
    where d.idea_id = new.idea_id and d.action = 'extend'
      and not exists (select 1 from public.decisions f where f.idea_id = new.idea_id and f.action in ('continue', 'stop', 'pause') and f.decided_at > d.decided_at)
    order by d.decided_at desc limit 1;
    if v_end is not null and v_today < v_end then
      raise exception 'EXTEND_ACTIVE: de verlengde testfase loopt tot %; het definitieve besluit volgt daarna', v_end using errcode = 'P0001';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists decisions_extend_guard on public.decisions;
create trigger decisions_extend_guard before insert on public.decisions
  for each row execute function public.guard_decision_extend();

-- De uitkomstklok start niet tijdens de verlengde testfase (aanvulling op stamp_outcome_question, punt 1).
create or replace function public.guard_clock_extension()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_end date;
begin
  if old.outcome_clock_start is null and new.outcome_clock_start is not null then
    select (d.decided_at at time zone 'Europe/Amsterdam')::date + d.extend_weeks * 7 into v_end
    from public.decisions d
    where d.idea_id = new.id and d.action = 'extend'
      and not exists (select 1 from public.decisions f where f.idea_id = new.id and f.action in ('continue', 'stop', 'pause') and f.decided_at > d.decided_at)
    order by d.decided_at desc limit 1;
    if v_end is not null and new.outcome_clock_start < v_end then
      raise exception 'EXTEND_ACTIVE: de uitkomstklok start pas na de verlengde testfase (tot %)', v_end using errcode = 'P0001';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists ideas_clock_extension on public.ideas;
create trigger ideas_clock_extension before update of outcome_clock_start on public.ideas
  for each row execute function public.guard_clock_extension();

-- Een vastgelegd besluit verandert niet: nu ook het aantal weken van de verlengde fase.
create or replace function public.guard_decision()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'UPDATE' then
    if (new.action, new.rationale, new.next_step, new.decided_by, new.decided_at, new.reality_check_id, new.experiment_id,
        new.rule_met, new.rule_evaluation, new.rule_deviation_reason, new.extend_weeks)
       is distinct from
       (old.action, old.rationale, old.next_step, old.decided_by, old.decided_at, old.reality_check_id, old.experiment_id,
        old.rule_met, old.rule_evaluation, old.rule_deviation_reason, old.extend_weeks) then
      raise exception 'DECISION_LOCKED: een vastgelegd besluit kan niet worden gewijzigd' using errcode = 'P0001';
    end if;
  end if;
  return new;
end $$;

revoke execute on function public.guard_decision_extend(), public.guard_clock_extension() from public, anon, authenticated;
revoke execute on function public.extended_phase_end(uuid) from public, anon;
grant execute on function public.extended_phase_end(uuid) to authenticated;

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


-- ===== 20261107110000_golf_c =====
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

insert into supabase_migrations.schema_migrations (version, name) values
  ('20261106090000', 'research_search_log'),
  ('20261106090100', 'research_question_fields'),
  ('20261106100000', 'intake_coach'),
  ('20261106110000', 'method_v2'),
  ('20261107090000', 'golf_a'),
  ('20261107100000', 'golf_b'),
  ('20261107110000', 'golf_c')
on conflict (version) do nothing;
commit;
