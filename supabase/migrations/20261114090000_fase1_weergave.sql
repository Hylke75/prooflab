-- Fase 1 · punt 1: twee standen per dossier, "Snel" en "Grondig" (IMPLEMENTATION_STATUS.md, sectie
-- "Fase 1 · punt 1: Snel en Grondig").
--
-- De stand is alleen weergave: geen enkele berekening (kansen, statussen, beslisregel, rapport) leest hem. Daarom
-- staat hij op het idee en verandert hij niets aan het bewijs. Wat Snel wel verandert: velden die je niet ziet,
-- krijgen een standaardwaarde. Welke dat zijn, legt de app vast in defaulted_fields; zo blijft in het auditspoor
-- zichtbaar wat een mens heeft ingevuld en wat ProofLab standaard heeft overgenomen.
--
-- Idempotent: opnieuw uitvoeren verandert niets. Zonder deze migratie valt de app terug: elk dossier geldt dan als
-- Grondig, de schakelaar meldt dat de stand nog niet kan worden bewaard, en de standaardwaarden worden zonder
-- defaulted_fields opgeslagen (de Test Card toont ze dan niet als "standaard").

-- ===========================================================================
-- 1. ideas.detail_level: bestaande dossiers Grondig, nieuwe Snel
-- ===========================================================================
-- Eerst de kolom met standaard 'thorough' (vult alle bestaande rijen), daarna de standaard voor nieuwe rijen op
-- 'quick'. Alleen als de kolom nog niet bestaat: bij een tweede keer uitvoeren blijven gekozen standen staan.
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'ideas' and column_name = 'detail_level'
  ) then
    alter table public.ideas add column detail_level text not null default 'thorough';
  end if;
end $$;
alter table public.ideas alter column detail_level set default 'quick';
alter table public.ideas drop constraint if exists ideas_detail_level_check;
alter table public.ideas add constraint ideas_detail_level_check check (detail_level in ('quick', 'thorough'));

comment on column public.ideas.detail_level is
  'Weergave van het dossier: quick (Snel) of thorough (Grondig). Alleen weergave; geen berekening leest deze kolom.';

-- Wisselen van stand is geen inhoudelijke wijziging: updated_at blijft staan (het dossier springt dan niet bovenaan
-- "laatst bijgewerkt" en de coach ziet geen nieuwe activiteit). Elke andere wijziging zet updated_at zoals altijd.
-- Het auditspoor legt de wissel wel vast: audit_row (ideas_audit) bewaart detail_level oud → nieuw.
create or replace function public.touch_idea_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  if (to_jsonb(new) - 'detail_level' - 'updated_at') = (to_jsonb(old) - 'detail_level' - 'updated_at')
     and new.detail_level is distinct from old.detail_level then
    new.updated_at := old.updated_at;
  else
    new.updated_at := now();
  end if;
  return new;
end $$;
drop trigger if exists ideas_touch on public.ideas;
create trigger ideas_touch before update on public.ideas
  for each row execute function public.touch_idea_updated_at();
revoke execute on function public.touch_idea_updated_at() from public, anon, authenticated;

-- ===========================================================================
-- 2. defaulted_fields: welke velden ProofLab standaard invulde
-- ===========================================================================
-- hypotheses: Test Card-velden die bij het opslaan nog de standaardwaarde hadden (bijv. min_sample,
--             max_duration_days, channels). Het experiment zelf bewaart de kanalen; de lijst staat op de hypothese
--             omdat die na goedkeuring vergrendeld is.
-- assumptions: de startkans (prior) bleef op 50%; bij het bewaren van een eigen startkans haalt de app 'prior' weg.
-- interviews: de wervingsgroep werd afgeleid uit het wervingskanaal in plaats van gekozen.
alter table public.hypotheses add column if not exists defaulted_fields text[] not null default '{}';
alter table public.assumptions add column if not exists defaulted_fields text[] not null default '{}';
alter table public.interviews add column if not exists defaulted_fields text[] not null default '{}';

comment on column public.hypotheses.defaulted_fields is 'Test Card-velden met de standaardwaarde van ProofLab bij het opslaan (gezet door de app).';
comment on column public.assumptions.defaulted_fields is 'Velden met de standaardwaarde van ProofLab (prior = startkans 50%), gezet door de app.';
comment on column public.interviews.defaulted_fields is 'Velden met de standaardwaarde van ProofLab (recruitment_group afgeleid uit het kanaal), gezet door de app.';

-- Een vergrendelde hypothese verandert niet stil: nu ook de lijst met standaardwaarden niet (zelfde controle als
-- methode v2, met defaulted_fields erbij).
create or replace function public.guard_hypothesis_lock()
returns trigger language plpgsql set search_path = '' as $$
begin
  if old.locked_at is not null then
    if (new.we_believe, new.target_group, new.test_method, new.metric_label, new.metric_numerator,
        new.metric_denominator, new.success_threshold_pct, new.fail_threshold_pct, new.min_sample,
        new.max_duration_days, new.assumption_id, new.version, new.locked_at,
        new.decision_rule, new.success_count, new.required_n, new.expected_pct, new.available_per_week,
        new.defaulted_fields)
       is distinct from
       (old.we_believe, old.target_group, old.test_method, old.metric_label, old.metric_numerator,
        old.metric_denominator, old.success_threshold_pct, old.fail_threshold_pct, old.min_sample,
        old.max_duration_days, old.assumption_id, old.version, old.locked_at,
        old.decision_rule, old.success_count, old.required_n, old.expected_pct, old.available_per_week,
        old.defaulted_fields) then
      raise exception 'HYPOTHESIS_LOCKED: deze hypothese is vergrendeld; maak een nieuwe versie met motivering'
        using errcode = 'P0001';
    end if;
  end if;
  return new;
end $$;

-- audit_row legt bij een insert alleen wie en wanneer vast. De standaardwaarden moeten ook in het spoor: bij een
-- insert met een niet-lege lijst een eigen regel 'defaulted_fields' met de velden en hun waarden. Latere wijzigingen
-- van de lijst (bijv. een eigen startkans) legt audit_row al vast als gewijzigde waarde.
create or replace function public.audit_defaulted_fields()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  rec jsonb := to_jsonb(new);
  vals jsonb := '{}'::jsonb;
  f text;
begin
  if coalesce(cardinality(new.defaulted_fields), 0) = 0 then
    return null;
  end if;
  foreach f in array new.defaulted_fields loop
    if rec ? f then
      vals := vals || jsonb_build_object(f, rec->f);
    end if;
  end loop;
  insert into public.audit_events (idea_id, org_id, actor_id, table_name, row_id, action, detail)
  values (new.idea_id, (select i.org_id from public.ideas i where i.id = new.idea_id), auth.uid(), tg_table_name, new.id::text,
          'defaulted_fields', jsonb_build_object('fields', to_jsonb(new.defaulted_fields), 'values', vals));
  return null;
end $$;

do $$
declare t text;
begin
  foreach t in array array['hypotheses', 'assumptions', 'interviews'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_defaulted_audit', t);
    execute format('create trigger %I after insert on public.%I for each row execute function public.audit_defaulted_fields()', t || '_defaulted_audit', t);
  end loop;
end $$;
revoke execute on function public.audit_defaulted_fields() from public, anon, authenticated;
