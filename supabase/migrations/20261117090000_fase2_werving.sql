-- Fase 2 · punt 5: werving bijhouden (IMPLEMENTATION_STATUS.md, sectie "Fase 2 · punt 5: Werving bijhouden").
--
-- Wat:
-- 1. recruitment_entries: handmatige wervingsregels per test (datum, kanaal, stap, aantal, notitie) voor de trechter
--    benaderd → gereageerd → afspraak → gesprek gehouden. Alleen toevoegen: een regel wordt nooit gewijzigd of
--    verwijderd. Een correctie is een nieuwe regel (negatief aantal, met reden; eventueel als tegenboeking van een
--    eerdere regel). Het netto aantal per test, kanaal en stap kan niet onder nul komen. "Gesprek gehouden" wordt
--    nooit handmatig geteld: dat zijn de interviews (of de gemeten deelnemers) van de test zelf.
-- 2. recruitment_campaigns: koppeling van een Expandi-campagne (outreach_events.campaign) aan één test. Daaruit telt
--    ProofLab automatisch benaderd en gereageerd (unieke gepseudonimiseerde contacten). Eén campagne hoort bij één
--    test, zodat dezelfde contacten nooit in twee tests meetellen.
-- 3. Nieuw brontype 'recruitment_log' ("Eigen wervingsregistratie") voor de bevinding "Kanaal X levert Y% respons".
--    Het is een eigen meting: nooit primair, nooit een officiële statistiek of primaire bron (database-guards op
--    claim_sources en claims), en het brontype van een bestaande bron kan niet naar of van dit type worden gewijzigd.
--
-- Waarom: zonder trechter ziet een consultant pas op de deadline dat er te weinig gesprekken zijn. Met de trechter
-- en de respons per kanaal (Wilson-interval) is vooraf te zien welk kanaal werkt en of de steekproef haalbaar is.
--
-- Terugval: zonder deze migratie werkt de app zoals voorheen. De testpagina meldt dat de wervingsregistratie nog
-- niet beschikbaar is (de tabellen ontbreken), de trechter toont dan alleen automatische getallen (interviews,
-- metingen) en "Leg vast als bevinding" meldt dat de database eerst moet worden bijgewerkt.
--
-- Idempotent: opnieuw uitvoeren verandert niets. Geen bestaande functie wordt vervangen.

begin;

-- ---------------------------------------------------------------------------
-- 1. Handmatige wervingsregels
-- ---------------------------------------------------------------------------

create table if not exists public.recruitment_entries (
  id uuid primary key default gen_random_uuid(),
  idea_id uuid not null references public.ideas(id) on delete cascade,
  experiment_id uuid not null references public.experiments(id) on delete cascade,
  entry_date date not null,
  channel text not null check (channel in
    ('network', 'linkedin', 'linkedin_ads', 'meta', 'meta_ads', 'x', 'google_ads', 'outreach', 'email', 'newsletter', 'other', 'direct')),
  step text not null check (step in ('approached', 'responded', 'appointment')),
  quantity integer not null check (quantity <> 0 and quantity between -10000 and 10000),
  note text check (char_length(note) <= 500),
  corrects_id uuid references public.recruitment_entries(id) on delete set null,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists recruitment_entries_experiment_idx on public.recruitment_entries(experiment_id, channel, step);
create index if not exists recruitment_entries_idea_idx on public.recruitment_entries(idea_id);
create index if not exists recruitment_entries_corrects_fk on public.recruitment_entries(corrects_id);
create index if not exists recruitment_entries_created_by_fk on public.recruitment_entries(created_by);

comment on table public.recruitment_entries is
  'Handmatige wervingsregels per test (alleen toevoegen). Correctie = nieuwe regel met negatief aantal en reden. Gesprek gehouden komt altijd uit de interviews of metingen van de test.';

drop trigger if exists recruitment_entries_refs on public.recruitment_entries;
create trigger recruitment_entries_refs before insert or update on public.recruitment_entries
  for each row execute function public.check_idea_refs('experiment_id', 'experiments', 'corrects_id', 'recruitment_entries');

create or replace function public.guard_recruitment_entry()
returns trigger language plpgsql set search_path = '' as $$
declare
  e public.experiments;
  c public.recruitment_entries;
  v_net bigint;
begin
  if tg_op = 'DELETE' then
    -- Alleen het verwijderen van het dossier of de test zelf (cascade) haalt regels weg.
    if not exists (select 1 from public.ideas i where i.id = old.idea_id)
       or not exists (select 1 from public.experiments x where x.id = old.experiment_id) then
      return old;
    end if;
    raise exception 'RECRUITMENT_APPEND_ONLY: een wervingsregel wordt niet verwijderd; leg een correctie vast' using errcode = 'P0001';
  end if;
  if tg_op = 'UPDATE' then
    -- on delete set null van corrects_id (bij een cascade) mag; verder verandert een regel nooit.
    if (to_jsonb(new) - 'corrects_id') = (to_jsonb(old) - 'corrects_id') and new.corrects_id is null then
      return new;
    end if;
    raise exception 'RECRUITMENT_APPEND_ONLY: een wervingsregel wordt niet gewijzigd; leg een correctie vast' using errcode = 'P0001';
  end if;

  new.created_by := auth.uid();
  new.created_at := now();
  select * into e from public.experiments x where x.id = new.experiment_id;
  if e.id is null then
    raise exception 'RECRUITMENT_TEST: test niet gevonden' using errcode = 'P0001';
  end if;
  if e.state in ('draft', 'ready_for_review') then
    raise exception 'RECRUITMENT_STATE: werving bijhouden kan vanaf een goedgekeurde test' using errcode = 'P0001';
  end if;
  if new.step = 'appointment' and e.type <> 'interview' then
    raise exception 'RECRUITMENT_STEP: afspraken horen bij een interviewtest' using errcode = 'P0001';
  end if;
  if new.entry_date > current_date + 1 or new.entry_date < date '2020-01-01' then
    raise exception 'RECRUITMENT_DATE: de datum ligt in de toekomst of is ongeldig' using errcode = 'P0001';
  end if;
  if new.quantity < 0 and char_length(btrim(coalesce(new.note, ''))) < 5 then
    raise exception 'RECRUITMENT_REASON: een correctie heeft een reden nodig' using errcode = 'P0001';
  end if;
  if new.corrects_id is not null then
    select * into c from public.recruitment_entries r where r.id = new.corrects_id;
    if c.id is null or c.experiment_id <> new.experiment_id or c.channel <> new.channel or c.step <> new.step then
      raise exception 'RECRUITMENT_CORRECTION: een tegenboeking hoort bij dezelfde test, hetzelfde kanaal en dezelfde stap' using errcode = 'P0001';
    end if;
  end if;
  -- Netto kan een stap per kanaal niet onder nul komen (gelijktijdige correcties wachten op elkaar).
  perform pg_advisory_xact_lock(hashtext('recruitment:' || new.experiment_id::text || ':' || new.channel || ':' || new.step));
  select coalesce(sum(r.quantity), 0) into v_net
  from public.recruitment_entries r
  where r.experiment_id = new.experiment_id and r.channel = new.channel and r.step = new.step;
  if v_net + new.quantity < 0 then
    raise exception 'RECRUITMENT_NEGATIVE: na deze correctie zou het aantal onder nul komen' using errcode = 'P0001';
  end if;
  return new;
end $$;
drop trigger if exists recruitment_entries_guard on public.recruitment_entries;
create trigger recruitment_entries_guard before insert or update or delete on public.recruitment_entries
  for each row execute function public.guard_recruitment_entry();

alter table public.recruitment_entries enable row level security;
drop policy if exists recruitment_entries_select on public.recruitment_entries;
drop policy if exists recruitment_entries_insert on public.recruitment_entries;
-- Notities kunnen over personen gaan: alleen het onderzoeksteam leest de regels. Geen update- of delete-beleid.
create policy recruitment_entries_select on public.recruitment_entries for select to authenticated using (public.can_write_idea(idea_id));
create policy recruitment_entries_insert on public.recruitment_entries for insert to authenticated with check (public.can_write_idea(idea_id));

revoke all on public.recruitment_entries from public, anon, authenticated;
grant select, insert on public.recruitment_entries to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Expandi-campagne ↔ test
-- ---------------------------------------------------------------------------

create table if not exists public.recruitment_campaigns (
  id uuid primary key default gen_random_uuid(),
  idea_id uuid not null references public.ideas(id) on delete cascade,
  experiment_id uuid not null references public.experiments(id) on delete cascade,
  campaign text not null check (char_length(btrim(campaign)) between 1 and 200),
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
-- Eén campagne telt in één test van het dossier: dezelfde contacten tellen nooit dubbel.
create unique index if not exists recruitment_campaigns_uniq on public.recruitment_campaigns(idea_id, campaign);
create index if not exists recruitment_campaigns_experiment_idx on public.recruitment_campaigns(experiment_id);
create index if not exists recruitment_campaigns_created_by_fk on public.recruitment_campaigns(created_by);

comment on table public.recruitment_campaigns is
  'Koppelt een Expandi-campagne (outreach_events.campaign) aan één test: benaderd en gereageerd tellen dan automatisch mee in de wervingstrechter.';

drop trigger if exists recruitment_campaigns_refs on public.recruitment_campaigns;
create trigger recruitment_campaigns_refs before insert or update on public.recruitment_campaigns
  for each row execute function public.check_idea_refs('experiment_id', 'experiments');

create or replace function public.guard_recruitment_campaign()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'UPDATE' then
    raise exception 'RECRUITMENT_CAMPAIGN_LOCKED: ontkoppel de campagne en koppel opnieuw' using errcode = 'P0001';
  end if;
  new.campaign := btrim(new.campaign);
  new.created_by := auth.uid();
  new.created_at := now();
  return new;
end $$;
drop trigger if exists recruitment_campaigns_guard on public.recruitment_campaigns;
create trigger recruitment_campaigns_guard before insert or update on public.recruitment_campaigns
  for each row execute function public.guard_recruitment_campaign();

alter table public.recruitment_campaigns enable row level security;
drop policy if exists recruitment_campaigns_select on public.recruitment_campaigns;
drop policy if exists recruitment_campaigns_insert on public.recruitment_campaigns;
drop policy if exists recruitment_campaigns_delete on public.recruitment_campaigns;
-- Zoals outreach_events: alleen het onderzoeksteam.
create policy recruitment_campaigns_select on public.recruitment_campaigns for select to authenticated using (public.can_write_idea(idea_id));
create policy recruitment_campaigns_insert on public.recruitment_campaigns for insert to authenticated with check (public.can_write_idea(idea_id));
create policy recruitment_campaigns_delete on public.recruitment_campaigns for delete to authenticated using (public.can_write_idea(idea_id));

revoke all on public.recruitment_campaigns from public, anon, authenticated;
grant select, insert, delete on public.recruitment_campaigns to authenticated;

do $$
declare t text;
begin
  foreach t in array array['recruitment_entries', 'recruitment_campaigns'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_audit', t);
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function public.audit_row()', t || '_audit', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 3. Brontype "Eigen wervingsregistratie"
-- ---------------------------------------------------------------------------

alter table public.sources drop constraint if exists sources_source_type_check;
alter table public.sources add constraint sources_source_type_check check (source_type in
  ('official_statistic', 'primary_document', 'company_page', 'research_report', 'news', 'review_site', 'blog',
   'forum', 'outreach', 'survey', 'dataset_upload', 'interview', 'recruitment_log', 'other'));

-- Een eigen registratie is nooit een primaire bron.
alter table public.sources drop constraint if exists sources_recruitment_log_not_primary;
alter table public.sources add constraint sources_recruitment_log_not_primary
  check (source_type <> 'recruitment_log' or not is_primary);

-- Een bestaande bron wordt geen eigen registratie (of omgekeerd): het brontype bepaalt hoe zwaar een bevinding telt.
create or replace function public.guard_recruitment_log_source()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.source_type is distinct from old.source_type and 'recruitment_log' in (new.source_type, old.source_type) then
    raise exception 'RECRUITMENT_LOG_TYPE: het brontype eigen wervingsregistratie ligt vast' using errcode = 'P0001';
  end if;
  return new;
end $$;
drop trigger if exists sources_recruitment_log_guard on public.sources;
create trigger sources_recruitment_log_guard before update of source_type on public.sources
  for each row execute function public.guard_recruitment_log_source();

-- Een bevinding uit een eigen registratie is nooit een officiële statistiek of primaire bron.
create or replace function public.guard_recruitment_log_claim_source()
returns trigger language plpgsql set search_path = '' as $$
begin
  if exists (select 1 from public.sources s where s.id = new.source_id and s.source_type = 'recruitment_log')
     and exists (select 1 from public.claims c where c.id = new.claim_id and c.evidence_type in ('official_statistic', 'primary_document')) then
    raise exception 'RECRUITMENT_LOG_EVIDENCE: een eigen wervingsregistratie is geen officiële statistiek of primaire bron' using errcode = 'P0001';
  end if;
  return new;
end $$;
drop trigger if exists claim_sources_recruitment_log_guard on public.claim_sources;
create trigger claim_sources_recruitment_log_guard before insert or update on public.claim_sources
  for each row execute function public.guard_recruitment_log_claim_source();

create or replace function public.guard_recruitment_log_claim()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.evidence_type in ('official_statistic', 'primary_document')
     and exists (select 1 from public.claim_sources cs join public.sources s on s.id = cs.source_id
                 where cs.claim_id = new.id and s.source_type = 'recruitment_log') then
    raise exception 'RECRUITMENT_LOG_EVIDENCE: een eigen wervingsregistratie is geen officiële statistiek of primaire bron' using errcode = 'P0001';
  end if;
  return new;
end $$;
drop trigger if exists claims_recruitment_log_guard on public.claims;
create trigger claims_recruitment_log_guard before update of evidence_type on public.claims
  for each row execute function public.guard_recruitment_log_claim();

revoke execute on function public.guard_recruitment_entry(), public.guard_recruitment_campaign(),
  public.guard_recruitment_log_source(), public.guard_recruitment_log_claim_source(), public.guard_recruitment_log_claim()
  from public, anon, authenticated;

commit;
