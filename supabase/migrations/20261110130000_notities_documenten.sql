-- Eigen notities en documenten per stap (overzicht, Markt, Aannames, Testen, Besluit).
-- Nog NIET live: gaat pas naar productie na akkoord van de product owner. Idempotent; wijzigt of verwijdert geen
-- bestaande gegevens. Een notitie of document is intern werkmateriaal: geen bron, geen bewijs en niet in het rapport.
begin;

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

commit;
