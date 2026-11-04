-- Fase B0, aanvulling. Door de product owner goedgekeurd (3 november 2026). Geen data gewijzigd of verwijderd.
begin;

-- 1. Echte gesprekken voor iedereen die het dossier mag lezen. Opdrachtgevers mogen de tabel interviews niet lezen;
--    zonder deze functie telde interviewbewijs op hun scherm niet mee en zagen zij lagere kansen dan de consultant.
--    Alleen de ids van gesprekken die als echt zijn aangegeven, geen inhoud.
create or replace function public.real_interview_ids(p_idea uuid)
returns setof uuid
language sql stable security definer set search_path = '' as $$
  select i.id from public.interviews i
  where i.idea_id = p_idea and i.is_practice is false and public.can_read_idea(p_idea);
$$;
revoke execute on function public.real_interview_ids(uuid) from public, anon;
grant execute on function public.real_interview_ids(uuid) to authenticated;

-- 2. Geleerde gewichten: waarnemingen uit oefengesprekken en nog niet aangegeven gesprekken tellen niet mee,
--    net als in de rest van de app (alleen is_practice = false telt).
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
    left join public.interviews iv on iv.id = ob.interview_id
    where not ob.is_synthetic and (ob.origin <> 'ai' or ob.review_status = 'accepted')
      and (ob.interview_id is null or iv.is_practice is false)
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
revoke execute on function public.learning_counts_internal(uuid) from public, anon, authenticated;

-- 3. De reden bij afronden onder de minimale steekproef ligt vast zodra hij is vastgelegd.
create or replace function public.guard_end_reason()
returns trigger language plpgsql set search_path = '' as $$
begin
  if old.end_reason is not null and new.end_reason is distinct from old.end_reason then
    raise exception 'END_REASON_LOCKED: de reden van afronden kan niet meer worden gewijzigd' using errcode = 'P0001';
  end if;
  return new;
end $$;
drop trigger if exists experiments_end_reason_lock on public.experiments;
create trigger experiments_end_reason_lock before update of end_reason on public.experiments
  for each row execute function public.guard_end_reason();
revoke execute on function public.guard_end_reason() from public, anon, authenticated;

commit;
