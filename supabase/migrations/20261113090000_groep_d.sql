-- Gebruikerstest: groep D (IMPLEMENTATION_STATUS.md, sectie "Gebruikerstest: groep D").
-- Eén migratie voor de hele ronde. Idempotent: opnieuw uitvoeren verandert niets. Raakt geen bestaande data: alleen
-- checks, een nieuwe kolom en een leesregel worden verruimd of toegevoegd. Zolang deze migratie niet live staat, valt
-- de app netjes terug (zie de opmerking per deel).

-- ===========================================================================
-- D6. Voorstellen voor alternatieven (competitors.origin = 'proposal')
-- ===========================================================================
-- Alternatieven die de AI in de Reality Check noemt, worden voorstellen zonder bron. Ze tellen nergens mee (de app
-- filtert ze uit rapport, Reality Check, dossierstatus en AI-samenvatting) en opdrachtgevers mogen ze niet lezen.
-- Overnemen (origin 'manual') kan alleen met een website of gekoppelde bevinding; dat dwingt saveCompetitor af.
-- Zonder deze migratie weigert de database 'proposal': de Reality Check slaat dan geen voorstellen op en loopt door.
-- De oorspronkelijke check stond inline in core_schema (automatische naam); we zoeken de check op de kolom origin zelf.
do $$
declare
  c record;
begin
  for c in
    select con.conname
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace n on n.oid = rel.relnamespace
    join pg_attribute att on att.attrelid = rel.oid and att.attname = 'origin'
    where n.nspname = 'public' and rel.relname = 'competitors' and con.contype = 'c' and con.conkey = array[att.attnum]
  loop
    execute format('alter table public.competitors drop constraint %I', c.conname);
  end loop;
end $$;
alter table public.competitors add constraint competitors_origin_check
  check (origin in ('manual', 'ai', 'proposal'));

-- Leesregel: opdrachtgevers (alleen leesrechten) zien geen voorstellen; consultants (schrijfrechten) wel.
drop policy if exists competitors_select on public.competitors;
create policy competitors_select on public.competitors for select to authenticated
  using (public.can_read_idea(idea_id) and (origin <> 'proposal' or public.can_write_idea(idea_id)));

-- ===========================================================================
-- D7. Nieuwe branche "Verenigingen, sport en maatschappelijke organisaties" (associations)
-- ===========================================================================
-- Zonder deze migratie weigert de database de nieuwe branche bij het aanmaken van een dossier; kies dan een andere.
do $$
declare
  c record;
begin
  for c in
    select con.conname
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace n on n.oid = rel.relnamespace
    join pg_attribute att on att.attrelid = rel.oid and att.attname = 'sector_template'
    where n.nspname = 'public' and rel.relname = 'ideas' and con.contype = 'c' and con.conkey = array[att.attnum]
  loop
    execute format('alter table public.ideas drop constraint %I', c.conname);
  end loop;
end $$;
alter table public.ideas add constraint ideas_sector_template_check
  check (sector_template in ('generic', 'smb', 'events', 'media_culture', 'associations'));

-- ===========================================================================
-- D8. Korte doelgroep (ideas.audience_short)
-- ===========================================================================
-- Voor in onderzoeksvragen en kopjes ("amateursportclubs"). Leeg: de app leidt hem af uit audience_detail. Zonder deze
-- migratie slaat de intake hem niet op en leidt de app hem steeds af.
alter table public.ideas add column if not exists audience_short text;
alter table public.ideas drop constraint if exists ideas_audience_short_check;
alter table public.ideas add constraint ideas_audience_short_check
  check (audience_short is null or char_length(audience_short) between 1 and 60);
