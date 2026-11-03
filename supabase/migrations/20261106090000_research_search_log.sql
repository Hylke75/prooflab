-- Zoeklogboek van onderzoeksruns: per zoekopdracht de zoekterm, de gevonden URL's met wat ProofLab ermee deed
-- (bewaard of de reden waarom niet) en het aantal bewaarde letterlijke passages. Zo raakt geen gevonden bron
-- ongemerkt kwijt, en kan ProofLab zoekresultaten van dezelfde vraag binnen 7 dagen hergebruiken in plaats van
-- opnieuw te betalen.
--
-- Alleen het onderzoeksteam (can_write_idea) leest en schrijft het logboek; de opdrachtgever niet. Het logboek is
-- alleen-toevoegen: er zijn geen update- of delete-policies (rijen verdwijnen met de run of het idee).

create table public.research_search_log (
  id uuid primary key default gen_random_uuid(),
  run_id uuid references public.research_runs(id) on delete cascade,
  task_id uuid references public.research_tasks(id) on delete set null,
  idea_id uuid not null references public.ideas(id) on delete cascade,
  question_id uuid references public.research_questions(id) on delete set null,
  -- De onderzoeksvraag zoals die op het moment van zoeken luidde (sleutel voor hergebruik binnen 7 dagen).
  question text,
  provider text not null check (provider in ('anthropic', 'openai', 'gemini', 'prooflab')),
  query text not null check (char_length(query) between 1 and 500),
  -- [{ url, title, status, reason }], status: bewaard | pdf_geen_tekst | lege_pagina | geblokkeerd |
  -- geen_relevante_alinea | citaat_niet_letterlijk | niet_opgehaald
  urls jsonb not null default '[]'::jsonb check (jsonb_typeof(urls) = 'array'),
  passages int not null default 0 check (passages >= 0),
  -- true wanneer deze rij een eerder (betaald) resultaat hergebruikt in plaats van opnieuw te zoeken.
  reused boolean not null default false,
  created_at timestamptz not null default now()
);

create index research_search_log_idea_idx on public.research_search_log(idea_id, created_at desc);
create index research_search_log_run_idx on public.research_search_log(run_id);

alter table public.research_search_log enable row level security;

create policy research_search_log_select on public.research_search_log for select to authenticated
  using (public.can_write_idea(idea_id));
create policy research_search_log_insert on public.research_search_log for insert to authenticated
  with check (public.can_write_idea(idea_id));

-- Verwijzingen blijven binnen hetzelfde idee (zie 20261029090000_integrity.sql).
create trigger research_search_log_refs before insert or update on public.research_search_log
  for each row execute function public.check_idea_refs('run_id', 'research_runs', 'task_id', 'research_tasks', 'question_id', 'research_questions');

revoke all on public.research_search_log from anon;
revoke update, delete on public.research_search_log from authenticated;
grant select, insert on public.research_search_log to authenticated;
