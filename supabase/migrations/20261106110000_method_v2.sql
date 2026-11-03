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
