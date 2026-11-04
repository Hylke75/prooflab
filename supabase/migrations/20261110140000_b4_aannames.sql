-- Fase B4: de consultant kiest maximaal drie aannames om nu te testen; de rest blijft zichtbaar als "later".
-- Idempotent. Geen data gewijzigd of verwijderd: bestaande aannames krijgen false (nog niet gekozen).
begin;

alter table public.assumptions add column if not exists selected_for_test boolean not null default false;
comment on column public.assumptions.selected_for_test is
  'B4: gekozen om nu te testen (maximaal 3 per idee, afgedwongen door guard_selected_for_test). False = later.';

-- Maximaal drie gekozen aannames per idee. De advisory lock per idee voorkomt dat twee gelijktijdige keuzes samen
-- boven de drie uitkomen.
create or replace function public.guard_selected_for_test()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  n integer;
begin
  if new.selected_for_test is true and (tg_op = 'INSERT' or old.selected_for_test is distinct from true) then
    perform pg_advisory_xact_lock(hashtext('selected_for_test:' || new.idea_id::text));
    select count(*) into n from public.assumptions a
      where a.idea_id = new.idea_id and a.selected_for_test is true and a.id <> new.id;
    if n >= 3 then
      raise exception 'MAX_SELECTED: kies maximaal drie aannames om te testen' using errcode = 'P0001';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists assumptions_selected_for_test on public.assumptions;
create trigger assumptions_selected_for_test before insert or update of selected_for_test on public.assumptions
  for each row execute function public.guard_selected_for_test();

create index if not exists assumptions_selected_for_test_idx on public.assumptions (idea_id) where selected_for_test;

commit;
