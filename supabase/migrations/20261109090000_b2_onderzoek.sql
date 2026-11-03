-- Fase B2: onderzoek dat de grootste onzekerheid eerst raakt, binnen een hard kostenplafond, op de server.
-- Alles is idempotent (if not exists / or replace) en raakt geen bestaande gegevens: er worden alleen kolommen,
-- indexen, functies en een tabel toegevoegd. De app werkt ook zolang deze migratie nog niet live staat; ze valt
-- dan terug op het oude gedrag (eerste vraag als beslissende vraag, geen lease, geen opgeslagen selectie).

-- ---------------------------------------------------------------------------
-- Punt 1. De beslissende vraag
-- ---------------------------------------------------------------------------
-- Hooguit één vraag per idee is de beslissende vraag: de vraag die de grootste onzekerheid uit de intake raakt.
-- Een onderzoeksrun begint altijd met die vraag; de dossierstatus (lib/domain/dossier-status.ts) leest hem.

alter table public.research_questions add column if not exists is_decisive boolean not null default false;
create unique index if not exists research_questions_one_decisive on public.research_questions(idea_id) where is_decisive;
