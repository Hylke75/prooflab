-- System observations summarise a finished experiment (computed server-side from raw events).
-- They may only be attached to experiments that have ended.
drop policy if exists observations_insert on public.observations;
create policy observations_insert on public.observations for insert to authenticated
  with check (
    public.can_write_idea(idea_id) and (
      origin <> 'system'
      or exists (
        select 1 from public.experiments e
        where e.id = observations.experiment_id and e.state in ('ended', 'analyzed')
      )
    )
  );
