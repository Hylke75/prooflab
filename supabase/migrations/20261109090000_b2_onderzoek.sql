-- Fase B2: onderzoek dat de grootste onzekerheid eerst raakt, binnen een hard kostenplafond, op de server.
-- Alles is idempotent (if not exists / or replace) en raakt geen bestaande gegevens: er worden alleen kolommen,
-- indexen, functies en een tabel toegevoegd. De app werkt ook zolang deze migratie nog niet live staat; ze valt
-- dan terug op het oude gedrag (eerste vraag als beslissende vraag, geen lease, geen opgeslagen selectie).

-- ---------------------------------------------------------------------------
-- Punt 1. De beslissende vraag
-- ---------------------------------------------------------------------------
-- Hooguit één vraag per idee is de beslissende vraag: de vraag die de grootste onzekerheid uit de intake raakt.
-- Een onderzoeksrun begint altijd met die vraag; de dossierstatus (lib/domain/dossier-status.ts) leest hem.

alter table public.research_questions add column if not exists is_decisive boolean not null default false;
create unique index if not exists research_questions_one_decisive on public.research_questions(idea_id) where is_decisive;

-- ---------------------------------------------------------------------------
-- Punt 4. De run draait op de server: één werker per run tegelijk
-- ---------------------------------------------------------------------------
-- Een portie (/api/research/[runId]/advance, na de response) neemt een lease op de run, werkt stappen af, geeft de
-- lease vrij en roept de volgende portie aan. De lease voorkomt dat twee porties (bijv. een open tabblad en de
-- serverketen) tegelijk aan dezelfde run werken. Security invoker: alleen wie het dossier mag bewerken (RLS van
-- research_runs), en alleen zolang de run loopt. De klok is die van de database.

-- Een aparte tabel (geen kolommen op research_runs): leasevernieuwingen horen niet in het auditlogboek van de run.
create table if not exists public.research_run_leases (
  run_id uuid primary key references public.research_runs(id) on delete cascade,
  idea_id uuid not null references public.ideas(id) on delete cascade,
  lease_id uuid not null,
  lease_until timestamptz not null
);
create index if not exists research_run_leases_idea_idx on public.research_run_leases(idea_id);
alter table public.research_run_leases enable row level security;
drop policy if exists research_run_leases_select on public.research_run_leases;
create policy research_run_leases_select on public.research_run_leases for select to authenticated using (public.can_write_idea(idea_id));
drop policy if exists research_run_leases_insert on public.research_run_leases;
create policy research_run_leases_insert on public.research_run_leases for insert to authenticated with check (public.can_write_idea(idea_id));
drop policy if exists research_run_leases_update on public.research_run_leases;
create policy research_run_leases_update on public.research_run_leases for update to authenticated
  using (public.can_write_idea(idea_id)) with check (public.can_write_idea(idea_id));
drop policy if exists research_run_leases_delete on public.research_run_leases;
create policy research_run_leases_delete on public.research_run_leases for delete to authenticated using (public.can_write_idea(idea_id));
revoke all on public.research_run_leases from public, anon;
grant select, insert, update, delete on public.research_run_leases to authenticated;

-- Neemt (of verlengt) de lease; false als een andere portie de run nog vasthoudt of de run niet (meer) loopt.
create or replace function public.research_run_lease(p_run uuid, p_lease uuid, p_seconds int)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare v_idea uuid;
begin
  select idea_id into v_idea from public.research_runs where id = p_run and status in ('queued', 'running');
  if v_idea is null then
    return false;
  end if;
  insert into public.research_run_leases as l (run_id, idea_id, lease_id, lease_until)
  values (p_run, v_idea, p_lease, now() + make_interval(secs => greatest(30, least(coalesce(p_seconds, 330), 900))))
  on conflict (run_id) do update set lease_id = excluded.lease_id, lease_until = excluded.lease_until
  where l.lease_until < now() or l.lease_id = excluded.lease_id;
  return found;
end $$;

create or replace function public.research_run_release(p_run uuid, p_lease uuid)
returns void language plpgsql security invoker set search_path = '' as $$
begin
  delete from public.research_run_leases where run_id = p_run and lease_id = p_lease;
end $$;

revoke execute on function public.research_run_lease(uuid, uuid, int), public.research_run_release(uuid, uuid) from public, anon;
grant execute on function public.research_run_lease(uuid, uuid, int), public.research_run_release(uuid, uuid) to authenticated;

-- Melding in de app als een run klaar is: een coachnotitie met bron 'system' (geen regel en geen AI-advies, dus de
-- coachcontrole sluit hem niet automatisch).
alter table public.coach_notes drop constraint if exists coach_notes_source_check;
alter table public.coach_notes add constraint coach_notes_source_check check (source in ('rules', 'ai', 'system'));

-- ---------------------------------------------------------------------------
-- Punt 6. "Wat dit betekent voor je grootste onzekerheid"
-- ---------------------------------------------------------------------------
-- Hooguit drie bevindingen die de grootste onzekerheid het sterkst ondersteunen of ondermijnen. De AI (of, zonder
-- AI, een regel) stelt de selectie voor aan het eind van een run; de consultant kan bevindingen weghalen,
-- toevoegen of het effect omdraaien. Daarna is de selectie van de consultant (origin 'consultant') en overschrijft
-- een volgende run hem niet. Alleen bestaande bevindingen met bron: de selectie zelf is geen bewijs.

create table if not exists public.uncertainty_findings (
  id uuid primary key default gen_random_uuid(),
  idea_id uuid not null references public.ideas(id) on delete cascade,
  claim_id uuid not null references public.claims(id) on delete cascade,
  effect text not null check (effect in ('supports', 'undermines')),
  rank int not null default 1 check (rank between 1 and 3),
  reason text check (char_length(reason) <= 500),
  origin text not null check (origin in ('ai', 'rules', 'consultant')),
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (idea_id, claim_id)
);
create index if not exists uncertainty_findings_claim_idx on public.uncertainty_findings(claim_id);
create index if not exists uncertainty_findings_created_by_fk on public.uncertainty_findings(created_by);

alter table public.uncertainty_findings enable row level security;
drop policy if exists uncertainty_findings_select on public.uncertainty_findings;
create policy uncertainty_findings_select on public.uncertainty_findings for select to authenticated using (public.can_read_idea(idea_id));
drop policy if exists uncertainty_findings_insert on public.uncertainty_findings;
create policy uncertainty_findings_insert on public.uncertainty_findings for insert to authenticated with check (public.can_write_idea(idea_id));
drop policy if exists uncertainty_findings_update on public.uncertainty_findings;
create policy uncertainty_findings_update on public.uncertainty_findings for update to authenticated
  using (public.can_write_idea(idea_id)) with check (public.can_write_idea(idea_id));
drop policy if exists uncertainty_findings_delete on public.uncertainty_findings;
create policy uncertainty_findings_delete on public.uncertainty_findings for delete to authenticated using (public.can_write_idea(idea_id));
revoke all on public.uncertainty_findings from public, anon;
grant select, insert, update, delete on public.uncertainty_findings to authenticated;

-- De bevinding hoort bij hetzelfde dossier, en er zijn er hooguit drie per dossier.
drop trigger if exists uncertainty_findings_refs on public.uncertainty_findings;
create trigger uncertainty_findings_refs before insert or update on public.uncertainty_findings
  for each row execute function public.check_idea_refs('claim_id', 'claims');

create or replace function public.guard_uncertainty_findings()
returns trigger language plpgsql set search_path = '' as $$
begin
  if (select count(*) from public.uncertainty_findings where idea_id = new.idea_id) >= 3 then
    raise exception 'UNCERTAINTY_MAX: hooguit drie bevindingen bij de grootste onzekerheid' using errcode = 'P0001';
  end if;
  return new;
end $$;
drop trigger if exists uncertainty_findings_max on public.uncertainty_findings;
create trigger uncertainty_findings_max before insert on public.uncertainty_findings
  for each row execute function public.guard_uncertainty_findings();
revoke execute on function public.guard_uncertainty_findings() from public, anon, authenticated;

-- De slotstap van een run die de selectie voorstelt.
alter table public.research_tasks drop constraint if exists research_tasks_kind_check;
alter table public.research_tasks add constraint research_tasks_kind_check
  check (kind in ('plan', 'search', 'extract', 'counter', 'competitors', 'sizing', 'reality_check', 'uncertainty'));
