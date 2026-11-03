-- A coach that follows the whole trajectory, and more sources for customer signals (forums, bulk imports,
-- LinkedIn outreach via Expandi webhooks).

-- ---------------------------------------------------------------------------
-- 1. Coach notes: tips, warnings and questions that the coach posts when the dossier changes
-- ---------------------------------------------------------------------------

create table public.coach_notes (
  id uuid primary key default gen_random_uuid(),
  idea_id uuid not null references public.ideas(id) on delete cascade,
  code text not null check (char_length(code) between 2 and 80),
  kind text not null check (kind in ('tip', 'warning', 'question', 'praise')),
  title text not null check (char_length(title) between 3 and 160),
  body text not null check (char_length(body) between 3 and 1200),
  href text check (href is null or (href like '/app/%' and char_length(href) <= 300)),
  source text not null check (source in ('rules', 'ai')),
  audience text not null default 'consultant' check (audience in ('consultant', 'everyone')),
  status text not null default 'open' check (status in ('open', 'done', 'dismissed')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references auth.users(id)
);
-- A rule fires once per dossier while its note is open; AI notes carry their own code per review.
create unique index coach_notes_open_code on public.coach_notes(idea_id, code) where status = 'open';
create index coach_notes_idea_idx on public.coach_notes(idea_id, status, created_at desc);
create index coach_notes_resolved_by_fk on public.coach_notes(resolved_by);

alter table public.coach_notes enable row level security;
create policy coach_notes_select on public.coach_notes for select to authenticated
  using (public.can_write_idea(idea_id) or (audience = 'everyone' and public.can_read_idea(idea_id)));
create policy coach_notes_insert on public.coach_notes for insert to authenticated
  with check (public.can_write_idea(idea_id) and status = 'open');
create policy coach_notes_update on public.coach_notes for update to authenticated
  using (public.can_write_idea(idea_id)) with check (public.can_write_idea(idea_id));

-- Only the status of a note changes; its content is what the coach said at the time.
create or replace function public.guard_coach_note()
returns trigger language plpgsql set search_path = '' as $$
begin
  if (to_jsonb(new) - 'status' - 'resolved_at' - 'resolved_by') is distinct from (to_jsonb(old) - 'status' - 'resolved_at' - 'resolved_by') then
    raise exception 'COACH_NOTE_LOCKED: alleen de status van een coachnotitie verandert' using errcode = 'P0001';
  end if;
  if new.status <> 'open' and old.status = 'open' then
    new.resolved_at := now();
    new.resolved_by := auth.uid();
  end if;
  return new;
end $$;

create trigger coach_notes_guard before update on public.coach_notes
  for each row execute function public.guard_coach_note();

-- One row per dossier: what the coach last looked at, so it only reviews again after a real change and the
-- number of AI reviews per day stays limited.
create table public.coach_reviews (
  idea_id uuid primary key references public.ideas(id) on delete cascade,
  fingerprint text not null,
  reviewed_at timestamptz not null default now(),
  ai_reviews_today int not null default 0,
  ai_day date not null default current_date
);
alter table public.coach_reviews enable row level security;
create policy coach_reviews_all on public.coach_reviews for all to authenticated
  using (public.can_write_idea(idea_id)) with check (public.can_write_idea(idea_id));

-- ---------------------------------------------------------------------------
-- 2. More sources for customer signals
-- ---------------------------------------------------------------------------

alter table public.sources drop constraint if exists sources_source_type_check;
alter table public.sources add constraint sources_source_type_check check (source_type in
  ('official_statistic', 'primary_document', 'company_page', 'research_report', 'news', 'review_site', 'blog',
   'forum', 'outreach', 'dataset_upload', 'interview', 'other'));

-- Webhook endpoints per dossier (for now: Expandi). The URL carries a random token; only its hash is stored.
create table public.integration_endpoints (
  id uuid primary key default gen_random_uuid(),
  idea_id uuid not null references public.ideas(id) on delete cascade,
  provider text not null check (provider in ('expandi')),
  label text not null check (char_length(label) between 2 and 120),
  token_hash text not null unique,
  active boolean not null default true,
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  last_event_at timestamptz
);
create index integration_endpoints_idea_idx on public.integration_endpoints(idea_id);
create index integration_endpoints_created_by_fk on public.integration_endpoints(created_by);
alter table public.integration_endpoints enable row level security;
create policy integration_endpoints_select on public.integration_endpoints for select to authenticated using (public.can_write_idea(idea_id));
create policy integration_endpoints_insert on public.integration_endpoints for insert to authenticated with check (public.can_write_idea(idea_id));
create policy integration_endpoints_update on public.integration_endpoints for update to authenticated
  using (public.can_write_idea(idea_id)) with check (public.can_write_idea(idea_id));

-- Outreach events (connection accepted, reply, message). Names and profile URLs are not stored: the contact
-- is a pseudonymous hash, the message text is kept for analysis until the retention date.
create table public.outreach_events (
  id bigint generated always as identity primary key,
  idea_id uuid not null references public.ideas(id) on delete cascade,
  endpoint_id uuid not null references public.integration_endpoints(id) on delete cascade,
  event_type text not null check (event_type in ('connection_request', 'connection_accepted', 'message_sent', 'reply', 'other')),
  contact_hash text not null check (char_length(contact_hash) <= 64),
  campaign text check (char_length(campaign) <= 200),
  message text check (char_length(message) <= 4000),
  received_at timestamptz not null default now(),
  retention_until date not null default (current_date + 180),
  dedupe_key text not null,
  unique (endpoint_id, dedupe_key)
);
create index outreach_events_idea_idx on public.outreach_events(idea_id, received_at desc);
alter table public.outreach_events enable row level security;
create policy outreach_events_select on public.outreach_events for select to authenticated using (public.can_write_idea(idea_id));
create policy outreach_events_delete on public.outreach_events for delete to authenticated using (public.can_write_idea(idea_id));

-- Called by the app server with the ingest secret; the endpoint token identifies the dossier.
create or replace function public.record_outreach_event(
  p_key text, p_token_hash text, p_event text, p_contact_hash text, p_campaign text, p_message text, p_dedupe text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  ep public.integration_endpoints;
  v_rows int;
begin
  if not public.ingest_key_ok(p_key) then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  select * into ep from public.integration_endpoints where token_hash = p_token_hash and active;
  if ep.id is null then
    return false;
  end if;
  if not public.ingest_allowed('outreach:' || ep.id::text) then
    return false;
  end if;
  insert into public.outreach_events (idea_id, endpoint_id, event_type, contact_hash, campaign, message, dedupe_key)
  values (ep.idea_id, ep.id,
          case when p_event in ('connection_request', 'connection_accepted', 'message_sent', 'reply') then p_event else 'other' end,
          left(p_contact_hash, 64), left(p_campaign, 200), left(p_message, 4000), left(p_dedupe, 200))
  on conflict (endpoint_id, dedupe_key) do nothing;
  get diagnostics v_rows = row_count;
  update public.integration_endpoints set last_event_at = now() where id = ep.id;
  return v_rows > 0;
end $$;

-- Outreach messages leave with the other personal data after the retention date.
create or replace function public.purge_expired_personal_data()
returns int language plpgsql security definer set search_path = '' as $$
declare v1 int; v2 int; v3 int;
begin
  update public.test_submissions set email = null, answers = '{}'::jsonb
  where retention_until < current_date and (email is not null or answers <> '{}'::jsonb);
  get diagnostics v1 = row_count;
  update public.interviews set transcript = '[verwijderd na afloop van de bewaartermijn]'
  where retention_until < current_date and transcript <> '[verwijderd na afloop van de bewaartermijn]';
  get diagnostics v2 = row_count;
  update public.observations o set quote = null
  from public.interviews i
  where o.interview_id = i.id and i.retention_until < current_date and o.quote is not null;
  update public.outreach_events set message = null where retention_until < current_date and message is not null;
  get diagnostics v3 = row_count;
  return v1 + v2 + v3;
end $$;

-- ---------------------------------------------------------------------------
-- 3. Audit and grants
-- ---------------------------------------------------------------------------

do $$
declare t text;
begin
  foreach t in array array['coach_notes', 'integration_endpoints'] loop
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function public.audit_row()', t || '_audit', t);
  end loop;
end $$;

revoke all on public.coach_notes, public.coach_reviews, public.integration_endpoints, public.outreach_events from anon;
grant select, insert, update on public.coach_notes, public.integration_endpoints to authenticated;
grant select, insert, update, delete on public.coach_reviews to authenticated;
grant select, delete on public.outreach_events to authenticated;
revoke execute on function public.guard_coach_note(), public.record_outreach_event(text, text, text, text, text, text, text) from public, authenticated;
grant execute on function public.record_outreach_event(text, text, text, text, text, text, text) to anon;
