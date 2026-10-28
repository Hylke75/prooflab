-- ProofLab core schema: tenancy, ideas, research, evidence, experiments, decisions, reports.
-- Every table is protected by row level security; access helpers are SECURITY DEFINER
-- functions with a pinned search_path.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Tenancy
-- ---------------------------------------------------------------------------

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 120),
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now()
);

create table public.organization_members (
  org_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner', 'editor')),
  created_at timestamptz not null default now(),
  primary key (org_id, user_id)
);

create table public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  full_name text,
  created_at timestamptz not null default now()
);

create table public.clients (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 160),
  sector text,
  contact_name text,
  contact_email text,
  notes text,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Ideas (one validation trajectory each)
-- ---------------------------------------------------------------------------

create table public.ideas (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid references public.clients(id) on delete set null,
  title text not null check (char_length(title) between 2 and 140),
  decision_question text not null,
  decision_stakes text,
  decision_deadline date,
  budget_eur numeric(12,2),
  key_uncertainty text,
  project_type text not null check (project_type in
    ('new_business', 'new_product', 'expansion', 'revenue_model', 'internal_innovation')),
  sector_template text not null default 'generic' check (sector_template in
    ('generic', 'smb', 'events', 'media_culture')),
  description text not null,
  target_audience text not null,
  audience_detail text,
  region text not null,
  region_detail text,
  first_question text,
  status text not null default 'active' check (status in ('active', 'parked', 'stopped', 'continued')),
  is_demo boolean not null default false,
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index ideas_org_idx on public.ideas(org_id);

-- Client stakeholders get read access per idea and may confirm decisions.
create table public.idea_members (
  idea_id uuid not null references public.ideas(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,
  email text not null,
  role text not null default 'client_decider' check (role in ('client_decider', 'client_viewer')),
  invited_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  primary key (idea_id, email)
);
create index idea_members_user_idx on public.idea_members(user_id);

-- ---------------------------------------------------------------------------
-- Research plan, runs, sources, claims
-- ---------------------------------------------------------------------------

create table public.research_questions (
  id uuid primary key default gen_random_uuid(),
  idea_id uuid not null references public.ideas(id) on delete cascade,
  position int not null check (position between 1 and 5),
  question text not null,
  why_it_matters text,
  data_needed text,
  suggested_sources text,
  method text not null default 'desk' check (method in ('desk', 'customer', 'both')),
  done_criterion text not null,
  status text not null default 'open' check (status in ('open', 'answered', 'needs_customer_research')),
  origin text not null default 'template' check (origin in ('template', 'ai', 'manual')),
  created_at timestamptz not null default now(),
  unique (idea_id, position)
);

create table public.research_runs (
  id uuid primary key default gen_random_uuid(),
  idea_id uuid not null references public.ideas(id) on delete cascade,
  mode text not null check (mode in ('quick', 'deep')),
  status text not null default 'queued' check (status in ('queued', 'running', 'done', 'failed', 'cancelled')),
  budget_usd numeric(8,2) not null,
  cost_usd numeric(10,4) not null default 0,
  error text,
  started_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  finished_at timestamptz
);

create table public.research_tasks (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.research_runs(id) on delete cascade,
  idea_id uuid not null references public.ideas(id) on delete cascade,
  position int not null,
  kind text not null check (kind in ('plan', 'search', 'extract', 'competitors', 'sizing', 'reality_check')),
  question_id uuid references public.research_questions(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'running', 'done', 'failed', 'skipped')),
  attempts int not null default 0,
  label text not null,
  detail text,
  output jsonb,
  cost_usd numeric(10,4) not null default 0,
  started_at timestamptz,
  finished_at timestamptz,
  unique (run_id, position)
);

create table public.sources (
  id uuid primary key default gen_random_uuid(),
  idea_id uuid not null references public.ideas(id) on delete cascade,
  run_id uuid references public.research_runs(id) on delete set null,
  url text,
  domain text,
  title text not null,
  publisher text,
  published_on date,
  retrieved_at timestamptz not null default now(),
  source_type text not null check (source_type in
    ('official_statistic', 'primary_document', 'company_page', 'research_report', 'news', 'review_site', 'blog', 'dataset_upload', 'interview', 'other')),
  is_primary boolean not null default false,
  access_note text,
  origin text not null default 'manual' check (origin in ('manual', 'ai_search')),
  content_hash text,
  created_at timestamptz not null default now()
);
create index sources_idea_idx on public.sources(idea_id);

-- Only relevant excerpts are stored, never full third-party documents.
create table public.source_excerpts (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references public.sources(id) on delete cascade,
  idea_id uuid not null references public.ideas(id) on delete cascade,
  text text not null check (char_length(text) between 1 and 6000),
  location text,
  created_at timestamptz not null default now()
);

create table public.claims (
  id uuid primary key default gen_random_uuid(),
  idea_id uuid not null references public.ideas(id) on delete cascade,
  question_id uuid references public.research_questions(id) on delete set null,
  section text not null default 'market' check (section in ('market', 'customers', 'competition', 'pricing', 'sizing', 'regulation', 'other')),
  statement text not null,
  evidence_type text not null check (evidence_type in
    ('official_statistic', 'third_party_estimate', 'primary_document', 'qualitative_observation',
     'self_reported_intent', 'observed_action', 'verified_transaction', 'verified_commitment',
     'ai_inference', 'internal_assumption', 'synthetic_simulation')),
  status text not null default 'insufficient' check (status in ('verified', 'estimate', 'insufficient', 'contested', 'outdated')),
  status_reason text,
  supports text,
  does_not_prove text,
  region text,
  period text,
  numeric_value numeric,
  unit text,
  definition text,
  limitations text,
  freshness_kind text not null default 'statistic' check (freshness_kind in ('statistic', 'price', 'regulation', 'product', 'general')),
  origin text not null default 'manual' check (origin in ('manual', 'ai')),
  created_by uuid default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index claims_idea_idx on public.claims(idea_id);

create table public.claim_sources (
  id uuid primary key default gen_random_uuid(),
  claim_id uuid not null references public.claims(id) on delete cascade,
  idea_id uuid not null references public.ideas(id) on delete cascade,
  source_id uuid not null references public.sources(id) on delete cascade,
  excerpt_id uuid references public.source_excerpts(id) on delete set null,
  quote text not null,
  stance text not null default 'supports' check (stance in ('supports', 'contradicts')),
  quote_check text not null default 'unchecked' check (quote_check in ('exact', 'not_found', 'numbers_mismatch', 'unchecked')),
  created_at timestamptz not null default now()
);

create table public.competitors (
  id uuid primary key default gen_random_uuid(),
  idea_id uuid not null references public.ideas(id) on delete cascade,
  name text not null,
  website text,
  kind text not null check (kind in ('direct', 'indirect', 'alternative', 'status_quo')),
  positioning text,
  target_buyer text,
  pricing_model text,
  visible_price text,
  price_checked_on date,
  strengths text,
  weaknesses text,
  differentiation_opportunity text,
  claim_id uuid references public.claims(id) on delete set null,
  origin text not null default 'manual' check (origin in ('manual', 'ai')),
  last_checked_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.segments (
  id uuid primary key default gen_random_uuid(),
  idea_id uuid not null references public.ideas(id) on delete cascade,
  role text not null check (role in ('user', 'buyer', 'supplier', 'other')),
  label text not null,
  job_to_be_done text,
  pain text,
  current_alternative text,
  open_question text,
  created_at timestamptz not null default now()
);

-- Bottom-up sizing: every factor carries its own provenance.
create table public.sizing_scenarios (
  id uuid primary key default gen_random_uuid(),
  idea_id uuid not null references public.ideas(id) on delete cascade,
  kind text not null check (kind in ('conservative', 'realistic', 'optimistic')),
  model text not null default 'b2b_accounts' check (model in ('b2b_accounts', 'b2c_people', 'transactions')),
  updated_at timestamptz not null default now(),
  unique (idea_id, kind)
);

create table public.sizing_factors (
  id uuid primary key default gen_random_uuid(),
  scenario_id uuid not null references public.sizing_scenarios(id) on delete cascade,
  idea_id uuid not null references public.ideas(id) on delete cascade,
  key text not null,
  label text not null,
  value numeric not null check (value >= 0),
  unit text not null check (unit in ('count', 'percent', 'eur', 'per_year')),
  claim_id uuid references public.claims(id) on delete set null,
  note text,
  position int not null,
  unique (scenario_id, key)
);

create table public.unit_economics (
  idea_id uuid primary key references public.ideas(id) on delete cascade,
  price_per_customer_year numeric,
  gross_margin_pct numeric check (gross_margin_pct between 0 and 100),
  cac_eur numeric,
  annual_churn_pct numeric check (annual_churn_pct between 0 and 100),
  fixed_costs_year numeric,
  upfront_investment numeric,
  notes text,
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Assumptions, hypotheses, experiments, observations
-- ---------------------------------------------------------------------------

create table public.assumptions (
  id uuid primary key default gen_random_uuid(),
  idea_id uuid not null references public.ideas(id) on delete cascade,
  statement text not null,
  category text not null check (category in ('desirability', 'feasibility', 'viability', 'context')),
  importance int not null default 3 check (importance between 1 and 5),
  status text not null default 'untested' check (status in ('untested', 'testing', 'supported', 'refuted', 'inconclusive')),
  origin text not null default 'manual' check (origin in ('manual', 'ai', 'template')),
  created_at timestamptz not null default now()
);

create table public.assumption_claims (
  assumption_id uuid not null references public.assumptions(id) on delete cascade,
  claim_id uuid not null references public.claims(id) on delete cascade,
  idea_id uuid not null references public.ideas(id) on delete cascade,
  relation text not null check (relation in ('supports', 'contradicts')),
  primary key (assumption_id, claim_id)
);

create table public.hypotheses (
  id uuid primary key default gen_random_uuid(),
  idea_id uuid not null references public.ideas(id) on delete cascade,
  assumption_id uuid not null references public.assumptions(id) on delete cascade,
  version int not null default 1,
  we_believe text not null,
  target_group text not null,
  test_method text not null,
  metric_label text not null,
  metric_numerator text not null,
  metric_denominator text not null,
  success_threshold_pct numeric not null check (success_threshold_pct > 0 and success_threshold_pct <= 100),
  fail_threshold_pct numeric check (fail_threshold_pct >= 0 and fail_threshold_pct <= 100),
  min_sample int not null check (min_sample >= 1),
  max_duration_days int not null check (max_duration_days between 1 and 180),
  expected_biases text,
  change_reason text,
  locked_at timestamptz,
  superseded_by uuid references public.hypotheses(id),
  created_at timestamptz not null default now()
);

create table public.experiments (
  id uuid primary key default gen_random_uuid(),
  idea_id uuid not null references public.ideas(id) on delete cascade,
  hypothesis_id uuid not null references public.hypotheses(id),
  type text not null check (type in ('landing', 'interview', 'pricing')),
  state text not null default 'draft' check (state in ('draft', 'ready_for_review', 'approved', 'live', 'paused', 'ended', 'analyzed', 'decided')),
  title text not null,
  public_slug text unique,
  config jsonb not null default '{}'::jsonb,
  channels jsonb not null default '[]'::jsonb,
  cost_estimate_eur numeric default 0,
  owner_id uuid not null default auth.uid() references auth.users(id),
  approved_by uuid references auth.users(id),
  approved_at timestamptz,
  started_at timestamptz,
  ends_at timestamptz,
  ended_at timestamptz,
  ended_early boolean not null default false,
  created_at timestamptz not null default now()
);

-- Raw, deduplicated events from public test pages. Never edited.
create table public.test_events (
  id bigint generated always as identity primary key,
  experiment_id uuid not null references public.experiments(id) on delete cascade,
  idea_id uuid not null references public.ideas(id) on delete cascade,
  visitor_hash text not null,
  event_type text not null check (event_type in ('view', 'cta_click', 'submit')),
  variant text not null default 'a',
  channel text not null default 'direct',
  day date not null default current_date,
  created_at timestamptz not null default now(),
  unique (experiment_id, visitor_hash, event_type, variant, day)
);
create index test_events_exp_idx on public.test_events(experiment_id);

create table public.test_submissions (
  id uuid primary key default gen_random_uuid(),
  experiment_id uuid not null references public.experiments(id) on delete cascade,
  idea_id uuid not null references public.ideas(id) on delete cascade,
  visitor_hash text not null,
  variant text not null default 'a',
  channel text not null default 'direct',
  email text,
  answers jsonb not null default '{}'::jsonb,
  consent_given boolean not null,
  consent_text text not null,
  retention_until date not null default (current_date + 180),
  created_at timestamptz not null default now(),
  unique (experiment_id, visitor_hash)
);

create table public.interviews (
  id uuid primary key default gen_random_uuid(),
  experiment_id uuid not null references public.experiments(id) on delete cascade,
  idea_id uuid not null references public.ideas(id) on delete cascade,
  participant_label text not null,
  dmu_role text not null check (dmu_role in ('user', 'buyer', 'decider', 'influencer', 'other')),
  segment text,
  recruited_via text not null,
  is_acquaintance boolean not null default false,
  held_on date not null,
  record_type text not null check (record_type in ('transcript', 'notes')),
  transcript text not null,
  consent_recorded boolean not null,
  retention_until date not null default (current_date + 365),
  created_at timestamptz not null default now()
);

create table public.observations (
  id uuid primary key default gen_random_uuid(),
  idea_id uuid not null references public.ideas(id) on delete cascade,
  experiment_id uuid references public.experiments(id) on delete cascade,
  interview_id uuid references public.interviews(id) on delete cascade,
  kind text not null check (kind in
    ('problem_confirmed', 'problem_absent', 'current_behaviour', 'current_spend', 'counter_example',
     'objection', 'waitlist_signup', 'demo_request', 'quote_request', 'deposit', 'repeat_purchase', 'opinion', 'other')),
  summary text not null,
  quote text,
  quote_check text not null default 'unchecked' check (quote_check in ('exact', 'not_found', 'unchecked')),
  is_fact boolean not null default false,
  is_behaviour boolean not null default false,
  is_real_context boolean not null default false,
  is_costly boolean not null default false,
  is_synthetic boolean not null default false,
  origin text not null default 'manual' check (origin in ('manual', 'ai', 'system')),
  created_at timestamptz not null default now()
);

create table public.assumption_observations (
  assumption_id uuid not null references public.assumptions(id) on delete cascade,
  observation_id uuid not null references public.observations(id) on delete cascade,
  idea_id uuid not null references public.ideas(id) on delete cascade,
  relation text not null check (relation in ('supports', 'contradicts')),
  primary key (assumption_id, observation_id)
);

create table public.learning_cards (
  id uuid primary key default gen_random_uuid(),
  experiment_id uuid not null references public.experiments(id) on delete cascade,
  idea_id uuid not null references public.ideas(id) on delete cascade,
  version int not null default 1,
  we_believed text not null,
  we_observed text not null,
  we_learned text not null,
  therefore text not null,
  verdict text not null check (verdict in ('pass', 'fail', 'inconclusive')),
  data_reliability text not null check (data_reliability in ('low', 'medium', 'high')),
  metrics jsonb not null default '{}'::jsonb,
  status text not null default 'draft' check (status in ('draft', 'approved')),
  approved_by uuid references auth.users(id),
  approved_at timestamptz,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Reality check, decisions, reports
-- ---------------------------------------------------------------------------

create table public.reality_checks (
  id uuid primary key default gen_random_uuid(),
  idea_id uuid not null references public.ideas(id) on delete cascade,
  findings jsonb not null,
  advice text not null check (advice in ('continue', 'adjust', 'test_more', 'pause', 'stop')),
  advice_reason text not null,
  ai_used boolean not null default false,
  created_by uuid default auth.uid() references auth.users(id),
  created_at timestamptz not null default now()
);

create table public.decisions (
  id uuid primary key default gen_random_uuid(),
  idea_id uuid not null references public.ideas(id) on delete cascade,
  experiment_id uuid references public.experiments(id) on delete set null,
  reality_check_id uuid not null references public.reality_checks(id),
  action text not null check (action in ('continue', 'adjust', 'test_more', 'pause', 'stop')),
  rationale text not null,
  next_step text,
  decided_by uuid not null default auth.uid() references auth.users(id),
  decided_at timestamptz not null default now(),
  client_confirmed_by uuid references auth.users(id),
  client_confirmed_at timestamptz,
  client_comment text
);

create table public.reports (
  id uuid primary key default gen_random_uuid(),
  idea_id uuid not null references public.ideas(id) on delete cascade,
  version int not null,
  snapshot jsonb not null,
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  unique (idea_id, version)
);

-- ---------------------------------------------------------------------------
-- Audit and AI usage ledger
-- ---------------------------------------------------------------------------

create table public.audit_events (
  id bigint generated always as identity primary key,
  idea_id uuid references public.ideas(id) on delete cascade,
  actor_id uuid,
  table_name text not null,
  row_id text not null,
  action text not null,
  detail jsonb,
  occurred_at timestamptz not null default now()
);

create table public.ai_runs (
  id uuid primary key default gen_random_uuid(),
  idea_id uuid references public.ideas(id) on delete cascade,
  purpose text not null,
  model text not null,
  prompt_version text not null,
  input_tokens int not null default 0,
  output_tokens int not null default 0,
  web_searches int not null default 0,
  cost_usd numeric(10,4) not null default 0,
  outcome text not null check (outcome in ('ok', 'rejected', 'refused', 'error')),
  detail text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
