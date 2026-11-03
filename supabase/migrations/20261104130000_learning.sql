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
