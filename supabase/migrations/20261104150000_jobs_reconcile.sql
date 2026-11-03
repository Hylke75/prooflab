-- Survey e-mail jobs on top of the privacy and outreach migration (20261104100000): invitations with a delivery
-- issue (hard bounce, spam complaint) are never claimed, mailed or deleted by a job; the batch returns each
-- invitation's salt version and delivery issue; the worker checks the suppression list under every salt version
-- (job_suppressed_hashes) and records the Resend message id after a send (job_survey_sent), which the bounce
-- webhook (record_email_event) matches on. The worker functions run without a signed-in user, so the delivery
-- guard trigger does not apply to them: every condition is explicit here.

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
        'salt_version', i.salt_version, 'delivery_issue', i.delivery_issue,
        'suppressed', exists (select 1 from public.email_suppressions s where s.org_id = j.org_id and s.email_hash = i.email_hash)))
      from public.survey_invitations i
      where i.experiment_id = e.id and i.id = any(p_ids) and (j.payload -> 'ids') ? i.id::text), '[]'::jsonb));
end $$;

-- Which of the given address hashes (an address under every salt version) are on the job organisation's
-- do-not-mail list.
create or replace function public.job_suppressed_hashes(p_key text, p_job uuid, p_hashes text[])
returns text[] language plpgsql stable security definer set search_path = '' as $$
declare j public.jobs;
begin
  if not public.ingest_key_ok(p_key) then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  select * into j from public.jobs where id = p_job;
  if j.id is null or coalesce(array_length(p_hashes, 1), 0) > 2000 then
    return '{}'::text[];
  end if;
  return coalesce((select array_agg(s.email_hash) from public.email_suppressions s where s.org_id = j.org_id and s.email_hash = any(p_hashes)), '{}'::text[]);
end $$;

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
      where id = p_invitation and experiment_id = v_exp and status in ('pending', 'failed') and delivery_issue is null
      returning sent_at into v_at;
    elsif p_action = 'fail' then
      update public.survey_invitations set status = 'failed', sent_at = null, error = left(coalesce(p_error, 'Niet verstuurd.'), 300)
      where id = p_invitation and experiment_id = v_exp and status = 'sent' and delivery_issue is null returning now() into v_at;
    elsif p_action = 'release' then
      update public.survey_invitations set status = 'pending', sent_at = null, error = null
      where id = p_invitation and experiment_id = v_exp and status = 'sent' and delivery_issue is null returning now() into v_at;
    else
      delete from public.survey_invitations
      where id = p_invitation and experiment_id = v_exp and status in ('pending', 'failed') and delivery_issue is null returning now() into v_at;
    end if;
  else
    if p_action = 'claim' then
      update public.survey_invitations set reminded_at = now()
      where id = p_invitation and experiment_id = v_exp and status = 'sent' and error is null and reminded_at is null
        and delivery_issue is null and sent_at is not null and sent_at <= now() - interval '3 days'
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

-- After a successful send: the Resend message id of the first mail (provider_message_id) or of the reminder
-- (reminder_message_id). Also after a cancel, because the mail did leave.
create or replace function public.job_survey_sent(p_key text, p_job uuid, p_invitation uuid, p_message_id text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare j public.jobs;
begin
  if not public.ingest_key_ok(p_key) then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  select * into j from public.jobs where id = p_job;
  if j.id is null or j.kind not in ('survey_invite', 'survey_reminder') or not ((j.payload -> 'ids') ? p_invitation::text)
     or coalesce(p_message_id, '') = '' then
    return false;
  end if;
  if j.kind = 'survey_invite' then
    update public.survey_invitations set provider_message_id = left(p_message_id, 100)
    where id = p_invitation and experiment_id = (j.payload ->> 'experiment_id')::uuid and status in ('sent', 'responded', 'unsubscribed');
  else
    update public.survey_invitations set reminder_message_id = left(p_message_id, 100)
    where id = p_invitation and experiment_id = (j.payload ->> 'experiment_id')::uuid and reminded_at is not null;
  end if;
  return found;
end $$;

revoke execute on function
  public.job_suppressed_hashes(text, uuid, text[]),
  public.job_survey_sent(text, uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function
  public.job_suppressed_hashes(text, uuid, text[]),
  public.job_survey_sent(text, uuid, uuid, text)
  to anon;
