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
