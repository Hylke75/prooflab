-- Access helpers, row level security, integrity triggers, audit trail and public RPCs.

-- ---------------------------------------------------------------------------
-- Access helpers
-- ---------------------------------------------------------------------------

create or replace function public.is_org_member(p_org uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.organization_members m
    where m.org_id = p_org and m.user_id = (select auth.uid())
  );
$$;

create or replace function public.is_org_owner(p_org uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.organization_members m
    where m.org_id = p_org and m.user_id = (select auth.uid()) and m.role = 'owner'
  );
$$;

-- Consultants (organization members) can change an idea.
create or replace function public.can_write_idea(p_idea uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.ideas i
    join public.organization_members m on m.org_id = i.org_id
    where i.id = p_idea and m.user_id = (select auth.uid())
  );
$$;

-- Client stakeholders can read the ideas they were invited to.
create or replace function public.can_read_idea(p_idea uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.can_write_idea(p_idea) or exists (
    select 1 from public.idea_members im
    where im.idea_id = p_idea and im.user_id = (select auth.uid())
  );
$$;

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------

alter table public.organizations enable row level security;
alter table public.organization_members enable row level security;
alter table public.profiles enable row level security;
alter table public.clients enable row level security;
alter table public.ideas enable row level security;
alter table public.idea_members enable row level security;
alter table public.research_questions enable row level security;
alter table public.research_runs enable row level security;
alter table public.research_tasks enable row level security;
alter table public.sources enable row level security;
alter table public.source_excerpts enable row level security;
alter table public.claims enable row level security;
alter table public.claim_sources enable row level security;
alter table public.competitors enable row level security;
alter table public.segments enable row level security;
alter table public.sizing_scenarios enable row level security;
alter table public.sizing_factors enable row level security;
alter table public.unit_economics enable row level security;
alter table public.assumptions enable row level security;
alter table public.assumption_claims enable row level security;
alter table public.hypotheses enable row level security;
alter table public.experiments enable row level security;
alter table public.test_events enable row level security;
alter table public.test_submissions enable row level security;
alter table public.interviews enable row level security;
alter table public.observations enable row level security;
alter table public.assumption_observations enable row level security;
alter table public.learning_cards enable row level security;
alter table public.reality_checks enable row level security;
alter table public.decisions enable row level security;
alter table public.reports enable row level security;
alter table public.audit_events enable row level security;
alter table public.ai_runs enable row level security;

-- Organizations
create policy org_select on public.organizations for select to authenticated
  using (public.is_org_member(id));
create policy org_update on public.organizations for update to authenticated
  using (public.is_org_owner(id)) with check (public.is_org_owner(id));

create policy orgm_select on public.organization_members for select to authenticated
  using (public.is_org_member(org_id));
create policy orgm_insert on public.organization_members for insert to authenticated
  with check (public.is_org_owner(org_id));
create policy orgm_delete on public.organization_members for delete to authenticated
  using (public.is_org_owner(org_id) and user_id <> (select auth.uid()));

create policy profiles_select on public.profiles for select to authenticated
  using (
    user_id = (select auth.uid())
    or exists (
      select 1 from public.organization_members a
      join public.organization_members b on a.org_id = b.org_id
      where a.user_id = (select auth.uid()) and b.user_id = profiles.user_id
    )
  );
create policy profiles_update on public.profiles for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create policy clients_all on public.clients for all to authenticated
  using (public.is_org_member(org_id)) with check (public.is_org_member(org_id));

-- Ideas
-- org_id is checked directly so INSERT ... RETURNING sees the new row.
create policy ideas_select on public.ideas for select to authenticated
  using (public.is_org_member(org_id) or public.can_read_idea(id));
create policy ideas_insert on public.ideas for insert to authenticated
  with check (public.is_org_member(org_id));
create policy ideas_update on public.ideas for update to authenticated
  using (public.can_write_idea(id)) with check (public.is_org_member(org_id));
create policy ideas_delete on public.ideas for delete to authenticated
  using (public.is_org_owner(org_id));

create policy idea_members_select on public.idea_members for select to authenticated
  using (public.can_write_idea(idea_id) or user_id = (select auth.uid()));
create policy idea_members_insert on public.idea_members for insert to authenticated
  with check (public.can_write_idea(idea_id));
create policy idea_members_delete on public.idea_members for delete to authenticated
  using (public.can_write_idea(idea_id));

-- Idea-scoped tables that clients may read and consultants may change.
do $$
declare t text;
begin
  foreach t in array array[
    'research_questions', 'research_runs', 'sources', 'source_excerpts', 'claims', 'claim_sources',
    'competitors', 'segments', 'sizing_scenarios', 'sizing_factors', 'unit_economics',
    'assumptions', 'assumption_claims', 'hypotheses', 'experiments', 'assumption_observations',
    'learning_cards', 'reality_checks', 'reports'
  ] loop
    execute format('create policy %I on public.%I for select to authenticated using (public.can_read_idea(idea_id))', t || '_select', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (public.can_write_idea(idea_id))', t || '_insert', t);
    execute format('create policy %I on public.%I for update to authenticated using (public.can_write_idea(idea_id)) with check (public.can_write_idea(idea_id))', t || '_update', t);
    execute format('create policy %I on public.%I for delete to authenticated using (public.can_write_idea(idea_id))', t || '_delete', t);
  end loop;
end $$;

-- Reports are immutable snapshots: no updates.
drop policy reports_update on public.reports;

-- Sensitive raw data: consultants only (clients see aggregates and pseudonymised quotes).
create policy research_tasks_select on public.research_tasks for select to authenticated
  using (public.can_write_idea(idea_id));
create policy research_tasks_write on public.research_tasks for all to authenticated
  using (public.can_write_idea(idea_id)) with check (public.can_write_idea(idea_id));

create policy test_events_select on public.test_events for select to authenticated
  using (public.can_write_idea(idea_id));
-- No insert/update/delete policies: events only arrive through record_test_event().

create policy test_submissions_select on public.test_submissions for select to authenticated
  using (public.can_write_idea(idea_id));
create policy test_submissions_delete on public.test_submissions for delete to authenticated
  using (public.can_write_idea(idea_id));

create policy interviews_all on public.interviews for all to authenticated
  using (public.can_write_idea(idea_id)) with check (public.can_write_idea(idea_id));

create policy observations_select on public.observations for select to authenticated
  using (public.can_read_idea(idea_id));
create policy observations_insert on public.observations for insert to authenticated
  with check (public.can_write_idea(idea_id) and origin <> 'system');
-- Raw observations are never rewritten; manual ones may be removed by consultants.
create policy observations_delete on public.observations for delete to authenticated
  using (public.can_write_idea(idea_id) and origin = 'manual');

-- Decisions: consultants record them; clients confirm through confirm_decision().
create policy decisions_select on public.decisions for select to authenticated
  using (public.can_read_idea(idea_id));
create policy decisions_insert on public.decisions for insert to authenticated
  with check (public.can_write_idea(idea_id) and client_confirmed_at is null);

create policy audit_select on public.audit_events for select to authenticated
  using (idea_id is not null and public.can_write_idea(idea_id));

create policy ai_runs_select on public.ai_runs for select to authenticated
  using (idea_id is not null and public.can_write_idea(idea_id));
create policy ai_runs_insert on public.ai_runs for insert to authenticated
  with check (idea_id is not null and public.can_write_idea(idea_id));

-- ---------------------------------------------------------------------------
-- Grants: anon gets no table access at all.
-- ---------------------------------------------------------------------------

revoke all on all tables in schema public from anon;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;

-- ---------------------------------------------------------------------------
-- Integrity triggers
-- ---------------------------------------------------------------------------

create or replace function public.touch_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

create trigger ideas_touch before update on public.ideas
  for each row execute function public.touch_updated_at();
create trigger claims_touch before update on public.claims
  for each row execute function public.touch_updated_at();

-- A locked hypothesis can only be superseded, never silently edited.
create or replace function public.guard_hypothesis_lock()
returns trigger language plpgsql set search_path = '' as $$
begin
  if old.locked_at is not null then
    if (new.we_believe, new.target_group, new.test_method, new.metric_label, new.metric_numerator,
        new.metric_denominator, new.success_threshold_pct, new.fail_threshold_pct, new.min_sample,
        new.max_duration_days, new.assumption_id, new.version, new.locked_at)
       is distinct from
       (old.we_believe, old.target_group, old.test_method, old.metric_label, old.metric_numerator,
        old.metric_denominator, old.success_threshold_pct, old.fail_threshold_pct, old.min_sample,
        old.max_duration_days, old.assumption_id, old.version, old.locked_at) then
      raise exception 'HYPOTHESIS_LOCKED: deze hypothese is vergrendeld; maak een nieuwe versie met motivering'
        using errcode = 'P0001';
    end if;
  end if;
  return new;
end $$;

create trigger hypotheses_lock before update on public.hypotheses
  for each row execute function public.guard_hypothesis_lock();

create or replace function public.guard_hypothesis_version()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.version > 1 and coalesce(btrim(new.change_reason), '') = '' then
    raise exception 'HYPOTHESIS_REASON: een nieuwe versie vraagt een motivering' using errcode = 'P0001';
  end if;
  return new;
end $$;

create trigger hypotheses_version before insert on public.hypotheses
  for each row execute function public.guard_hypothesis_version();

-- Experiment state machine, approval lock and immutable configuration once running.
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
    return new;
  end if;

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
      if new.type in ('landing', 'pricing') and new.public_slug is null then
        new.public_slug := lower(substr(replace(gen_random_uuid()::text, '-', ''), 1, 14));
      end if;
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

create trigger experiments_guard before insert or update on public.experiments
  for each row execute function public.guard_experiment();

-- Decisions require that the latest reality check exists and are immutable afterwards.
create or replace function public.guard_decision()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'UPDATE' then
    if (new.action, new.rationale, new.next_step, new.decided_by, new.decided_at, new.reality_check_id, new.experiment_id)
       is distinct from
       (old.action, old.rationale, old.next_step, old.decided_by, old.decided_at, old.reality_check_id, old.experiment_id) then
      raise exception 'DECISION_LOCKED: een vastgelegd besluit kan niet worden gewijzigd' using errcode = 'P0001';
    end if;
  end if;
  return new;
end $$;

create trigger decisions_guard before update on public.decisions
  for each row execute function public.guard_decision();

-- Generic audit trail.
create or replace function public.audit_row()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  rec jsonb;
  v_idea uuid;
begin
  rec := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  v_idea := case
    when tg_table_name = 'ideas' then (rec->>'id')::uuid
    else nullif(rec->>'idea_id', '')::uuid
  end;
  -- Deletes may cascade from a removed idea, so they are logged without the foreign key.
  insert into public.audit_events (idea_id, actor_id, table_name, row_id, action, detail)
  values (
    case when tg_op = 'DELETE' then null else v_idea end,
    auth.uid(), tg_table_name, coalesce(rec->>'id', rec->>'claim_id', ''), lower(tg_op),
    case
      when tg_op = 'UPDATE' then jsonb_build_object('state', rec->>'state', 'status', rec->>'status')
      when tg_op = 'DELETE' then jsonb_build_object('idea_id', v_idea)
      else null
    end
  );
  return null;
end $$;

do $$
declare t text;
begin
  foreach t in array array['ideas', 'claims', 'hypotheses', 'experiments', 'decisions', 'learning_cards',
                           'reports', 'assumptions', 'idea_members', 'reality_checks', 'sources'] loop
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function public.audit_row()', t || '_audit', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- RPCs for authenticated users
-- ---------------------------------------------------------------------------

create or replace function public.create_organization(p_name text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED' using errcode = 'P0001';
  end if;
  insert into public.organizations (name, created_by) values (btrim(p_name), auth.uid()) returning id into v_id;
  insert into public.organization_members (org_id, user_id, role) values (v_id, auth.uid(), 'owner');
  return v_id;
end $$;

-- Link pending client invitations to the signed-in account (matched on verified e-mail).
create or replace function public.claim_invitations()
returns int language plpgsql security definer set search_path = '' as $$
declare
  v_email text := lower(coalesce(auth.jwt()->>'email', ''));
  v_count int;
begin
  if auth.uid() is null or v_email = '' then
    return 0;
  end if;
  update public.idea_members set user_id = auth.uid()
  where lower(email) = v_email and user_id is null;
  get diagnostics v_count = row_count;
  insert into public.profiles (user_id, email) values (auth.uid(), v_email)
  on conflict (user_id) do nothing;
  return v_count;
end $$;

create or replace function public.confirm_decision(p_decision uuid, p_comment text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare d public.decisions;
begin
  select * into d from public.decisions where id = p_decision;
  if d.id is null then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  if not exists (
    select 1 from public.idea_members im
    where im.idea_id = d.idea_id and im.user_id = auth.uid() and im.role = 'client_decider'
  ) then
    raise exception 'FORBIDDEN: alleen de opdrachtgever kan dit besluit bevestigen' using errcode = 'P0001';
  end if;
  if d.client_confirmed_at is not null then
    return false;
  end if;
  update public.decisions
  set client_confirmed_by = auth.uid(), client_confirmed_at = now(), client_comment = nullif(btrim(p_comment), '')
  where id = p_decision;
  return true;
end $$;

-- ---------------------------------------------------------------------------
-- Public test pages (called by the app server with an ingest secret)
-- ---------------------------------------------------------------------------

create table public.ingest_keys (
  key_hash text primary key,
  created_at timestamptz not null default now()
);
alter table public.ingest_keys enable row level security;
revoke all on public.ingest_keys from anon, authenticated;

create or replace function public.ingest_key_ok(p_key text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.ingest_keys k
    where k.key_hash = encode(extensions.digest(coalesce(p_key, ''), 'sha256'), 'hex')
  );
$$;

create or replace function public.get_public_test(p_slug text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', e.id, 'type', e.type, 'state', e.state, 'config', e.config, 'ends_at', e.ends_at
  )
  from public.experiments e
  where e.public_slug = p_slug and e.state in ('approved', 'live', 'paused', 'ended', 'analyzed', 'decided');
$$;

create or replace function public.record_test_event(
  p_key text, p_slug text, p_visitor text, p_event text, p_variant text, p_channel text)
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
  insert into public.test_events (experiment_id, idea_id, visitor_hash, event_type, variant, channel)
  values (e.id, e.idea_id, left(p_visitor, 64), p_event, left(coalesce(p_variant, 'a'), 12), left(coalesce(nullif(p_channel, ''), 'direct'), 40))
  on conflict do nothing;
  get diagnostics v_rows = row_count;
  return v_rows > 0;
end $$;

create or replace function public.submit_test_form(
  p_key text, p_slug text, p_visitor text, p_variant text, p_channel text,
  p_email text, p_answers jsonb, p_consent boolean, p_consent_text text)
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
  insert into public.test_submissions (experiment_id, idea_id, visitor_hash, variant, channel, email, answers, consent_given, consent_text)
  values (e.id, e.idea_id, left(p_visitor, 64), left(coalesce(p_variant, 'a'), 12),
          left(coalesce(nullif(p_channel, ''), 'direct'), 40),
          case when p_consent then left(lower(btrim(p_email)), 254) else null end,
          coalesce(p_answers, '{}'::jsonb), coalesce(p_consent, false), left(p_consent_text, 600))
  on conflict (experiment_id, visitor_hash) do nothing;
  get diagnostics v_rows = row_count;
  insert into public.test_events (experiment_id, idea_id, visitor_hash, event_type, variant, channel)
  values (e.id, e.idea_id, left(p_visitor, 64), 'submit', left(coalesce(p_variant, 'a'), 12), left(coalesce(nullif(p_channel, ''), 'direct'), 40))
  on conflict do nothing;
  return v_rows > 0;
end $$;

-- Function privileges: everything private by default, then open what is needed.
revoke execute on all functions in schema public from public, anon;
grant execute on function
  public.is_org_member(uuid), public.is_org_owner(uuid), public.can_write_idea(uuid), public.can_read_idea(uuid),
  public.create_organization(text), public.claim_invitations(), public.confirm_decision(uuid, text),
  public.get_public_test(text)
  to authenticated;
grant execute on function
  public.get_public_test(text),
  public.record_test_event(text, text, text, text, text, text),
  public.submit_test_form(text, text, text, text, text, text, jsonb, boolean, text)
  to anon, authenticated;
