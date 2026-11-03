-- ProofLab: alle migraties sinds 'hardening' in één keer, voor de SQL Editor van Supabase.
-- Plak dit hele bestand in Supabase → SQL Editor en klik op Run. Alles gebeurt in één transactie:
-- gaat er iets mis, dan verandert er niets. Daarna wordt de migratiegeschiedenis gelijkgezet met de repository.
begin;

-- ===== 20261029090000_integrity.sql =====
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

-- An idea can only be linked to a client of its own organisation.
create or replace function public.check_idea_client()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.client_id is not null and not exists (
    select 1 from public.clients c where c.id = new.client_id and c.org_id = new.org_id
  ) then
    raise exception 'IDEA_MISMATCH: deze opdrachtgever hoort niet bij deze werkruimte' using errcode = 'P0001';
  end if;
  return new;
end $$;

create trigger ideas_client_ref before insert or update of client_id, org_id on public.ideas
  for each row execute function public.check_idea_client();

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
    select 1
    from jsonb_array_elements(case when jsonb_typeof(rc.findings) = 'array' then rc.findings
                                   else coalesce(rc.findings->'findings', '[]'::jsonb) end) f
    where f->>'severity' = 'blocker'
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

-- Daily at 03:17 UTC via pg_cron (available on Supabase). On a database without pg_cron, schedule
-- "select public.purge_expired_personal_data()" with another scheduler.
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
revoke execute on function public.purge_expired_personal_data(), public.ingest_allowed(text), public.check_idea_refs(), public.check_idea_client(),
  public.audit_row() from authenticated;
grant execute on function
  public.get_public_test(text),
  public.record_test_event(text, text, text, text, text, text, text),
  public.submit_test_form(text, text, text, text, text, text, jsonb, boolean, text, text)
  to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 11. Accounts by invitation only
-- ---------------------------------------------------------------------------
-- New accounts are allowed for invited client e-mail addresses and for entries on the allowlist
-- (an exact address, or "@domain.nl" for a whole consultancy). The app checks this before sending a
-- sign-in link; the auth hook below enforces it for direct calls to Supabase Auth as well
-- (enable it under Authentication → Hooks → "Before user created").

create table if not exists public.signup_allowlist (
  entry text primary key check (entry = lower(entry) and (entry like '@%.%' or entry like '%@%.%')),
  note text,
  created_at timestamptz not null default now()
);
alter table public.signup_allowlist enable row level security;

create or replace function public.email_may_sign_up(p_email text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.idea_members im where lower(im.email) = lower(btrim(p_email)) and im.user_id is null)
      or exists (select 1 from public.signup_allowlist a
                 where a.entry = lower(btrim(p_email)) or lower(btrim(p_email)) like '%' || a.entry);
$$;

-- Server-only check (guarded by the ingest secret, so it cannot be used to probe invitations).
create or replace function public.may_create_account(p_key text, p_email text)
returns boolean language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.ingest_key_ok(p_key) then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  return public.email_may_sign_up(p_email);
end $$;

create or replace function public.hook_before_user_created(event jsonb)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if public.email_may_sign_up(coalesce(event->'user'->>'email', '')) then
    return '{}'::jsonb;
  end if;
  return jsonb_build_object('error', jsonb_build_object(
    'http_code', 403,
    'message', 'ProofLab werkt op uitnodiging. Vraag je adviseur om een uitnodiging.'));
end $$;

revoke all on public.signup_allowlist from anon, authenticated;
revoke execute on function public.email_may_sign_up(text), public.hook_before_user_created(jsonb) from public, anon, authenticated;
revoke execute on function public.may_create_account(text, text) from public, authenticated;
grant execute on function public.may_create_account(text, text) to anon;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'supabase_auth_admin') then
    grant execute on function public.hook_before_user_created(jsonb) to supabase_auth_admin;
    grant execute on function public.email_may_sign_up(text) to supabase_auth_admin;
    grant usage on schema public to supabase_auth_admin;
    grant select on public.idea_members, public.signup_allowlist to supabase_auth_admin;
  end if;
end $$;


-- ===== 20261103090000_prediction.sql =====
-- Prediction core (research "ProofLab_Voorspelkracht_v1"): every dossier states a measurable outcome six months
-- after the decision, starts from a base rate, collects blind probability forecasts at fixed moments, and is
-- resolved against what really happened. Plus the research-method additions: support checks on quotes, review
-- of AI-coded observations, pre-mortem assumptions, ranges for market sizing and customer signals.

-- ---------------------------------------------------------------------------
-- 1. Outcome definition and base rate per idea
-- ---------------------------------------------------------------------------

alter table public.ideas
  add column if not exists outcome_statement text check (char_length(outcome_statement) <= 400),
  add column if not exists outcome_metric text check (char_length(outcome_metric) <= 160),
  add column if not exists outcome_target numeric check (outcome_target >= 0),
  add column if not exists outcome_due date,
  add column if not exists outcome_clock_start date,
  add column if not exists reference_class text,
  add column if not exists base_rate_low numeric check (base_rate_low between 0 and 1),
  add column if not exists base_rate_high numeric check (base_rate_high between 0 and 1),
  add column if not exists base_rate_note text check (char_length(base_rate_note) <= 600),
  add constraint ideas_base_rate_order check (base_rate_low is null or base_rate_high is null or base_rate_low <= base_rate_high);

-- External reference classes, read-only for everyone. Each has a source and a warning when its outcome
-- definition differs from ProofLab's own (six months after the decision).
create table public.reference_classes (
  id text primary key,
  label text not null,
  low numeric not null check (low between 0 and 1),
  high numeric not null check (high between 0 and 1 and high >= low),
  source_title text not null,
  source_url text not null,
  caveat text not null,
  position int not null default 0
);
alter table public.reference_classes enable row level security;
create policy reference_classes_read on public.reference_classes for select to authenticated using (true);

insert into public.reference_classes (id, label, low, high, source_title, source_url, caveat, position) values
  ('new_product', 'Nieuw product of nieuwe dienst (algemeen)', 0.10, 0.60,
   'Success factors of product innovation: an updated meta-analysis (Henard & Szymanski e.a.)',
   'https://research.aston.ac.uk/en/publications/success-factors-of-product-innovation-an-updated-meta-analysis',
   'Meestal genoemd: minder dan 25% slaagt. De spreiding is groot omdat sector en definitie van succes verschillen. Gaat over marktsucces op langere termijn, niet over een doel na zes maanden.', 1),
  ('new_business_nl', 'Nieuw bedrijf in Nederland, nog actief na 5 jaar', 0.52, 0.71,
   'CBS: 5-jarig overlevingspercentage van nieuwe bedrijven neemt toe (2022)',
   'https://www.cbs.nl/nl-nl/nieuws/2022/48/5-jarig-overlevingspercentage-van-nieuwe-bedrijven-neemt-toe',
   'Overleven is niet hetzelfde als het doel halen. Handel 52%, bouw 71%. Alleen bruikbaar als bovengrens voor nieuwe bedrijven.', 2),
  ('product_experiment', 'Gerichte productverbetering in een experiment', 0.10, 0.40,
   'The Base Rate for a Product Bet: experiment portfolios',
   'https://www.koji.so/docs/product-idea-base-rate-outside-view',
   'Praktijkbron, geen peer review. Gaat over losse verbeteringen in bestaande producten.', 3);

-- ---------------------------------------------------------------------------
-- 2. Blind forecasts at fixed moments
-- ---------------------------------------------------------------------------

create table public.forecasts (
  id uuid primary key default gen_random_uuid(),
  idea_id uuid not null references public.ideas(id) on delete cascade,
  moment text not null check (moment in ('intake', 'research', 'experiment', 'decision')),
  forecaster_kind text not null check (forecaster_kind in ('consultant', 'client', 'ai')),
  forecaster_id uuid references auth.users(id),
  probability numeric not null check (probability between 0.01 and 0.99),
  rationale text not null check (char_length(rationale) between 3 and 600),
  model text,
  created_at timestamptz not null default now(),
  check ((forecaster_kind = 'ai') = (forecaster_id is null))
);
create unique index forecasts_one_per_person on public.forecasts(idea_id, moment, forecaster_id) where forecaster_id is not null;
create unique index forecasts_one_ai on public.forecasts(idea_id, moment) where forecaster_kind = 'ai';
create index forecasts_idea_idx on public.forecasts(idea_id, moment);

alter table public.forecasts enable row level security;

-- Outcomes are created here already because forecast visibility depends on them (section 3).
create table public.idea_outcomes (
  idea_id uuid primary key references public.ideas(id) on delete cascade,
  achieved text not null check (achieved in ('yes', 'partial', 'no')),
  actual_value numeric,
  evidence text not null check (char_length(evidence) between 10 and 2000),
  resolved_by uuid not null default auth.uid() references auth.users(id),
  resolved_at timestamptz not null default now()
);
alter table public.idea_outcomes enable row level security;
create policy idea_outcomes_select on public.idea_outcomes for select to authenticated using (public.can_read_idea(idea_id));
create policy idea_outcomes_insert on public.idea_outcomes for insert to authenticated with check (public.can_write_idea(idea_id));
-- An outcome is a fact on the record: no update or delete policies.

-- You see the others' forecasts for a moment only after you made your own (no anchoring), or once the
-- outcome is known.
create or replace function public.forecast_visible(p_idea uuid, p_moment text, p_forecaster uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.can_read_idea(p_idea) and (
    p_forecaster = (select auth.uid())
    or exists (select 1 from public.forecasts f where f.idea_id = p_idea and f.moment = p_moment and f.forecaster_id = (select auth.uid()))
    or exists (select 1 from public.idea_outcomes o where o.idea_id = p_idea)
  );
$$;

create policy forecasts_select on public.forecasts for select to authenticated
  using (public.forecast_visible(idea_id, moment, forecaster_id));
-- People forecast as themselves, in their own role; AI forecasts are recorded by a consultant's session.
create policy forecasts_insert on public.forecasts for insert to authenticated
  with check (
    (forecaster_kind = 'consultant' and forecaster_id = (select auth.uid()) and public.can_write_idea(idea_id))
    or (forecaster_kind = 'client' and forecaster_id = (select auth.uid()) and not public.can_write_idea(idea_id) and public.can_read_idea(idea_id))
    or (forecaster_kind = 'ai' and forecaster_id is null and public.can_write_idea(idea_id))
  );
-- Forecasts are never edited or deleted: a changed opinion is a forecast at the next moment.

-- No forecasts after the outcome is known.
create or replace function public.guard_forecast()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.idea_outcomes o where o.idea_id = new.idea_id) then
    raise exception 'FORECAST_CLOSED: de uitkomst is al vastgelegd' using errcode = 'P0001';
  end if;
  new.created_at := now();
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- 3. Outcomes (resolution) and the interim check at three months
-- ---------------------------------------------------------------------------


create table public.outcome_checkins (
  id uuid primary key default gen_random_uuid(),
  idea_id uuid not null references public.ideas(id) on delete cascade,
  on_track text not null check (on_track in ('yes', 'unsure', 'no')),
  current_value numeric,
  note text not null check (char_length(note) between 3 and 1000),
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now()
);
create index outcome_checkins_idea_idx on public.outcome_checkins(idea_id, created_at desc);
alter table public.outcome_checkins enable row level security;
create policy outcome_checkins_select on public.outcome_checkins for select to authenticated using (public.can_read_idea(idea_id));
create policy outcome_checkins_insert on public.outcome_checkins for insert to authenticated with check (public.can_write_idea(idea_id));

create or replace function public.guard_outcome()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.ideas i where i.id = new.idea_id and i.outcome_statement is not null) then
    raise exception 'OUTCOME_UNDEFINED: leg eerst vast wat geslaagd betekent' using errcode = 'P0001';
  end if;
  new.resolved_by := auth.uid();
  new.resolved_at := now();
  return new;
end $$;

create trigger idea_outcomes_guard before insert on public.idea_outcomes
  for each row execute function public.guard_outcome();
create trigger forecasts_guard before insert on public.forecasts
  for each row execute function public.guard_forecast();

-- The outcome definition is fixed once the first forecast exists (no moving the goalposts).
create or replace function public.guard_outcome_definition()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  -- The definition and the base rate it starts from are fixed once forecasts exist. The due date (six
  -- months after the decision) and the decision date that starts the clock may be filled in once.
  if ((new.outcome_statement, new.outcome_metric, new.outcome_target, new.reference_class, new.base_rate_low, new.base_rate_high)
      is distinct from (old.outcome_statement, old.outcome_metric, old.outcome_target, old.reference_class, old.base_rate_low, old.base_rate_high)
      or (old.outcome_due is not null and new.outcome_due is distinct from old.outcome_due)
      or (old.outcome_clock_start is not null and new.outcome_clock_start is distinct from old.outcome_clock_start))
     and exists (select 1 from public.forecasts f where f.idea_id = new.id) then
    raise exception 'OUTCOME_LOCKED: de uitkomstdefinitie ligt vast zodra er een voorspelling is' using errcode = 'P0001';
  end if;
  return new;
end $$;

create trigger ideas_outcome_lock before update of outcome_statement, outcome_metric, outcome_target, outcome_due,
  outcome_clock_start, reference_class, base_rate_low, base_rate_high on public.ideas
  for each row execute function public.guard_outcome_definition();

-- Whether any forecast exists for an idea (also the ones the caller may not see yet), so the screen can show
-- that the definition and base rate are locked.
create or replace function public.forecasts_exist(p_idea uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.can_read_idea(p_idea) and exists (select 1 from public.forecasts f where f.idea_id = p_idea);
$$;

-- Scores per forecaster across the organisation: Brier score on resolved ideas (yes = 1, partial = 0.5, no = 0).
create or replace function public.forecast_scores(p_org uuid)
returns table (forecaster_kind text, forecaster_id uuid, forecasts bigint, brier numeric, mean_probability numeric, hit_rate numeric)
language sql stable security definer set search_path = '' as $$
  select f.forecaster_kind, f.forecaster_id, count(*),
         avg(power(f.probability - case o.achieved when 'yes' then 1 when 'partial' then 0.5 else 0 end, 2)),
         avg(f.probability),
         avg(case o.achieved when 'yes' then 1 when 'partial' then 0.5 else 0 end)
  from public.forecasts f
  join public.idea_outcomes o on o.idea_id = f.idea_id
  join public.ideas i on i.id = f.idea_id
  where i.org_id = p_org and public.is_org_member(p_org)
  group by f.forecaster_kind, f.forecaster_id;
$$;

-- Calibration buckets for the whole organisation (all resolved forecasts).
create or replace function public.forecast_calibration(p_org uuid)
returns table (bucket int, forecasts bigint, mean_probability numeric, observed numeric)
language sql stable security definer set search_path = '' as $$
  select least(9, floor(f.probability * 10))::int, count(*), avg(f.probability),
         avg(case o.achieved when 'yes' then 1 when 'partial' then 0.5 else 0 end)
  from public.forecasts f
  join public.idea_outcomes o on o.idea_id = f.idea_id
  join public.ideas i on i.id = f.idea_id
  where i.org_id = p_org and public.is_org_member(p_org)
  group by 1 order by 1;
$$;

-- Own base rate: share of resolved ideas of this organisation that reached their outcome, optionally per
-- project type. Returns nothing below the minimum number of resolved ideas.
create or replace function public.own_base_rate(p_org uuid, p_project_type text, p_min int default 10)
returns table (resolved bigint, achieved numeric)
language sql stable security definer set search_path = '' as $$
  select count(*), avg(case o.achieved when 'yes' then 1 when 'partial' then 0.5 else 0 end)
  from public.idea_outcomes o join public.ideas i on i.id = o.idea_id
  where i.org_id = p_org and public.is_org_member(p_org) and (p_project_type is null or i.project_type = p_project_type)
  having count(*) >= p_min;
$$;

-- ---------------------------------------------------------------------------
-- 4. Research methods: does the quote carry the claim, review of AI coding, pre-mortem
-- ---------------------------------------------------------------------------

alter table public.claim_sources
  add column if not exists support_check text not null default 'unchecked'
    check (support_check in ('supports', 'partial', 'not_supported', 'unchecked')),
  add column if not exists support_checked_by text check (support_checked_by in ('ai', 'consultant')),
  add column if not exists support_note text check (char_length(support_note) <= 600),
  -- What the AI said, kept next to the consultant's verdict so their agreement can be measured.
  add column if not exists ai_support_check text check (ai_support_check in ('supports', 'partial', 'not_supported')),
  -- Result of the last live recheck of this quote on its page (null = never rechecked).
  add column if not exists live_found boolean,
  add column if not exists live_checked_at timestamptz;

alter table public.sources
  add column if not exists live_checked_at timestamptz,
  add column if not exists live_error text check (char_length(live_error) <= 200);

alter table public.observations
  add column if not exists review_status text check (review_status in ('accepted', 'rejected')),
  add column if not exists reviewed_by uuid references auth.users(id),
  add column if not exists reviewed_at timestamptz;

-- AI-coded observations may be reviewed (accepted/rejected) once by a consultant; nothing else changes.
create policy observations_review on public.observations for update to authenticated
  using (public.can_write_idea(idea_id) and origin = 'ai') with check (public.can_write_idea(idea_id) and origin = 'ai');

create or replace function public.guard_observation_review()
returns trigger language plpgsql set search_path = '' as $$
begin
  -- System jobs (retention purge) run without a user and may clear quotes.
  if auth.uid() is null then
    return new;
  end if;
  if (to_jsonb(new) - 'review_status' - 'reviewed_by' - 'reviewed_at') is distinct from (to_jsonb(old) - 'review_status' - 'reviewed_by' - 'reviewed_at') then
    raise exception 'OBSERVATION_LOCKED: een observatie wordt niet herschreven' using errcode = 'P0001';
  end if;
  new.reviewed_by := auth.uid();
  new.reviewed_at := now();
  return new;
end $$;

create trigger observations_review_guard before update on public.observations
  for each row execute function public.guard_observation_review();

-- A chosen starting probability per assumption (default 50% when empty); see lib/domain/evidence.ts.
alter table public.assumptions add column if not exists prior numeric check (prior between 0.01 and 0.99);

alter table public.assumptions drop constraint if exists assumptions_origin_check;
alter table public.assumptions add constraint assumptions_origin_check check (origin in ('manual', 'ai', 'template', 'premortem'));

-- ---------------------------------------------------------------------------
-- 5. Ranges for market sizing (Monte Carlo) and customer signals
-- ---------------------------------------------------------------------------

alter table public.sizing_factors
  add column if not exists low_value numeric check (low_value >= 0),
  add column if not exists high_value numeric check (high_value >= 0),
  add constraint sizing_factors_range_order check (low_value is null or high_value is null or low_value <= high_value);

create table public.customer_signals (
  id uuid primary key default gen_random_uuid(),
  idea_id uuid not null references public.ideas(id) on delete cascade,
  kind text not null check (kind in ('job', 'pain', 'gain', 'objection')),
  label text not null check (char_length(label) between 3 and 300),
  mentions int not null check (mentions >= 1),
  quotes jsonb not null default '[]'::jsonb check (jsonb_typeof(quotes) = 'array' and pg_column_size(quotes) <= 40000),
  origin text not null default 'ai' check (origin in ('ai', 'manual')),
  created_at timestamptz not null default now()
);
create index customer_signals_idea_idx on public.customer_signals(idea_id);
alter table public.customer_signals enable row level security;
create policy customer_signals_select on public.customer_signals for select to authenticated using (public.can_read_idea(idea_id));
create policy customer_signals_insert on public.customer_signals for insert to authenticated with check (public.can_write_idea(idea_id));
create policy customer_signals_delete on public.customer_signals for delete to authenticated using (public.can_write_idea(idea_id));

-- ---------------------------------------------------------------------------
-- 6. Audit, indexes and grants
-- ---------------------------------------------------------------------------

do $$
declare t text;
begin
  foreach t in array array['forecasts', 'idea_outcomes', 'outcome_checkins', 'customer_signals'] loop
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function public.audit_row()', t || '_audit', t);
  end loop;
end $$;

create index if not exists forecasts_forecaster_fk on public.forecasts(forecaster_id);
create index if not exists idea_outcomes_resolved_by_fk on public.idea_outcomes(resolved_by);
create index if not exists outcome_checkins_created_by_fk on public.outcome_checkins(created_by);
create index if not exists observations_reviewed_by_fk on public.observations(reviewed_by);

revoke all on public.reference_classes, public.forecasts, public.idea_outcomes, public.outcome_checkins, public.customer_signals from anon;
grant select on public.reference_classes to authenticated;
grant select, insert on public.forecasts, public.idea_outcomes, public.outcome_checkins to authenticated;
grant select, insert, delete on public.customer_signals to authenticated;
revoke execute on function public.forecasts_exist(uuid), public.forecast_visible(uuid, text, uuid), public.forecast_scores(uuid), public.forecast_calibration(uuid),
  public.own_base_rate(uuid, text, int), public.guard_forecast(), public.guard_outcome(), public.guard_outcome_definition(),
  public.guard_observation_review() from public, anon;
grant execute on function public.forecast_visible(uuid, text, uuid), public.forecast_scores(uuid), public.forecast_calibration(uuid),
  public.own_base_rate(uuid, text, int), public.forecasts_exist(uuid) to authenticated;


-- ===== 20261103100000_coach_and_signals.sql =====
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


-- ===== 20261103120000_surveys.sql =====
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


-- ===== 20261103130000_review_fixes.sql =====
-- Fixes from the independent review of 3 November 2026.

-- ---------------------------------------------------------------------------
-- 1. Forecasts only at the open moment; AI forecasts only from the app server
-- ---------------------------------------------------------------------------
-- The moment that is open follows the dossier: intake → research (findings and current alternatives mapped)
-- → experiment (a test has ended) → decision (a Reality Check exists; closes 14 days after the decision that
-- started the six-month clock). Same rule as lib/domain/forecast.ts openMoment.

create or replace function public.open_forecast_moment(p_idea uuid)
returns text language sql stable security definer set search_path = '' as $$
  select case
    when not exists (select 1 from public.ideas i where i.id = p_idea and i.outcome_statement is not null) then null
    when exists (select 1 from public.idea_outcomes o where o.idea_id = p_idea) then null
    when exists (select 1 from public.reality_checks r where r.idea_id = p_idea) then
      case when exists (select 1 from public.ideas i where i.id = p_idea and i.outcome_clock_start is not null
                        and current_date > i.outcome_clock_start + 14) then null else 'decision' end
    when exists (select 1 from public.experiments e where e.idea_id = p_idea and e.state in ('ended', 'analyzed', 'decided')) then 'experiment'
    when exists (select 1 from public.claims c where c.idea_id = p_idea)
      and exists (select 1 from public.competitors c where c.idea_id = p_idea and c.kind in ('alternative', 'status_quo')) then 'research'
    else 'intake'
  end;
$$;

create or replace function public.guard_forecast()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_open text;
begin
  if exists (select 1 from public.idea_outcomes o where o.idea_id = new.idea_id) then
    raise exception 'FORECAST_CLOSED: de uitkomst is al vastgelegd' using errcode = 'P0001';
  end if;
  v_open := public.open_forecast_moment(new.idea_id);
  if v_open is null or v_open <> new.moment then
    raise exception 'FORECAST_MOMENT: voorspellen kan nu alleen bij het open moment (%)', coalesce(v_open, 'geen') using errcode = 'P0001';
  end if;
  new.created_at := now();
  return new;
end $$;

drop policy if exists forecasts_insert on public.forecasts;
create policy forecasts_insert on public.forecasts for insert to authenticated
  with check (
    (forecaster_kind = 'consultant' and forecaster_id = (select auth.uid()) and public.can_write_idea(idea_id))
    or (forecaster_kind = 'client' and forecaster_id = (select auth.uid()) and not public.can_write_idea(idea_id) and public.can_read_idea(idea_id))
  );

-- The app server records the AI forecast after its own model call (guarded by the ingest secret, so a user
-- cannot type in an "AI" forecast through the API).
create or replace function public.record_ai_forecast(p_key text, p_idea uuid, p_moment text, p_probability numeric, p_rationale text, p_model text)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if not public.ingest_key_ok(p_key) or not public.can_write_idea(p_idea) then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  insert into public.forecasts (idea_id, moment, forecaster_kind, forecaster_id, probability, rationale, model)
  values (p_idea, p_moment, 'ai', null, greatest(0.01, least(0.99, p_probability)), left(p_rationale, 600), left(p_model, 80))
  on conflict do nothing;
  return found;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Outreach webhook: say why an event was not recorded, and allow campaign bursts
-- ---------------------------------------------------------------------------

create or replace function public.ingest_allowed(p_bucket text, p_limit int)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_hits int;
begin
  insert into public.ingest_rate as r (bucket, hits, window_start) values (left(p_bucket, 128), 1, now())
  on conflict (bucket) do update set
    hits = case when r.window_start < now() - interval '1 minute' then 1 else r.hits + 1 end,
    window_start = case when r.window_start < now() - interval '1 minute' then now() else r.window_start end
  returning hits into v_hits;
  delete from public.ingest_rate where window_start < now() - interval '1 hour';
  return v_hits <= p_limit;
end $$;

create or replace function public.ingest_allowed(p_bucket text)
returns boolean language sql security definer set search_path = '' as $$
  select public.ingest_allowed(p_bucket, 30);
$$;

drop function if exists public.record_outreach_event(text, text, text, text, text, text, text);
-- Returns ok, duplicate, unknown (token) or rate (try again later).
create or replace function public.record_outreach_event(
  p_key text, p_token_hash text, p_event text, p_contact_hash text, p_campaign text, p_message text, p_dedupe text)
returns text language plpgsql security definer set search_path = '' as $$
declare
  ep public.integration_endpoints;
  v_rows int;
begin
  if not public.ingest_key_ok(p_key) then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  select * into ep from public.integration_endpoints where token_hash = p_token_hash and active;
  if ep.id is null then
    return 'unknown';
  end if;
  if exists (select 1 from public.outreach_events o where o.endpoint_id = ep.id and o.dedupe_key = left(p_dedupe, 200)) then
    return 'duplicate';
  end if;
  -- A campaign launch can send hundreds of events at once; 600 per minute per endpoint.
  if not public.ingest_allowed('outreach:' || ep.id::text, 600) then
    return 'rate';
  end if;
  insert into public.outreach_events (idea_id, endpoint_id, event_type, contact_hash, campaign, message, dedupe_key)
  values (ep.idea_id, ep.id,
          case when p_event in ('connection_request', 'connection_accepted', 'message_sent', 'reply') then p_event else 'other' end,
          left(p_contact_hash, 64), left(p_campaign, 200), left(p_message, 4000), left(p_dedupe, 200))
  on conflict (endpoint_id, dedupe_key) do nothing;
  get diagnostics v_rows = row_count;
  update public.integration_endpoints set last_event_at = now() where id = ep.id;
  return case when v_rows > 0 then 'ok' else 'duplicate' end;
end $$;

-- ---------------------------------------------------------------------------
-- 3. Personal texts (outreach replies, open survey answers) stay with consultants and expire
-- ---------------------------------------------------------------------------

drop policy if exists source_excerpts_select on public.source_excerpts;
create policy source_excerpts_select on public.source_excerpts for select to authenticated
  using (
    public.can_write_idea(idea_id)
    or (public.can_read_idea(idea_id)
        and not exists (select 1 from public.sources s where s.id = source_excerpts.source_id and s.source_type in ('outreach', 'survey')))
  );

-- Customer signals quote people literally; clients see the summary in the report, not the quotes.
drop policy if exists customer_signals_select on public.customer_signals;
create policy customer_signals_select on public.customer_signals for select to authenticated using (public.can_write_idea(idea_id));

create or replace function public.purge_expired_personal_data()
returns int language plpgsql security definer set search_path = '' as $$
declare v1 int; v2 int; v3 int; v4 int; v5 int;
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
  update public.survey_invitations set email = 'verwijderd-' || id::text || '@invalid'
  where retention_until < current_date and email not like 'verwijderd-%';
  get diagnostics v4 = row_count;
  update public.survey_responses set answers = (
      select coalesce(jsonb_object_agg(k, case when jsonb_typeof(v) = 'string' and length(v #>> '{}') > 40 then to_jsonb('[verwijderd]'::text) else v end), '{}'::jsonb)
      from jsonb_each(answers) as t(k, v))
  where retention_until < current_date;
  -- Copies of outreach replies (180 days) and open survey answers (365 days) in the source library.
  delete from public.source_excerpts x using public.sources s
  where x.source_id = s.id
    and ((s.source_type = 'outreach' and s.created_at < now() - interval '180 days')
      or (s.source_type = 'survey' and s.created_at < now() - interval '365 days'));
  get diagnostics v5 = row_count;
  -- Signal quotes whose fragment is gone are removed; the label and count stay.
  update public.customer_signals cs set quotes = coalesce((
      select jsonb_agg(q) from jsonb_array_elements(cs.quotes) q
      where exists (select 1 from public.source_excerpts x where x.id::text = q->>'excerpt_id')), '[]'::jsonb)
  where exists (select 1 from jsonb_array_elements(cs.quotes) q
                where not exists (select 1 from public.source_excerpts x where x.id::text = q->>'excerpt_id'));
  return v1 + v2 + v3 + v4 + v5;
end $$;

-- Clients compute the same probabilities as consultants: the scoring fields (and the review status of AI
-- coding) are readable for everyone on the dossier; the literal quote stays with consultants.
drop function if exists public.observations_for_idea(uuid);
create or replace function public.observations_for_idea(p_idea uuid)
returns table (
  id uuid, idea_id uuid, experiment_id uuid, interview_id uuid, kind text, summary text, quote text,
  quote_check text, is_fact boolean, is_behaviour boolean, is_real_context boolean, is_costly boolean,
  is_synthetic boolean, origin text, review_status text, created_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select o.id, o.idea_id, o.experiment_id, o.interview_id, o.kind, o.summary,
         case when public.can_write_idea(o.idea_id) then o.quote else null end,
         o.quote_check, o.is_fact, o.is_behaviour, o.is_real_context, o.is_costly, o.is_synthetic,
         o.origin, o.review_status, o.created_at
  from public.observations o
  where o.idea_id = p_idea and public.can_read_idea(p_idea);
$$;
revoke execute on function public.observations_for_idea(uuid) from public, anon;
grant execute on function public.observations_for_idea(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

revoke execute on function public.open_forecast_moment(uuid), public.record_ai_forecast(text, uuid, text, numeric, text, text),
  public.ingest_allowed(text, int), public.record_outreach_event(text, text, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.open_forecast_moment(uuid), public.record_ai_forecast(text, uuid, text, numeric, text, text) to authenticated;
grant execute on function public.record_outreach_event(text, text, text, text, text, text, text) to anon;
revoke execute on function public.ingest_allowed(text) from public, anon, authenticated;


-- ===== 20261103140000_survey_key_answers.sql =====
-- Opdrachtgevers (readers) see the outcome of a survey on the experiment page: only the answer to the
-- pre-registered key question (a choice question, so no free text), with source, channel and duration for
-- the plausibility checks. Every other answer stays with the research team.

create or replace function public.survey_key_answers(p_experiment uuid)
returns table (id uuid, source text, channel text, duration_ms int, created_at timestamptz, key_answer jsonb)
language sql stable security definer set search_path = '' as $$
  select r.id, r.source, r.channel, r.duration_ms, r.created_at,
         case when jsonb_typeof(r.answers -> (e.config ->> 'key_question')) in ('string', 'array')
              then r.answers -> (e.config ->> 'key_question') end
  from public.survey_responses r
  join public.experiments e on e.id = r.experiment_id
  where r.experiment_id = p_experiment and e.type = 'survey' and public.can_read_idea(e.idea_id)
  order by r.created_at, r.id;
$$;
revoke execute on function public.survey_key_answers(uuid) from public, anon;
grant execute on function public.survey_key_answers(uuid) to authenticated;


-- ===== 20261104090000_survey_quality.sql =====
-- Survey quality: screening, attention checks, straightlining, key-metric counting in the database and
-- per-question summaries that consultants can share with clients.
--
-- One source of truth for "believable": the TypeScript rule assessResponse() in lib/domain/survey.ts. The submit
-- route validates the answers against the locked survey, applies that rule and passes the outcome to
-- submit_survey(), which stores it in survey_responses.qualified and .quality. The database never re-implements
-- the rule: survey_key_counts() only counts the stored flags (and the pre-registered success options of the key
-- question). Rows stored before this migration are backfilled once below with the duration rule they were
-- judged by until now (two seconds per question, at least eight seconds).

-- ---------------------------------------------------------------------------
-- 1. Stored quality flags
-- ---------------------------------------------------------------------------

alter table public.survey_responses
  add column qualified boolean,
  add column quality text check (quality in ('ok', 'too_fast', 'attention', 'straightlining'));

update public.survey_responses r
set qualified = true,
    quality = case
      when r.duration_ms is not null
       and r.duration_ms < greatest(8000, coalesce(jsonb_array_length(e.config -> 'questions'), 0) * 2000) then 'too_fast'
      else 'ok' end
from public.experiments e
where e.id = r.experiment_id and r.quality is null;

alter table public.survey_responses alter column qualified set not null, alter column quality set not null;

-- ---------------------------------------------------------------------------
-- 2. Public RPCs
-- ---------------------------------------------------------------------------

-- The respondent's view: also without the qualifying screening answers and the correct answer of attention checks.
create or replace function public.get_public_survey(p_slug text, p_token_hash text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', e.id, 'state', e.state,
    'config', (e.config - 'key_question' - 'success_options') #- '{screening,qualifying}'
      || jsonb_build_object('questions', coalesce((
           select jsonb_agg(q.value - 'attention' order by q.ordinality)
           from jsonb_array_elements(case when jsonb_typeof(e.config -> 'questions') = 'array' then e.config -> 'questions' else '[]'::jsonb end)
             with ordinality as q(value, ordinality)), '[]'::jsonb)),
    'ends_at', e.ends_at,
    'invitation', case when p_token_hash is null then null else (
      select jsonb_build_object('status', i.status) from public.survey_invitations i
      where i.token_hash = p_token_hash and i.experiment_id = e.id) end)
  from public.experiments e
  where e.public_slug = p_slug and e.type = 'survey' and e.state in ('approved', 'live', 'paused', 'ended', 'analyzed', 'decided');
$$;

-- The complete, locked survey for the app server (ingest secret), which validates and assesses answers with it.
create or replace function public.get_survey_config(p_key text, p_slug text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.ingest_key_ok(p_key) then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  return (select e.config from public.experiments e
          where e.public_slug = p_slug and e.type = 'survey' and e.state in ('approved', 'live', 'paused', 'ended', 'analyzed', 'decided'));
end $$;

drop function public.submit_survey(text, text, text, text, jsonb, boolean, int, text, text);

-- p_qualified and p_quality: the outcome of assessResponse() in the app server (see the header of this file).
create function public.submit_survey(
  p_key text, p_slug text, p_visitor text, p_channel text, p_answers jsonb, p_consent boolean,
  p_duration_ms int, p_token_hash text, p_rate_bucket text, p_qualified boolean, p_quality text)
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
  if pg_column_size(coalesce(p_answers, '{}'::jsonb)) > 20000 or jsonb_typeof(coalesce(p_answers, '{}'::jsonb)) <> 'object'
     or p_qualified is null or p_quality is null or p_quality not in ('ok', 'too_fast', 'attention', 'straightlining') then
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
  insert into public.survey_responses (experiment_id, idea_id, visitor_hash, invitation_id, source, channel, answers, consent_given, duration_ms, qualified, quality)
  values (e.id, e.idea_id, left(p_visitor, 64), inv.id,
          case when inv.id is null then 'open_link' else 'invitation' end,
          left(coalesce(nullif(p_channel, ''), case when inv.id is null then 'direct' else 'email' end), 40),
          p_answers, true, greatest(0, least(coalesce(p_duration_ms, 0), 86400000)), p_qualified, p_quality)
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

-- ---------------------------------------------------------------------------
-- 3. The key metric, counted in the database
-- ---------------------------------------------------------------------------

-- Per source × channel: all responses, believable answers to the key question (n) and how many chose a success
-- option, plus the excluded responses by reason. Readable for everyone who can read the dossier (clients too):
-- counts only, no answers. Replaces loading every row through survey_key_answers() on each page view.
create or replace function public.survey_key_counts(p_experiment uuid)
returns table (source text, channel text, responses int, n int, successes int, too_fast int, screened_out int, failed_attention int, straightlining int)
language sql stable security definer set search_path = '' as $$
  with e as (
    select x.id, x.config ->> 'key_question' as key_q,
           array(select jsonb_array_elements_text(case when jsonb_typeof(x.config -> 'success_options') = 'array' then x.config -> 'success_options' else '[]'::jsonb end)) as success
    from public.experiments x
    where x.id = p_experiment and x.type = 'survey' and public.can_read_idea(x.idea_id)
  ), r as (
    select r.source, r.channel, r.qualified, r.quality,
           case jsonb_typeof(r.answers -> e.key_q)
             when 'string' then jsonb_build_array(r.answers -> e.key_q)
             when 'array' then r.answers -> e.key_q end as key_answer,
           e.success
    from public.survey_responses r join e on e.id = r.experiment_id
  )
  select r.source, r.channel,
         count(*)::int,
         count(*) filter (where r.qualified and r.quality = 'ok' and r.key_answer is not null)::int,
         count(*) filter (where r.qualified and r.quality = 'ok' and r.key_answer is not null and r.key_answer ?| r.success)::int,
         count(*) filter (where r.qualified and r.quality = 'too_fast')::int,
         count(*) filter (where not r.qualified)::int,
         count(*) filter (where r.qualified and r.quality = 'attention')::int,
         count(*) filter (where r.qualified and r.quality = 'straightlining')::int
  from r
  group by r.source, r.channel
  order by r.source, r.channel;
$$;

-- ---------------------------------------------------------------------------
-- 4. Sharing per-question summaries with clients
-- ---------------------------------------------------------------------------

-- Which closed questions (choice, scale, number; never open text) the research team shows to clients. A separate
-- table because experiments.config is locked after approval, while sharing is decided when results come in.
create table public.survey_shares (
  id uuid primary key default gen_random_uuid(),
  experiment_id uuid not null unique references public.experiments(id) on delete cascade,
  idea_id uuid not null references public.ideas(id) on delete cascade,
  questions text[] not null default '{}' check (cardinality(questions) <= 25),
  updated_by uuid not null default auth.uid() references auth.users(id),
  updated_at timestamptz not null default now()
);
create index survey_shares_idea_idx on public.survey_shares(idea_id);
create index survey_shares_updated_by_fk on public.survey_shares(updated_by);
alter table public.survey_shares enable row level security;
create policy survey_shares_select on public.survey_shares for select to authenticated using (public.can_read_idea(idea_id));
create policy survey_shares_insert on public.survey_shares for insert to authenticated with check (public.can_write_idea(idea_id));
create policy survey_shares_update on public.survey_shares for update to authenticated
  using (public.can_write_idea(idea_id)) with check (public.can_write_idea(idea_id));
create policy survey_shares_delete on public.survey_shares for delete to authenticated using (public.can_write_idea(idea_id));
-- Who changed the sharing and when is set by the database, not by the client.
create or replace function public.stamp_survey_share()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_by := coalesce(auth.uid(), new.updated_by);
  new.updated_at := now();
  if tg_op = 'UPDATE' then
    new.experiment_id := old.experiment_id;
    new.idea_id := old.idea_id;
  end if;
  return new;
end $$;
create trigger survey_shares_stamp before insert or update on public.survey_shares
  for each row execute function public.stamp_survey_share();
create trigger survey_shares_refs before insert or update on public.survey_shares
  for each row execute function public.check_idea_refs('experiment_id', 'experiments');
create trigger survey_shares_audit after insert or update or delete on public.survey_shares
  for each row execute function public.audit_row();

-- Counts per answer value for the shared closed questions, over believable responses from the target group only.
-- Open answers, attention checks and questions that were not shared never leave the database this way. Below
-- five believable answers a shared question returns nothing (a single answer could be recognised; the app uses
-- the same minimum: SHARE_MIN_N in lib/domain/survey-results.ts).
create or replace function public.survey_shared_summaries(p_experiment uuid)
returns table (question_id text, value text, answers int, count int)
language sql stable security definer set search_path = '' as $$
  with e as (
    select x.id, x.config from public.experiments x
    where x.id = p_experiment and x.type = 'survey' and public.can_read_idea(x.idea_id)
  ), q as (
    select qq ->> 'id' as qid
    from e, jsonb_array_elements(case when jsonb_typeof(e.config -> 'questions') = 'array' then e.config -> 'questions' else '[]'::jsonb end) qq
    where qq ->> 'type' in ('single', 'multi', 'scale', 'number') and not (qq ? 'attention')
      and (qq ->> 'id') = any (select unnest(s.questions) from public.survey_shares s where s.experiment_id = e.id)
  ), a as (
    select q.qid, r.answers -> q.qid as v
    from public.survey_responses r join e on e.id = r.experiment_id cross join q
    where r.qualified and r.quality = 'ok' and jsonb_typeof(r.answers -> q.qid) in ('string', 'number', 'array')
  ), n as (
    select a.qid, count(*)::int as answers from a group by a.qid having count(*) >= 5
  ), vals as (
    select a.qid, x.value from a cross join lateral jsonb_array_elements_text(a.v) x where jsonb_typeof(a.v) = 'array'
    union all
    select a.qid, a.v #>> '{}' from a where jsonb_typeof(a.v) <> 'array'
  )
  select vals.qid, vals.value, n.answers, count(*)::int
  from vals join n on n.qid = vals.qid
  group by vals.qid, vals.value, n.answers
  order by vals.qid, vals.value;
$$;

-- ---------------------------------------------------------------------------
-- 5. Grants
-- ---------------------------------------------------------------------------

revoke execute on function public.stamp_survey_share() from public, anon, authenticated;
revoke all on public.survey_shares from anon;
grant select, insert, update, delete on public.survey_shares to authenticated;

revoke execute on function public.get_survey_config(text, text),
  public.submit_survey(text, text, text, text, jsonb, boolean, int, text, text, boolean, text) from public, authenticated;
grant execute on function public.get_survey_config(text, text),
  public.submit_survey(text, text, text, text, jsonb, boolean, int, text, text, boolean, text) to anon;

revoke execute on function public.survey_key_counts(uuid), public.survey_shared_summaries(uuid) from public, anon;
grant execute on function public.survey_key_counts(uuid), public.survey_shared_summaries(uuid) to authenticated;


-- ===== 20261104100000_privacy_and_outreach.sql =====
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


-- ===== 20261104110000_ops.sql =====
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


-- ===== 20261104120000_jobs.sql =====
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


-- ===== 20261104130000_learning.sql =====
-- Learning from outcomes (docs/ProofLab_Voorspelkracht_v1.md §8): learned evidence weights per organisation
-- (opt-in), survey versus behaviour agreement, coach tip effectiveness with a "was this useful?" vote.
-- The functions return counts only; lib/domain/calibration.ts computes everything from them.

-- ---------------------------------------------------------------------------
-- 1. Organisation setting: use learned evidence weights (default off)
-- ---------------------------------------------------------------------------

alter table public.organizations
  add column if not exists use_learned_weights boolean not null default false,
  add column if not exists learned_weights_changed_at timestamptz,
  add column if not exists learned_weights_changed_by uuid references auth.users(id);
create index if not exists organizations_learned_weights_changed_by_fk on public.organizations(learned_weights_changed_by);

-- Who switched it, and when, is always stamped by the database (also when an owner updates the row directly).
create or replace function public.stamp_learned_weights()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.use_learned_weights is distinct from old.use_learned_weights then
    new.learned_weights_changed_at := now();
    new.learned_weights_changed_by := auth.uid();
  else
    new.learned_weights_changed_at := old.learned_weights_changed_at;
    new.learned_weights_changed_by := old.learned_weights_changed_by;
  end if;
  return new;
end $$;

create trigger organizations_learned_weights_stamp before update on public.organizations
  for each row execute function public.stamp_learned_weights();

-- Every consultant of the organisation (not only the owner) may switch learned weights on or off.
create or replace function public.set_learned_weights(p_org uuid, p_on boolean)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or not public.is_org_member(p_org) then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  update public.organizations set use_learned_weights = p_on where id = p_org;
  return p_on;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Counts for learned evidence weights
-- ---------------------------------------------------------------------------

-- Per resolved dossier of the organisation and per observation kind / test type: the net direction of the
-- evidence (more supporting than contradicting = positive). Synthetic observations and AI coding that no
-- consultant accepted are left out; counter-evidence kinds always count against (as in evidence.ts). For
-- tests the latest approved Learning Card per experiment gives the verdict (inconclusive = no result).
-- Plus one 'resolved' row per outcome with the number of resolved dossiers.
-- Internal: no access check, not executable by users. Wrapped below for members and for idea readers.
create or replace function public.learning_counts_internal(p_org uuid)
returns table (dimension text, kind text, achieved text, direction text, dossiers bigint)
language sql stable security definer set search_path = '' as $$
  with resolved as (
    select o.idea_id, o.achieved
    from public.idea_outcomes o join public.ideas i on i.id = o.idea_id
    where i.org_id = p_org
  ),
  obs as (
    select r.idea_id, r.achieved, ob.kind,
           sum(case when ob.kind in ('objection', 'problem_absent', 'counter_example') or ao.relation = 'contradicts' then -1 else 1 end) as net
    from resolved r
    join public.observations ob on ob.idea_id = r.idea_id
    join public.assumption_observations ao on ao.observation_id = ob.id
    where not ob.is_synthetic and (ob.origin <> 'ai' or ob.review_status = 'accepted')
    group by r.idea_id, r.achieved, ob.kind
  ),
  tests as (
    select r.idea_id, r.achieved, e.type as kind,
           sum(case lc.verdict when 'pass' then 1 when 'fail' then -1 else 0 end) as net
    from resolved r
    join public.experiments e on e.idea_id = r.idea_id
    join lateral (
      select c.verdict from public.learning_cards c
      where c.experiment_id = e.id and c.status = 'approved'
      order by c.version desc, c.created_at desc limit 1
    ) lc on true
    group by r.idea_id, r.achieved, e.type
  )
  select 'resolved'::text, ''::text, achieved, ''::text, count(*) from resolved group by achieved
  union all
  select 'observation', kind, achieved, case when net > 0 then 'positive' else 'negative' end, count(*)
  from obs where net <> 0 group by 2, 3, 4
  union all
  select 'test', kind, achieved, case when net > 0 then 'positive' else 'negative' end, count(*)
  from tests where net <> 0 group by 2, 3, 4;
$$;

-- For the learning page: consultants of the organisation only.
create or replace function public.learning_evidence_counts(p_org uuid)
returns table (dimension text, kind text, achieved text, direction text, dossiers bigint)
language sql stable security definer set search_path = '' as $$
  select c.* from public.learning_counts_internal(p_org) c where public.is_org_member(p_org);
$$;

-- For computing the probabilities of one idea, by everyone who may read it (also an invited client, so
-- client and consultant see the same numbers): whether the idea's organisation uses learned weights, and if
-- so the anonymous counts (no idea ids, no text) they are learned from.
create or replace function public.idea_uses_learned_weights(p_idea uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select o.use_learned_weights from public.ideas i join public.organizations o on o.id = i.org_id
                   where i.id = p_idea and public.can_read_idea(p_idea)), false);
$$;

create or replace function public.idea_learning_counts(p_idea uuid)
returns table (dimension text, kind text, achieved text, direction text, dossiers bigint)
language sql stable security definer set search_path = '' as $$
  select c.* from public.ideas i
  join public.organizations o on o.id = i.org_id and o.use_learned_weights
  cross join lateral public.learning_counts_internal(i.org_id) c
  where i.id = p_idea and public.can_read_idea(p_idea);
$$;

-- Survey key metric versus behaviour test (landing or pricing) on the same assumption: per assumption the
-- verdicts of each side (pass, fail, or mixed when its tests disagree), counted per combination.
create or replace function public.survey_behaviour_agreement(p_org uuid)
returns table (survey_verdict text, behaviour_verdict text, assumptions bigint)
language sql stable security definer set search_path = '' as $$
  with v as (
    select h.assumption_id, case when e.type = 'survey' then 'survey' else 'behaviour' end as side, lc.verdict
    from public.experiments e
    join public.hypotheses h on h.id = e.hypothesis_id
    join public.ideas i on i.id = e.idea_id
    join lateral (
      select c.verdict from public.learning_cards c
      where c.experiment_id = e.id and c.status = 'approved'
      order by c.version desc, c.created_at desc limit 1
    ) lc on true
    where i.org_id = p_org and public.is_org_member(p_org)
      and e.type in ('survey', 'landing', 'pricing') and lc.verdict in ('pass', 'fail')
  ),
  per as (
    select assumption_id, side,
           case when bool_and(verdict = 'pass') then 'pass' when bool_and(verdict = 'fail') then 'fail' else 'mixed' end as verdict
    from v group by assumption_id, side
  )
  select s.verdict, b.verdict, count(*)
  from per s join per b on b.assumption_id = s.assumption_id and b.side = 'behaviour'
  where s.side = 'survey'
  group by s.verdict, b.verdict;
$$;

-- ---------------------------------------------------------------------------
-- 3. Coach tips: "was this useful?" and statistics per rule
-- ---------------------------------------------------------------------------

alter table public.coach_notes add column if not exists helpful boolean;

-- The content of a note stays what the coach said at the time; the status and the helpful vote may change.
create or replace function public.guard_coach_note()
returns trigger language plpgsql set search_path = '' as $$
begin
  if (to_jsonb(new) - 'status' - 'resolved_at' - 'resolved_by' - 'helpful') is distinct from (to_jsonb(old) - 'status' - 'resolved_at' - 'resolved_by' - 'helpful') then
    raise exception 'COACH_NOTE_LOCKED: alleen de status van een coachnotitie verandert' using errcode = 'P0001';
  end if;
  if new.status <> 'open' and old.status = 'open' then
    new.resolved_at := now();
    new.resolved_by := auth.uid();
  elsif new.status is not distinct from old.status then
    new.resolved_at := old.resolved_at;
    new.resolved_by := old.resolved_by;
  end if;
  return new;
end $$;

-- One row per coach note of the organisation, without its text: the rule (code up to the first ':', 'ai'
-- for AI notes), status, days until resolved, the helpful vote, and for resolved dossiers the mean Brier
-- score of the human forecasts at the decision moment.
create or replace function public.coach_note_stats(p_org uuid)
returns table (idea_id uuid, rule text, status text, days_to_resolve numeric, helpful boolean, decision_brier numeric)
language sql stable security definer set search_path = '' as $$
  select n.idea_id,
         case when n.source = 'ai' then 'ai' else split_part(n.code, ':', 1) end,
         n.status,
         case when n.resolved_at is not null then round((extract(epoch from (n.resolved_at - n.created_at)) / 86400)::numeric, 2) end,
         n.helpful,
         (select avg(power(f.probability - case o.achieved when 'yes' then 1 when 'partial' then 0.5 else 0 end, 2))
            from public.forecasts f join public.idea_outcomes o on o.idea_id = f.idea_id
           where f.idea_id = n.idea_id and f.moment = 'decision' and f.forecaster_kind <> 'ai')
  from public.coach_notes n
  join public.ideas i on i.id = n.idea_id
  where i.org_id = p_org and public.is_org_member(p_org);
$$;

-- ---------------------------------------------------------------------------
-- 4. Grants
-- ---------------------------------------------------------------------------

revoke execute on function public.stamp_learned_weights(), public.set_learned_weights(uuid, boolean), public.learning_counts_internal(uuid),
  public.learning_evidence_counts(uuid), public.idea_uses_learned_weights(uuid), public.idea_learning_counts(uuid),
  public.survey_behaviour_agreement(uuid), public.coach_note_stats(uuid) from public, anon;
revoke execute on function public.stamp_learned_weights(), public.learning_counts_internal(uuid) from authenticated;
grant execute on function public.set_learned_weights(uuid, boolean), public.learning_evidence_counts(uuid), public.idea_uses_learned_weights(uuid),
  public.idea_learning_counts(uuid), public.survey_behaviour_agreement(uuid), public.coach_note_stats(uuid) to authenticated;


-- ===== 20261104140000_survey_reconcile.sql =====
-- Reconciles two migrations that both redefined submit_survey from the surveys.sql version:
--   20261104090000_survey_quality.sql      added p_qualified, p_quality (stored quality flags)
--   20261104100000_privacy_and_outreach.sql added p_content (post code of an open link)
-- After both ran, two overloads existed and the p_content one inserted no quality flags (NOT NULL columns). This
-- leaves exactly one submit_survey with all parameters, and counts the key metric per post code as well, using the
-- stored flags, so per-post survey numbers follow the same believability rule as the verdict.

drop function if exists public.submit_survey(text, text, text, text, jsonb, boolean, int, text, text);
drop function if exists public.submit_survey(text, text, text, text, jsonb, boolean, int, text, text, text);
drop function if exists public.submit_survey(text, text, text, text, jsonb, boolean, int, text, text, boolean, text);

-- p_qualified and p_quality: the outcome of assessResponse() in the app server (see 20261104090000). p_content: the
-- post code (utm_content) of an open link; never stored for invitations.
create function public.submit_survey(
  p_key text, p_slug text, p_visitor text, p_channel text, p_answers jsonb, p_consent boolean,
  p_duration_ms int, p_token_hash text, p_rate_bucket text, p_qualified boolean, p_quality text,
  p_content text default null)
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
  if pg_column_size(coalesce(p_answers, '{}'::jsonb)) > 20000 or jsonb_typeof(coalesce(p_answers, '{}'::jsonb)) <> 'object'
     or p_qualified is null or p_quality is null or p_quality not in ('ok', 'too_fast', 'attention', 'straightlining') then
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
  insert into public.survey_responses (experiment_id, idea_id, visitor_hash, invitation_id, source, channel, answers, consent_given, duration_ms, content, qualified, quality)
  values (e.id, e.idea_id, left(p_visitor, 64), inv.id,
          case when inv.id is null then 'open_link' else 'invitation' end,
          left(coalesce(nullif(p_channel, ''), case when inv.id is null then 'direct' else 'email' end), 40),
          p_answers, true, greatest(0, least(coalesce(p_duration_ms, 0), 86400000)),
          case when inv.id is null then public.clean_content(p_content) end,
          p_qualified, p_quality)
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

-- The key metric per source × channel × post code (content null: no post code). Same counting as before; callers
-- that do not need the post code sum over it.
drop function if exists public.survey_key_counts(uuid);
create function public.survey_key_counts(p_experiment uuid)
returns table (source text, channel text, content text, responses int, n int, successes int, too_fast int, screened_out int, failed_attention int, straightlining int)
language sql stable security definer set search_path = '' as $$
  with e as (
    select x.id, x.config ->> 'key_question' as key_q,
           array(select jsonb_array_elements_text(case when jsonb_typeof(x.config -> 'success_options') = 'array' then x.config -> 'success_options' else '[]'::jsonb end)) as success
    from public.experiments x
    where x.id = p_experiment and x.type = 'survey' and public.can_read_idea(x.idea_id)
  ), r as (
    select r.source, r.channel, r.content, r.qualified, r.quality,
           case jsonb_typeof(r.answers -> e.key_q)
             when 'string' then jsonb_build_array(r.answers -> e.key_q)
             when 'array' then r.answers -> e.key_q end as key_answer,
           e.success
    from public.survey_responses r join e on e.id = r.experiment_id
  )
  select r.source, r.channel, r.content,
         count(*)::int,
         count(*) filter (where r.qualified and r.quality = 'ok' and r.key_answer is not null)::int,
         count(*) filter (where r.qualified and r.quality = 'ok' and r.key_answer is not null and r.key_answer ?| r.success)::int,
         count(*) filter (where r.qualified and r.quality = 'too_fast')::int,
         count(*) filter (where not r.qualified)::int,
         count(*) filter (where r.qualified and r.quality = 'attention')::int,
         count(*) filter (where r.qualified and r.quality = 'straightlining')::int
  from r
  group by r.source, r.channel, r.content
  order by r.source, r.channel, r.content nulls first;
$$;

revoke execute on function public.submit_survey(text, text, text, text, jsonb, boolean, int, text, text, boolean, text, text) from public, authenticated;
grant execute on function public.submit_survey(text, text, text, text, jsonb, boolean, int, text, text, boolean, text, text) to anon;
revoke execute on function public.survey_key_counts(uuid) from public, anon;
grant execute on function public.survey_key_counts(uuid) to authenticated;


-- ===== 20261104150000_jobs_reconcile.sql =====
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


-- ===== Migratiegeschiedenis gelijk met de repository =====
update supabase_migrations.schema_migrations set version = '20261027190000' where version = '20261027185423' and name = 'core_schema';
insert into supabase_migrations.schema_migrations (version, name) values
  ('20261027190100', 'security'),
  ('20261028090000', 'hardening'),
  ('20261029090000', 'integrity'),
  ('20261103090000', 'prediction'),
  ('20261103100000', 'coach_and_signals'),
  ('20261103120000', 'surveys'),
  ('20261103130000', 'review_fixes'),
  ('20261103140000', 'survey_key_answers'),
  ('20261104090000', 'survey_quality'),
  ('20261104100000', 'privacy_and_outreach'),
  ('20261104110000', 'ops'),
  ('20261104120000', 'jobs'),
  ('20261104130000', 'learning'),
  ('20261104140000', 'survey_reconcile'),
  ('20261104150000', 'jobs_reconcile')
on conflict (version) do nothing;

commit;
