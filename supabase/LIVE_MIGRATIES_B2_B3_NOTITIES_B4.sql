-- Plak dit in de Supabase SQL Editor (project mcazwspfwitefcmdhcgv) en klik Run. Alles in één transactie;
-- elke migratie is idempotent en verwijdert geen gegevens. Daarna worden ze in de migratiehistorie geregistreerd.
begin;

-- ===== 20261109090000_b2_onderzoek (md5 f8ca3027d30bfd9c4c6e2394bab135fc) =====
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
insert into supabase_migrations.schema_migrations(version, name) values ('20261109090000', 'b2_onderzoek') on conflict do nothing;

-- ===== 20261110090000_b3_intake (md5 1780570888d0eacc0a5d74d27361b527) =====
-- Fase B3: intake in drie vragen en één bevestiging.
-- Alles is idempotent (if not exists / or replace / drop policy if exists) en raakt geen bestaande gegevens: er
-- worden alleen kolommen, een policy en een functie toegevoegd en org_ai_spend telt voortaan ook AI-aanroepen
-- zonder idee mee. Zolang deze migratie niet live staat, werkt de intake ook: zonder org-budgetcontrole maakt
-- ProofLab dan alleen een voorstel uit de tekst zelf (geen AI), en de prijs komt in de beschrijving.

-- ---------------------------------------------------------------------------
-- 1. Het idee: prijs van het aanbod en het intakevoorstel
-- ---------------------------------------------------------------------------
-- offer_price: de prijs die de consultant noemt ("€ 249 per maand"); de onderzoeksvragen (lib/research-questions.ts)
-- lezen hem als eerste. intake_proposal: de drie antwoorden, het voorstel (AI of regels) en welke velden de
-- consultant bij de bevestiging aanpaste. Zo blijft herleidbaar wat een voorstel was en wat de consultant vastlegde.
alter table public.ideas add column if not exists offer_price text;
alter table public.ideas drop constraint if exists ideas_offer_price_len;
alter table public.ideas add constraint ideas_offer_price_len check (offer_price is null or char_length(offer_price) <= 120);
alter table public.ideas add column if not exists intake_proposal jsonb;
alter table public.ideas drop constraint if exists ideas_intake_proposal_size;
alter table public.ideas add constraint ideas_intake_proposal_size check (intake_proposal is null or pg_column_size(intake_proposal) <= 32000);

-- ---------------------------------------------------------------------------
-- 2. AI vóór er een idee is: het voorstel uit de intake
-- ---------------------------------------------------------------------------
-- Het voorstel wordt gemaakt voordat het idee bestaat. De aanroep komt in hetzelfde grootboek (ai_runs), op de
-- organisatie in plaats van op een idee, en telt mee voor het maandbudget van de organisatie.
alter table public.ai_runs add column if not exists org_id uuid references public.organizations(id) on delete cascade;
create index if not exists ai_runs_org_idx on public.ai_runs(org_id) where org_id is not null;

drop policy if exists ai_runs_insert_org on public.ai_runs;
create policy ai_runs_insert_org on public.ai_runs for insert to authenticated
  with check (idea_id is null and org_id is not null and public.is_org_member(org_id) and created_by = (select auth.uid()));
drop policy if exists ai_runs_select_org on public.ai_runs;
create policy ai_runs_select_org on public.ai_runs for select to authenticated
  using (idea_id is null and org_id is not null and public.is_org_member(org_id));

-- Uitgaven en plafond van de organisatie, voor een AI-aanroep zonder idee. Alleen voor teamleden.
create or replace function public.org_ai_spend_for_org(p_org uuid)
returns table (spent numeric, cap numeric) language sql stable security definer set search_path = '' as $$
  select coalesce((
      select sum(r.cost_usd) from public.ai_runs r
      left join public.ideas i2 on i2.id = r.idea_id
      where (i2.org_id = o.id or (r.idea_id is null and r.org_id = o.id)) and r.created_at >= date_trunc('month', now())
    ), 0), o.ai_monthly_cap_usd
  from public.organizations o
  where o.id = p_org and public.is_org_member(p_org);
$$;
revoke execute on function public.org_ai_spend_for_org(uuid) from public, anon;
grant execute on function public.org_ai_spend_for_org(uuid) to authenticated;

-- Het bestaande budget per idee telt de intake-aanroepen van de organisatie nu ook mee.
create or replace function public.org_ai_spend(p_idea uuid)
returns table (spent numeric, cap numeric) language sql stable security definer set search_path = '' as $$
  select coalesce((
      select sum(r.cost_usd) from public.ai_runs r
      left join public.ideas i2 on i2.id = r.idea_id
      where (i2.org_id = o.id or (r.idea_id is null and r.org_id = o.id)) and r.created_at >= date_trunc('month', now())
    ), 0), o.ai_monthly_cap_usd
  from public.ideas i join public.organizations o on o.id = i.org_id
  where i.id = p_idea and public.can_read_idea(p_idea);
$$;
insert into supabase_migrations.schema_migrations(version, name) values ('20261110090000', 'b3_intake') on conflict do nothing;

-- ===== 20261110130000_notities_documenten (md5 97ed89b6ebbb35c9528dce6f6842ceba) =====
-- Eigen notities en documenten per stap (overzicht, Markt, Aannames, Testen, Besluit).
-- Nog NIET live: gaat pas naar productie na akkoord van de product owner. Idempotent; wijzigt of verwijdert geen
-- bestaande gegevens. Een notitie of document is intern werkmateriaal: geen bron, geen bewijs en niet in het rapport.

-- ---------------------------------------------------------------------------
-- 1. Rechten
-- ---------------------------------------------------------------------------

-- Bewerken en verwijderen: wie mag schrijven in het dossier, en dan alleen het eigen item, of als eigenaar van de
-- werkruimte ook dat van een ander.
create or replace function public.can_edit_step_item(p_idea uuid, p_created_by uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.can_write_idea(p_idea) and (
    p_created_by = (select auth.uid())
    or exists (select 1 from public.ideas i where i.id = p_idea and public.is_org_owner(i.org_id))
  );
$$;

-- Het idee uit een objectpad "<idea_id>/<stap>/<uuid>-<veilige-naam>". Null als het pad niet aan het patroon voldoet,
-- zodat de storage-policies een afwijkend pad altijd weigeren.
create or replace function public.step_document_idea(p_name text)
returns uuid language sql immutable set search_path = '' as $$
  select case
    when p_name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/(overview|market|assumptions|test|decide)/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-[A-Za-z0-9._-]{1,120}$'
         and position('..' in p_name) = 0
    then split_part(p_name, '/', 1)::uuid
    else null
  end;
$$;

revoke execute on function public.can_edit_step_item(uuid, uuid), public.step_document_idea(text) from public, anon;
grant execute on function public.can_edit_step_item(uuid, uuid), public.step_document_idea(text) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Notities
-- ---------------------------------------------------------------------------

create table if not exists public.step_notes (
  id uuid primary key default gen_random_uuid(),
  idea_id uuid not null references public.ideas(id) on delete cascade,
  step text not null check (step in ('overview', 'market', 'assumptions', 'test', 'decide')),
  title text not null default '' check (char_length(title) <= 200),
  body text not null check (char_length(btrim(body)) between 1 and 20000),
  -- De naam van de auteur op het moment van schrijven, zodat ook een opdrachtgever (die de profielen van het team niet
  -- mag lezen) ziet wie de notitie schreef.
  author_name text not null default '' check (char_length(author_name) <= 200),
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists step_notes_idea_step on public.step_notes(idea_id, step, created_at desc);
create index if not exists step_notes_created_by_fk on public.step_notes(created_by);

-- ---------------------------------------------------------------------------
-- 3. Documenten (metadata; het bestand zelf staat in Storage, bucket step-documents)
-- ---------------------------------------------------------------------------

create table if not exists public.step_documents (
  id uuid primary key default gen_random_uuid(),
  idea_id uuid not null references public.ideas(id) on delete cascade,
  step text not null check (step in ('overview', 'market', 'assumptions', 'test', 'decide')),
  storage_path text not null unique,
  file_name text not null check (char_length(file_name) between 1 and 200),
  mime_type text not null check (mime_type in (
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'text/csv', 'text/plain', 'text/markdown', 'image/png', 'image/jpeg', 'image/webp')),
  size_bytes bigint not null check (size_bytes between 1 and 20971520),
  description text check (description is null or char_length(description) <= 500),
  author_name text not null default '' check (char_length(author_name) <= 200),
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  -- Het pad hoort bij hetzelfde idee en dezelfde stap als de rij.
  constraint step_documents_path_matches check (
    public.step_document_idea(storage_path) = idea_id and split_part(storage_path, '/', 2) = step
  )
);
create index if not exists step_documents_idea_step on public.step_documents(idea_id, step, created_at desc);
create index if not exists step_documents_created_by_fk on public.step_documents(created_by);

-- ---------------------------------------------------------------------------
-- 4. Wie en wanneer legt de database vast, niet de app
-- ---------------------------------------------------------------------------

create or replace function public.stamp_step_item()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_name text;
begin
  if tg_op = 'INSERT' then
    select coalesce(nullif(btrim(p.full_name), ''), u.email, '') into v_name
    from auth.users u left join public.profiles p on p.user_id = u.id
    where u.id = auth.uid();
    new.created_by := auth.uid();
    new.created_at := now();
    new.author_name := left(coalesce(v_name, ''), 200);
    if tg_table_name = 'step_notes' then
      new.updated_at := now();
    end if;
    return new;
  end if;
  -- Bij bewerken blijven dossier, stap, auteur en aanmaakmoment ongewijzigd.
  new.id := old.id;
  new.idea_id := old.idea_id;
  new.step := old.step;
  new.created_by := old.created_by;
  new.created_at := old.created_at;
  new.author_name := old.author_name;
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists step_notes_stamp on public.step_notes;
create trigger step_notes_stamp before insert or update on public.step_notes
  for each row execute function public.stamp_step_item();
drop trigger if exists step_documents_stamp on public.step_documents;
create trigger step_documents_stamp before insert on public.step_documents
  for each row execute function public.stamp_step_item();
revoke execute on function public.stamp_step_item() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. Row level security
-- ---------------------------------------------------------------------------

alter table public.step_notes enable row level security;
alter table public.step_documents enable row level security;

drop policy if exists step_notes_select on public.step_notes;
create policy step_notes_select on public.step_notes for select to authenticated using (public.can_read_idea(idea_id));
drop policy if exists step_notes_insert on public.step_notes;
create policy step_notes_insert on public.step_notes for insert to authenticated with check (public.can_write_idea(idea_id));
drop policy if exists step_notes_update on public.step_notes;
create policy step_notes_update on public.step_notes for update to authenticated
  using (public.can_edit_step_item(idea_id, created_by)) with check (public.can_write_idea(idea_id));
drop policy if exists step_notes_delete on public.step_notes;
create policy step_notes_delete on public.step_notes for delete to authenticated using (public.can_edit_step_item(idea_id, created_by));

drop policy if exists step_documents_select on public.step_documents;
create policy step_documents_select on public.step_documents for select to authenticated using (public.can_read_idea(idea_id));
drop policy if exists step_documents_insert on public.step_documents;
create policy step_documents_insert on public.step_documents for insert to authenticated with check (public.can_write_idea(idea_id));
-- Geen update-policy: een document vervang je door een nieuw te uploaden en het oude te verwijderen.
drop policy if exists step_documents_delete on public.step_documents;
create policy step_documents_delete on public.step_documents for delete to authenticated using (public.can_edit_step_item(idea_id, created_by));

revoke all on public.step_notes, public.step_documents from public, anon, authenticated;
grant select, insert, update, delete on public.step_notes to authenticated;
grant select, insert, delete on public.step_documents to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Auditspoor (zelfde audit_row als de andere dossiertabellen; bij verwijderen staat de rij erin)
-- ---------------------------------------------------------------------------

do $$
declare t text;
begin
  foreach t in array array['step_notes', 'step_documents'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_audit', t);
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function public.audit_row()', t || '_audit', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 7. Storage: privé bucket met grens van 20 MB en alleen de toegestane typen
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('step-documents', 'step-documents', false, 20971520, array[
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/csv', 'text/plain', 'text/markdown', 'image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do nothing;

-- Objectpad: <idea_id>/<stap>/<uuid>-<veilige-naam>. Lezen (downloaden via een kort geldige link) mag iedereen die
-- het dossier mag lezen; uploaden alleen wie mag schrijven; verwijderen alleen de uploader of de eigenaar van de
-- werkruimte. Overschrijven (update) is niet toegestaan.
drop policy if exists step_documents_objects_select on storage.objects;
create policy step_documents_objects_select on storage.objects for select to authenticated
  using (bucket_id = 'step-documents' and public.can_read_idea(public.step_document_idea(name)));
drop policy if exists step_documents_objects_insert on storage.objects;
create policy step_documents_objects_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'step-documents' and public.can_write_idea(public.step_document_idea(name)));
drop policy if exists step_documents_objects_delete on storage.objects;
create policy step_documents_objects_delete on storage.objects for delete to authenticated
  using (bucket_id = 'step-documents' and public.can_edit_step_item(
    public.step_document_idea(name),
    case when owner_id = (select auth.uid())::text or owner = (select auth.uid()) then (select auth.uid()) end));

insert into supabase_migrations.schema_migrations(version, name) values ('20261110130000', 'notities_documenten') on conflict do nothing;

-- ===== 20261110140000_b4_aannames (md5 82a2f8ff7ffa1509a081033d3029b6f5) =====
-- Fase B4: de consultant kiest maximaal drie aannames om nu te testen; de rest blijft zichtbaar als "later".
-- Idempotent. Geen data gewijzigd of verwijderd: bestaande aannames krijgen false (nog niet gekozen).

alter table public.assumptions add column if not exists selected_for_test boolean not null default false;
comment on column public.assumptions.selected_for_test is
  'B4: gekozen om nu te testen (maximaal 3 per idee, afgedwongen door guard_selected_for_test). False = later.';

-- Maximaal drie gekozen aannames per idee. De advisory lock per idee voorkomt dat twee gelijktijdige keuzes samen
-- boven de drie uitkomen.
create or replace function public.guard_selected_for_test()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  n integer;
begin
  if new.selected_for_test is true and (tg_op = 'INSERT' or old.selected_for_test is distinct from true) then
    perform pg_advisory_xact_lock(hashtext('selected_for_test:' || new.idea_id::text));
    select count(*) into n from public.assumptions a
      where a.idea_id = new.idea_id and a.selected_for_test is true and a.id <> new.id;
    if n >= 3 then
      raise exception 'MAX_SELECTED: kies maximaal drie aannames om te testen' using errcode = 'P0001';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists assumptions_selected_for_test on public.assumptions;
create trigger assumptions_selected_for_test before insert or update of selected_for_test on public.assumptions
  for each row execute function public.guard_selected_for_test();

create index if not exists assumptions_selected_for_test_idx on public.assumptions (idea_id) where selected_for_test;

insert into supabase_migrations.schema_migrations(version, name) values ('20261110140000', 'b4_aannames') on conflict do nothing;

commit;
