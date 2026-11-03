-- Durable background jobs. Long work (sending survey invitations and reminders) no longer depends on a browser
-- tab: a consultant enqueues a job, a worker (Vercel Cron → /api/jobs/run, or a kick right after enqueue) claims
-- it with FOR UPDATE SKIP LOCKED and runs it in slices. The app has no service-role key, so the worker talks to
-- the database only through the SECURITY DEFINER functions below, guarded by the ingest secret (ingest_key_ok).
-- Consultants of the dossier see their jobs (can_write_idea) and can cancel them; nobody edits a job directly.

-- ---------------------------------------------------------------------------
-- 1. Table
-- ---------------------------------------------------------------------------

create table public.jobs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  idea_id uuid not null references public.ideas(id) on delete cascade,
  kind text not null check (kind in ('survey_invite', 'survey_reminder')),
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object' and pg_column_size(payload) <= 1000000),
  -- At most one queued or running job per key (e.g. one e-mail send per survey at a time).
  dedupe_key text check (char_length(dedupe_key) <= 200),
  status text not null default 'queued' check (status in ('queued', 'running', 'done', 'failed', 'cancelled')),
  attempts int not null default 0 check (attempts >= 0),
  max_attempts int not null default 5 check (max_attempts between 1 and 20),
  run_after timestamptz not null default now(),
  locked_until timestamptz,
  last_error text check (char_length(last_error) <= 500),
  progress jsonb not null default '{}'::jsonb check (jsonb_typeof(progress) = 'object' and pg_column_size(progress) <= 8000),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  cancelled_by uuid references auth.users(id) on delete set null
);
create index jobs_queued_idx on public.jobs(run_after, created_at) where status = 'queued';
create index jobs_running_idx on public.jobs(locked_until) where status = 'running';
create index jobs_idea_idx on public.jobs(idea_id, created_at desc);
create index jobs_org_idx on public.jobs(org_id);
create index jobs_created_by_fk on public.jobs(created_by);
create index jobs_cancelled_by_fk on public.jobs(cancelled_by);
create unique index jobs_active_dedupe on public.jobs(dedupe_key) where status in ('queued', 'running') and dedupe_key is not null;

alter table public.jobs enable row level security;
create policy jobs_select on public.jobs for select to authenticated using (public.can_write_idea(idea_id));
-- No insert/update/delete policies: enqueue_job, cancel_job and the worker functions are the only writers.

-- A finished job is final, and personal data in the payload (names for the greeting) leaves with it.
create or replace function public.guard_job()
returns trigger language plpgsql set search_path = '' as $$
begin
  if old.status in ('done', 'failed', 'cancelled') and new.status is distinct from old.status then
    raise exception 'JOB_FINAL: een afgeronde taak kan niet opnieuw starten' using errcode = 'P0001';
  end if;
  new.id := old.id; new.org_id := old.org_id; new.idea_id := old.idea_id; new.kind := old.kind;
  new.created_by := old.created_by; new.created_at := old.created_at;
  if new.status in ('done', 'failed', 'cancelled') then
    new.payload := new.payload - 'names';
    new.finished_at := coalesce(new.finished_at, now());
    new.locked_until := null;
  end if;
  return new;
end $$;
create trigger jobs_guard before update on public.jobs for each row execute function public.guard_job();

-- ---------------------------------------------------------------------------
-- 2. Consultant RPCs
-- ---------------------------------------------------------------------------

-- Returns {"id": …, "created": true} or, when the same work is already queued or running, that job's id with
-- created = false (nothing new is enqueued).
create or replace function public.enqueue_job(p_idea uuid, p_kind text, p_payload jsonb, p_dedupe text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  v_org uuid;
begin
  if auth.uid() is null or not public.can_write_idea(p_idea) then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if p_kind not in ('survey_invite', 'survey_reminder') then
    raise exception 'JOB_KIND: onbekende taak' using errcode = 'P0001';
  end if;
  if p_dedupe is not null then
    select id into v_id from public.jobs where dedupe_key = p_dedupe and status in ('queued', 'running');
    if v_id is not null then
      return jsonb_build_object('id', v_id, 'created', false);
    end if;
  end if;
  select org_id into v_org from public.ideas where id = p_idea;
  begin
    insert into public.jobs (org_id, idea_id, kind, payload, dedupe_key, created_by)
    values (v_org, p_idea, p_kind, coalesce(p_payload, '{}'::jsonb), left(p_dedupe, 200), auth.uid())
    returning id into v_id;
  exception when unique_violation then
    select id into v_id from public.jobs where dedupe_key = p_dedupe and status in ('queued', 'running');
    return jsonb_build_object('id', v_id, 'created', false);
  end;
  return jsonb_build_object('id', v_id, 'created', true);
end $$;

-- Stop a queued or running job. A running handler notices at its next step (claims check the job status).
create or replace function public.cancel_job(p_job uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare j public.jobs;
begin
  select * into j from public.jobs where id = p_job;
  if j.id is null or auth.uid() is null or not public.can_write_idea(j.idea_id) then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  update public.jobs set status = 'cancelled', cancelled_by = auth.uid(), finished_at = now()
  where id = p_job and status in ('queued', 'running');
  return found;
end $$;

-- ---------------------------------------------------------------------------
-- 3. Worker RPCs (app server with the ingest secret)
-- ---------------------------------------------------------------------------

-- Claims up to p_limit due jobs: queued ones whose run_after has passed, and running ones whose lease ran out
-- (the worker died). Each claim counts as an attempt; a lease that ran out after the last attempt fails the job.
create or replace function public.claim_jobs(p_key text, p_limit int, p_lease_seconds int)
returns setof public.jobs language plpgsql security definer set search_path = '' as $$
begin
  if not public.ingest_key_ok(p_key) then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  update public.jobs j set status = 'failed', last_error = left(coalesce(j.last_error || ' · ', '') || 'Time-out: de verwerking stopte onverwacht.', 500)
  where j.id in (
    select x.id from public.jobs x
    where x.status = 'running' and x.locked_until < now() and x.attempts >= x.max_attempts
    for update skip locked);
  return query
  with picked as (
    select x.id from public.jobs x
    where (x.status = 'queued' and x.run_after <= now())
       or (x.status = 'running' and x.locked_until < now() and x.attempts < x.max_attempts)
    order by x.run_after, x.created_at
    limit greatest(1, least(coalesce(p_limit, 1), 10))
    for update skip locked)
  update public.jobs j
  set status = 'running', attempts = j.attempts + 1, started_at = coalesce(j.started_at, now()),
      locked_until = now() + make_interval(secs => greatest(30, least(coalesce(p_lease_seconds, 120), 900)))
  from picked where j.id = picked.id
  returning j.*;
end $$;

-- Extends the lease and stores progress; returns the job's status so a handler can stop when it was cancelled.
create or replace function public.job_heartbeat(p_key text, p_job uuid, p_progress jsonb, p_lease_seconds int)
returns text language plpgsql security definer set search_path = '' as $$
declare v_status text;
begin
  if not public.ingest_key_ok(p_key) then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  update public.jobs set progress = coalesce(p_progress, progress),
    locked_until = now() + make_interval(secs => greatest(30, least(coalesce(p_lease_seconds, 120), 900)))
  where id = p_job and status = 'running';
  select status into v_status from public.jobs where id = p_job;
  return v_status;
end $$;

-- Outcome of one run: done, yield (time slice used up: back in the queue at once, no attempt counted), retry
-- (after p_delay_seconds, unless the attempts are used up) or failed. A cancelled job stays cancelled; only its
-- final progress is kept. Returns the resulting status.
create or replace function public.complete_job(p_key text, p_job uuid, p_outcome text, p_error text, p_progress jsonb, p_delay_seconds int)
returns text language plpgsql security definer set search_path = '' as $$
declare
  j public.jobs;
  v_status text;
begin
  if not public.ingest_key_ok(p_key) then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if p_outcome not in ('done', 'yield', 'retry', 'failed') then
    raise exception 'JOB_OUTCOME' using errcode = 'P0001';
  end if;
  select * into j from public.jobs where id = p_job for update;
  if j.id is null then
    return null;
  end if;
  if j.status <> 'running' then
    if j.status = 'cancelled' and p_progress is not null then
      update public.jobs set progress = p_progress where id = p_job;
    end if;
    return j.status;
  end if;
  v_status := case
    when p_outcome = 'done' then 'done'
    when p_outcome = 'failed' then 'failed'
    when p_outcome = 'retry' and j.attempts >= j.max_attempts then 'failed'
    else 'queued' end;
  update public.jobs set
    status = v_status,
    progress = coalesce(p_progress, progress),
    last_error = case when p_error is null then last_error else left(p_error, 500) end,
    attempts = case when p_outcome = 'yield' then greatest(attempts - 1, 0) else attempts end,
    run_after = case when v_status = 'queued' then now() + make_interval(secs => greatest(0, least(coalesce(p_delay_seconds, 0), 86400))) else run_after end,
    locked_until = null
  where id = p_job;
  return v_status;
end $$;

-- Survey e-mail jobs: the experiment and the state of the requested invitations (only ids listed in the job's
-- payload, only for the job's own survey).
create or replace function public.job_survey_batch(p_key text, p_job uuid, p_ids uuid[])
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  j public.jobs;
  e public.experiments;
begin
  if not public.ingest_key_ok(p_key) then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  select * into j from public.jobs where id = p_job;
  if j.id is null or j.status <> 'running' or j.kind not in ('survey_invite', 'survey_reminder') then
    return null;
  end if;
  select * into e from public.experiments where id = (j.payload ->> 'experiment_id')::uuid and idea_id = j.idea_id;
  if e.id is null then
    return jsonb_build_object('experiment', null, 'items', '[]'::jsonb);
  end if;
  return jsonb_build_object(
    'experiment', jsonb_build_object('id', e.id, 'type', e.type, 'state', e.state, 'slug', e.public_slug, 'config', e.config, 'ends_at', e.ends_at),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', i.id, 'email', i.email, 'status', i.status, 'sent_at', i.sent_at, 'reminded_at', i.reminded_at, 'error', i.error,
        'suppressed', exists (select 1 from public.email_suppressions s where s.org_id = j.org_id and s.email_hash = i.email_hash)))
      from public.survey_invitations i
      where i.experiment_id = e.id and i.id = any(p_ids) and (j.payload -> 'ids') ? i.id::text), '[]'::jsonb));
end $$;

-- Per-invitation step of a survey e-mail job. 'claim' is the conditional update that guarantees one mail per
-- invitation (invite: pending/failed → sent; reminder: reminded_at null → now, at least three days after the
-- first mail); it only succeeds while the job runs and the survey is live. 'fail' records a refused mail,
-- 'release' undoes a claim after a temporary error, 'suppress' handles an address on the unsubscribe list.
-- Returns the claim time (or now() for the other actions) when a row changed, else null.
create or replace function public.job_survey_mark(p_key text, p_job uuid, p_invitation uuid, p_action text, p_error text)
returns timestamptz language plpgsql security definer set search_path = '' as $$
declare
  j public.jobs;
  v_exp uuid;
  v_at timestamptz;
begin
  if not public.ingest_key_ok(p_key) then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if p_action not in ('claim', 'fail', 'release', 'suppress') then
    raise exception 'JOB_ACTION' using errcode = 'P0001';
  end if;
  select * into j from public.jobs where id = p_job;
  if j.id is null or j.kind not in ('survey_invite', 'survey_reminder') or not ((j.payload -> 'ids') ? p_invitation::text) then
    return null;
  end if;
  -- Undoing a claim stays possible after a cancel; starting new work does not.
  if j.status <> 'running' and p_action in ('claim', 'suppress') then
    return null;
  end if;
  select e.id into v_exp from public.experiments e where e.id = (j.payload ->> 'experiment_id')::uuid and e.idea_id = j.idea_id;
  if v_exp is null then
    return null;
  end if;
  if p_action = 'claim' and not exists (
      select 1 from public.experiments e where e.id = v_exp and e.state = 'live' and (e.ends_at is null or now() < e.ends_at)) then
    return null;
  end if;

  if j.kind = 'survey_invite' then
    if p_action = 'claim' then
      update public.survey_invitations set status = 'sent', sent_at = now(), error = null
      where id = p_invitation and experiment_id = v_exp and status in ('pending', 'failed') returning sent_at into v_at;
    elsif p_action = 'fail' then
      update public.survey_invitations set status = 'failed', sent_at = null, error = left(coalesce(p_error, 'Niet verstuurd.'), 300)
      where id = p_invitation and experiment_id = v_exp and status = 'sent' returning now() into v_at;
    elsif p_action = 'release' then
      update public.survey_invitations set status = 'pending', sent_at = null, error = null
      where id = p_invitation and experiment_id = v_exp and status = 'sent' returning now() into v_at;
    else
      delete from public.survey_invitations
      where id = p_invitation and experiment_id = v_exp and status in ('pending', 'failed') returning now() into v_at;
    end if;
  else
    if p_action = 'claim' then
      update public.survey_invitations set reminded_at = now()
      where id = p_invitation and experiment_id = v_exp and status = 'sent' and error is null and reminded_at is null
        and sent_at is not null and sent_at <= now() - interval '3 days'
      returning reminded_at into v_at;
    elsif p_action = 'fail' then
      update public.survey_invitations set reminded_at = null, error = left('Herinnering niet verstuurd: ' || coalesce(p_error, ''), 300)
      where id = p_invitation and experiment_id = v_exp and status = 'sent' and reminded_at is not null returning now() into v_at;
    elsif p_action = 'release' then
      update public.survey_invitations set reminded_at = null
      where id = p_invitation and experiment_id = v_exp and status = 'sent' and reminded_at is not null returning now() into v_at;
    else
      update public.survey_invitations set error = 'Geen herinnering: adres staat op de afmeldlijst.'
      where id = p_invitation and experiment_id = v_exp and status = 'sent' and reminded_at is null returning now() into v_at;
    end if;
  end if;
  return v_at;
end $$;

-- ---------------------------------------------------------------------------
-- 4. Audit and grants
-- ---------------------------------------------------------------------------

-- Status changes only: progress heartbeats would flood the audit log.
create trigger jobs_audit after insert or delete or update of status on public.jobs for each row execute function public.audit_row();

revoke all on public.jobs from public, anon, authenticated;
grant select on public.jobs to authenticated;

revoke execute on function
  public.guard_job(),
  public.enqueue_job(uuid, text, jsonb, text),
  public.cancel_job(uuid),
  public.claim_jobs(text, int, int),
  public.job_heartbeat(text, uuid, jsonb, int),
  public.complete_job(text, uuid, text, text, jsonb, int),
  public.job_survey_batch(text, uuid, uuid[]),
  public.job_survey_mark(text, uuid, uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.enqueue_job(uuid, text, jsonb, text), public.cancel_job(uuid) to authenticated;
-- The worker uses the publishable (anon) key plus the ingest secret, like the other server-side ingest RPCs.
grant execute on function
  public.claim_jobs(text, int, int),
  public.job_heartbeat(text, uuid, jsonb, int),
  public.complete_job(text, uuid, text, text, jsonb, int),
  public.job_survey_batch(text, uuid, uuid[]),
  public.job_survey_mark(text, uuid, uuid, text, text)
  to anon;
