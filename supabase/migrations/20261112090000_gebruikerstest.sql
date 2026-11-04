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
    status_reason = 'Gecontroleerde bronnen spreken dit tegen; geen bron bevestigt het. Klopt de richting van het citaat? Zo ja: zoek een bron die de bevinding bevestigt of herformuleer haar.'
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

-- ===========================================================================
-- B3. Twee nieuwe soorten aannames: kanaal en regelgeving/context (lib/domain/assumption-kind.ts)
-- ===========================================================================
-- Zonder deze migratie weigert de database de nieuwe soorten bij "Soort opslaan"; afgeleid uit de tekst werken ze wel.
alter table public.assumptions drop constraint if exists assumptions_kind_check;
alter table public.assumptions add constraint assumptions_kind_check
  check (kind is null or kind in ('market', 'price', 'behaviour', 'technical', 'channel', 'regulation'));
comment on column public.assumptions.kind is 'B0/B4/gebruikerstest B3: markt, prijs, gedrag, technisch, kanaal of regelgeving/context. Null = afgeleid uit de tekst.';

-- ===========================================================================
-- B4. Zelfgoedkeuring zichtbaar maken (lib/domain/experiment-gates.ts selfApproval)
-- ===========================================================================
-- submitted_by: wie de Test Card ter review aanbood. self_approved: de goedkeurder is de eigenaar of de indiener.
-- Beide worden alleen door de trigger gezet, nooit door de app. Geen vier-ogenregel (volgt in fase 3). Zonder deze
-- migratie ontbreken de kolommen: de app kijkt dan alleen naar de eigenaar en het rapport vermeldt niets.
alter table public.experiments add column if not exists submitted_by uuid references auth.users(id);
alter table public.experiments add column if not exists self_approved boolean;
comment on column public.experiments.submitted_by is 'Gebruikerstest B4: wie de Test Card ter review aanbood (gezet door guard_experiment).';
comment on column public.experiments.self_approved is 'Gebruikerstest B4: goedgekeurd door de eigenaar of de indiener (gezet door guard_experiment).';

-- Laatste definitie uit 20261103120000_surveys.sql, ongewijzigd overgenomen; alleen de regels met "B4" zijn nieuw.
create or replace function public.guard_experiment()
returns trigger language plpgsql set search_path = '' as $$
declare
  allowed boolean;
  h public.hypotheses;
begin
  if tg_op = 'INSERT' then
    if new.state <> 'draft' then
      raise exception 'EXPERIMENT_STATE: nieuwe experimenten starten als concept' using errcode = 'P0001';
    end if;
    new.approved_by := null; new.approved_at := null; new.started_at := null;
    new.ends_at := null; new.ended_at := null; new.ended_early := false; new.public_slug := null;
    new.submitted_by := null; new.self_approved := null; -- B4
    return new;
  end if;

  new.idea_id := old.idea_id;
  new.approved_by := old.approved_by; new.approved_at := old.approved_at;
  new.started_at := old.started_at; new.ends_at := old.ends_at; new.ended_at := old.ended_at;
  new.ended_early := old.ended_early; new.public_slug := old.public_slug;
  new.owner_id := old.owner_id; -- B4: de eigenaar verandert niet bij een update
  new.submitted_by := old.submitted_by; new.self_approved := old.self_approved; -- B4

  if new.state is distinct from old.state then
    allowed := (old.state, new.state) in (
      ('draft', 'ready_for_review'), ('ready_for_review', 'draft'), ('ready_for_review', 'approved'),
      ('approved', 'live'), ('live', 'paused'), ('paused', 'live'), ('live', 'ended'), ('paused', 'ended'),
      ('ended', 'analyzed'), ('analyzed', 'decided'), ('approved', 'draft')
    );
    if not allowed then
      raise exception 'EXPERIMENT_STATE: overgang % naar % is niet toegestaan', old.state, new.state
        using errcode = 'P0001';
    end if;

    if new.state = 'ready_for_review' then
      new.submitted_by := auth.uid(); -- B4
    end if;

    if new.state = 'approved' then
      select * into h from public.hypotheses where id = new.hypothesis_id;
      if h.superseded_by is not null then
        raise exception 'EXPERIMENT_STATE: hypothese is vervangen door een nieuwere versie' using errcode = 'P0001';
      end if;
      update public.hypotheses set locked_at = coalesce(locked_at, now()) where id = new.hypothesis_id;
      new.approved_by := auth.uid();
      new.approved_at := now();
      new.self_approved := coalesce(new.approved_by = new.owner_id or new.approved_by = new.submitted_by, false); -- B4
      if new.type in ('landing', 'pricing', 'survey') and new.public_slug is null then
        new.public_slug := lower(substr(replace(gen_random_uuid()::text, '-', ''), 1, 14));
      end if;
    end if;

    if new.state = 'draft' and old.state = 'approved' then
      new.approved_by := null;
      new.approved_at := null;
      new.self_approved := null; -- B4
    end if;

    if new.state = 'live' and old.state = 'approved' then
      select * into h from public.hypotheses where id = new.hypothesis_id;
      new.started_at := now();
      new.ends_at := now() + make_interval(days => h.max_duration_days);
    end if;

    if new.state = 'ended' then
      new.ended_at := now();
      new.ended_early := new.ends_at is not null and now() < new.ends_at;
    end if;
  end if;

  if old.state not in ('draft', 'ready_for_review') and (
       new.config is distinct from old.config or new.hypothesis_id is distinct from old.hypothesis_id
       or new.type is distinct from old.type or new.channels is distinct from old.channels) then
    raise exception 'EXPERIMENT_LOCKED: een goedgekeurd experiment kan niet meer worden gewijzigd'
      using errcode = 'P0001';
  end if;
  return new;
end $$;
revoke execute on function public.guard_experiment() from public, anon, authenticated;
