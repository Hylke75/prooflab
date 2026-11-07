-- Propositie- en businessmodelcanvas per idee (ontwerp §6.1, §11 /model, §13.4 business_models).
-- Twee canvassen per idee: het businessmodel (negen bouwstenen) en de waardepropositie (klantprofiel en waardekaart).
-- Een onderdeel is werkmateriaal, geen bewijs: het toont de bewijsstand van de gekoppelde aanname. Een AI-voorstel is
-- gelabeld tot een consultant het accepteert en kan pas daarna aan een aanname hangen.
-- Versies zijn onveranderlijke momentopnamen die de database zelf samenstelt (save_canvas_version).
-- Idempotent; wijzigt geen bestaande tabellen of functies. Nog niet toegepast op productie.
begin;

-- ---------------------------------------------------------------------------
-- 1. Onderdelen van een canvas
-- ---------------------------------------------------------------------------

create table if not exists public.canvas_items (
  id uuid primary key default gen_random_uuid(),
  idea_id uuid not null references public.ideas(id) on delete cascade,
  canvas text not null check (canvas in ('business', 'value')),
  block text not null,
  body text not null check (char_length(btrim(body)) between 1 and 500 and char_length(body) <= 500),
  position int not null default 0 check (position between 0 and 10000),
  -- Herkomst: eigen invoer, overgenomen uit de intake of het onderzoek, of een AI-voorstel.
  origin text not null default 'manual' check (origin in ('manual', 'intake', 'research', 'ai')),
  -- Waar een overgenomen onderdeel vandaan kwam ("intake:audience", "segment:<id>", "signal:<id>"): één keer per idee.
  source_ref text check (source_ref is null or char_length(source_ref) between 1 and 120),
  -- Alleen bij een AI-voorstel: wanneer en door wie het is geaccepteerd (de database zet beide).
  accepted_at timestamptz,
  accepted_by uuid references auth.users(id) on delete set null,
  assumption_id uuid references public.assumptions(id) on delete set null,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint canvas_items_block_check check (
    (canvas = 'business' and block in ('key_partners', 'key_activities', 'key_resources', 'value_propositions', 'customer_relationships',
                                       'channels', 'customer_segments', 'cost_structure', 'revenue_streams'))
    or (canvas = 'value' and block in ('customer_jobs', 'pains', 'gains', 'products_services', 'pain_relievers', 'gain_creators'))
  ),
  -- Een niet-geaccepteerd AI-voorstel hangt nooit aan een aanname: het komt pas op de aannamekaart na akkoord.
  constraint canvas_items_ai_link check (origin <> 'ai' or accepted_at is not null or assumption_id is null),
  constraint canvas_items_accept_only_ai check (origin = 'ai' or (accepted_at is null and accepted_by is null))
);
create index if not exists canvas_items_idea_block on public.canvas_items(idea_id, canvas, block, position);
-- Volledige (niet-partiële) unieke index, zodat "on conflict (idea_id, source_ref) do nothing" werkt; null telt nooit dubbel.
create unique index if not exists canvas_items_source_ref on public.canvas_items(idea_id, source_ref);
create index if not exists canvas_items_assumption_fk on public.canvas_items(assumption_id);
create index if not exists canvas_items_created_by_fk on public.canvas_items(created_by);
create index if not exists canvas_items_accepted_by_fk on public.canvas_items(accepted_by);

-- Wie, wanneer en herkomst legt de database vast, niet de app. Dossier, canvas, herkomst en aanmaker veranderen niet;
-- accepteren kan één keer en alleen bij een AI-voorstel. Een gekoppelde aanname hoort bij hetzelfde idee.
create or replace function public.guard_canvas_item()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
    new.created_at := now();
    new.updated_at := now();
    -- Een nieuw onderdeel is nooit al geaccepteerd: een AI-voorstel wacht op een consultant.
    new.accepted_at := null;
    new.accepted_by := null;
  else
    new.id := old.id;
    new.idea_id := old.idea_id;
    new.canvas := old.canvas;
    new.origin := old.origin;
    new.source_ref := old.source_ref;
    new.created_by := old.created_by;
    new.created_at := old.created_at;
    if old.accepted_at is not null then
      new.accepted_at := old.accepted_at;
      -- Alleen het wissen van een verwijderd account (on delete set null) mag de accepteerder leegmaken.
      new.accepted_by := case when new.accepted_by is null then null else old.accepted_by end;
    elsif new.accepted_at is not null then
      if old.origin <> 'ai' then
        raise exception 'CANVAS_ACCEPT_NOT_AI: alleen een AI-voorstel wordt geaccepteerd' using errcode = 'P0001';
      end if;
      new.accepted_at := now();
      new.accepted_by := auth.uid();
    else
      new.accepted_by := null;
    end if;
    new.updated_at := now();
  end if;
  if new.assumption_id is not null and not exists (
    select 1 from public.assumptions a where a.id = new.assumption_id and a.idea_id = new.idea_id
  ) then
    raise exception 'CANVAS_ASSUMPTION_IDEA: de aanname hoort niet bij dit idee' using errcode = 'P0001';
  end if;
  return new;
end $$;

drop trigger if exists canvas_items_guard on public.canvas_items;
create trigger canvas_items_guard before insert or update on public.canvas_items
  for each row execute function public.guard_canvas_item();

-- ---------------------------------------------------------------------------
-- 2. Versies: onveranderlijke momentopnamen
-- ---------------------------------------------------------------------------

create table if not exists public.canvas_versions (
  id uuid primary key default gen_random_uuid(),
  idea_id uuid not null references public.ideas(id) on delete cascade,
  version_no int not null check (version_no >= 1),
  note text not null default '' check (char_length(note) <= 1000),
  -- De onderdelen op dat moment, met de gekoppelde aanname en haar status (samengesteld door save_canvas_version).
  items jsonb not null check (jsonb_typeof(items) = 'array'),
  -- De naam van de auteur op dat moment, zodat ook een opdrachtgever ziet wie de versie opsloeg.
  author_name text not null default '' check (char_length(author_name) <= 200),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint canvas_versions_number unique (idea_id, version_no)
);
create index if not exists canvas_versions_created_by_fk on public.canvas_versions(created_by);

-- Een versie verandert nooit en wordt niet los verwijderd. Uitzonderingen: het wissen van een verwijderd account
-- (created_by naar null) en het verwijderen van het hele idee (cascade).
create or replace function public.guard_canvas_version()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' then
    if new.created_by is null and old.created_by is not null
       and (new.id, new.idea_id, new.version_no, new.note, new.items, new.author_name, new.created_at)
           is not distinct from (old.id, old.idea_id, old.version_no, old.note, old.items, old.author_name, old.created_at) then
      return new;
    end if;
    raise exception 'CANVAS_VERSION_LOCKED: een canvasversie is onveranderlijk' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.ideas i where i.id = old.idea_id) then
    raise exception 'CANVAS_VERSION_LOCKED: een canvasversie is onveranderlijk' using errcode = 'P0001';
  end if;
  return old;
end $$;

drop trigger if exists canvas_versions_guard on public.canvas_versions;
create trigger canvas_versions_guard before update or delete on public.canvas_versions
  for each row execute function public.guard_canvas_version();

-- Versie opslaan: de database stelt de momentopname samen uit de huidige onderdelen (de app kan geen eigen inhoud
-- aanleveren), nummert door en legt auteur en tijd vast.
create or replace function public.save_canvas_version(p_idea uuid, p_note text default '')
returns table (id uuid, version_no int)
language plpgsql security definer set search_path = '' as $$
declare
  v_items jsonb;
  v_no int;
  v_name text;
  v_id uuid;
begin
  if p_idea is null or not public.can_write_idea(p_idea) then
    raise exception 'CANVAS_NOT_ALLOWED: geen schrijfrechten op dit idee' using errcode = '42501';
  end if;
  if char_length(coalesce(p_note, '')) > 1000 then
    raise exception 'CANVAS_NOTE_TOO_LONG: de notitie is langer dan 1000 tekens' using errcode = 'P0001';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('canvas_version:' || p_idea::text, 0));
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', c.id,
           'canvas', c.canvas,
           'block', c.block,
           'body', c.body,
           'position', c.position,
           'origin', c.origin,
           'accepted', c.accepted_at is not null,
           'assumption_id', c.assumption_id,
           'assumption_statement', a.statement,
           'assumption_status', a.status
         ) order by c.canvas, c.block, c.position, c.created_at), '[]'::jsonb)
    into v_items
  from public.canvas_items c
  left join public.assumptions a on a.id = c.assumption_id
  where c.idea_id = p_idea;
  select coalesce(max(v.version_no), 0) + 1 into v_no from public.canvas_versions v where v.idea_id = p_idea;
  select coalesce(nullif(btrim(p.full_name), ''), u.email, '') into v_name
  from auth.users u left join public.profiles p on p.user_id = u.id
  where u.id = auth.uid();
  insert into public.canvas_versions (idea_id, version_no, note, items, author_name, created_by, created_at)
  values (p_idea, v_no, btrim(coalesce(p_note, '')), v_items, left(coalesce(v_name, ''), 200), auth.uid(), now())
  returning canvas_versions.id into v_id;
  return query select v_id, v_no;
end $$;

-- ---------------------------------------------------------------------------
-- 3. Row level security: lezen wie het dossier mag lezen (ook opdrachtgevers), schrijven alleen het team
-- ---------------------------------------------------------------------------

alter table public.canvas_items enable row level security;
alter table public.canvas_versions enable row level security;

drop policy if exists canvas_items_select on public.canvas_items;
-- Een opdrachtgever ziet geen AI-voorstel dat nog door niemand is beoordeeld; het team ziet alles.
create policy canvas_items_select on public.canvas_items for select to authenticated
  using (public.can_write_idea(idea_id) or (public.can_read_idea(idea_id) and (origin <> 'ai' or accepted_at is not null)));
drop policy if exists canvas_items_insert on public.canvas_items;
create policy canvas_items_insert on public.canvas_items for insert to authenticated with check (public.can_write_idea(idea_id));
drop policy if exists canvas_items_update on public.canvas_items;
create policy canvas_items_update on public.canvas_items for update to authenticated
  using (public.can_write_idea(idea_id)) with check (public.can_write_idea(idea_id));
drop policy if exists canvas_items_delete on public.canvas_items;
create policy canvas_items_delete on public.canvas_items for delete to authenticated using (public.can_write_idea(idea_id));

-- Versies: alleen lezen. Opslaan gaat uitsluitend via save_canvas_version; bijwerken en verwijderen kan niet.
drop policy if exists canvas_versions_select on public.canvas_versions;
create policy canvas_versions_select on public.canvas_versions for select to authenticated using (public.can_read_idea(idea_id));

revoke all on public.canvas_items, public.canvas_versions from public, anon, authenticated;
grant select, insert, update, delete on public.canvas_items to authenticated;
grant select on public.canvas_versions to authenticated;

revoke execute on function public.guard_canvas_item(), public.guard_canvas_version() from public, anon, authenticated;
revoke execute on function public.save_canvas_version(uuid, text) from public, anon;
grant execute on function public.save_canvas_version(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Auditspoor (zelfde audit_row als de andere dossiertabellen)
-- ---------------------------------------------------------------------------

do $$
declare t text;
begin
  foreach t in array array['canvas_items', 'canvas_versions'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_audit', t);
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function public.audit_row()', t || '_audit', t);
  end loop;
end $$;

commit;
