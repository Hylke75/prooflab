-- Businesscase (docs/ONTWERP_BUSINESSCASE.md): één rij per idee met de antwoorden van de begeleide vragen, als JSON
-- met een schemaversie. De berekening gebeurt in de app (lib/domain/business-case.ts); hier staat alleen de invoer.
-- Bestaande tabellen veranderen niet. Rechten zoals unit_economics: lezen wie het idee mag lezen, schrijven wie het
-- idee mag schrijven. Elke wijziging komt in het auditlogboek.

create table if not exists public.business_cases (
  idea_id uuid primary key references public.ideas(id) on delete cascade,
  inputs jsonb not null default '{}'::jsonb,
  version int not null default 1,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null,
  constraint business_cases_inputs_object check (jsonb_typeof(inputs) = 'object'),
  constraint business_cases_inputs_size check (pg_column_size(inputs) <= 100000)
);

alter table public.business_cases enable row level security;

drop policy if exists business_cases_select on public.business_cases;
drop policy if exists business_cases_insert on public.business_cases;
drop policy if exists business_cases_update on public.business_cases;
drop policy if exists business_cases_delete on public.business_cases;
create policy business_cases_select on public.business_cases for select to authenticated using (public.can_read_idea(idea_id));
create policy business_cases_insert on public.business_cases for insert to authenticated with check (public.can_write_idea(idea_id));
create policy business_cases_update on public.business_cases for update to authenticated
  using (public.can_write_idea(idea_id)) with check (public.can_write_idea(idea_id));
create policy business_cases_delete on public.business_cases for delete to authenticated using (public.can_write_idea(idea_id));
revoke all on public.business_cases from public, anon, authenticated;
grant select, insert, update, delete on public.business_cases to authenticated;

drop trigger if exists business_cases_audit on public.business_cases;
create trigger business_cases_audit after insert or update or delete on public.business_cases
  for each row execute function public.audit_row();
