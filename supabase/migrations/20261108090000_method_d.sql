-- Methode 2026-11-d: tegenbewijs telt per bron één keer (lib/domain/method/2026-11-d.ts,
-- docs/ProofLab_Voorspelkracht_v1.md hoofdstuk 13). Akkoord product owner: 4 november 2026.
-- Wijzigt geen eerdere migratie en geen bestaande rijen: bestaande dossiers houden hun methodeversie, zodat
-- hun kansen en rapporten reproduceerbaar blijven. Alleen nieuwe dossiers starten op 2026-11-d; een bestaand
-- dossier stapt alleen over via switch_method_version (vooruit, met audit).

alter table public.ideas drop constraint if exists ideas_method_version_check;
alter table public.ideas add constraint ideas_method_version_check
  check (method_version in ('2026-11-a', '2026-11-b', '2026-11-c', '2026-11-d'));
alter table public.ideas alter column method_version set default '2026-11-d';

-- Volgorde van de versies; een onbekende versie heeft geen plek (null).
create or replace function public.method_version_rank(p_version text)
returns int language sql immutable set search_path = '' as $$
  select case p_version when '2026-11-a' then 1 when '2026-11-b' then 2 when '2026-11-c' then 3 when '2026-11-d' then 4 end;
$$;

-- Overstappen kan alleen vooruit, nooit terug: zo blijft elk rapport reproduceerbaar.
create or replace function public.guard_method_version()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.method_version is distinct from old.method_version
     and not coalesce(public.method_version_rank(new.method_version) > public.method_version_rank(old.method_version), false) then
    raise exception 'METHOD_VERSION: een dossier kan alleen overstappen naar een latere methodeversie (2026-11-a → 2026-11-b → 2026-11-c → 2026-11-d)'
      using errcode = 'P0001';
  end if;
  return new;
end $$;

-- Rechten zoals in golf A (create or replace behoudt ze; hier expliciet herhaald).
revoke execute on function public.method_version_rank(text) from public, anon;
grant execute on function public.method_version_rank(text) to authenticated;
revoke execute on function public.guard_method_version() from public, anon, authenticated;
