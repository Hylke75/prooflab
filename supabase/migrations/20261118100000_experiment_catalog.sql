-- Experimentencatalogus en begeleide handmatige sjablonen (IMPLEMENTATION_STATUS.md, sectie "Experimentencatalogus").
--
-- Wat:
-- 1. Experimenttype 'manual': een methode uit de catalogus (lib/domain/experiment-catalog.ts) zonder ingebouwde
--    automatisering. De configuratie noemt de catalogusmethode (config.catalog_method_id) en de soort waarneming
--    (config.observation_kind). Die soort is hooguit een kleine handeling op de bewijsladder: handmatig ingevoerde
--    resultaten tellen nooit als prijskeuze, betaling of herhaalaankoop (zelfde lijst als lib/domain/manual-kind.ts).
--    De configuratie ligt na goedkeuring vast via de bestaande guard_experiment (ongewijzigd).
-- 2. manual_results: de ruwe resultaten van een handmatige test. Per regel een datum, een aantal (eenheden), hoeveel
--    daarvan aan de vooraf vastgelegde teller voldoen, een notitie zonder namen en eventueel een bewijsbestand.
--    Alleen toevoegen terwijl de test loopt (live of gepauzeerd), met een waarnemingsdatum tussen de start en vandaag.
--    Een regel wordt nooit gewijzigd of verwijderd; intrekken kan alleen terwijl de test loopt, met een reden. Na het
--    afronden ligt alles vast: zo kan niemand na het zien van de uitkomst nog resultaten bijschuiven.
-- 3. Privé bucket manual-evidence voor bewijsbestanden (alleen het onderzoeksteam).
--
-- Idempotent: twee keer uitvoeren verandert niets. Zonder deze migratie werkt de app zoals voorheen; de catalogus is
-- te bekijken en ingebouwde methodes werken, alleen een handmatig sjabloon kan dan niet worden opgeslagen (melding).
-- Bestaande functies worden niet gewijzigd.

begin;

-- ---------------------------------------------------------------------------
-- 1. Experimenttype 'manual'
-- ---------------------------------------------------------------------------

alter table public.experiments drop constraint if exists experiments_type_check;
alter table public.experiments add constraint experiments_type_check
  check (type in ('landing', 'interview', 'pricing', 'survey', 'manual'));

alter table public.experiments drop constraint if exists experiments_manual_catalog;
-- coalesce: een ontbrekende sleutel geeft null, en een check met null zou stil slagen.
alter table public.experiments add constraint experiments_manual_catalog check (
  type <> 'manual' or coalesce(
    jsonb_typeof(config -> 'catalog_method_id') = 'string'
    and (config ->> 'catalog_method_id') ~ '^[a-z0-9-]{2,60}$'
    and (config ->> 'observation_kind') in ('opinion', 'problem_confirmed', 'current_behaviour', 'current_spend', 'waitlist_signup', 'demo_request'),
    false));
comment on constraint experiments_manual_catalog on public.experiments is
  'Experimentencatalogus: een handmatige test noemt zijn catalogusmethode en een soort waarneming van hooguit een kleine handeling.';

-- ---------------------------------------------------------------------------
-- 2. manual_results
-- ---------------------------------------------------------------------------

-- Pad van een bewijsbestand: <idee>/<experiment>/<uuid>-<bestandsnaam>. Geeft het idee, of null bij een ongeldig pad.
create or replace function public.manual_evidence_idea(p_name text)
returns uuid language sql immutable set search_path = '' as $$
  select case
    when p_name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-[A-Za-z0-9._-]{1,120}$'
         and position('..' in p_name) = 0
    then split_part(p_name, '/', 1)::uuid
    else null
  end;
$$;

create table if not exists public.manual_results (
  id uuid primary key default gen_random_uuid(),
  experiment_id uuid not null references public.experiments(id) on delete cascade,
  idea_id uuid not null references public.ideas(id) on delete cascade,
  observed_on date not null,
  units int not null check (units between 1 and 100000),
  successes int not null check (successes >= 0),
  note text not null check (char_length(btrim(note)) between 3 and 1000),
  evidence_path text unique check (evidence_path is null or public.manual_evidence_idea(evidence_path) is not null),
  evidence_mime text check (evidence_mime is null or evidence_mime in ('application/pdf', 'image/png', 'image/jpeg', 'image/webp', 'text/csv')),
  evidence_size bigint check (evidence_size is null or evidence_size between 1 and 10485760),
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  withdrawn_at timestamptz,
  withdrawn_by uuid references auth.users(id) on delete set null,
  withdraw_reason text check (withdraw_reason is null or char_length(btrim(withdraw_reason)) between 10 and 600),
  constraint manual_results_successes check (successes <= units),
  constraint manual_results_withdrawn check ((withdrawn_at is null) = (withdraw_reason is null)),
  constraint manual_results_evidence check ((evidence_path is null) = (evidence_mime is null))
);
create index if not exists manual_results_experiment_idx on public.manual_results(experiment_id, observed_on);
create index if not exists manual_results_idea_idx on public.manual_results(idea_id);
create index if not exists manual_results_created_by_fk on public.manual_results(created_by);
create index if not exists manual_results_withdrawn_by_fk on public.manual_results(withdrawn_by);
comment on table public.manual_results is
  'Experimentencatalogus: ruwe, handmatig ingevoerde resultaten van een handmatig sjabloon (type manual). Alleen toevoegen of intrekken terwijl de test loopt.';

-- Wie, wanneer en wat mag. Toevoegen: alleen bij een lopende handmatige test, met een waarnemingsdatum tussen de start
-- en vandaag, en een bewijsbestand dat al in de bucket staat onder dit idee en deze test. Wijzigen: alleen intrekken
-- (met reden) terwijl de test loopt. Onderhoud zonder gebruiker (auth.uid() is null) mag alles.
create or replace function public.guard_manual_result()
returns trigger language plpgsql security definer set search_path = '' as $$
declare e public.experiments;
begin
  if tg_op = 'INSERT' then
    select * into e from public.experiments where id = new.experiment_id;
    if e.id is null or e.type <> 'manual' then
      raise exception 'MANUAL_RESULT_TYPE: handmatige resultaten horen bij een handmatig sjabloon' using errcode = 'P0001';
    end if;
    if e.state not in ('live', 'paused') then
      raise exception 'MANUAL_RESULT_CLOSED: resultaten voer je in terwijl de test loopt' using errcode = 'P0001';
    end if;
    if new.observed_on > current_date or (e.started_at is not null and new.observed_on < (e.started_at at time zone 'Europe/Amsterdam')::date) then
      raise exception 'MANUAL_RESULT_DATE: de waarneming ligt tussen de start van de test en vandaag' using errcode = 'P0001';
    end if;
    if new.evidence_path is not null and (
         public.manual_evidence_idea(new.evidence_path) is distinct from new.idea_id
         or split_part(new.evidence_path, '/', 2) <> new.experiment_id::text
         or not exists (select 1 from storage.objects o where o.bucket_id = 'manual-evidence' and o.name = new.evidence_path)) then
      raise exception 'MANUAL_RESULT_EVIDENCE: het bewijsbestand hoort bij deze test en moet eerst zijn geüpload' using errcode = 'P0001';
    end if;
    new.created_by := auth.uid();
    new.created_at := now();
    new.withdrawn_at := null;
    new.withdrawn_by := null;
    new.withdraw_reason := null;
    return new;
  end if;
  if auth.uid() is null then
    return new;
  end if;
  if old.withdrawn_at is null and new.withdraw_reason is not null
     and (to_jsonb(new) - 'withdrawn_at' - 'withdrawn_by' - 'withdraw_reason') is not distinct from (to_jsonb(old) - 'withdrawn_at' - 'withdrawn_by' - 'withdraw_reason') then
    select * into e from public.experiments where id = old.experiment_id;
    if e.state not in ('live', 'paused') then
      raise exception 'MANUAL_RESULT_LOCKED: na het afronden ligt elk resultaat vast' using errcode = 'P0001';
    end if;
    new.withdrawn_at := now();
    new.withdrawn_by := auth.uid();
    return new;
  end if;
  raise exception 'MANUAL_RESULT_LOCKED: een ingevoerd resultaat ligt vast; alleen intrekken met een reden is mogelijk' using errcode = 'P0001';
end $$;
drop trigger if exists manual_results_guard on public.manual_results;
create trigger manual_results_guard before insert or update on public.manual_results
  for each row execute function public.guard_manual_result();
drop trigger if exists manual_results_refs on public.manual_results;
create trigger manual_results_refs before insert or update on public.manual_results
  for each row execute function public.check_idea_refs('experiment_id', 'experiments');
drop trigger if exists manual_results_audit on public.manual_results;
create trigger manual_results_audit after insert or update or delete on public.manual_results
  for each row execute function public.audit_row();

alter table public.manual_results enable row level security;
-- Aantallen en notities (zonder namen) zijn ruwe meetdata: iedereen die het dossier mag lezen ziet ze, zodat een
-- rapport herleidbaar blijft. Toevoegen en intrekken: alleen het onderzoeksteam. Verwijderen: niemand.
drop policy if exists manual_results_select on public.manual_results;
create policy manual_results_select on public.manual_results for select to authenticated using (public.can_read_idea(idea_id));
drop policy if exists manual_results_insert on public.manual_results;
create policy manual_results_insert on public.manual_results for insert to authenticated with check (public.can_write_idea(idea_id));
drop policy if exists manual_results_update on public.manual_results;
create policy manual_results_update on public.manual_results for update to authenticated
  using (public.can_write_idea(idea_id)) with check (public.can_write_idea(idea_id));
revoke all on public.manual_results from public, anon, authenticated;
grant select, insert, update on public.manual_results to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Privé bucket voor bewijsbestanden: alleen het onderzoeksteam leest, uploadt en verwijdert (een bestand dat bij
--    een resultaat hoort, kan niet worden verwijderd).
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('manual-evidence', 'manual-evidence', false, 10485760, array['application/pdf', 'image/png', 'image/jpeg', 'image/webp', 'text/csv'])
on conflict (id) do nothing;
drop policy if exists manual_evidence_objects_select on storage.objects;
create policy manual_evidence_objects_select on storage.objects for select to authenticated
  using (bucket_id = 'manual-evidence' and public.can_write_idea(public.manual_evidence_idea(name)));
drop policy if exists manual_evidence_objects_insert on storage.objects;
create policy manual_evidence_objects_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'manual-evidence' and public.can_write_idea(public.manual_evidence_idea(name)));
drop policy if exists manual_evidence_objects_delete on storage.objects;
create policy manual_evidence_objects_delete on storage.objects for delete to authenticated
  using (bucket_id = 'manual-evidence' and public.can_write_idea(public.manual_evidence_idea(name))
         and not exists (select 1 from public.manual_results r where r.evidence_path = name));

-- ---------------------------------------------------------------------------
-- Rechten op functies
-- ---------------------------------------------------------------------------

revoke execute on function public.guard_manual_result() from public, anon, authenticated;

commit;
