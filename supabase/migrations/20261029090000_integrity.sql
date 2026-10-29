-- Integrity hardening after the first system review (October 2026).
-- Everything the app promises about evidence is enforced here, not only in server actions: a signed-in
-- user holds the publishable key and their own JWT and can call PostgREST directly.

-- ---------------------------------------------------------------------------
-- 1. Client sign-off can only come from a real, invited client
-- ---------------------------------------------------------------------------

-- Invitations are created without an account; only claim_invitations() links a user to one.
drop policy if exists idea_members_insert on public.idea_members;
create policy idea_members_insert on public.idea_members for insert to authenticated
  with check (public.can_write_idea(idea_id) and user_id is null);

-- Only accounts with a confirmed e-mail address can claim an invitation.
create or replace function public.claim_invitations()
returns int language plpgsql security definer set search_path = '' as $$
declare
  v_email text := lower(coalesce(auth.jwt()->>'email', ''));
  v_count int;
begin
  if auth.uid() is null or v_email = '' then
    return 0;
  end if;
  if not exists (select 1 from auth.users u where u.id = auth.uid() and u.email_confirmed_at is not null) then
    return 0;
  end if;
  update public.idea_members set user_id = auth.uid()
  where lower(email) = v_email and user_id is null;
  get diagnostics v_count = row_count;
  insert into public.profiles (user_id, email) values (auth.uid(), v_email)
  on conflict (user_id) do nothing;
  return v_count;
end $$;

-- Members of the consultancy can never confirm "as the client".
create or replace function public.confirm_decision(p_decision uuid, p_comment text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  d public.decisions;
  v_org uuid;
begin
  select * into d from public.decisions where id = p_decision;
  if d.id is null then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  select org_id into v_org from public.ideas where id = d.idea_id;
  if public.is_org_member(v_org) or not exists (
    select 1 from public.idea_members im
    where im.idea_id = d.idea_id and im.user_id = auth.uid() and im.role = 'client_decider'
  ) then
    raise exception 'FORBIDDEN: alleen de opdrachtgever kan dit besluit bevestigen' using errcode = 'P0001';
  end if;
  if d.client_confirmed_at is not null then
    return false;
  end if;
  update public.decisions
  set client_confirmed_by = auth.uid(), client_confirmed_at = now(), client_comment = left(nullif(btrim(p_comment), ''), 2000)
  where id = p_decision;
  return true;
end $$;

-- ---------------------------------------------------------------------------
-- 2. References must stay inside the same idea
-- ---------------------------------------------------------------------------
-- Foreign keys ignore RLS, so without this a row in idea A could point at evidence from idea B
-- (or from another tenant). Arguments: pairs of (column, referenced table).

create or replace function public.check_idea_refs()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  rec jsonb := to_jsonb(new);
  i int := 0;
  v_ref text;
  v_idea uuid;
begin
  while i < tg_nargs loop
    v_ref := rec->>tg_argv[i];
    if v_ref is not null then
      execute format('select idea_id from public.%I where id = $1', tg_argv[i + 1]) into v_idea using v_ref::uuid;
      if v_idea is null or v_idea <> new.idea_id then
        raise exception 'IDEA_MISMATCH: % verwijst naar een ander dossier', tg_argv[i] using errcode = 'P0001';
      end if;
    end if;
    i := i + 2;
  end loop;
  return new;
end $$;

create trigger source_excerpts_refs before insert or update on public.source_excerpts
  for each row execute function public.check_idea_refs('source_id', 'sources');
create trigger claims_refs before insert or update on public.claims
  for each row execute function public.check_idea_refs('question_id', 'research_questions');
create trigger claim_sources_refs before insert or update on public.claim_sources
  for each row execute function public.check_idea_refs('claim_id', 'claims', 'source_id', 'sources', 'excerpt_id', 'source_excerpts');
create trigger competitors_refs before insert or update on public.competitors
  for each row execute function public.check_idea_refs('claim_id', 'claims');
create trigger sizing_factors_refs before insert or update on public.sizing_factors
  for each row execute function public.check_idea_refs('scenario_id', 'sizing_scenarios', 'claim_id', 'claims');
create trigger assumption_claims_refs before insert or update on public.assumption_claims
  for each row execute function public.check_idea_refs('assumption_id', 'assumptions', 'claim_id', 'claims');
create trigger hypotheses_refs before insert or update on public.hypotheses
  for each row execute function public.check_idea_refs('assumption_id', 'assumptions', 'superseded_by', 'hypotheses');
create trigger experiments_refs before insert or update on public.experiments
  for each row execute function public.check_idea_refs('hypothesis_id', 'hypotheses');
create trigger interviews_refs before insert or update on public.interviews
  for each row execute function public.check_idea_refs('experiment_id', 'experiments');
create trigger observations_refs before insert or update on public.observations
  for each row execute function public.check_idea_refs('experiment_id', 'experiments', 'interview_id', 'interviews');
create trigger assumption_observations_refs before insert or update on public.assumption_observations
  for each row execute function public.check_idea_refs('assumption_id', 'assumptions', 'observation_id', 'observations');
create trigger learning_cards_refs before insert or update on public.learning_cards
  for each row execute function public.check_idea_refs('experiment_id', 'experiments');
create trigger research_tasks_refs before insert or update on public.research_tasks
  for each row execute function public.check_idea_refs('run_id', 'research_runs', 'question_id', 'research_questions');
create trigger sources_refs before insert or update on public.sources
  for each row execute function public.check_idea_refs('run_id', 'research_runs');
create trigger decisions_refs before insert on public.decisions
  for each row execute function public.check_idea_refs('experiment_id', 'experiments', 'reality_check_id', 'reality_checks');

-- ---------------------------------------------------------------------------
-- 3. Immutable evidence
-- ---------------------------------------------------------------------------

-- Reports are snapshots: never deleted; only the sharing fields may change (see section 9).
drop policy if exists reports_delete on public.reports;

-- Experiments can only be removed while they are still a concept; a locked hypothesis never.
drop policy if exists experiments_delete on public.experiments;
create policy experiments_delete on public.experiments for delete to authenticated
  using (public.can_write_idea(idea_id) and state in ('draft', 'ready_for_review'));
drop policy if exists hypotheses_delete on public.hypotheses;
create policy hypotheses_delete on public.hypotheses for delete to authenticated
  using (public.can_write_idea(idea_id) and locked_at is null);

-- Lifecycle timestamps are set by the state machine only; a live test's end date cannot be moved.
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
      if new.type in ('landing', 'pricing') and new.public_slug is null then
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

-- An approved Learning Card is part of the record; a draft can still be edited or removed.
create or replace function public.guard_learning_card()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    if old.status = 'approved' then
      raise exception 'CARD_LOCKED: een goedgekeurde Learning Card kan niet worden verwijderd' using errcode = 'P0001';
    end if;
    return old;
  end if;
  if tg_op = 'INSERT' then
    if new.status <> 'draft' then
      raise exception 'CARD_STATE: een Learning Card begint als concept' using errcode = 'P0001';
    end if;
    new.approved_by := null;
    new.approved_at := null;
    return new;
  end if;
  if old.status = 'approved' then
    raise exception 'CARD_LOCKED: een goedgekeurde Learning Card kan niet meer worden gewijzigd' using errcode = 'P0001';
  end if;
  new.idea_id := old.idea_id;
  new.experiment_id := old.experiment_id;
  new.metrics := old.metrics;
  if new.status = 'approved' then
    new.approved_by := auth.uid();
    new.approved_at := now();
  end if;
  return new;
end $$;

create trigger learning_cards_guard before insert or update or delete on public.learning_cards
  for each row execute function public.guard_learning_card();

-- At most one concept and one approved card per experiment: generating a card twice cannot double the evidence.
create unique index learning_cards_one_draft on public.learning_cards(experiment_id) where status = 'draft';
create unique index learning_cards_one_approved on public.learning_cards(experiment_id) where status = 'approved';
-- One system summary per experiment, and an AI coding of the same quote only once per interview.
create unique index observations_one_system on public.observations(experiment_id) where origin = 'system';
create unique index observations_ai_quote on public.observations(interview_id, md5(lower(coalesce(quote, summary))))
  where origin = 'ai';

-- Reality checks are evidence for a decision: never rewritten.
drop policy if exists reality_checks_update on public.reality_checks;
drop policy if exists reality_checks_delete on public.reality_checks;

-- A decision must rest on the latest Reality Check of the same idea, taken after the latest approved
-- Learning Card, and "continue" is impossible while that check has blocking findings.
create or replace function public.guard_decision_insert()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  rc public.reality_checks;
  v_latest uuid;
  v_card timestamptz;
begin
  select * into rc from public.reality_checks where id = new.reality_check_id;
  select id into v_latest from public.reality_checks where idea_id = new.idea_id order by created_at desc, id desc limit 1;
  if rc.id is null or rc.idea_id <> new.idea_id or rc.id <> v_latest then
    raise exception 'DECISION_CHECK: een besluit vraagt de laatste Reality Check van dit dossier' using errcode = 'P0001';
  end if;
  select max(approved_at) into v_card from public.learning_cards where idea_id = new.idea_id and status = 'approved';
  if v_card is not null and v_card > rc.created_at then
    raise exception 'DECISION_STALE: er is nieuw bewijs sinds de laatste Reality Check; voer hem opnieuw uit' using errcode = 'P0001';
  end if;
  if new.action = 'continue' and exists (
    select 1 from jsonb_array_elements(rc.findings) f where f->>'severity' = 'blocker'
  ) then
    raise exception 'DECISION_BLOCKED: doorgaan kan niet zolang de Reality Check blokkades toont' using errcode = 'P0001';
  end if;
  new.decided_by := auth.uid();
  new.decided_at := now();
  new.client_confirmed_by := null;
  new.client_confirmed_at := null;
  new.client_comment := null;
  return new;
end $$;

create trigger decisions_guard_insert before insert on public.decisions
  for each row execute function public.guard_decision_insert();

-- ---------------------------------------------------------------------------
-- 4. AI spend cannot be changed by the user
-- ---------------------------------------------------------------------------
-- The server enforces a per-organisation monthly cap from the ai_runs ledger, which users can neither
-- update nor delete. Run budgets are fixed at creation and costs only ever go up.

alter table public.organizations add column if not exists ai_monthly_cap_usd numeric(8,2) not null default 50
  check (ai_monthly_cap_usd between 0 and 1000);

create or replace function public.guard_research_run()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if new.budget_usd < 0 or new.budget_usd > 25 then
      raise exception 'RUN_BUDGET: budget per onderzoek ligt tussen $0 en $25' using errcode = 'P0001';
    end if;
    new.cost_usd := 0;
    new.started_by := auth.uid();
    return new;
  end if;
  new.idea_id := old.idea_id;
  new.budget_usd := old.budget_usd;
  new.started_by := old.started_by;
  if new.cost_usd < old.cost_usd then
    new.cost_usd := old.cost_usd;
  end if;
  return new;
end $$;

create trigger research_runs_guard before insert or update on public.research_runs
  for each row execute function public.guard_research_run();

create or replace function public.guard_research_task()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'UPDATE' then
    new.run_id := old.run_id;
    new.idea_id := old.idea_id;
    if new.cost_usd < old.cost_usd then
      new.cost_usd := old.cost_usd;
    end if;
  else
    new.cost_usd := 0;
  end if;
  return new;
end $$;

create trigger research_tasks_guard before insert or update on public.research_tasks
  for each row execute function public.guard_research_task();

-- Atomic cost booking (no read-modify-write races between two tabs).
create or replace function public.add_research_cost(p_task uuid, p_cost numeric)
returns numeric language plpgsql set search_path = '' as $$
declare
  v_run uuid;
  v_total numeric;
begin
  if p_cost is null or p_cost < 0 then
    raise exception 'BAD_COST' using errcode = 'P0001';
  end if;
  update public.research_tasks set cost_usd = cost_usd + p_cost where id = p_task returning run_id into v_run;
  if v_run is null then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  update public.research_runs set cost_usd = cost_usd + p_cost where id = v_run returning cost_usd into v_total;
  return v_total;
end $$;

-- Spend this calendar month across the organisation that owns an idea (ledger only).
create or replace function public.org_ai_spend(p_idea uuid)
returns table (spent numeric, cap numeric) language sql stable security definer set search_path = '' as $$
  select coalesce((
      select sum(r.cost_usd) from public.ai_runs r
      join public.ideas i2 on i2.id = r.idea_id
      where i2.org_id = o.id and r.created_at >= date_trunc('month', now())
    ), 0), o.ai_monthly_cap_usd
  from public.ideas i join public.organizations o on o.id = i.org_id
  where i.id = p_idea and public.can_read_idea(p_idea);
$$;

-- Clients may use the coach too, so their AI calls are logged as well.
drop policy if exists ai_runs_insert on public.ai_runs;
create policy ai_runs_insert on public.ai_runs for insert to authenticated
  with check (idea_id is not null and public.can_read_idea(idea_id) and created_by = (select auth.uid()));

-- One policy per action keeps RLS evaluation cheap (advisor: multiple permissive policies).
drop policy if exists research_tasks_select on public.research_tasks;

-- ---------------------------------------------------------------------------
-- 5. Public test pages: stable pseudonym per experiment, behaviour in order, rate limited
-- ---------------------------------------------------------------------------
-- The visitor code is now an HMAC of (experiment, ip, user agent) with a server secret: stable for one
-- experiment, unlinkable across experiments and not reversible. A returning visitor counts once and keeps
-- seeing the same price.

create unique index if not exists test_events_once on public.test_events(experiment_id, visitor_hash, event_type);

create table if not exists public.ingest_rate (
  bucket text primary key,
  hits int not null default 0,
  window_start timestamptz not null default now()
);
alter table public.ingest_rate enable row level security;

-- Max 30 recorded actions per minute per (network, test page).
create or replace function public.ingest_allowed(p_bucket text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_hits int;
begin
  insert into public.ingest_rate as r (bucket, hits, window_start) values (left(p_bucket, 128), 1, now())
  on conflict (bucket) do update set
    hits = case when r.window_start < now() - interval '1 minute' then 1 else r.hits + 1 end,
    window_start = case when r.window_start < now() - interval '1 minute' then now() else r.window_start end
  returning hits into v_hits;
  delete from public.ingest_rate where window_start < now() - interval '1 hour';
  return v_hits <= 30;
end $$;

drop function if exists public.record_test_event(text, text, text, text, text, text);
create or replace function public.record_test_event(
  p_key text, p_slug text, p_visitor text, p_event text, p_variant text, p_channel text, p_rate_bucket text)
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
  insert into public.test_events (experiment_id, idea_id, visitor_hash, event_type, variant, channel)
  values (e.id, e.idea_id, left(p_visitor, 64), p_event, left(coalesce(p_variant, 'a'), 12), left(coalesce(nullif(p_channel, ''), 'direct'), 40))
  on conflict do nothing;
  get diagnostics v_rows = row_count;
  return v_rows > 0;
end $$;

drop function if exists public.submit_test_form(text, text, text, text, text, text, jsonb, boolean, text);
create or replace function public.submit_test_form(
  p_key text, p_slug text, p_visitor text, p_variant text, p_channel text,
  p_email text, p_answers jsonb, p_consent boolean, p_consent_text text, p_rate_bucket text)
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
  insert into public.test_events (experiment_id, idea_id, visitor_hash, event_type, variant, channel)
  values (e.id, e.idea_id, left(p_visitor, 64), 'submit', left(coalesce(p_variant, 'a'), 12), left(coalesce(nullif(p_channel, ''), 'direct'), 40))
  on conflict do nothing;
  return v_rows > 0;
end $$;

-- Distinct counts in the database, so large tests are never cut off at a page of rows.
create or replace function public.experiment_event_counts(p_experiment uuid)
returns table (channel text, variant text, viewers bigint, clickers bigint, submitters bigint)
language sql stable set search_path = '' as $$
  with v as (
    select distinct on (visitor_hash) visitor_hash, channel, variant
    from public.test_events
    where experiment_id = p_experiment and event_type = 'view'
    order by visitor_hash, created_at
  )
  select v.channel, v.variant, count(*),
    count(*) filter (where exists (select 1 from public.test_events c where c.experiment_id = p_experiment and c.visitor_hash = v.visitor_hash and c.event_type = 'cta_click')),
    count(*) filter (where exists (select 1 from public.test_events s where s.experiment_id = p_experiment and s.visitor_hash = v.visitor_hash and s.event_type = 'submit'))
  from v
  group by v.channel, v.variant;
$$;

-- ---------------------------------------------------------------------------
-- 6. Audit trail: every evidence table, deletes stay visible, the history survives the idea
-- ---------------------------------------------------------------------------

alter table public.audit_events drop constraint if exists audit_events_idea_id_fkey;
alter table public.audit_events add column if not exists org_id uuid;
create index if not exists audit_events_idea_idx on public.audit_events(idea_id, occurred_at desc);
create index if not exists audit_events_org_idx on public.audit_events(org_id, occurred_at desc);

drop policy if exists audit_select on public.audit_events;
create policy audit_select on public.audit_events for select to authenticated
  using ((idea_id is not null and public.can_write_idea(idea_id)) or (org_id is not null and public.is_org_owner(org_id)));

create or replace function public.audit_row()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  rec jsonb;
  prev jsonb;
  v_idea uuid;
  v_org uuid;
  v_changes jsonb := '{}'::jsonb;
  k text;
begin
  rec := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  v_idea := case when tg_table_name = 'ideas' then (rec->>'id')::uuid else nullif(rec->>'idea_id', '')::uuid end;
  v_org := case when tg_table_name = 'ideas' then (rec->>'org_id')::uuid
                else (select i.org_id from public.ideas i where i.id = v_idea) end;
  -- During a cascade the idea row is already gone; its earlier audit rows still name the organisation.
  if v_org is null and v_idea is not null then
    select a.org_id into v_org from public.audit_events a where a.idea_id = v_idea and a.org_id is not null limit 1;
  end if;
  if tg_op = 'UPDATE' then
    prev := to_jsonb(old);
    for k in select jsonb_object_keys(rec) loop
      if k not in ('updated_at') and rec->k is distinct from prev->k then
        v_changes := v_changes || jsonb_build_object(k, jsonb_build_object(
          'old', case when length(coalesce(prev->>k, '')) > 300 then to_jsonb('md5:' || md5(prev->>k)) else prev->k end,
          'new', case when length(coalesce(rec->>k, '')) > 300 then to_jsonb('md5:' || md5(rec->>k)) else rec->k end));
      end if;
    end loop;
  end if;
  insert into public.audit_events (idea_id, org_id, actor_id, table_name, row_id, action, detail)
  values (
    v_idea, v_org, auth.uid(), tg_table_name,
    coalesce(rec->>'id', concat_ws(':', rec->>'assumption_id', rec->>'claim_id', rec->>'observation_id', rec->>'idea_id')),
    lower(tg_op),
    case
      when tg_op = 'UPDATE' then jsonb_build_object('changes', v_changes)
      when tg_op = 'DELETE' then jsonb_build_object('deleted', (
        select jsonb_object_agg(key, case when length(value::text) > 300 then to_jsonb('md5:' || md5(value::text)) else value end)
        from jsonb_each(rec)))
      else null
    end
  );
  return null;
end $$;

do $$
declare t text;
begin
  foreach t in array array['observations', 'assumption_observations', 'assumption_claims', 'claim_sources',
                           'interviews', 'test_submissions', 'competitors', 'sizing_factors', 'research_runs',
                           'research_questions', 'source_excerpts', 'unit_economics'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_audit', t);
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function public.audit_row()', t || '_audit', t);
  end loop;
end $$;

update public.audit_events a set org_id = i.org_id from public.ideas i where a.idea_id = i.id and a.org_id is null;

-- ---------------------------------------------------------------------------
-- 7. Privacy: retention is enforced, clients never read raw interview quotes
-- ---------------------------------------------------------------------------

-- After the retention date personal data is removed; the aggregate counts and pseudonymous labels stay.
create or replace function public.purge_expired_personal_data()
returns int language plpgsql security definer set search_path = '' as $$
declare v1 int; v2 int;
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
  return v1 + v2;
end $$;

-- Daily at 03:17 UTC where pg_cron is available (Supabase); elsewhere the app calls it on report runs.
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.schedule('prooflab-purge-personal-data', '17 3 * * *', 'select public.purge_expired_personal_data()');
  end if;
end $$;

-- Clients read observations through this function: same rows, without the literal quote.
drop policy if exists observations_select on public.observations;
create policy observations_select on public.observations for select to authenticated
  using (public.can_write_idea(idea_id));

create or replace function public.observations_for_idea(p_idea uuid)
returns table (
  id uuid, idea_id uuid, experiment_id uuid, interview_id uuid, kind text, summary text, quote text,
  quote_check text, is_fact boolean, is_behaviour boolean, is_real_context boolean, is_costly boolean,
  is_synthetic boolean, origin text, created_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select o.id, o.idea_id, o.experiment_id, o.interview_id, o.kind, o.summary,
         case when public.can_write_idea(o.idea_id) then o.quote else null end,
         o.quote_check, o.is_fact, o.is_behaviour, o.is_real_context, o.is_costly, o.is_synthetic,
         o.origin, o.created_at
  from public.observations o
  where o.idea_id = p_idea and public.can_read_idea(p_idea);
$$;

-- ---------------------------------------------------------------------------
-- 8. Sprint planning and sharing reports with the client
-- ---------------------------------------------------------------------------

alter table public.ideas add column if not exists sprint_start date;
alter table public.ideas add column if not exists sprint_weeks int not null default 5 check (sprint_weeks between 2 and 12);

alter table public.reports add column if not exists shared_at timestamptz;
alter table public.reports add column if not exists shared_by uuid references auth.users(id);
alter table public.reports add column if not exists client_viewed_at timestamptz;

create policy reports_update on public.reports for update to authenticated
  using (public.can_write_idea(idea_id)) with check (public.can_write_idea(idea_id));

-- The snapshot itself never changes; consultants can only share a version (once).
create or replace function public.guard_report()
returns trigger language plpgsql set search_path = '' as $$
begin
  if (new.idea_id, new.version, new.snapshot, new.created_by, new.created_at, new.client_viewed_at)
     is distinct from (old.idea_id, old.version, old.snapshot, old.created_by, old.created_at, old.client_viewed_at) then
    raise exception 'REPORT_LOCKED: een rapportversie is onveranderlijk' using errcode = 'P0001';
  end if;
  if old.shared_at is not null then
    new.shared_at := old.shared_at;
    new.shared_by := old.shared_by;
  elsif new.shared_at is not null then
    new.shared_at := now();
    new.shared_by := auth.uid();
  end if;
  return new;
end $$;

create trigger reports_guard before update on public.reports
  for each row when (current_setting('prooflab.report_view', true) is distinct from 'on')
  execute function public.guard_report();

-- Clients only see shared versions.
drop policy if exists reports_select on public.reports;
create policy reports_select on public.reports for select to authenticated
  using (public.can_write_idea(idea_id) or (shared_at is not null and public.can_read_idea(idea_id)));

create or replace function public.mark_report_viewed(p_report uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare r public.reports;
begin
  select * into r from public.reports where id = p_report;
  if r.id is null or r.shared_at is null or not exists (
    select 1 from public.idea_members im where im.idea_id = r.idea_id and im.user_id = auth.uid()
  ) then
    return false;
  end if;
  if r.client_viewed_at is null then
    perform set_config('prooflab.report_view', 'on', true);
    update public.reports set client_viewed_at = now() where id = p_report;
    perform set_config('prooflab.report_view', 'off', true);
  end if;
  return true;
end $$;

-- ---------------------------------------------------------------------------
-- 9. Size limits that hold for direct API writes too
-- ---------------------------------------------------------------------------

do $$
declare
  spec text[];
  specs text[][] := array[
    array['ideas', 'description', '4000'], array['ideas', 'decision_question', '600'], array['ideas', 'key_uncertainty', '600'],
    array['ideas', 'audience_detail', '300'], array['ideas', 'region_detail', '200'], array['ideas', 'decision_stakes', '600'],
    array['clients', 'notes', '4000'],
    array['research_questions', 'question', '400'], array['research_questions', 'done_criterion', '400'],
    array['sources', 'title', '300'], array['sources', 'url', '2000'], array['sources', 'publisher', '200'],
    array['sources', 'access_note', '600'], array['source_excerpts', 'location', '200'],
    array['claims', 'statement', '600'], array['claims', 'supports', '400'], array['claims', 'does_not_prove', '400'],
    array['claims', 'definition', '400'], array['claims', 'limitations', '600'], array['claims', 'region', '120'],
    array['claims', 'period', '80'], array['claims', 'unit', '60'],
    array['claim_sources', 'quote', '2000'],
    array['competitors', 'name', '160'], array['competitors', 'positioning', '600'], array['competitors', 'strengths', '1200'],
    array['competitors', 'weaknesses', '1200'], array['competitors', 'differentiation_opportunity', '1200'],
    array['competitors', 'visible_price', '200'],
    array['segments', 'job_to_be_done', '600'], array['segments', 'pain', '600'],
    array['sizing_factors', 'note', '400'], array['unit_economics', 'notes', '2000'],
    array['assumptions', 'statement', '400'],
    array['hypotheses', 'we_believe', '600'], array['hypotheses', 'target_group', '300'], array['hypotheses', 'test_method', '300'],
    array['hypotheses', 'expected_biases', '600'], array['hypotheses', 'change_reason', '600'],
    array['experiments', 'title', '200'],
    array['interviews', 'transcript', '100000'], array['interviews', 'participant_label', '80'],
    array['observations', 'summary', '1000'], array['observations', 'quote', '2000'],
    array['learning_cards', 'we_believed', '2000'], array['learning_cards', 'we_observed', '2000'],
    array['learning_cards', 'we_learned', '2000'], array['learning_cards', 'therefore', '2000'],
    array['decisions', 'rationale', '4000'], array['decisions', 'next_step', '2000'], array['decisions', 'client_comment', '2000'],
    array['reality_checks', 'advice_reason', '2000']
  ];
begin
  foreach spec slice 1 in array specs loop
    execute format('alter table public.%I add constraint %I check (char_length(%I) <= %s) not valid',
      spec[1], spec[1] || '_' || spec[2] || '_len', spec[2], spec[3]);
  end loop;
end $$;

alter table public.experiments add constraint experiments_config_size check (pg_column_size(config) <= 60000) not valid;
alter table public.reality_checks add constraint reality_checks_findings_size check (pg_column_size(findings) <= 200000) not valid;
alter table public.reports add constraint reports_snapshot_size check (pg_column_size(snapshot) <= 2000000) not valid;
alter table public.learning_cards add constraint learning_cards_metrics_size check (pg_column_size(metrics) <= 60000) not valid;

-- ---------------------------------------------------------------------------
-- 10. Indexes for every foreign key (RLS filters on idea_id on every query)
-- ---------------------------------------------------------------------------

do $$
declare r record;
begin
  for r in
    select c.conrelid::regclass as tbl, a.attname as col, cl.relname as tname
    from pg_constraint c
    join pg_class cl on cl.oid = c.conrelid
    join pg_namespace n on n.oid = cl.relnamespace
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
    where c.contype = 'f' and n.nspname = 'public' and array_length(c.conkey, 1) = 1
      and not exists (
        select 1 from pg_index i where i.indrelid = c.conrelid and i.indkey[0] = c.conkey[1]
      )
  loop
    execute format('create index if not exists %I on %s(%I)', left(r.tname || '_' || r.col || '_fk', 63), r.tbl, r.col);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Grants (default privileges were revoked in the hardening migration)
-- ---------------------------------------------------------------------------

revoke all on public.ingest_rate from anon, authenticated;
revoke execute on all functions in schema public from public, anon;
revoke all on all tables in schema public from anon;
grant execute on function
  public.is_org_member(uuid), public.is_org_owner(uuid), public.can_write_idea(uuid), public.can_read_idea(uuid),
  public.create_organization(text), public.claim_invitations(), public.confirm_decision(uuid, text),
  public.get_public_test(text), public.add_research_cost(uuid, numeric), public.org_ai_spend(uuid),
  public.experiment_event_counts(uuid), public.mark_report_viewed(uuid), public.observations_for_idea(uuid)
  to authenticated;
revoke execute on function public.purge_expired_personal_data(), public.ingest_allowed(text), public.check_idea_refs(),
  public.audit_row() from authenticated;
grant execute on function
  public.get_public_test(text),
  public.record_test_event(text, text, text, text, text, text, text),
  public.submit_test_form(text, text, text, text, text, text, jsonb, boolean, text, text)
  to anon, authenticated;
