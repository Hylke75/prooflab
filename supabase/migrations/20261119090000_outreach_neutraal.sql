-- Neutrale benaming van de LinkedIn-outreachtool in voor gebruikers zichtbare, opgeslagen teksten.
--
-- Wat:
-- 1. evidence_source_refs herkent de campagne in zowel de nieuwe brontitel "Outreach-antwoorden – <campagne> – <datum>"
--    als de oude titel "Expandi-antwoorden – …" (zelfde regel als OUTREACH_TITLE in lib/domain/evidence.ts).
--    Verder ongewijzigd ten opzichte van 20261106110000_method_v2.sql.
-- 2. Bestaande outreachbronnen krijgen de nieuwe titel, uitgever en toegangsnotitie; eigen wervingsregistraties en
--    de standaardnaam van een outreachkoppeling verliezen de toolnaam. Interne waarden (provider 'expandi',
--    tabel expandi_campaign_hooks) blijven zoals ze zijn.
-- Niet aangepast: rapporten (reports.snapshot) zijn onveranderlijke momentopnamen en houden de titel van toen.
-- Idempotent. Nog niet toegepast op productie.
begin;

create or replace function public.evidence_source_refs(p_idea uuid)
returns table (
  item_type text, item_id uuid, source_id uuid, source_type text, source_title text, campaign text,
  survey_experiment_id uuid, experiment_id uuid, experiment_title text, interview_id uuid, interview_label text)
language sql stable security definer set search_path = '' as $$
  with access as (select public.can_read_idea(p_idea) as can_read, public.can_write_idea(p_idea) as can_write),
  claim_src as (
    select distinct on (cs.claim_id) cs.claim_id, s.id as source_id, s.source_type, s.title
    from public.claim_sources cs join public.sources s on s.id = cs.source_id
    where cs.idea_id = p_idea
    order by cs.claim_id, (cs.quote_check = 'exact') desc, cs.created_at, cs.id
  ),
  claims as (
    select c.id as claim_id, cs.source_id, cs.source_type, cs.title,
           case when cs.source_type = 'outreach' then substring(cs.title from '^(?:Outreach|Expandi)-antwoorden – (.+) – [^–]+$') end as campaign,
           case when cs.source_type = 'survey' then (
             select e.id from public.experiments e
             where e.idea_id = p_idea and e.type = 'survey' and starts_with(cs.title, 'Enquête – ' || e.title || ' – open antwoorden – ')
             order by length(e.title) desc limit 1) end as survey_experiment_id
    from public.claims c left join claim_src cs on cs.claim_id = c.id
    where c.idea_id = p_idea
  )
  select 'claim', c.claim_id, c.source_id, c.source_type,
         case when a.can_write or c.source_type not in ('outreach', 'survey') then c.title end,
         case when c.campaign is null then null when a.can_write then c.campaign else 'md5:' || md5(c.campaign) end,
         c.survey_experiment_id, null::uuid,
         case when c.survey_experiment_id is not null then (select e.title from public.experiments e where e.id = c.survey_experiment_id) end,
         null::uuid, null::text
  from claims c cross join access a
  where a.can_read
  union all
  select 'observation', o.id, null, null, null, null, null, o.experiment_id, e.title, o.interview_id,
         case when a.can_write then i.participant_label end
  from public.observations o
  cross join access a
  left join public.experiments e on e.id = o.experiment_id
  left join public.interviews i on i.id = o.interview_id
  where o.idea_id = p_idea and a.can_read;
$$;

revoke execute on function public.evidence_source_refs(uuid) from public, anon;
grant execute on function public.evidence_source_refs(uuid) to authenticated;

update public.sources
set title = 'Outreach-antwoorden' || substring(title from char_length('Expandi-antwoorden') + 1)
where source_type = 'outreach' and starts_with(title, 'Expandi-antwoorden – ');

update public.sources
set publisher = 'LinkedIn (via outreachtool)'
where source_type = 'outreach' and publisher = 'LinkedIn (via Expandi)';

update public.sources
set access_note = replace(access_note, 'ontvangen via de Expandi-webhook.', 'ontvangen via de webhook van de outreachtool.')
where source_type = 'outreach' and access_note like '%ontvangen via de Expandi-webhook.%';

update public.sources
set access_note = replace(access_note, 'gekoppelde Expandi-campagnes', 'gekoppelde outreachcampagnes')
where source_type = 'recruitment_log' and access_note like '%gekoppelde Expandi-campagnes%';

update public.integration_endpoints
set label = 'LinkedIn-outreach'
where provider = 'expandi' and label = 'Expandi – LinkedIn-outreach';

commit;
