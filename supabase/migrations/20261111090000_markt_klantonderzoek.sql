-- Markt: klantonderzoek vanuit stap 1. Verkennende enquêtes en online interviews (schriftelijk) hangen aan een
-- onderzoeksvraag en hebben geen go/no-go-drempels: ze geven richting, maar beslissen niets. Technisch zijn het
-- experimenten van het type 'survey' met een hypothese die als verkennend is gemarkeerd (lib/domain/customer-research.ts).
--
-- Idempotent. Geen bestaande data gewijzigd of verwijderd: bestaande hypotheses krijgen exploratory = false en houden
-- hun aanname en drempels; de nieuwe controle eist dat ook voor elke niet-verkennende hypothese. De regels voor
-- hoofdtests en tests uit stap 3 veranderen niet.
--
-- Zonder deze migratie werkt de app gewoon: het tabblad Klantonderzoek toont de bestaande enquêtes en interviews en
-- meldt dat nieuw verkennend onderzoek op deze update wacht.
begin;

-- ---------------------------------------------------------------------------
-- 1. Verkennende hypothese: gemarkeerd, gekoppeld aan een onderzoeksvraag, zonder aanname en drempels
-- ---------------------------------------------------------------------------

alter table public.hypotheses add column if not exists exploratory boolean not null default false;
comment on column public.hypotheses.exploratory is
  'Verkennend klantonderzoek vanuit Markt: geen aanname, geen succesdrempel, geen beslisregel. Beslist niets.';

-- Een verwijderde onderzoeksvraag laat het onderzoek (en de antwoorden) staan; alleen de koppeling vervalt.
alter table public.hypotheses add column if not exists research_question_id uuid references public.research_questions(id) on delete set null;
create index if not exists hypotheses_research_question_fk on public.hypotheses(research_question_id);
comment on column public.hypotheses.research_question_id is
  'De onderzoeksvraag (stap 1 Markt) waar dit verkennende onderzoek bij hoort.';

alter table public.hypotheses alter column assumption_id drop not null;
alter table public.hypotheses alter column success_threshold_pct drop not null;

-- Niet-verkennend: aanname en succesdrempel blijven verplicht, zoals voorheen. Verkennend: geen drempels en geen
-- beslisregel, zodat er nooit een oordeel uit kan volgen. Omdat de vergrendeling (guard_hypothesis_lock) drempels en
-- aanname na goedkeuring bevriest, kan een hypothese daarna ook niet van soort wisselen.
alter table public.hypotheses drop constraint if exists hypotheses_exploratory_shape;
alter table public.hypotheses add constraint hypotheses_exploratory_shape check (
  (exploratory is false and assumption_id is not null and success_threshold_pct is not null)
  or (exploratory is true and success_threshold_pct is null and fail_threshold_pct is null and decision_rule is null and success_count is null)
);

-- Dezelfde dossiercontrole als voor de aanname: de onderzoeksvraag moet bij hetzelfde idee horen.
drop trigger if exists hypotheses_refs on public.hypotheses;
create trigger hypotheses_refs before insert or update on public.hypotheses
  for each row execute function public.check_idea_refs('assumption_id', 'assumptions', 'superseded_by', 'hypotheses', 'research_question_id', 'research_questions');

-- ---------------------------------------------------------------------------
-- 2. De beslisregel van het dossier: een verkennend onderzoek vergrendelt hem niet
-- ---------------------------------------------------------------------------

-- De eerste goedgekeurde test vergrendelt de go-regel (golf B). Een verkennend onderzoek beslist niets en mag de
-- regel dus ook niet vastzetten. Voor alle andere tests ongewijzigd.
create or replace function public.lock_decision_rule_on_approval()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.state = 'approved' and old.state is distinct from 'approved'
     and not exists (select 1 from public.hypotheses h where h.id = new.hypothesis_id and h.exploratory is true) then
    update public.decision_rules set locked_at = now() where idea_id = new.idea_id and locked_at is null;
  end if;
  return null;
end $$;

-- Idem bij het vastleggen van de regel: alleen een goedgekeurde of gestarte test (geen verkennend onderzoek) maakt
-- de regel "achteraf vastgelegd". Verder gelijk aan golf B.
create or replace function public.save_decision_rule(p_idea uuid, p_primary uuid, p_note text, p_conditions jsonb)
returns text language plpgsql security definer set search_path = '' as $$
declare
  v_locked timestamptz;
  v_exists boolean;
  v_late boolean;
begin
  if auth.uid() is null or not public.can_write_idea(p_idea) then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if jsonb_typeof(coalesce(p_conditions, '[]'::jsonb)) <> 'array' then
    raise exception 'DECISION_RULE_INVALID: voorwaarden horen in een lijst' using errcode = 'P0001';
  end if;
  if p_primary is null and jsonb_array_length(coalesce(p_conditions, '[]'::jsonb)) = 0 then
    raise exception 'DECISION_RULE_INVALID: kies minstens één aanname of een hoofdtest' using errcode = 'P0001';
  end if;
  perform 1 from public.ideas where id = p_idea for update;
  select true, locked_at into v_exists, v_locked from public.decision_rules where idea_id = p_idea;
  if v_locked is not null then
    raise exception 'DECISION_RULE_LOCKED: de beslisregel ligt vast sinds de eerste goedgekeurde test' using errcode = 'P0001';
  end if;
  if coalesce(v_exists, false) then
    update public.decision_rules set primary_experiment_id = p_primary, note = nullif(btrim(p_note), '') where idea_id = p_idea;
    delete from public.decision_rule_assumptions where idea_id = p_idea;
  else
    insert into public.decision_rules (idea_id, primary_experiment_id, note) values (p_idea, p_primary, nullif(btrim(p_note), ''));
  end if;
  insert into public.decision_rule_assumptions (idea_id, assumption_id, min_probability)
  select p_idea, (c->>'assumption_id')::uuid, (c->>'min_probability')::numeric
  from jsonb_array_elements(coalesce(p_conditions, '[]'::jsonb)) c;
  -- Al een test goedgekeurd: meteen vergrendeld en achteraf vastgelegd. Verkennend onderzoek telt hier niet.
  v_late := exists (select 1 from public.experiments e
                    where e.idea_id = p_idea
                      and (e.approved_at is not null or e.state not in ('draft', 'ready_for_review'))
                      and not exists (select 1 from public.hypotheses h where h.id = e.hypothesis_id and h.exploratory is true));
  if v_late then
    update public.decision_rules set locked_at = now(), recorded_late = true where idea_id = p_idea;
    return 'locked_late';
  end if;
  return 'open';
end $$;

commit;
