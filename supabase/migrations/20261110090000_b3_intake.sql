-- Fase B3: intake in drie vragen en één bevestiging.
-- Alles is idempotent (if not exists / or replace / drop policy if exists) en raakt geen bestaande gegevens: er
-- worden alleen kolommen, een policy en een functie toegevoegd en org_ai_spend telt voortaan ook AI-aanroepen
-- zonder idee mee. Zolang deze migratie niet live staat, werkt de intake ook: zonder org-budgetcontrole maakt
-- ProofLab dan alleen een voorstel uit de tekst zelf (geen AI), en de prijs komt in de beschrijving.

-- ---------------------------------------------------------------------------
-- 1. Het idee: prijs van het aanbod en het intakevoorstel
-- ---------------------------------------------------------------------------
-- offer_price: de prijs die de consultant noemt ("€ 249 per maand"); de onderzoeksvragen (lib/research-questions.ts)
-- lezen hem als eerste. intake_proposal: de drie antwoorden, het voorstel (AI of regels) en welke velden de
-- consultant bij de bevestiging aanpaste. Zo blijft herleidbaar wat een voorstel was en wat de consultant vastlegde.
alter table public.ideas add column if not exists offer_price text;
alter table public.ideas drop constraint if exists ideas_offer_price_len;
alter table public.ideas add constraint ideas_offer_price_len check (offer_price is null or char_length(offer_price) <= 120);
alter table public.ideas add column if not exists intake_proposal jsonb;
alter table public.ideas drop constraint if exists ideas_intake_proposal_size;
alter table public.ideas add constraint ideas_intake_proposal_size check (intake_proposal is null or pg_column_size(intake_proposal) <= 32000);

-- ---------------------------------------------------------------------------
-- 2. AI vóór er een idee is: het voorstel uit de intake
-- ---------------------------------------------------------------------------
-- Het voorstel wordt gemaakt voordat het idee bestaat. De aanroep komt in hetzelfde grootboek (ai_runs), op de
-- organisatie in plaats van op een idee, en telt mee voor het maandbudget van de organisatie.
alter table public.ai_runs add column if not exists org_id uuid references public.organizations(id) on delete cascade;
create index if not exists ai_runs_org_idx on public.ai_runs(org_id) where org_id is not null;

drop policy if exists ai_runs_insert_org on public.ai_runs;
create policy ai_runs_insert_org on public.ai_runs for insert to authenticated
  with check (idea_id is null and org_id is not null and public.is_org_member(org_id) and created_by = (select auth.uid()));
drop policy if exists ai_runs_select_org on public.ai_runs;
create policy ai_runs_select_org on public.ai_runs for select to authenticated
  using (idea_id is null and org_id is not null and public.is_org_member(org_id));

-- Uitgaven en plafond van de organisatie, voor een AI-aanroep zonder idee. Alleen voor teamleden.
create or replace function public.org_ai_spend_for_org(p_org uuid)
returns table (spent numeric, cap numeric) language sql stable security definer set search_path = '' as $$
  select coalesce((
      select sum(r.cost_usd) from public.ai_runs r
      left join public.ideas i2 on i2.id = r.idea_id
      where (i2.org_id = o.id or (r.idea_id is null and r.org_id = o.id)) and r.created_at >= date_trunc('month', now())
    ), 0), o.ai_monthly_cap_usd
  from public.organizations o
  where o.id = p_org and public.is_org_member(p_org);
$$;
revoke execute on function public.org_ai_spend_for_org(uuid) from public, anon;
grant execute on function public.org_ai_spend_for_org(uuid) to authenticated;

-- Het bestaande budget per idee telt de intake-aanroepen van de organisatie nu ook mee.
create or replace function public.org_ai_spend(p_idea uuid)
returns table (spent numeric, cap numeric) language sql stable security definer set search_path = '' as $$
  select coalesce((
      select sum(r.cost_usd) from public.ai_runs r
      left join public.ideas i2 on i2.id = r.idea_id
      where (i2.org_id = o.id or (r.idea_id is null and r.org_id = o.id)) and r.created_at >= date_trunc('month', now())
    ), 0), o.ai_monthly_cap_usd
  from public.ideas i join public.organizations o on o.id = i.org_id
  where i.id = p_idea and public.can_read_idea(p_idea);
$$;
