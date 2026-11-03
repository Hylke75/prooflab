-- Golf A: bewijs en testen (docs/VERBETERPLAN_WERKWIJZE.md, docs/ProofLab_Voorspelkracht_v1.md hoofdstuk 10).
--
--   0. Methodeversie 2026-11-c naast 2026-11-a en 2026-11-b; nieuwe dossiers starten op 2026-11-c. Overstappen
--      kan alleen vooruit (a → b → c, of a → c) en met audit.
--   3. Aantal opgeloste dossiers per werkruimte, voor de weergave "niet gekalibreerd".
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
