-- ProofLab: migraties van 6 november in één keer, voor de SQL Editor van Supabase.
-- Plak dit hele bestand in Supabase → SQL Editor en klik op Run. Alles gebeurt in één transactie:
-- gaat er iets mis, dan verandert er niets.
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

insert into supabase_migrations.schema_migrations (version, name) values
  ('20261106090000', 'research_search_log'), ('20261106090100', 'research_question_fields'),
  ('20261106100000', 'intake_coach'), ('20261106110000', 'method_v2')
on conflict (version) do nothing;
commit;
