-- Privacy, bounces and outreach (4 November 2026)
--   1. Survey invitations: the e-mail provider's message ids, the version of the tracking salt, delivery problems.
--   2. Resend bounce/complaint webhook: idempotent per webhook id, written through an ingest-guarded RPC.
--   3. Per-post link tracking: utm_content (a short post code) on responses and test events.
--   4. Expandi campaign webhooks per experiment (consultants only).
--   5. Data-subject requests (AVG/GDPR): search, export and erase one e-mail address within one organisation.

-- ---------------------------------------------------------------------------
-- 1. Survey invitations
-- ---------------------------------------------------------------------------

alter table public.survey_invitations
  -- The id Resend returned for the first mail and for the reminder: bounces and complaints refer to it.
  add column if not exists provider_message_id text check (char_length(provider_message_id) <= 100),
  add column if not exists reminder_message_id text check (char_length(reminder_message_id) <= 100),
  -- Which TRACKING_SALTS entry derived the personal token and the address hash (see lib/domain/survey-tokens.ts).
  add column if not exists salt_version text not null default 'v1' check (salt_version ~ '^[a-z0-9]{1,16}$'),
  -- Set only by record_email_event(): a hard bounce or a spam complaint.
  add column if not exists delivery_issue text check (delivery_issue in ('bounced', 'complained'));
create index if not exists survey_invitations_provider_msg_idx on public.survey_invitations(provider_message_id) where provider_message_id is not null;
create index if not exists survey_invitations_reminder_msg_idx on public.survey_invitations(reminder_message_id) where reminder_message_id is not null;

-- A consultant cannot hide or invent a delivery problem, nor re-send to an address that bounced or complained.
-- The ingest RPC runs without a signed-in user (auth.uid() is null) and may change both.
create or replace function public.guard_invitation_delivery()
returns trigger language plpgsql set search_path = '' as $$
begin
  if (select auth.uid()) is null then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.delivery_issue := null;
    return new;
  end if;
  if new.delivery_issue is distinct from old.delivery_issue then
    raise exception 'DELIVERY_ISSUE: een bounce of klacht wordt alleen door de e-maildienst vastgelegd' using errcode = 'P0001';
  end if;
  if old.delivery_issue is not null and new.status is distinct from old.status then
    raise exception 'DELIVERY_ISSUE: dit adres bounce''de of meldde spam en wordt niet opnieuw gemaild' using errcode = 'P0001';
  end if;
  return new;
end $$;
drop trigger if exists survey_invitations_delivery_guard on public.survey_invitations;
create trigger survey_invitations_delivery_guard before insert or update on public.survey_invitations
  for each row execute function public.guard_invitation_delivery();

-- Why an address is on the do-not-mail list.
alter table public.email_suppressions
  add column if not exists reason text not null default 'unsubscribed'
    check (reason in ('unsubscribed', 'bounced', 'complained', 'erasure'));

-- ---------------------------------------------------------------------------
-- 2. E-mail provider webhook (Resend, signed with Svix)
-- ---------------------------------------------------------------------------

-- Every processed delivery once, by its svix-id (stays the same across retries). Kept 30 days.
create table if not exists public.email_webhook_events (
  webhook_id text primary key check (char_length(webhook_id) between 1 and 100),
  event_type text not null check (char_length(event_type) <= 60),
  provider_message_id text check (char_length(provider_message_id) <= 100),
  outcome text not null default 'pending' check (outcome in ('pending', 'ignored', 'unknown', 'bounced', 'complained')),
  received_at timestamptz not null default now()
);
create index if not exists email_webhook_events_received_idx on public.email_webhook_events(received_at);
alter table public.email_webhook_events enable row level security;
revoke all on public.email_webhook_events from public, anon, authenticated;

-- Returns ok (invitation marked and address suppressed), duplicate (webhook id seen before), ignored (not a hard
-- bounce or complaint), unknown (no invitation with this message id) or invalid.
create or replace function public.record_email_event(
  p_key text, p_webhook_id text, p_event text, p_message_id text, p_permanent boolean, p_subtype text)
returns text language plpgsql security definer set search_path = '' as $$
declare
  inv public.survey_invitations;
  v_org uuid;
  v_rows int;
  v_issue text;
  v_reason text;
  v_sub text := nullif(left(regexp_replace(coalesce(p_subtype, ''), '[^A-Za-z0-9 _-]', '', 'g'), 40), '');
begin
  if not public.ingest_key_ok(p_key) then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if coalesce(p_webhook_id, '') = '' or char_length(p_webhook_id) > 100 then
    return 'invalid';
  end if;
  delete from public.email_webhook_events where received_at < now() - interval '30 days';
  insert into public.email_webhook_events (webhook_id, event_type, provider_message_id)
  values (p_webhook_id, left(coalesce(p_event, ''), 60), left(p_message_id, 100))
  on conflict (webhook_id) do nothing;
  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    return 'duplicate';
  end if;

  v_issue := case
    when p_event = 'email.complained' then 'complained'
    when p_event = 'email.bounced' and coalesce(p_permanent, false) then 'bounced'
  end;
  if v_issue is null then
    update public.email_webhook_events set outcome = 'ignored' where webhook_id = p_webhook_id;
    return 'ignored';
  end if;

  select * into inv from public.survey_invitations i
  where coalesce(p_message_id, '') <> '' and (i.provider_message_id = p_message_id or i.reminder_message_id = p_message_id)
  limit 1;
  if inv.id is null then
    update public.email_webhook_events set outcome = 'unknown' where webhook_id = p_webhook_id;
    return 'unknown';
  end if;

  v_reason := case v_issue
    when 'bounced' then 'Onbestelbaar: de mailserver van de ontvanger weigert dit adres blijvend (harde bounce'
                        || coalesce(', ' || v_sub, '') || '). Niet opnieuw versturen.'
    else 'De ontvanger heeft de e-mail als spam gemeld. Dit adres krijgt geen e-mail meer van deze organisatie.'
  end;
  update public.survey_invitations set
    delivery_issue = v_issue,
    status = case when status in ('pending', 'sent', 'failed') then 'failed' else status end,
    error = case when status in ('pending', 'sent', 'failed') then left(v_reason, 300) else error end
  where id = inv.id;

  select org_id into v_org from public.ideas where id = inv.idea_id;
  if inv.email_hash is not null and v_org is not null then
    insert into public.email_suppressions (org_id, email_hash, reason) values (v_org, inv.email_hash, v_issue)
    on conflict do nothing;
  end if;
  update public.email_webhook_events set outcome = v_issue where webhook_id = p_webhook_id;
  return 'ok';
end $$;

-- ---------------------------------------------------------------------------
-- 3. Per-post link tracking (utm_content)
-- ---------------------------------------------------------------------------

-- A post code: lower-case letters, digits, dash and underscore, at most 40 characters. Anything else is dropped.
create or replace function public.clean_content(p text)
returns text language sql immutable set search_path = '' as $$
  select nullif(left(regexp_replace(lower(coalesce(p, '')), '[^a-z0-9_-]', '', 'g'), 40), '');
$$;

alter table public.survey_responses add column if not exists content text check (content ~ '^[a-z0-9_-]{1,40}$');
alter table public.test_events add column if not exists content text check (content ~ '^[a-z0-9_-]{1,40}$');

-- Every promo post has its own code; its link carries utm_content=<code>.
alter table public.promo_posts
  add column if not exists code text not null default ('p-' || substr(md5(gen_random_uuid()::text), 1, 6))
    check (code ~ '^[a-z0-9_-]{2,40}$');
update public.promo_posts set code = replace(platform, '_', '') || '-' || substr(md5(id::text), 1, 5)
where code like 'p-%';
create unique index if not exists promo_posts_code_uq on public.promo_posts(experiment_id, code);
-- Existing posts get the code in their link (posts that were already shared keep counting without one).
update public.promo_posts
set body = regexp_replace(body, '(\?utm_source=[a-z_]+)(&utm_content=[a-z0-9_-]+)?', '\1&utm_content=' || code, 'g')
where body ~ '\?utm_source=[a-z_]+' and body !~ 'utm_content='
  and char_length(regexp_replace(body, '(\?utm_source=[a-z_]+)', '\1&utm_content=' || code, 'g')) <= 3000;

-- The three ingest RPCs, as defined most recently (surveys.sql, integrity.sql), with one extra optional
-- parameter p_content. Behaviour is otherwise unchanged.

drop function if exists public.submit_survey(text, text, text, text, jsonb, boolean, int, text, text);
create or replace function public.submit_survey(
  p_key text, p_slug text, p_visitor text, p_channel text, p_answers jsonb, p_consent boolean,
  p_duration_ms int, p_token_hash text, p_rate_bucket text, p_content text default null)
returns text language plpgsql security definer set search_path = '' as $$
declare
  e public.experiments;
  inv public.survey_invitations;
  v_rows int;
begin
  if not public.ingest_key_ok(p_key) then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  select * into e from public.experiments where public_slug = p_slug and type = 'survey';
  if e.id is null or e.state <> 'live' or (e.ends_at is not null and now() > e.ends_at) then
    return 'closed';
  end if;
  if not coalesce(p_consent, false) then
    return 'consent';
  end if;
  if pg_column_size(coalesce(p_answers, '{}'::jsonb)) > 20000 or jsonb_typeof(coalesce(p_answers, '{}'::jsonb)) <> 'object' then
    return 'invalid';
  end if;
  if not public.ingest_allowed(coalesce(p_rate_bucket, '') || ':survey:' || p_slug) then
    return 'rate';
  end if;
  if p_token_hash is not null then
    select * into inv from public.survey_invitations where token_hash = p_token_hash and experiment_id = e.id;
    if inv.id is null or inv.status in ('unsubscribed') then
      return 'invalid';
    end if;
    if inv.status = 'responded' then
      return 'duplicate';
    end if;
  end if;
  insert into public.survey_responses (experiment_id, idea_id, visitor_hash, invitation_id, source, channel, answers, consent_given, duration_ms, content)
  values (e.id, e.idea_id, left(p_visitor, 64), inv.id,
          case when inv.id is null then 'open_link' else 'invitation' end,
          left(coalesce(nullif(p_channel, ''), case when inv.id is null then 'direct' else 'email' end), 40),
          p_answers, true, greatest(0, least(coalesce(p_duration_ms, 0), 86400000)),
          case when inv.id is null then public.clean_content(p_content) end)
  on conflict do nothing;
  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    return 'duplicate';
  end if;
  if inv.id is not null then
    update public.survey_invitations set status = 'responded', responded_at = now() where id = inv.id;
  end if;
  return 'ok';
end $$;

drop function if exists public.record_test_event(text, text, text, text, text, text, text);
create or replace function public.record_test_event(
  p_key text, p_slug text, p_visitor text, p_event text, p_variant text, p_channel text, p_rate_bucket text,
  p_content text default null)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  e public.experiments;
  v_rows int;
begin
  if not public.ingest_key_ok(p_key) then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  select * into e from public.experiments where public_slug = p_slug;
  if e.id is null or e.state <> 'live' or (e.ends_at is not null and now() > e.ends_at) then
    return false;
  end if;
  if p_event not in ('view', 'cta_click') then
    raise exception 'BAD_EVENT' using errcode = 'P0001';
  end if;
  if not public.ingest_allowed(coalesce(p_rate_bucket, '') || ':' || p_slug) then
    return false;
  end if;
  -- A click only counts after this visitor saw the page.
  if p_event = 'cta_click' and not exists (
    select 1 from public.test_events t
    where t.experiment_id = e.id and t.visitor_hash = left(p_visitor, 64) and t.event_type = 'view'
  ) then
    return false;
  end if;
  insert into public.test_events (experiment_id, idea_id, visitor_hash, event_type, variant, channel, content)
  values (e.id, e.idea_id, left(p_visitor, 64), p_event, left(coalesce(p_variant, 'a'), 12),
          left(coalesce(nullif(p_channel, ''), 'direct'), 40), public.clean_content(p_content))
  on conflict do nothing;
  get diagnostics v_rows = row_count;
  return v_rows > 0;
end $$;

drop function if exists public.submit_test_form(text, text, text, text, text, text, jsonb, boolean, text, text);
create or replace function public.submit_test_form(
  p_key text, p_slug text, p_visitor text, p_variant text, p_channel text,
  p_email text, p_answers jsonb, p_consent boolean, p_consent_text text, p_rate_bucket text, p_content text default null)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  e public.experiments;
  v_rows int;
begin
  if not public.ingest_key_ok(p_key) then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  select * into e from public.experiments where public_slug = p_slug;
  if e.id is null or e.state <> 'live' or (e.ends_at is not null and now() > e.ends_at) then
    return false;
  end if;
  if p_email is not null and not p_consent then
    raise exception 'CONSENT_REQUIRED' using errcode = 'P0001';
  end if;
  if not public.ingest_allowed(coalesce(p_rate_bucket, '') || ':' || p_slug) then
    return false;
  end if;
  -- A submission only counts after this visitor saw the page and clicked the call to action.
  if not exists (
    select 1 from public.test_events t
    where t.experiment_id = e.id and t.visitor_hash = left(p_visitor, 64) and t.event_type = 'cta_click'
  ) then
    return false;
  end if;
  if pg_column_size(coalesce(p_answers, '{}'::jsonb)) > 8000 then
    raise exception 'TOO_LARGE' using errcode = 'P0001';
  end if;
  insert into public.test_submissions (experiment_id, idea_id, visitor_hash, variant, channel, email, answers, consent_given, consent_text)
  values (e.id, e.idea_id, left(p_visitor, 64), left(coalesce(p_variant, 'a'), 12),
          left(coalesce(nullif(p_channel, ''), 'direct'), 40),
          case when p_consent then left(lower(btrim(p_email)), 254) else null end,
          coalesce(p_answers, '{}'::jsonb), coalesce(p_consent, false), left(p_consent_text, 600))
  on conflict (experiment_id, visitor_hash) do nothing;
  get diagnostics v_rows = row_count;
  insert into public.test_events (experiment_id, idea_id, visitor_hash, event_type, variant, channel, content)
  values (e.id, e.idea_id, left(p_visitor, 64), 'submit', left(coalesce(p_variant, 'a'), 12),
          left(coalesce(nullif(p_channel, ''), 'direct'), 40), public.clean_content(p_content))
  on conflict do nothing;
  return v_rows > 0;
end $$;

-- Key answers for everyone on the dossier, now with the post code (no personal data).
drop function if exists public.survey_key_answers(uuid);
create or replace function public.survey_key_answers(p_experiment uuid)
returns table (id uuid, source text, channel text, duration_ms int, created_at timestamptz, key_answer jsonb, content text)
language sql stable security definer set search_path = '' as $$
  select r.id, r.source, r.channel, r.duration_ms, r.created_at,
         case when jsonb_typeof(r.answers -> (e.config ->> 'key_question')) in ('string', 'array')
              then r.answers -> (e.config ->> 'key_question') end,
         r.content
  from public.survey_responses r
  join public.experiments e on e.id = r.experiment_id
  where r.experiment_id = p_experiment and e.type = 'survey' and public.can_read_idea(e.idea_id)
  order by r.created_at, r.id;
$$;

-- Distinct visitors per post code (the code of their first view), counted in the database like
-- experiment_event_counts. Runs with the caller's rights: row level security applies.
create or replace function public.experiment_content_counts(p_experiment uuid)
returns table (content text, viewers bigint, clickers bigint, submitters bigint)
language sql stable set search_path = '' as $$
  with v as (
    select distinct on (visitor_hash) visitor_hash, content
    from public.test_events
    where experiment_id = p_experiment and event_type = 'view'
    order by visitor_hash, created_at
  )
  select v.content, count(*),
    count(*) filter (where exists (select 1 from public.test_events c where c.experiment_id = p_experiment and c.visitor_hash = v.visitor_hash and c.event_type = 'cta_click')),
    count(*) filter (where exists (select 1 from public.test_events s where s.experiment_id = p_experiment and s.visitor_hash = v.visitor_hash and s.event_type = 'submit'))
  from v
  group by v.content;
$$;

-- ---------------------------------------------------------------------------
-- 4. Expandi campaign webhooks (consultants only)
-- ---------------------------------------------------------------------------

-- The "Assign people by using a webhook" URL of one Expandi campaign. The URL itself is the credential, so it is
-- readable only by consultants of the organisation, never by clients, and it is not copied into the audit trail.
create table if not exists public.expandi_campaign_hooks (
  experiment_id uuid primary key references public.experiments(id) on delete cascade,
  idea_id uuid not null references public.ideas(id) on delete cascade,
  url text not null check (char_length(url) between 12 and 600 and url ~ '^https://'),
  label text check (char_length(label) <= 120),
  pushed_count int not null default 0 check (pushed_count >= 0),
  last_push_at timestamptz,
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists expandi_campaign_hooks_idea_idx on public.expandi_campaign_hooks(idea_id);
create index if not exists expandi_campaign_hooks_created_by_fk on public.expandi_campaign_hooks(created_by);
alter table public.expandi_campaign_hooks enable row level security;
drop policy if exists expandi_campaign_hooks_all on public.expandi_campaign_hooks;
create policy expandi_campaign_hooks_all on public.expandi_campaign_hooks for all to authenticated
  using (public.can_write_idea(idea_id)) with check (public.can_write_idea(idea_id));
drop trigger if exists expandi_campaign_hooks_refs on public.expandi_campaign_hooks;
create trigger expandi_campaign_hooks_refs before insert or update on public.expandi_campaign_hooks
  for each row execute function public.check_idea_refs('experiment_id', 'experiments');
revoke all on public.expandi_campaign_hooks from public, anon, authenticated;
grant select, insert, update, delete on public.expandi_campaign_hooks to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Data-subject requests (inzage, export en verwijdering)
-- ---------------------------------------------------------------------------

-- Everything this organisation holds under one e-mail address. p_hashes are the HMACs of the address under every
-- known salt version (computed by the app server, which holds the salts). Owners only; only rows of p_org.
create or replace function public.dsr_search(p_org uuid, p_email text, p_hashes text[])
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_hashes text[];
  out jsonb;
begin
  if (select auth.uid()) is null or not public.is_org_owner(p_org) then
    raise exception 'FORBIDDEN: alleen eigenaren van de werkruimte behandelen privacyverzoeken' using errcode = 'P0001';
  end if;
  if char_length(v_email) > 254 or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'INVALID_EMAIL' using errcode = 'P0001';
  end if;
  v_hashes := coalesce(array(select h from unnest(coalesce(p_hashes, '{}')) h where h ~ '^[a-f0-9]{64}$' limit 10), '{}');

  out := jsonb_build_object(
    'email', v_email,
    'searched_at', now(),
    'survey_invitations', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', i.id, 'idea', d.title, 'experiment', e.title, 'email', i.email, 'status', i.status,
        'delivery_issue', i.delivery_issue, 'error', i.error, 'created_at', i.created_at, 'sent_at', i.sent_at,
        'reminded_at', i.reminded_at, 'responded_at', i.responded_at, 'retention_until', i.retention_until,
        'response', (select jsonb_build_object('id', r.id, 'created_at', r.created_at, 'source', r.source,
                       'channel', r.channel, 'answers', r.answers, 'retention_until', r.retention_until)
                     from public.survey_responses r where r.invitation_id = i.id)
      ) order by i.created_at), '[]'::jsonb)
      from public.survey_invitations i
      join public.ideas d on d.id = i.idea_id
      join public.experiments e on e.id = i.experiment_id
      where d.org_id = p_org and (i.email = v_email or i.email_hash = any(v_hashes))),
    'test_submissions', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', s.id, 'idea', d.title, 'experiment', e.title, 'email', s.email, 'answers', s.answers,
        'channel', s.channel, 'consent_text', s.consent_text, 'created_at', s.created_at, 'retention_until', s.retention_until
      ) order by s.created_at), '[]'::jsonb)
      from public.test_submissions s
      join public.ideas d on d.id = s.idea_id
      join public.experiments e on e.id = s.experiment_id
      where d.org_id = p_org and s.email = v_email),
    'email_suppressions', (
      select coalesce(jsonb_agg(jsonb_build_object('created_at', x.created_at, 'reason', x.reason) order by x.created_at), '[]'::jsonb)
      from public.email_suppressions x where x.org_id = p_org and x.email_hash = any(v_hashes)),
    'interviews', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', iv.id, 'idea', d.title, 'experiment', e.title, 'participant_label', iv.participant_label,
        'held_on', iv.held_on, 'label_is_email', lower(iv.participant_label) = v_email,
        'transcript_mentions_email', strpos(lower(iv.transcript), v_email) > 0
      ) order by iv.held_on), '[]'::jsonb)
      from public.interviews iv
      join public.ideas d on d.id = iv.idea_id
      join public.experiments e on e.id = iv.experiment_id
      where d.org_id = p_org and (lower(iv.participant_label) = v_email or strpos(lower(iv.transcript), v_email) > 0)),
    'team_account', (
      select coalesce(jsonb_agg(jsonb_build_object('full_name', p.full_name, 'role', m.role, 'member_since', m.created_at)), '[]'::jsonb)
      from public.profiles p join public.organization_members m on m.user_id = p.user_id and m.org_id = p_org
      where lower(p.email) = v_email),
    'client_access', (
      select coalesce(jsonb_agg(jsonb_build_object('idea', d.title, 'role', im.role, 'invited_at', im.created_at,
                                                   'account_linked', im.user_id is not null) order by im.created_at), '[]'::jsonb)
      from public.idea_members im join public.ideas d on d.id = im.idea_id
      where d.org_id = p_org and lower(im.email) = v_email)
  );
  -- The request itself is logged, without the address.
  insert into public.audit_events (org_id, actor_id, table_name, row_id, action, detail)
  values (p_org, auth.uid(), 'privacy_requests', gen_random_uuid()::text, 'dsr_search', jsonb_build_object(
    'invitations', jsonb_array_length(out->'survey_invitations'), 'submissions', jsonb_array_length(out->'test_submissions'),
    'suppressions', jsonb_array_length(out->'email_suppressions'), 'interviews', jsonb_array_length(out->'interviews')));
  return out;
end $$;

-- Erasure: invitation addresses anonymised (as the retention purge does), answers given through those invitations
-- deleted, e-mail and answers of test sign-ups removed, earlier audit copies of those rows reduced to a marker.
-- Optionally the address hash goes on the do-not-mail list. Interviews and accounts are not touched (see the page).
create or replace function public.dsr_erase(p_org uuid, p_email text, p_hashes text[], p_suppress boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_hashes text[];
  v_inv uuid[];
  v_resp text[];
  v_sub text[];
  v_suppressed int := 0;
  v_anon int := 0;
begin
  if (select auth.uid()) is null or not public.is_org_owner(p_org) then
    raise exception 'FORBIDDEN: alleen eigenaren van de werkruimte behandelen privacyverzoeken' using errcode = 'P0001';
  end if;
  if char_length(v_email) > 254 or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'INVALID_EMAIL' using errcode = 'P0001';
  end if;
  v_hashes := coalesce(array(select h from unnest(coalesce(p_hashes, '{}')) h where h ~ '^[a-f0-9]{64}$' limit 10), '{}');

  select coalesce(array_agg(i.id), '{}') into v_inv
  from public.survey_invitations i join public.ideas d on d.id = i.idea_id
  where d.org_id = p_org and (i.email = v_email or i.email_hash = any(v_hashes));

  with del as (delete from public.survey_responses r where r.invitation_id = any(v_inv) returning r.id)
  select coalesce(array_agg(id::text), '{}') into v_resp from del;

  update public.survey_invitations set
    email = case when email like 'verwijderd-%' then email else 'verwijderd-' || id::text || '@invalid' end,
    -- The do-not-mail entry (optional, below) lives in email_suppressions; the invitation keeps nothing.
    email_hash = null
  where id = any(v_inv);
  get diagnostics v_anon = row_count;

  with upd as (
    update public.test_submissions s set email = null, answers = '{}'::jsonb
    from public.ideas d
    where d.id = s.idea_id and d.org_id = p_org and s.email = v_email
    returning s.id)
  select coalesce(array_agg(id::text), '{}') into v_sub from upd;

  if coalesce(p_suppress, false) and array_length(v_hashes, 1) > 0 then
    insert into public.email_suppressions (org_id, email_hash, reason) values (p_org, v_hashes[1], 'erasure')
    on conflict do nothing;
    get diagnostics v_suppressed = row_count;
  end if;

  -- Audit copies of these rows can contain the address or the answers: keep the event, drop the content.
  update public.audit_events a set detail = jsonb_build_object('gewist', 'privacyverzoek')
  where a.org_id = p_org and a.detail is not null and (
    (a.table_name = 'survey_invitations' and a.row_id = any(array(select x::text from unnest(v_inv) x)))
    or (a.table_name = 'survey_responses' and a.row_id = any(v_resp))
    or (a.table_name = 'test_submissions' and a.row_id = any(v_sub)));

  insert into public.audit_events (org_id, actor_id, table_name, row_id, action, detail)
  values (p_org, auth.uid(), 'privacy_requests', gen_random_uuid()::text, 'dsr_erase', jsonb_build_object(
    'invitations', v_anon, 'responses', coalesce(array_length(v_resp, 1), 0), 'submissions', coalesce(array_length(v_sub, 1), 0),
    'suppressed', v_suppressed > 0));
  return jsonb_build_object('invitations', v_anon, 'responses', coalesce(array_length(v_resp, 1), 0),
                            'submissions', coalesce(array_length(v_sub, 1), 0), 'suppressed', v_suppressed > 0);
end $$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

revoke execute on function
  public.guard_invitation_delivery(), public.clean_content(text),
  public.record_email_event(text, text, text, text, boolean, text),
  public.submit_survey(text, text, text, text, jsonb, boolean, int, text, text, text),
  public.record_test_event(text, text, text, text, text, text, text, text),
  public.submit_test_form(text, text, text, text, text, text, jsonb, boolean, text, text, text),
  public.survey_key_answers(uuid), public.experiment_content_counts(uuid),
  public.dsr_search(uuid, text, text[]), public.dsr_erase(uuid, text, text[], boolean)
  from public, anon, authenticated;
grant execute on function
  public.record_email_event(text, text, text, text, boolean, text),
  public.submit_survey(text, text, text, text, jsonb, boolean, int, text, text, text)
  to anon;
grant execute on function
  public.record_test_event(text, text, text, text, text, text, text, text),
  public.submit_test_form(text, text, text, text, text, text, jsonb, boolean, text, text, text)
  to anon, authenticated;
grant execute on function
  public.survey_key_answers(uuid), public.experiment_content_counts(uuid),
  public.dsr_search(uuid, text, text[]), public.dsr_erase(uuid, text, text[], boolean)
  to authenticated;
