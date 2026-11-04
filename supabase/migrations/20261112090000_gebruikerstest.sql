-- Gebruikerstest: verbeterpunten A, B en C (IMPLEMENTATION_STATUS.md, sectie "Gebruikerstest: verbeterpunten A/B/C").
-- Eén migratie voor de hele ronde. Idempotent: opnieuw uitvoeren verandert niets. Raakt geen bestaande data, behalve de
-- herberekening van de bevindingstatus in deel A5 (tegenstrijdig zonder enige bevestigende bron → weerlegd).
-- Zolang deze migratie niet live staat, valt de app netjes terug (zie de opmerking per deel).

-- ===========================================================================
-- A5. Nieuwe bevindingstatus "refuted" (weerlegd)
-- ===========================================================================
-- Weerlegd = minstens één gecontroleerde tegensprekende bron en geen enkele bevestigende (lib/domain/verify.ts
-- computeClaimStatus). "contested" (tegenstrijdig) blijft voor minstens één bevestigende én één tegensprekende bron.
-- De oorspronkelijke check stond inline in core_schema (automatische naam); we zoeken de check op de kolom status zelf.
do $$
declare
  c record;
begin
  for c in
    select con.conname
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace n on n.oid = rel.relnamespace
    join pg_attribute att on att.attrelid = rel.oid and att.attname = 'status'
    where n.nspname = 'public' and rel.relname = 'claims' and con.contype = 'c' and con.conkey = array[att.attnum]
  loop
    execute format('alter table public.claims drop constraint %I', c.conname);
  end loop;
end $$;
alter table public.claims add constraint claims_status_check
  check (status in ('verified', 'estimate', 'insufficient', 'contested', 'refuted', 'outdated'));

-- Herberekening, met dezelfde regel als computeClaimStatus en claimStatusWithSupport (lib/domain/support.ts):
-- een bron telt als "gecontroleerd" bij een letterlijk gevonden citaat (quote_check = 'exact') dat de steuncontrole niet
-- afwees en dat niet van de live pagina verdween. Een tegenstrijdige bevinding zonder één zo'n bevestigende bron, maar met
-- minstens één zo'n tegensprekende bron, is weerlegd. Alleen status en reden veranderen; de bronnen zelf niet.
update public.claims c
set status = 'refuted',
    status_reason = 'Gecontroleerde bronnen spreken dit tegen; geen bron ondersteunt het (herberekend bij de invoering van "weerlegd").'
where c.status = 'contested'
  and not exists (
    select 1 from public.claim_sources cs
    where cs.claim_id = c.id and cs.stance = 'supports' and cs.quote_check = 'exact'
      and cs.support_check is distinct from 'not_supported' and cs.live_found is distinct from false
  )
  and exists (
    select 1 from public.claim_sources cs
    where cs.claim_id = c.id and cs.stance = 'contradicts' and cs.quote_check = 'exact'
      and cs.support_check is distinct from 'not_supported' and cs.live_found is distinct from false
  );

-- ===========================================================================
-- A5. Methode 2026-11-e (lib/domain/method/2026-11-e.ts)
-- ===========================================================================
-- Een weerlegde bevinding waarop een aanname leunt, telt als tegenbewijs. Bestaande dossiers houden hun versie (hun
-- kansen en rapporten blijven reproduceerbaar); alleen nieuwe dossiers starten op 2026-11-e. Overstappen kan alleen
-- vooruit via switch_method_version (met audit). Zonder deze migratie weigert de database 2026-11-e; de app toont dan
-- de overstap-fout en rekent elk dossier met zijn opgeslagen versie.
alter table public.ideas drop constraint if exists ideas_method_version_check;
alter table public.ideas add constraint ideas_method_version_check
  check (method_version in ('2026-11-a', '2026-11-b', '2026-11-c', '2026-11-d', '2026-11-e'));
alter table public.ideas alter column method_version set default '2026-11-e';

create or replace function public.method_version_rank(p_version text)
returns int language sql immutable set search_path = '' as $$
  select case p_version when '2026-11-a' then 1 when '2026-11-b' then 2 when '2026-11-c' then 3 when '2026-11-d' then 4 when '2026-11-e' then 5 end;
$$;

create or replace function public.guard_method_version()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.method_version is distinct from old.method_version
     and not coalesce(public.method_version_rank(new.method_version) > public.method_version_rank(old.method_version), false) then
    raise exception 'METHOD_VERSION: een dossier kan alleen overstappen naar een latere methodeversie (2026-11-a → 2026-11-b → 2026-11-c → 2026-11-d → 2026-11-e)'
      using errcode = 'P0001';
  end if;
  return new;
end $$;

revoke execute on function public.method_version_rank(text) from public, anon;
grant execute on function public.method_version_rank(text) to authenticated;
revoke execute on function public.guard_method_version() from public, anon, authenticated;
