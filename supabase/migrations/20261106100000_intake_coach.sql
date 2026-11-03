-- Intake, succescriterium en coach (6 november).

-- ---------------------------------------------------------------------------
-- 1. Beslisvraag: wat staat er op het spel?
-- ---------------------------------------------------------------------------
-- De inzet is een bedrag (euro), tijd (uren) of capaciteit (fte). Verplicht in de intake, maar optioneel in de
-- database: bestaande ideeën blijven geldig. decision_stakes houdt de leesbare tekst ("€ 25.000"),
-- budget_eur blijft gevuld bij een bedrag (rapport).

alter table public.ideas
  add column if not exists stake_kind text check (stake_kind in ('amount', 'time', 'capacity')),
  add column if not exists stake_value numeric check (stake_value >= 0);

alter table public.ideas drop constraint if exists ideas_stake_pair;
alter table public.ideas add constraint ideas_stake_pair check ((stake_kind is null) = (stake_value is null));

-- ---------------------------------------------------------------------------
-- 2. Succescriterium: naast het aantal ook een waarde, en een geplande meetdatum
-- ---------------------------------------------------------------------------
-- Een minimumbedrag per klant en/of een omzetdoel (euro). De app vraagt minstens één van beide voor nieuwe
-- definities; bestaande definities blijven geldig. De meetdatum ligt na de beslisdatum en binnen zes maanden
-- daarna (gecontroleerd in de app); bij het besluit wordt hij de uitkomstdatum als hij dan nog in dat venster past.

alter table public.ideas
  add column if not exists outcome_min_value_per_customer numeric check (outcome_min_value_per_customer >= 0),
  add column if not exists outcome_revenue_target numeric check (outcome_revenue_target >= 0),
  add column if not exists outcome_measure_date date;

-- De vergrendeling geldt ook voor de nieuwe onderdelen van de definitie.
create or replace function public.guard_outcome_definition()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  -- The definition and the base rate it starts from are fixed once forecasts exist. The due date (six
  -- months after the decision) and the decision date that starts the clock may be filled in once.
  if ((new.outcome_statement, new.outcome_metric, new.outcome_target, new.outcome_min_value_per_customer,
       new.outcome_revenue_target, new.outcome_measure_date, new.reference_class, new.base_rate_low, new.base_rate_high)
      is distinct from (old.outcome_statement, old.outcome_metric, old.outcome_target, old.outcome_min_value_per_customer,
       old.outcome_revenue_target, old.outcome_measure_date, old.reference_class, old.base_rate_low, old.base_rate_high)
      or (old.outcome_due is not null and new.outcome_due is distinct from old.outcome_due)
      or (old.outcome_clock_start is not null and new.outcome_clock_start is distinct from old.outcome_clock_start))
     and exists (select 1 from public.forecasts f where f.idea_id = new.id) then
    raise exception 'OUTCOME_LOCKED: de uitkomstdefinitie ligt vast zodra er een voorspelling is' using errcode = 'P0001';
  end if;
  return new;
end $$;

drop trigger if exists ideas_outcome_lock on public.ideas;
create trigger ideas_outcome_lock before update of outcome_statement, outcome_metric, outcome_target, outcome_due,
  outcome_clock_start, outcome_min_value_per_customer, outcome_revenue_target, outcome_measure_date,
  reference_class, base_rate_low, base_rate_high on public.ideas
  for each row execute function public.guard_outcome_definition();

-- ---------------------------------------------------------------------------
-- 3. Referentieklasse "Nieuwe B2B-dienst / bureau-aanbod, klanten binnen 6 maanden"
-- ---------------------------------------------------------------------------
-- Niet toegevoegd aan reference_classes: er is (op 3 november 2026) geen betrouwbare, citeerbare bron gevonden met
-- een letterlijk percentage voor deze klasse. Een referentie staat nooit zonder bron. In plaats daarvan kan de
-- consultant een voorstel per dossier laten zoeken (hieronder).

-- Door AI voorgestelde referenties, per dossier. Alleen de app-server legt ze vast (ingest-sleutel), en alleen
-- nadat ProofLab de pagina zelf ophaalde en het citaat met het percentage er letterlijk op terugvond.
create table if not exists public.reference_proposals (
  id uuid primary key default gen_random_uuid(),
  idea_id uuid not null references public.ideas(id) on delete cascade,
  label text not null check (char_length(label) between 2 and 160),
  rate numeric not null check (rate between 0 and 1),
  source_url text not null check (source_url ~* '^https?://' and char_length(source_url) <= 2000),
  source_title text not null check (char_length(source_title) between 1 and 300),
  quote text not null check (char_length(quote) between 8 and 1000),
  passage text not null check (char_length(passage) between 8 and 1500),
  model text check (char_length(model) <= 80),
  created_by uuid default auth.uid() references auth.users(id),
  created_at timestamptz not null default now()
);
create index if not exists reference_proposals_idea_idx on public.reference_proposals(idea_id, created_at desc);
create index if not exists reference_proposals_created_by_fk on public.reference_proposals(created_by);

alter table public.reference_proposals enable row level security;
drop policy if exists reference_proposals_select on public.reference_proposals;
create policy reference_proposals_select on public.reference_proposals for select to authenticated
  using (public.can_read_idea(idea_id));
-- Geen insert-, update- of delete-policies: vastleggen kan alleen via record_reference_proposal.

create or replace function public.record_reference_proposal(
  p_key text, p_idea uuid, p_label text, p_rate numeric, p_url text, p_title text, p_quote text, p_passage text, p_model text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if not public.ingest_key_ok(p_key) or not public.can_write_idea(p_idea) then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  -- De controle van het citaat op de pagina gebeurt in de app (lib/domain/reference-proposal.ts); de ingest-sleutel
  -- garandeert dat alleen de app-server hier komt, niet een gebruiker met een eigen 'citaat'.
  insert into public.reference_proposals (idea_id, label, rate, source_url, source_title, quote, passage, model)
  values (p_idea, left(p_label, 160), p_rate, p_url, left(p_title, 300), p_quote, p_passage, left(p_model, 80))
  returning id into v_id;
  return v_id;
end $$;

revoke execute on function public.record_reference_proposal(text, uuid, text, numeric, text, text, text, text, text) from public, anon;
grant execute on function public.record_reference_proposal(text, uuid, text, numeric, text, text, text, text, text) to authenticated;

revoke all on public.reference_proposals from anon;
grant select on public.reference_proposals to authenticated;

create trigger reference_proposals_audit after insert or update or delete on public.reference_proposals
  for each row execute function public.audit_row();
