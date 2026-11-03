-- Fase B0 – betrouwbaarheid van bewijs. Door de product owner goedgekeurd (3 november 2026).
-- Drie kolommen, alle nullable: bestaande gegevens blijven ongewijzigd en er wordt niets verwijderd.
begin;

-- 1. Echt gesprek of oefening. Null = nog niet aangegeven: telt niet als bewijs tot iemand het markeert.
alter table public.interviews add column if not exists is_practice boolean;
comment on column public.interviews.is_practice is
  'B0: true = oefening of fictief gesprek (telt nooit als bewijs), false = echt gesprek, null = onbekend (telt niet).';

-- 2. Reden bij afronden onder de minimale steekproef.
alter table public.experiments add column if not exists end_reason text;
alter table public.experiments drop constraint if exists experiments_end_reason_len;
alter table public.experiments add constraint experiments_end_reason_len check (end_reason is null or char_length(end_reason) <= 600);
comment on column public.experiments.end_reason is 'B0: motivering bij afronden onder de minimale steekproef.';

-- 3. Soort aanname: bepaalt welke maatstaf en welk testtype passen (B0 punt 3, B4).
alter table public.assumptions add column if not exists kind text;
alter table public.assumptions drop constraint if exists assumptions_kind_check;
alter table public.assumptions add constraint assumptions_kind_check check (kind is null or kind in ('market', 'price', 'behaviour', 'technical'));
comment on column public.assumptions.kind is 'B0/B4: markt, prijs, gedrag of technisch. Null = nog niet bepaald (afgeleid uit de tekst).';

commit;
