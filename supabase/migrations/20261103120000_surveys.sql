-- Surveys as a fourth experiment type: a locked Test Card with a pre-registered key question, a public page per
-- channel and personal e-mail invitations. Answers from invitations come from known people; answers from an open
-- link are kept apart, because AI agents fill in open online surveys convincingly.

-- ---------------------------------------------------------------------------
-- 1. Types
-- ---------------------------------------------------------------------------

alter table public.experiments drop constraint if exists experiments_type_check;
alter table public.experiments add constraint experiments_type_check check (type in ('landing', 'interview', 'pricing', 'survey'));

alter table public.observations drop constraint if exists observations_kind_check;
alter table public.observations add constraint observations_kind_check check (kind in
  ('problem_confirmed', 'problem_absent', 'current_behaviour', 'current_spend', 'counter_example',
   'objection', 'waitlist_signup', 'demo_request', 'quote_request', 'deposit', 'repeat_purchase', 'opinion',
   'survey_answer', 'other'));

alter table public.sources drop constraint if exists sources_source_type_check;
alter table public.sources add constraint sources_source_type_check check (source_type in
  ('official_statistic', 'primary_document', 'company_page', 'research_report', 'news', 'review_site', 'blog',
   'forum', 'outreach', 'survey', 'dataset_upload', 'interview', 'other'));

-- Surveys get a public link on approval, like landing and pricing tests.
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
    return new;
  end if;

  new.idea_id := old.idea_id;
  new.approved_by := old.approved_by; new.approved_at := old.approved_at;
  new.started_at := old.started_at; new.ends_at := old.ends_at; new.ended_at := old.ended_at;
  new.ended_early := old.ended_early; new.public_slug := old.public_slug;

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

    if new.state = 'approved' then
      select * into h from public.hypotheses where id = new.hypothesis_id;
      if h.superseded_by is not null then
        raise exception 'EXPERIMENT_STATE: hypothese is vervangen door een nieuwere versie' using errcode = 'P0001';
      end if;
      update public.hypotheses set locked_at = coalesce(locked_at, now()) where id = new.hypothesis_id;
      new.approved_by := auth.uid();
      new.approved_at := now();
      if new.type in ('landing', 'pricing', 'survey') and new.public_slug is null then
        new.public_slug := lower(substr(replace(gen_random_uuid()::text, '-', ''), 1, 14));
      end if;
    end if;

    if new.state = 'draft' and old.state = 'approved' then
      new.approved_by := null;
      new.approved_at := null;
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

-- ---------------------------------------------------------------------------
-- 2. Responses and invitations
-- ---------------------------------------------------------------------------

create table public.survey_invitations (
  id uuid primary key default gen_random_uuid(),
  experiment_id uuid not null references public.experiments(id) on delete cascade,
  idea_id uuid not null references public.ideas(id) on delete cascade,
  email text not null check (char_length(email) <= 254 and email = lower(email)),
  token_hash text not null unique,
  -- HMAC of the address (app salt): unsubscribing suppresses this stored hash, not one supplied by the caller.
  email_hash text check (char_length(email_hash) <= 64),
  status text not null default 'pending' check (status in ('pending', 'sent', 'failed', 'responded', 'unsubscribed')),
  error text check (char_length(error) <= 300),
  sent_at timestamptz,
  reminded_at timestamptz,
  responded_at timestamptz,
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  retention_until date not null default (current_date + 180),
  unique (experiment_id, email)
);
create index survey_invitations_idea_idx on public.survey_invitations(idea_id);
create index survey_invitations_created_by_fk on public.survey_invitations(created_by);
alter table public.survey_invitations enable row level security;
create policy survey_invitations_select on public.survey_invitations for select to authenticated using (public.can_write_idea(idea_id));
create policy survey_invitations_insert on public.survey_invitations for insert to authenticated
  with check (public.can_write_idea(idea_id) and status = 'pending');
-- Consultants record the sending result; responding and unsubscribing only happen through the RPCs.
create policy survey_invitations_update on public.survey_invitations for update to authenticated
  using (public.can_write_idea(idea_id)) with check (public.can_write_idea(idea_id) and status in ('pending', 'sent', 'failed'));
create policy survey_invitations_delete on public.survey_invitations for delete to authenticated
  using (public.can_write_idea(idea_id) and status in ('pending', 'failed'));

-- People who unsubscribed are never mailed again by this organisation (hash of the address only).
create table public.email_suppressions (
  org_id uuid not null references public.organizations(id) on delete cascade,
  email_hash text not null,
  created_at timestamptz not null default now(),
  primary key (org_id, email_hash)
);
alter table public.email_suppressions enable row level security;
create policy email_suppressions_select on public.email_suppressions for select to authenticated using (public.is_org_member(org_id));

create table public.survey_responses (
  id uuid primary key default gen_random_uuid(),
  experiment_id uuid not null references public.experiments(id) on delete cascade,
  idea_id uuid not null references public.ideas(id) on delete cascade,
  visitor_hash text not null,
  invitation_id uuid references public.survey_invitations(id) on delete set null,
  source text not null check (source in ('invitation', 'open_link')),
  channel text not null default 'direct' check (char_length(channel) <= 40),
  answers jsonb not null check (jsonb_typeof(answers) = 'object' and pg_column_size(answers) <= 20000),
  consent_given boolean not null,
  duration_ms int check (duration_ms >= 0),
  created_at timestamptz not null default now(),
  retention_until date not null default (current_date + 365),
  unique (experiment_id, visitor_hash)
);
create unique index survey_responses_one_per_invitation on public.survey_responses(invitation_id) where invitation_id is not null;
create index survey_responses_exp_idx on public.survey_responses(experiment_id);
create index survey_responses_idea_idx on public.survey_responses(idea_id);
alter table public.survey_responses enable row level security;
create policy survey_responses_select on public.survey_responses for select to authenticated using (public.can_write_idea(idea_id));
create policy survey_responses_delete on public.survey_responses for delete to authenticated using (public.can_write_idea(idea_id));
-- Responses only arrive through submit_survey(); they are never edited.

-- Social posts and invitation texts generated for a published test (any type with a public link).
create table public.promo_posts (
  id uuid primary key default gen_random_uuid(),
  experiment_id uuid not null references public.experiments(id) on delete cascade,
  idea_id uuid not null references public.ideas(id) on delete cascade,
  platform text not null check (platform in ('linkedin', 'linkedin_dm', 'instagram', 'facebook', 'x', 'whatsapp', 'email', 'newsletter')),
  body text not null check (char_length(body) between 10 and 3000),
  origin text not null default 'ai' check (origin in ('ai', 'template', 'manual')),
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now()
);
create index promo_posts_exp_idx on public.promo_posts(experiment_id);
create index promo_posts_idea_idx on public.promo_posts(idea_id);
create index promo_posts_created_by_fk on public.promo_posts(created_by);
alter table public.promo_posts enable row level security;
create policy promo_posts_all on public.promo_posts for all to authenticated
  using (public.can_write_idea(idea_id)) with check (public.can_write_idea(idea_id));

create trigger survey_invitations_refs before insert or update on public.survey_invitations
  for each row execute function public.check_idea_refs('experiment_id', 'experiments');
create trigger promo_posts_refs before insert or update on public.promo_posts
  for each row execute function public.check_idea_refs('experiment_id', 'experiments');

-- ---------------------------------------------------------------------------
-- 3. Public RPCs (called by the app server with the ingest secret)
-- ---------------------------------------------------------------------------

-- The questions of a live survey; for an invitation also whether it can still be used.
create or replace function public.get_public_survey(p_slug text, p_token_hash text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    -- The pre-registered key question and success options stay out of the respondent's view.
    'id', e.id, 'state', e.state, 'config', e.config - 'key_question' - 'success_options', 'ends_at', e.ends_at,
    'invitation', case when p_token_hash is null then null else (
      select jsonb_build_object('status', i.status) from public.survey_invitations i
      where i.token_hash = p_token_hash and i.experiment_id = e.id) end)
  from public.experiments e
  where e.public_slug = p_slug and e.type = 'survey' and e.state in ('approved', 'live', 'paused', 'ended', 'analyzed', 'decided');
$$;

create or replace function public.submit_survey(
  p_key text, p_slug text, p_visitor text, p_channel text, p_answers jsonb, p_consent boolean,
  p_duration_ms int, p_token_hash text, p_rate_bucket text)
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
  insert into public.survey_responses (experiment_id, idea_id, visitor_hash, invitation_id, source, channel, answers, consent_given, duration_ms)
  values (e.id, e.idea_id, left(p_visitor, 64), inv.id,
          case when inv.id is null then 'open_link' else 'invitation' end,
          left(coalesce(nullif(p_channel, ''), case when inv.id is null then 'direct' else 'email' end), 40),
          p_answers, true, greatest(0, least(coalesce(p_duration_ms, 0), 86400000)))
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

create or replace function public.unsubscribe_invitation(p_key text, p_token_hash text, p_email_hash text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  inv public.survey_invitations;
  v_org uuid;
begin
  if not public.ingest_key_ok(p_key) then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  select * into inv from public.survey_invitations where token_hash = p_token_hash;
  if inv.id is null then
    return false;
  end if;
  select org_id into v_org from public.ideas where id = inv.idea_id;
  update public.survey_invitations set status = 'unsubscribed' where id = inv.id and status <> 'responded';
  insert into public.email_suppressions (org_id, email_hash) values (v_org, left(coalesce(inv.email_hash, p_email_hash), 64)) on conflict do nothing;
  return true;
end $$;

-- Distinct answers per question are counted in the app from the rows; the database only guarantees one
-- response per visitor and per invitation.

-- ---------------------------------------------------------------------------
-- 4. Retention, audit, grants
-- ---------------------------------------------------------------------------

create or replace function public.purge_expired_personal_data()
returns int language plpgsql security definer set search_path = '' as $$
declare v1 int; v2 int; v3 int; v4 int;
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
  -- Invitation addresses go after 180 days; the (anonymous) answers stay, open texts go after a year.
  update public.survey_invitations set email = 'verwijderd-' || id::text || '@invalid'
  where retention_until < current_date and email not like 'verwijderd-%';
  get diagnostics v4 = row_count;
  update public.survey_responses set answers = (
      select coalesce(jsonb_object_agg(k, case when jsonb_typeof(v) = 'string' and length(v #>> '{}') > 40 then to_jsonb('[verwijderd]'::text) else v end), '{}'::jsonb)
      from jsonb_each(answers) as t(k, v))
  where retention_until < current_date;
  return v1 + v2 + v3 + v4;
end $$;

do $$
declare t text;
begin
  foreach t in array array['survey_invitations', 'survey_responses', 'promo_posts'] loop
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function public.audit_row()', t || '_audit', t);
  end loop;
end $$;

revoke all on public.survey_invitations, public.email_suppressions, public.survey_responses, public.promo_posts from anon;
grant select, insert, update, delete on public.survey_invitations, public.promo_posts to authenticated;
grant select, delete on public.survey_responses to authenticated;
grant select on public.email_suppressions to authenticated;
revoke execute on function public.get_public_survey(text, text), public.submit_survey(text, text, text, text, jsonb, boolean, int, text, text),
  public.unsubscribe_invitation(text, text, text) from public, authenticated;
grant execute on function public.get_public_survey(text, text), public.submit_survey(text, text, text, text, jsonb, boolean, int, text, text),
  public.unsubscribe_invitation(text, text, text) to anon;
