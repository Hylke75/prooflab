-- Golf A: bewijs en testen (docs/VERBETERPLAN_WERKWIJZE.md, docs/ProofLab_Voorspelkracht_v1.md hoofdstuk 10).
--
--   0. Methodeversie 2026-11-c naast 2026-11-a en 2026-11-b; nieuwe dossiers starten op 2026-11-c. Overstappen
--      kan alleen vooruit (a → b → c, of a → c) en met audit.
--   3. Aantal opgeloste dossiers per werkruimte, voor de weergave "niet gekalibreerd".
--   4/13. Wervingsgroep per test, interview en observatie (vergrendeld na goedkeuring; een bekende is eigen
--      netwerk) en evidence_recruitment_refs voor de afnemende factor van methode 2026-11-c.
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
