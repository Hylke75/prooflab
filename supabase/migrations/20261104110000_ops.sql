-- Operational status for workspace owners (app/app/status). Cheap markers only: which parts of the schema are
-- present, whether the ingest key and the auth hook function exist, the last run of the purge job and the AI
-- spend of this month. Never returns personal data, secrets or hashes.

create or replace function public.system_status(p_org uuid default null)
returns table (
  org_id uuid,
  migration_version text,
  has_core boolean,
  has_forecasts boolean,
  has_coach boolean,
  has_surveys boolean,
  has_survey_key_answers boolean,
  has_ops boolean,
  ingest_key_registered boolean,
  auth_hook_function boolean,
  cron_available boolean,
  purge_job_scheduled boolean,
  purge_last_run_at timestamptz,
  purge_last_status text,
  ai_spent_usd numeric,
  ai_cap_usd numeric,
  checked_at timestamptz
)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_org uuid := p_org;
  v_version text;
  v_cron boolean := false;
  v_scheduled boolean := false;
  v_last_at timestamptz;
  v_last_status text;
begin
  -- Owner of the given organisation, or (without an argument) of the caller's first owned organisation.
  if v_org is null then
    select m.org_id into v_org from public.organization_members m
    where m.user_id = (select auth.uid()) and m.role = 'owner'
    order by m.created_at limit 1;
  end if;
  if v_org is null or not public.is_org_owner(v_org) then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  -- Migration history as recorded by the Supabase CLI (absent on a plain Postgres).
  if to_regclass('supabase_migrations.schema_migrations') is not null then
    begin
      execute 'select max(version)::text from supabase_migrations.schema_migrations' into v_version;
    exception when others then v_version := null;
    end;
  end if;

  -- pg_cron: job and run details are only visible to the role that scheduled them (the migration owner, which
  -- is also the owner of this function). Any failure means "unknown", never an error for the page.
  if to_regclass('cron.job') is not null then
    v_cron := true;
    begin
      execute 'select exists (select 1 from cron.job where jobname = $1)' into v_scheduled using 'prooflab-purge-personal-data';
      if to_regclass('cron.job_run_details') is not null then
        execute $q$
          select d.start_time, d.status from cron.job_run_details d
          join cron.job j on j.jobid = d.jobid
          where j.jobname = $1 order by d.start_time desc limit 1
        $q$ into v_last_at, v_last_status using 'prooflab-purge-personal-data';
      end if;
    exception when others then
      v_scheduled := null; v_last_at := null; v_last_status := null;
    end;
  end if;

  return query
  select
    v_org,
    v_version,
    to_regclass('public.ideas') is not null and to_regclass('public.audit_events') is not null,
    to_regclass('public.forecasts') is not null,
    to_regclass('public.coach_notes') is not null,
    to_regclass('public.survey_responses') is not null,
    to_regprocedure('public.survey_key_answers(uuid)') is not null,
    true,
    exists (select 1 from public.ingest_keys),
    to_regprocedure('public.hook_before_user_created(jsonb)') is not null,
    v_cron,
    v_scheduled,
    v_last_at,
    v_last_status,
    coalesce((
      select sum(r.cost_usd) from public.ai_runs r
      join public.ideas i on i.id = r.idea_id
      where i.org_id = v_org and r.created_at >= date_trunc('month', now())
    ), 0)::numeric,
    (select o.ai_monthly_cap_usd from public.organizations o where o.id = v_org)::numeric,
    now();
end $$;

revoke execute on function public.system_status(uuid) from public, anon;
grant execute on function public.system_status(uuid) to authenticated;
