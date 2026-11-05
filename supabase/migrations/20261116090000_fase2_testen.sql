-- Fase 2 · punt 4: testen uitvoeren in ProofLab (IMPLEMENTATION_STATUS.md, sectie "Fase 2 · punt 4: Testen uitvoeren
-- in ProofLab"). Keuzes door de product owner gemaakt.
--
-- 1. hypotheses.success_metric: wat telt als succes bij een landing- of prijstest (aanmelding zoals voorheen, betaling,
--    toezegging of afspraak). Vergrendeld na goedkeuring, net als de rest van de Test Card.
-- 2. observations.evidence_type: de systeemwaarneming van een test zegt expliciet welk soort bewijs het is
--    (Waargenomen handeling, Geverifieerde betaling, Geverifieerde toezegging). Alleen systeemwaarnemingen.
-- 3. Mollie: een API-sleutel per werkruimte, door de app versleuteld (AES-256-GCM, SECRETS_ENCRYPTION_KEY) en hier
--    alleen als versleutelde tekst bewaard. Alleen een eigenaar stelt hem in; niemand leest hem terug.
-- 4. test_payments: terugbetaalbare aanbetalingen. Alleen Mollie-id, bedrag, valuta, status, modus, persoonssleutel
--    (gezouten hash van het e-mailadres) en tijden; geen naam of IBAN. Schrijven alleen via functies met de
--    ingest-sleutel: de status komt altijd van Mollie zelf (de webhook levert alleen een id).
-- 5. test_commitments: getekende intentieverklaring (upload, privé bucket commitment-documents) of digitaal akkoord
--    via een persoonlijke link met eenmalige code. Zonder document of akkoord geen telling (database-check).
-- 6. test_booking_hooks en test_bookings: afspraken uit Calendly of Cal.com. test_bookings heeft precies het schema dat
--    punt 5 (werving) leest; extra kolommen zijn toegevoegd.
-- 7. experiment_action_counts(p_experiment): per persoon geteld (unieke bezoekers, klikkers, aanmelders, betalers,
--    toezeggers, bookers). Dubbele betalingen, toezeggingen of afspraken van dezelfde persoon tellen één keer.
-- 8. Privacy: nieuwe aanmeldingen 12 maanden bewaard (bestaande rijen ongewijzigd); een nieuwe landing- of prijstest
--    gaat pas live met naam en contact van de verwerkingsverantwoordelijke; purge_expired_personal_data wist ook
--    toezeggingsnamen en vervangt na de bewaartermijn de persoonssleutel van betalingen en afspraken; dsr_search vindt
--    betalingen, afspraken en toezeggingen op de persoonssleutel; audit_row bewaart persoonssleutels, namen en codes
--    alleen als md5.
--
-- Idempotent: opnieuw uitvoeren verandert niets. Zonder deze migratie werkt de app zoals voorheen: de Test Card kent
-- alleen "aanmelding", de betaalstap, toezeggingen en afspraken melden dat de database nog moet worden bijgewerkt,
-- de testpagina toont de oude privacytekst en tellingen vallen terug op experiment_event_counts.

begin;

-- ---------------------------------------------------------------------------
-- 1. Succesmaat op de Test Card
-- ---------------------------------------------------------------------------

alter table public.hypotheses add column if not exists success_metric text;
alter table public.hypotheses drop constraint if exists hypotheses_success_metric_check;
alter table public.hypotheses add constraint hypotheses_success_metric_check
  check (success_metric is null or success_metric in ('signup', 'payment', 'commitment', 'booking'));
comment on column public.hypotheses.success_metric is
  'Fase 2 · punt 4: wat telt als succes bij een landing- of prijstest. Leeg of signup = aanmelding/klik (zoals voorheen).';

-- Laatste versie uit 20261114090000_fase1_weergave.sql; alleen success_metric toegevoegd aan de vergrendelde velden.
create or replace function public.guard_hypothesis_lock()
returns trigger language plpgsql set search_path = '' as $$
begin
  if old.locked_at is not null then
    if (new.we_believe, new.target_group, new.test_method, new.metric_label, new.metric_numerator,
        new.metric_denominator, new.success_threshold_pct, new.fail_threshold_pct, new.min_sample,
        new.max_duration_days, new.assumption_id, new.version, new.locked_at,
        new.decision_rule, new.success_count, new.required_n, new.expected_pct, new.available_per_week,
        new.defaulted_fields, new.success_metric)
       is distinct from
       (old.we_believe, old.target_group, old.test_method, old.metric_label, old.metric_numerator,
        old.metric_denominator, old.success_threshold_pct, old.fail_threshold_pct, old.min_sample,
        old.max_duration_days, old.assumption_id, old.version, old.locked_at,
        old.decision_rule, old.success_count, old.required_n, old.expected_pct, old.available_per_week,
        old.defaulted_fields, old.success_metric) then
      raise exception 'HYPOTHESIS_LOCKED: deze hypothese is vergrendeld; maak een nieuwe versie met motivering'
        using errcode = 'P0001';
    end if;
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Soort bewijs van de systeemwaarneming
-- ---------------------------------------------------------------------------

alter table public.observations add column if not exists evidence_type text;
alter table public.observations drop constraint if exists observations_evidence_type_check;
alter table public.observations add constraint observations_evidence_type_check
  check (evidence_type is null or (origin = 'system' and evidence_type in ('observed_action', 'verified_transaction', 'verified_commitment'))) not valid;
comment on column public.observations.evidence_type is
  'Fase 2 · punt 4: soort bewijs van een automatische (systeem)waarneming. Een AI-bewering of handmatige waarneming heeft er nooit een.';

-- Laatste versie uit 20261115090000_interviews_import.sql; alleen evidence_type toegevoegd (aan het eind, zodat bestaande
-- aanroepers niets merken). Het retourtype verandert, dus eerst drop.
drop function if exists public.observations_for_idea(uuid);
create or replace function public.observations_for_idea(p_idea uuid)
returns table (
  id uuid, idea_id uuid, experiment_id uuid, interview_id uuid, kind text, summary text, quote text,
  quote_check text, is_fact boolean, is_behaviour boolean, is_real_context boolean, is_costly boolean,
  is_synthetic boolean, origin text, review_status text, created_at timestamptz, evidence_type text)
language sql stable security definer set search_path = '' as $$
  select o.id, o.idea_id, o.experiment_id, o.interview_id, o.kind, o.summary,
         case when public.can_write_idea(o.idea_id) then o.quote else null end,
         o.quote_check, o.is_fact, o.is_behaviour, o.is_real_context, o.is_costly, o.is_synthetic,
         o.origin, o.review_status, o.created_at, o.evidence_type
  from public.observations o
  where o.idea_id = p_idea and public.can_read_idea(p_idea) and not o.theme_only;
$$;
revoke execute on function public.observations_for_idea(uuid) from public, anon;
grant execute on function public.observations_for_idea(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Mollie-sleutel per werkruimte (versleuteld door de app)
-- ---------------------------------------------------------------------------

-- Geen policies: alleen via de functies hieronder. De sleutel staat er alleen versleuteld in (v1:<iv>:<tag>:<data>,
-- AES-256-GCM met SECRETS_ENCRYPTION_KEY, die alleen de app-server kent). Geen audit_row; de functies leggen vast wie
-- de sleutel zette of verwijderde, met modus en de laatste vier tekens.
create table if not exists public.org_payment_settings (
  org_id uuid primary key references public.organizations(id) on delete cascade,
  mollie_key_cipher text check (mollie_key_cipher is null or (char_length(mollie_key_cipher) between 30 and 2000 and mollie_key_cipher ~ '^v1:')),
  mollie_mode text check (mollie_mode is null or mollie_mode in ('test', 'live')),
  mollie_key_hint text check (mollie_key_hint is null or mollie_key_hint ~ '^[A-Za-z0-9]{4}$'),
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint org_payment_settings_complete check ((mollie_key_cipher is null) = (mollie_mode is null))
);
create index if not exists org_payment_settings_updated_by_fk on public.org_payment_settings(updated_by);
alter table public.org_payment_settings enable row level security;
revoke all on public.org_payment_settings from public, anon, authenticated;

create or replace function public.payment_settings_status(p_org uuid)
returns table (mollie_connected boolean, mollie_mode text, mollie_key_hint text, updated_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select s.mollie_key_cipher is not null, s.mollie_mode, s.mollie_key_hint, s.updated_at
  from public.org_payment_settings s
  where s.org_id = p_org and public.is_org_member(p_org);
$$;

create or replace function public.set_mollie_key(p_org uuid, p_cipher text, p_mode text, p_hint text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_cipher text := nullif(btrim(coalesce(p_cipher, '')), '');
begin
  if auth.uid() is null or not public.is_org_owner(p_org) then
    raise exception 'FORBIDDEN: alleen eigenaren van de werkruimte stellen Mollie in' using errcode = 'P0001';
  end if;
  if v_cipher is not null and (v_cipher !~ '^v1:' or p_mode not in ('test', 'live') or coalesce(p_hint, '') !~ '^[A-Za-z0-9]{4}$') then
    raise exception 'INVALID_KEY: dit is geen versleutelde Mollie-sleutel' using errcode = 'P0001';
  end if;
  insert into public.org_payment_settings (org_id, mollie_key_cipher, mollie_mode, mollie_key_hint, updated_by, updated_at)
  values (p_org, v_cipher, case when v_cipher is null then null else p_mode end, case when v_cipher is null then null else p_hint end, auth.uid(), now())
  on conflict (org_id) do update set mollie_key_cipher = excluded.mollie_key_cipher, mollie_mode = excluded.mollie_mode,
    mollie_key_hint = excluded.mollie_key_hint, updated_by = excluded.updated_by, updated_at = excluded.updated_at;
  insert into public.audit_events (org_id, actor_id, table_name, row_id, action, detail)
  values (p_org, auth.uid(), 'org_payment_settings', p_org::text, case when v_cipher is null then 'mollie_key_removed' else 'mollie_key_set' end,
          case when v_cipher is null then null else jsonb_build_object('mode', p_mode, 'hint', p_hint) end);
end $$;

-- De versleutelde sleutel, alleen op de server en alleen voor wie het dossier mag bewerken (terugbetalen).
create or replace function public.mollie_key_for_idea(p_idea uuid)
returns table (cipher text, mode text) language sql stable security definer set search_path = '' as $$
  select s.mollie_key_cipher, s.mollie_mode
  from public.ideas i join public.org_payment_settings s on s.org_id = i.org_id
  where i.id = p_idea and public.can_write_idea(p_idea) and s.mollie_key_cipher is not null;
$$;

-- ---------------------------------------------------------------------------
-- 4. Aanbetalingen
-- ---------------------------------------------------------------------------

create table if not exists public.test_payments (
  id uuid primary key default gen_random_uuid(),
  experiment_id uuid not null references public.experiments(id) on delete cascade,
  idea_id uuid not null references public.ideas(id) on delete cascade,
  mollie_id text not null unique check (mollie_id ~ '^tr_[A-Za-z0-9]{4,40}$'),
  amount numeric(10, 2) not null check (amount > 0 and amount <= 1000),
  currency text not null default 'EUR' check (currency ~ '^[A-Z]{3}$'),
  status text not null check (status in ('open', 'pending', 'authorized', 'paid', 'canceled', 'expired', 'failed', 'refunded', 'charged_back')),
  mode text not null check (mode in ('test', 'live')),
  person_key text not null check (person_key ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default now(),
  paid_at timestamptz,
  refund_requested_at timestamptz,
  refund_requested_by uuid references auth.users(id) on delete set null,
  refunded_at timestamptz,
  updated_at timestamptz not null default now(),
  retention_until date not null default ((current_date + interval '12 months')::date),
  purged_at timestamptz
);
create index if not exists test_payments_experiment_idx on public.test_payments(experiment_id, person_key);
create index if not exists test_payments_idea_idx on public.test_payments(idea_id);
create index if not exists test_payments_refund_requested_by_fk on public.test_payments(refund_requested_by);
alter table public.test_payments enable row level security;
drop policy if exists test_payments_select on public.test_payments;
create policy test_payments_select on public.test_payments for select to authenticated using (public.can_read_idea(idea_id));
revoke all on public.test_payments from public, anon, authenticated;
grant select on public.test_payments to authenticated;
comment on table public.test_payments is
  'Fase 2 · punt 4: terugbetaalbare aanbetalingen via Mollie. Status alleen van Mollie zelf; telt als Geverifieerde betaling bij live + paid.';

-- Wat de publieke betaalroute nodig heeft om een betaling te maken: de versleutelde sleutel, het bedrag en of deze
-- persoon al betaald heeft. Alleen met de ingest-sleutel (server), alleen voor een lopende test met betaalstap, en pas
-- na een klik op de knop van dezelfde bezoeker.
create or replace function public.deposit_checkout(p_key text, p_slug text, p_visitor text, p_person_key text, p_rate_bucket text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  e public.experiments;
  s public.org_payment_settings;
  v_amount numeric;
begin
  if not public.ingest_key_ok(p_key) then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  select * into e from public.experiments where public_slug = p_slug;
  if e.id is null or e.state <> 'live' or (e.ends_at is not null and now() > e.ends_at) then
    return jsonb_build_object('status', 'closed');
  end if;
  if coalesce((e.config->'deposit'->>'enabled')::boolean, false) is not true then
    return jsonb_build_object('status', 'disabled');
  end if;
  v_amount := (e.config->'deposit'->>'amount_eur')::numeric;
  if v_amount is null or v_amount <= 0 or v_amount > 1000 then
    return jsonb_build_object('status', 'disabled');
  end if;
  select ps.* into s from public.org_payment_settings ps join public.ideas i on i.org_id = ps.org_id where i.id = e.idea_id;
  if s.mollie_key_cipher is null then
    return jsonb_build_object('status', 'disabled');
  end if;
  if not public.ingest_allowed(coalesce(p_rate_bucket, '') || ':pay:' || p_slug) then
    return jsonb_build_object('status', 'rate');
  end if;
  if not exists (select 1 from public.test_events t where t.experiment_id = e.id and t.visitor_hash = left(p_visitor, 64) and t.event_type = 'cta_click') then
    return jsonb_build_object('status', 'no_click');
  end if;
  if exists (select 1 from public.test_payments p where p.experiment_id = e.id and p.person_key = p_person_key and p.status = 'paid') then
    return jsonb_build_object('status', 'already_paid');
  end if;
  return jsonb_build_object('status', 'ok', 'experiment_id', e.id, 'cipher', s.mollie_key_cipher, 'mode', s.mollie_mode,
                            'amount', v_amount, 'currency', 'EUR', 'product', coalesce(e.config->>'product_name', e.title));
end $$;

-- Een zojuist bij Mollie gemaakte betaling vastleggen (status zoals Mollie hem teruggaf, meestal open).
create or replace function public.register_test_payment(
  p_key text, p_slug text, p_person_key text, p_mollie_id text, p_amount numeric, p_currency text, p_mode text, p_status text)
returns text language plpgsql security definer set search_path = '' as $$
declare e public.experiments;
begin
  if not public.ingest_key_ok(p_key) then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  select * into e from public.experiments where public_slug = p_slug;
  if e.id is null or e.state <> 'live' then
    return 'closed';
  end if;
  if p_amount is distinct from (e.config->'deposit'->>'amount_eur')::numeric then
    raise exception 'AMOUNT_MISMATCH' using errcode = 'P0001';
  end if;
  insert into public.test_payments (experiment_id, idea_id, mollie_id, amount, currency, status, mode, person_key, paid_at)
  values (e.id, e.idea_id, p_mollie_id, p_amount, coalesce(p_currency, 'EUR'), p_status, p_mode, p_person_key,
          case when p_status = 'paid' then now() end)
  on conflict (mollie_id) do nothing;
  return 'ok';
end $$;

-- De webhook kent alleen een id. Bestaat die betaling bij deze test, dan geeft de functie de versleutelde sleutel van
-- de werkruimte terug zodat de server de status zelf bij Mollie ophaalt. Een onbekend id geeft niets: niets telt.
create or replace function public.mollie_webhook_lookup(p_key text, p_slug text, p_mollie_id text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v jsonb;
begin
  if not public.ingest_key_ok(p_key) then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  select jsonb_build_object('payment_id', p.id, 'cipher', s.mollie_key_cipher) into v
  from public.test_payments p
  join public.experiments e on e.id = p.experiment_id and e.public_slug = p_slug
  join public.ideas i on i.id = p.idea_id
  join public.org_payment_settings s on s.org_id = i.org_id
  where p.mollie_id = p_mollie_id and s.mollie_key_cipher is not null;
  return v;
end $$;

-- De status zoals de server hem net bij Mollie ophaalde. Terugbetaald of teruggeboekt blijft zo (telt nooit meer).
create or replace function public.record_mollie_status(p_key text, p_mollie_id text, p_status text, p_mode text)
returns text language plpgsql security definer set search_path = '' as $$
declare p public.test_payments;
begin
  if not public.ingest_key_ok(p_key) then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if p_status not in ('open', 'pending', 'authorized', 'paid', 'canceled', 'expired', 'failed', 'refunded', 'charged_back') or p_mode not in ('test', 'live') then
    raise exception 'INVALID_STATUS' using errcode = 'P0001';
  end if;
  select * into p from public.test_payments where mollie_id = p_mollie_id for update;
  if p.id is null then
    return 'unknown';
  end if;
  if p.status in ('refunded', 'charged_back') or (p.status = p_status and p.mode = p_mode) then
    return 'unchanged';
  end if;
  update public.test_payments
  set status = p_status, mode = p_mode, updated_at = now(),
      paid_at = case when p_status = 'paid' then coalesce(paid_at, now()) else paid_at end,
      refunded_at = case when p_status in ('refunded', 'charged_back') then now() else refunded_at end
  where id = p.id;
  return 'ok';
end $$;

-- Een consultant vraagt een terugbetaling aan (vóór het verzoek aan Mollie): wie en wanneer.
create or replace function public.mark_refund_requested(p_payment uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare p public.test_payments;
begin
  select * into p from public.test_payments where id = p_payment;
  if p.id is null or auth.uid() is null or not public.can_write_idea(p.idea_id) then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  update public.test_payments set refund_requested_at = coalesce(refund_requested_at, now()),
    refund_requested_by = coalesce(refund_requested_by, auth.uid()), updated_at = now()
  where id = p_payment;
end $$;

-- ---------------------------------------------------------------------------
-- 5. Toezeggingen
-- ---------------------------------------------------------------------------

-- Pad in de privé bucket: <idea_id>/<experiment_id>/<uuid>-<veilige-naam>. Null bij een afwijkend pad.
create or replace function public.commitment_document_idea(p_name text)
returns uuid language sql immutable set search_path = '' as $$
  select case
    when p_name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-[A-Za-z0-9._-]{1,120}$'
         and position('..' in p_name) = 0
    then split_part(p_name, '/', 1)::uuid
    else null
  end;
$$;

create table if not exists public.test_commitments (
  id uuid primary key default gen_random_uuid(),
  experiment_id uuid not null references public.experiments(id) on delete cascade,
  idea_id uuid not null references public.ideas(id) on delete cascade,
  method text not null check (method in ('upload', 'link')),
  status text not null default 'invited' check (status in ('invited', 'signed', 'revoked')),
  person_key text not null check (person_key ~ '^[a-f0-9]{64}$'),
  signer_name text check (signer_name is null or char_length(btrim(signer_name)) between 2 and 200),
  signer_org text check (signer_org is null or char_length(btrim(signer_org)) between 2 and 200),
  typed_name text check (typed_name is null or char_length(btrim(typed_name)) between 2 and 200),
  consent boolean not null default false,
  document_path text unique check (document_path is null or public.commitment_document_idea(document_path) is not null),
  document_mime text check (document_mime is null or document_mime in ('application/pdf', 'image/png', 'image/jpeg', 'image/webp')),
  document_size bigint check (document_size is null or document_size between 1 and 10485760),
  token_hash text unique check (token_hash is null or token_hash ~ '^[a-f0-9]{64}$'),
  token_expires_at timestamptz,
  ip_hash text check (ip_hash is null or ip_hash ~ '^[a-f0-9]{64}$'),
  signed_at timestamptz,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  retention_until date not null default ((current_date + interval '12 months')::date),
  purged_at timestamptz,
  -- Zonder document of akkoord geen telling: een getekende toezegging heeft altijd haar bewijs (tot de opschoning).
  constraint test_commitments_proof check (
    status <> 'signed' or purged_at is not null
    or (method = 'upload' and document_path is not null and signer_name is not null and signer_org is not null and signed_at is not null)
    or (method = 'link' and typed_name is not null and consent and signer_name is not null and signer_org is not null and signed_at is not null)),
  constraint test_commitments_token check ((method = 'link') = (token_hash is not null) or purged_at is not null)
);
create index if not exists test_commitments_experiment_idx on public.test_commitments(experiment_id, person_key);
create index if not exists test_commitments_idea_idx on public.test_commitments(idea_id);
create index if not exists test_commitments_created_by_fk on public.test_commitments(created_by);
comment on table public.test_commitments is
  'Fase 2 · punt 4: toezeggingen (getekende intentieverklaring of digitaal akkoord). Telt als Geverifieerde toezegging bij status signed.';

-- Wie, wanneer en wat mag: een upload is meteen getekend en heeft een bestaand document in de bucket; een link
-- begint als uitnodiging zonder ondertekenaar. Daarna kan een gebruiker alleen nog intrekken. Ondertekenen gaat
-- alleen via sign_commitment (zet een vlag in de transactie); de opschoontaak (zonder gebruiker) mag alles.
create or replace function public.guard_test_commitment()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_state text;
begin
  if tg_op = 'INSERT' then
    select e.state into v_state from public.experiments e where e.id = new.experiment_id;
    if v_state is null or v_state not in ('live', 'paused') then
      raise exception 'COMMITMENT_CLOSED: toezeggingen horen bij een lopende test' using errcode = 'P0001';
    end if;
    new.created_by := auth.uid();
    new.created_at := now();
    new.purged_at := null;
    new.retention_until := (current_date + interval '12 months')::date;
    if new.method = 'upload' then
      if new.document_path is null or public.commitment_document_idea(new.document_path) is distinct from new.idea_id
         or split_part(new.document_path, '/', 2) <> new.experiment_id::text
         or not exists (select 1 from storage.objects o where o.bucket_id = 'commitment-documents' and o.name = new.document_path) then
        raise exception 'COMMITMENT_DOCUMENT: zonder geüpload document telt een toezegging niet' using errcode = 'P0001';
      end if;
      new.status := 'signed';
      new.signed_at := now();
      new.token_hash := null; new.token_expires_at := null; new.typed_name := null; new.ip_hash := null; new.consent := false;
    else
      new.status := 'invited';
      new.signer_name := null; new.signer_org := null; new.typed_name := null; new.consent := false;
      new.signed_at := null; new.ip_hash := null; new.document_path := null; new.document_mime := null; new.document_size := null;
      new.token_expires_at := coalesce(new.token_expires_at, now() + interval '14 days');
      if new.token_expires_at > now() + interval '30 days' then
        new.token_expires_at := now() + interval '30 days';
      end if;
    end if;
    return new;
  end if;
  if coalesce(current_setting('prooflab.commitment_sign', true), '') = '1' or auth.uid() is null then
    return new;
  end if;
  if new.status = 'revoked' and old.status <> 'revoked'
     and (new.method, new.person_key, new.signer_name, new.signer_org, new.typed_name, new.consent, new.document_path, new.token_hash, new.signed_at, new.experiment_id, new.idea_id)
         is not distinct from
         (old.method, old.person_key, old.signer_name, old.signer_org, old.typed_name, old.consent, old.document_path, old.token_hash, old.signed_at, old.experiment_id, old.idea_id) then
    return new;
  end if;
  -- Na de bewaartermijn mag het team de verwijzing naar het (verwijderde) bestand wissen; verder niets.
  if old.purged_at is not null and old.document_path is not null and new.document_path is null
     and (new.status, new.method, new.person_key, new.signed_at, new.experiment_id, new.idea_id)
         is not distinct from (old.status, old.method, old.person_key, old.signed_at, old.experiment_id, old.idea_id) then
    return new;
  end if;
  raise exception 'COMMITMENT_LOCKED: een toezegging ligt vast; alleen intrekken is mogelijk' using errcode = 'P0001';
end $$;
drop trigger if exists test_commitments_guard on public.test_commitments;
create trigger test_commitments_guard before insert or update on public.test_commitments
  for each row execute function public.guard_test_commitment();
drop trigger if exists test_commitments_refs on public.test_commitments;
create trigger test_commitments_refs before insert or update on public.test_commitments
  for each row execute function public.check_idea_refs('experiment_id', 'experiments');

alter table public.test_commitments enable row level security;
-- Namen en documenten van ondertekenaars zijn persoonsgegevens: alleen het onderzoeksteam (geen opdrachtgevers).
drop policy if exists test_commitments_select on public.test_commitments;
create policy test_commitments_select on public.test_commitments for select to authenticated using (public.can_write_idea(idea_id));
drop policy if exists test_commitments_insert on public.test_commitments;
create policy test_commitments_insert on public.test_commitments for insert to authenticated with check (public.can_write_idea(idea_id));
drop policy if exists test_commitments_update on public.test_commitments;
create policy test_commitments_update on public.test_commitments for update to authenticated
  using (public.can_write_idea(idea_id)) with check (public.can_write_idea(idea_id));
revoke all on public.test_commitments from public, anon, authenticated;
grant select, insert, update on public.test_commitments to authenticated;

-- De persoonlijke link: wat de ondertekenaar ziet (zonder persoonsgegevens) en het akkoord zelf.
create or replace function public.get_commitment_invite(p_key text, p_token_hash text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare c public.test_commitments; e public.experiments;
begin
  if not public.ingest_key_ok(p_key) then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  select * into c from public.test_commitments where token_hash = p_token_hash and method = 'link';
  if c.id is null then
    return null;
  end if;
  select * into e from public.experiments where id = c.experiment_id;
  return jsonb_build_object(
    'state', case when c.status = 'signed' then 'signed' when c.status = 'revoked' then 'revoked'
                  when c.token_expires_at < now() or e.state not in ('live', 'paused') then 'expired' else 'open' end,
    'product', coalesce(e.config->>'product_name', e.title), 'offer', coalesce(e.config->>'offer', ''),
    'headline', coalesce(e.config->>'headline', ''), 'researcher', coalesce(e.config->>'researcher', ''),
    'privacy', coalesce(e.config->'privacy', '{}'::jsonb), 'commitment_text', coalesce(e.config->>'commitment_text', ''));
end $$;

create or replace function public.sign_commitment(p_key text, p_token_hash text, p_name text, p_org text, p_typed_name text, p_consent boolean, p_ip_hash text)
returns text language plpgsql security definer set search_path = '' as $$
declare c public.test_commitments; v_state text;
begin
  if not public.ingest_key_ok(p_key) then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  select * into c from public.test_commitments where token_hash = p_token_hash and method = 'link' for update;
  if c.id is null then
    return 'unknown';
  end if;
  select e.state into v_state from public.experiments e where e.id = c.experiment_id;
  if c.status <> 'invited' then
    return 'used';
  end if;
  if c.token_expires_at < now() or v_state not in ('live', 'paused') then
    return 'expired';
  end if;
  if not coalesce(p_consent, false) or char_length(btrim(coalesce(p_name, ''))) < 2 or char_length(btrim(coalesce(p_org, ''))) < 2
     or char_length(btrim(coalesce(p_typed_name, ''))) < 2 then
    return 'invalid';
  end if;
  if lower(regexp_replace(btrim(p_typed_name), '\s+', ' ', 'g')) <> lower(regexp_replace(btrim(p_name), '\s+', ' ', 'g')) then
    return 'name_mismatch';
  end if;
  perform set_config('prooflab.commitment_sign', '1', true);
  update public.test_commitments
  set status = 'signed', signer_name = left(btrim(p_name), 200), signer_org = left(btrim(p_org), 200),
      typed_name = left(btrim(p_typed_name), 200), consent = true, signed_at = now(),
      ip_hash = case when p_ip_hash ~ '^[a-f0-9]{64}$' then p_ip_hash end
  where id = c.id;
  perform set_config('prooflab.commitment_sign', '', true);
  return 'ok';
end $$;

-- Privé bucket voor getekende intentieverklaringen: alleen het onderzoeksteam leest, uploadt en verwijdert.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('commitment-documents', 'commitment-documents', false, 10485760, array['application/pdf', 'image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do nothing;
drop policy if exists commitment_documents_objects_select on storage.objects;
create policy commitment_documents_objects_select on storage.objects for select to authenticated
  using (bucket_id = 'commitment-documents' and public.can_write_idea(public.commitment_document_idea(name)));
drop policy if exists commitment_documents_objects_insert on storage.objects;
create policy commitment_documents_objects_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'commitment-documents' and public.can_write_idea(public.commitment_document_idea(name)));
drop policy if exists commitment_documents_objects_delete on storage.objects;
create policy commitment_documents_objects_delete on storage.objects for delete to authenticated
  using (bucket_id = 'commitment-documents' and public.can_write_idea(public.commitment_document_idea(name))
         and not exists (select 1 from public.test_commitments c where c.document_path = name and c.purged_at is null));

-- ---------------------------------------------------------------------------
-- 6. Afspraken (Calendly en Cal.com)
-- ---------------------------------------------------------------------------

-- Eén webhookadres per test en aanbieder. Alleen de sha256 van de code in de URL staat hier; de geheime sleutel voor
-- de handtekening leidt de app-server af uit de code (HMAC met TRACKING_SALT) en wordt nergens bewaard.
create table if not exists public.test_booking_hooks (
  id uuid primary key default gen_random_uuid(),
  experiment_id uuid not null references public.experiments(id) on delete cascade,
  idea_id uuid not null references public.ideas(id) on delete cascade,
  provider text not null check (provider in ('calendly', 'calcom')),
  token_hash text not null unique check (token_hash ~ '^[a-f0-9]{64}$'),
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (experiment_id, provider)
);
create index if not exists test_booking_hooks_idea_idx on public.test_booking_hooks(idea_id);
create index if not exists test_booking_hooks_created_by_fk on public.test_booking_hooks(created_by);
alter table public.test_booking_hooks enable row level security;
drop policy if exists test_booking_hooks_all on public.test_booking_hooks;
create policy test_booking_hooks_all on public.test_booking_hooks for all to authenticated
  using (public.can_write_idea(idea_id)) with check (public.can_write_idea(idea_id));
drop trigger if exists test_booking_hooks_refs on public.test_booking_hooks;
create trigger test_booking_hooks_refs before insert or update on public.test_booking_hooks
  for each row execute function public.check_idea_refs('experiment_id', 'experiments');
revoke all on public.test_booking_hooks from public, anon, authenticated;
grant select, insert, delete on public.test_booking_hooks to authenticated;

-- Punt 5 (werving) leest deze tabel voor "afspraak" in de wervingstrechter: de eerste kolommen liggen vast.
create table if not exists public.test_bookings (
  id uuid primary key default gen_random_uuid(),
  experiment_id uuid not null references public.experiments(id) on delete cascade,
  idea_id uuid not null references public.ideas(id) on delete cascade,
  provider text not null check (provider in ('calendly', 'calcom')),
  external_id text not null check (char_length(external_id) between 1 and 300),
  person_key text not null check (person_key ~ '^[a-f0-9]{64}$'),
  status text not null check (status in ('booked', 'cancelled')),
  booked_at timestamptz not null,
  scheduled_for timestamptz,
  created_at timestamptz not null default now(),
  -- Extra kolommen (fase 2 · punt 4).
  cancelled_at timestamptz,
  updated_at timestamptz not null default now(),
  retention_until date not null default ((current_date + interval '12 months')::date),
  purged_at timestamptz,
  unique (provider, external_id)
);
create index if not exists test_bookings_experiment_idx on public.test_bookings(experiment_id, person_key);
create index if not exists test_bookings_idea_idx on public.test_bookings(idea_id);
alter table public.test_bookings enable row level security;
drop policy if exists test_bookings_select on public.test_bookings;
create policy test_bookings_select on public.test_bookings for select to authenticated using (public.can_read_idea(idea_id));
revoke all on public.test_bookings from public, anon, authenticated;
grant select on public.test_bookings to authenticated;
comment on table public.test_bookings is
  'Fase 2 · punt 4: geboekte afspraken uit Calendly/Cal.com (Waargenomen handeling). Geannuleerd telt niet. Gelezen door de wervingstrechter (punt 5).';

-- De app-server heeft de handtekening en het tijdsvenster al gecontroleerd. Antwoord: ok, duplicate, unknown (code),
-- closed (test loopt niet), conflict (id hoort bij een andere test), ignored (annulering zonder boeking) of rate.
-- Een geannuleerde afspraak blijft geannuleerd: een herhaalde of oude "geboekt" maakt haar niet weer geldig.
create or replace function public.record_test_booking(
  p_key text, p_token_hash text, p_provider text, p_external_id text, p_person_key text, p_status text,
  p_booked_at timestamptz, p_scheduled_for timestamptz)
returns text language plpgsql security definer set search_path = '' as $$
declare
  h public.test_booking_hooks;
  b public.test_bookings;
  v_state text;
begin
  if not public.ingest_key_ok(p_key) then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if p_status not in ('booked', 'cancelled') or p_person_key !~ '^[a-f0-9]{64}$' or char_length(coalesce(p_external_id, '')) not between 1 and 300 then
    raise exception 'INVALID_BOOKING' using errcode = 'P0001';
  end if;
  select * into h from public.test_booking_hooks where token_hash = p_token_hash and provider = p_provider;
  if h.id is null then
    return 'unknown';
  end if;
  if not public.ingest_allowed('booking:' || p_token_hash) then
    return 'rate';
  end if;
  select * into b from public.test_bookings where provider = p_provider and external_id = p_external_id for update;
  if b.id is not null then
    if b.experiment_id <> h.experiment_id then
      return 'conflict';
    end if;
    if p_status = 'cancelled' and b.status = 'booked' then
      update public.test_bookings set status = 'cancelled', cancelled_at = now(), updated_at = now() where id = b.id;
      return 'ok';
    end if;
    return 'duplicate';
  end if;
  if p_status = 'cancelled' then
    return 'ignored';
  end if;
  select e.state into v_state from public.experiments e where e.id = h.experiment_id;
  if v_state not in ('live', 'paused') then
    return 'closed';
  end if;
  insert into public.test_bookings (experiment_id, idea_id, provider, external_id, person_key, status, booked_at, scheduled_for)
  values (h.experiment_id, h.idea_id, p_provider, p_external_id, p_person_key, 'booked', coalesce(p_booked_at, now()), p_scheduled_for);
  return 'ok';
end $$;

-- ---------------------------------------------------------------------------
-- 7. Per persoon tellen
-- ---------------------------------------------------------------------------

-- Alleen aantallen (geen persoonsgegevens) voor iedereen die het dossier mag lezen. Bezoekers, klikkers en
-- aanmelders zoals experiment_event_counts (een klik telt alleen na een weergave); betalers alleen live en betaald
-- (terugbetaald of testmodus telt niet); toezeggingen alleen getekend; afspraken alleen geboekt (niet geannuleerd).
create or replace function public.experiment_action_counts(p_experiment uuid)
returns table (visitors bigint, clickers bigint, submitters bigint, payers bigint, test_payers bigint, refunded bigint,
               unrefunded bigint, committers bigint, bookers bigint, cancelled_bookings bigint)
language plpgsql stable security definer set search_path = '' as $$
declare v_idea uuid;
begin
  select e.idea_id into v_idea from public.experiments e where e.id = p_experiment;
  if v_idea is null or not public.can_read_idea(v_idea) then
    return;
  end if;
  return query
  with v as (
    select distinct visitor_hash from public.test_events where experiment_id = p_experiment and event_type = 'view'
  )
  select
    (select count(*) from v),
    (select count(*) from v where exists (select 1 from public.test_events c where c.experiment_id = p_experiment and c.visitor_hash = v.visitor_hash and c.event_type = 'cta_click')),
    (select count(*) from v where exists (select 1 from public.test_events s where s.experiment_id = p_experiment and s.visitor_hash = v.visitor_hash and s.event_type = 'submit')),
    (select count(distinct p.person_key) from public.test_payments p where p.experiment_id = p_experiment and p.status = 'paid' and p.mode = 'live'),
    (select count(distinct p.person_key) from public.test_payments p where p.experiment_id = p_experiment and p.status = 'paid' and p.mode = 'test'),
    (select count(*) from public.test_payments p where p.experiment_id = p_experiment and p.status in ('refunded', 'charged_back')),
    (select count(*) from public.test_payments p where p.experiment_id = p_experiment and p.status = 'paid'),
    (select count(distinct c.person_key) from public.test_commitments c where c.experiment_id = p_experiment and c.status = 'signed'),
    (select count(distinct b.person_key) from public.test_bookings b where b.experiment_id = p_experiment and b.status = 'booked'),
    (select count(*) from public.test_bookings b where b.experiment_id = p_experiment and b.status = 'cancelled');
end $$;

-- ---------------------------------------------------------------------------
-- 8. Privacy
-- ---------------------------------------------------------------------------

-- Nieuwe aanmeldingen: 12 maanden (was 180 dagen). Bestaande rijen houden hun datum.
alter table public.test_submissions alter column retention_until set default ((current_date + interval '12 months')::date);

-- Een nieuwe landing- of prijstest (config.privacy aanwezig) gaat pas live met naam en contact van de
-- verwerkingsverantwoordelijke; met betaalstap ook alleen als de werkruimte een Mollie-sleutel heeft. Bestaande tests
-- (zonder config.privacy) en hervatten na een pauze blijven werken.
create or replace function public.guard_experiment_go_live()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if old.state = 'approved' and new.state = 'live' and new.type in ('landing', 'pricing') then
    if new.config ? 'privacy' and (coalesce(btrim(new.config->'privacy'->>'controller_name'), '') = ''
                                   or coalesce(btrim(new.config->'privacy'->>'controller_contact'), '') = '') then
      raise exception 'PRIVACY_CONTROLLER: vul naam en contact van de verwerkingsverantwoordelijke in voordat de test live gaat' using errcode = 'P0001';
    end if;
    if coalesce((new.config->'deposit'->>'enabled')::boolean, false) and not exists (
         select 1 from public.org_payment_settings s join public.ideas i on i.org_id = s.org_id
         where i.id = new.idea_id and s.mollie_key_cipher is not null) then
      raise exception 'DEPOSIT_NOT_CONFIGURED: de betaalstap vraagt een Mollie-sleutel van de werkruimte' using errcode = 'P0001';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists experiments_go_live_guard on public.experiments;
create trigger experiments_go_live_guard before update on public.experiments
  for each row execute function public.guard_experiment_go_live();

-- Laatste versie uit 20261115090000_interviews_import.sql; toegevoegd: toezeggingen (namen, getypte naam, gehashte IP)
-- en de persoonssleutel van betalingen en afspraken na de bewaartermijn. Mollie-id, bedrag, status en tijden blijven
-- als boekhoudspoor; de aantallen in goedgekeurde Learning Cards veranderen niet.
create or replace function public.purge_expired_personal_data()
returns int language plpgsql security definer set search_path = '' as $$
declare v1 int; v2 int; v3 int; v4 int; v5 int; v6 int; v7 int; v8 int;
begin
  update public.test_submissions set email = null, answers = '{}'::jsonb
  where retention_until < current_date and (email is not null or answers <> '{}'::jsonb);
  get diagnostics v1 = row_count;
  update public.interviews set transcript = '[verwijderd na afloop van de bewaartermijn]', segments = null
  where retention_until < current_date and (transcript <> '[verwijderd na afloop van de bewaartermijn]' or segments is not null);
  get diagnostics v2 = row_count;
  update public.observations o set quote = null, quote_start = null, quote_end = null, segment_index = null
  from public.interviews i
  where o.interview_id = i.id and i.retention_until < current_date and (o.quote is not null or o.quote_start is not null or o.segment_index is not null);
  update public.outreach_events set message = null where retention_until < current_date and message is not null;
  get diagnostics v3 = row_count;
  update public.survey_invitations set email = 'verwijderd-' || id::text || '@invalid'
  where retention_until < current_date and email not like 'verwijderd-%';
  get diagnostics v4 = row_count;
  update public.survey_responses set answers = (
      select coalesce(jsonb_object_agg(k, case when jsonb_typeof(v) = 'string' and length(v #>> '{}') > 40 then to_jsonb('[verwijderd]'::text) else v end), '{}'::jsonb)
      from jsonb_each(answers) as t(k, v))
  where retention_until < current_date;
  -- Copies of outreach replies (180 days) and open survey answers (365 days) in the source library.
  delete from public.source_excerpts x using public.sources s
  where x.source_id = s.id
    and ((s.source_type = 'outreach' and s.created_at < now() - interval '180 days')
      or (s.source_type = 'survey' and s.created_at < now() - interval '365 days'));
  get diagnostics v5 = row_count;
  -- Signal quotes whose fragment is gone are removed; the label and count stay.
  update public.customer_signals cs set quotes = coalesce((
      select jsonb_agg(q) from jsonb_array_elements(cs.quotes) q
      where exists (select 1 from public.source_excerpts x where x.id::text = q->>'excerpt_id')), '[]'::jsonb)
  where exists (select 1 from jsonb_array_elements(cs.quotes) q
                where not exists (select 1 from public.source_excerpts x where x.id::text = q->>'excerpt_id'));
  -- Thema's, toewijzingen, labels van de pseudonimisering en de aantallen blijven: daar staan geen citaten in.
  -- Fase 2 · punt 4: toezeggingen zonder namen; het document verwijdert het team via de Storage-API (de app toont
  -- "verlopen"); de status (en dus de telling) blijft.
  update public.test_commitments set signer_name = null, signer_org = null, typed_name = null, ip_hash = null, purged_at = now()
  where retention_until < current_date and purged_at is null;
  get diagnostics v6 = row_count;
  update public.test_payments set person_key = encode(extensions.digest('purged|' || id::text, 'sha256'), 'hex'), purged_at = now()
  where retention_until < current_date and purged_at is null;
  get diagnostics v7 = row_count;
  update public.test_bookings set person_key = encode(extensions.digest('purged|' || id::text, 'sha256'), 'hex'), purged_at = now()
  where retention_until < current_date and purged_at is null;
  get diagnostics v8 = row_count;
  return v1 + v2 + v3 + v4 + v5 + v6 + v7 + v8;
end $$;

-- Laatste versie uit 20261115090000_interviews_import.sql; toegevoegd: betalingen, afspraken en toezeggingen op de
-- persoonssleutel (dezelfde HMAC van het e-mailadres als p_hashes).
create or replace function public.dsr_search(p_org uuid, p_email text, p_hashes text[])
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_hashes text[];
  out jsonb;
begin
  if (select auth.uid()) is null or not public.is_org_owner(p_org) then
    raise exception 'FORBIDDEN: alleen eigenaren van de werkruimte behandelen privacyverzoeken' using errcode = 'P0001';
  end if;
  if char_length(v_email) > 254 or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'INVALID_EMAIL' using errcode = 'P0001';
  end if;
  v_hashes := coalesce(array(select h from unnest(coalesce(p_hashes, '{}')) h where h ~ '^[a-f0-9]{64}$' limit 10), '{}');

  out := jsonb_build_object(
    'email', v_email,
    'searched_at', now(),
    'survey_invitations', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', i.id, 'idea', d.title, 'experiment', e.title, 'email', i.email, 'status', i.status,
        'delivery_issue', i.delivery_issue, 'error', i.error, 'created_at', i.created_at, 'sent_at', i.sent_at,
        'reminded_at', i.reminded_at, 'responded_at', i.responded_at, 'retention_until', i.retention_until,
        'response', (select jsonb_build_object('id', r.id, 'created_at', r.created_at, 'source', r.source,
                       'channel', r.channel, 'answers', r.answers, 'retention_until', r.retention_until)
                     from public.survey_responses r where r.invitation_id = i.id)
      ) order by i.created_at), '[]'::jsonb)
      from public.survey_invitations i
      join public.ideas d on d.id = i.idea_id
      join public.experiments e on e.id = i.experiment_id
      where d.org_id = p_org and (i.email = v_email or i.email_hash = any(v_hashes))),
    'test_submissions', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', s.id, 'idea', d.title, 'experiment', e.title, 'email', s.email, 'answers', s.answers,
        'channel', s.channel, 'consent_text', s.consent_text, 'created_at', s.created_at, 'retention_until', s.retention_until
      ) order by s.created_at), '[]'::jsonb)
      from public.test_submissions s
      join public.ideas d on d.id = s.idea_id
      join public.experiments e on e.id = s.experiment_id
      where d.org_id = p_org and s.email = v_email),
    'email_suppressions', (
      select coalesce(jsonb_agg(jsonb_build_object('created_at', x.created_at, 'reason', x.reason) order by x.created_at), '[]'::jsonb)
      from public.email_suppressions x where x.org_id = p_org and x.email_hash = any(v_hashes)),
    'interviews', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', iv.id, 'idea', d.title, 'experiment', coalesce(e.title, 'Verkennend interview'), 'participant_label', iv.participant_label,
        'held_on', iv.held_on, 'label_is_email', lower(iv.participant_label) = v_email,
        'transcript_mentions_email', strpos(lower(iv.transcript), v_email) > 0,
        'pseudonymized', iv.pseudonymized_at is not null
      ) order by iv.held_on), '[]'::jsonb)
      from public.interviews iv
      join public.ideas d on d.id = iv.idea_id
      left join public.experiments e on e.id = iv.experiment_id
      where d.org_id = p_org and (lower(iv.participant_label) = v_email or strpos(lower(iv.transcript), v_email) > 0)),
    'test_payments', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', p.id, 'idea', d.title, 'experiment', e.title, 'mollie_id', p.mollie_id, 'amount', p.amount, 'currency', p.currency,
        'status', p.status, 'mode', p.mode, 'created_at', p.created_at, 'paid_at', p.paid_at, 'refunded_at', p.refunded_at,
        'retention_until', p.retention_until
      ) order by p.created_at), '[]'::jsonb)
      from public.test_payments p join public.ideas d on d.id = p.idea_id join public.experiments e on e.id = p.experiment_id
      where d.org_id = p_org and p.person_key = any(v_hashes)),
    'test_bookings', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', b.id, 'idea', d.title, 'experiment', e.title, 'provider', b.provider, 'status', b.status,
        'booked_at', b.booked_at, 'scheduled_for', b.scheduled_for, 'retention_until', b.retention_until
      ) order by b.booked_at), '[]'::jsonb)
      from public.test_bookings b join public.ideas d on d.id = b.idea_id join public.experiments e on e.id = b.experiment_id
      where d.org_id = p_org and b.person_key = any(v_hashes)),
    'test_commitments', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', c.id, 'idea', d.title, 'experiment', e.title, 'method', c.method, 'status', c.status,
        'signer_name', c.signer_name, 'signer_org', c.signer_org, 'signed_at', c.signed_at,
        'has_document', c.document_path is not null, 'retention_until', c.retention_until
      ) order by c.created_at), '[]'::jsonb)
      from public.test_commitments c join public.ideas d on d.id = c.idea_id join public.experiments e on e.id = c.experiment_id
      where d.org_id = p_org and c.person_key = any(v_hashes)),
    'team_account', (
      select coalesce(jsonb_agg(jsonb_build_object('full_name', p.full_name, 'role', m.role, 'member_since', m.created_at)), '[]'::jsonb)
      from public.profiles p join public.organization_members m on m.user_id = p.user_id and m.org_id = p_org
      where lower(p.email) = v_email),
    'client_access', (
      select coalesce(jsonb_agg(jsonb_build_object('idea', d.title, 'role', im.role, 'invited_at', im.created_at,
                                                   'account_linked', im.user_id is not null) order by im.created_at), '[]'::jsonb)
      from public.idea_members im join public.ideas d on d.id = im.idea_id
      where d.org_id = p_org and lower(im.email) = v_email)
  );
  -- The request itself is logged, without the address.
  insert into public.audit_events (org_id, actor_id, table_name, row_id, action, detail)
  values (p_org, auth.uid(), 'privacy_requests', gen_random_uuid()::text, 'dsr_search', jsonb_build_object(
    'invitations', jsonb_array_length(out->'survey_invitations'), 'submissions', jsonb_array_length(out->'test_submissions'),
    'suppressions', jsonb_array_length(out->'email_suppressions'), 'interviews', jsonb_array_length(out->'interviews'),
    'payments', jsonb_array_length(out->'test_payments'), 'bookings', jsonb_array_length(out->'test_bookings'),
    'commitments', jsonb_array_length(out->'test_commitments')));
  return out;
end $$;

-- ---------------------------------------------------------------------------
-- Auditspoor: betalingen, toezeggingen en afspraken (losse test_events niet)
-- ---------------------------------------------------------------------------
-- Laatste versie uit 20261115090000_interviews_import.sql; v_hidden uitgebreid met persoonssleutels, namen, getypte
-- naam, gehashte IP en codes van de nieuwe tabellen.
create or replace function public.audit_row()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  rec jsonb;
  prev jsonb;
  v_idea uuid;
  v_org uuid;
  v_changes jsonb := '{}'::jsonb;
  k text;
  -- Persoonsgegevens uit gesprekken komen nooit als tekst in het auditspoor, ook niet als ze kort zijn.
  v_hidden text[] := case
    when tg_table_name in ('interviews', 'observations') then array['transcript', 'quote', 'participant_label']
    when tg_table_name in ('test_payments', 'test_bookings') then array['person_key', 'external_id']
    when tg_table_name = 'test_commitments' then array['person_key', 'signer_name', 'signer_org', 'typed_name', 'ip_hash', 'token_hash', 'document_path']
    when tg_table_name = 'test_booking_hooks' then array['token_hash']
    else array[]::text[] end;
begin
  rec := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  v_idea := case when tg_table_name = 'ideas' then (rec->>'id')::uuid else nullif(rec->>'idea_id', '')::uuid end;
  v_org := case when tg_table_name = 'ideas' then (rec->>'org_id')::uuid
                else (select i.org_id from public.ideas i where i.id = v_idea) end;
  -- During a cascade the idea row is already gone; its earlier audit rows still name the organisation.
  if v_org is null and v_idea is not null then
    select a.org_id into v_org from public.audit_events a where a.idea_id = v_idea and a.org_id is not null limit 1;
  end if;
  if tg_op = 'UPDATE' then
    prev := to_jsonb(old);
    for k in select jsonb_object_keys(rec) loop
      if k not in ('updated_at') and rec->k is distinct from prev->k then
        v_changes := v_changes || jsonb_build_object(k, jsonb_build_object(
          'old', case when length(coalesce(prev->>k, '')) > 300 or (k = any(v_hidden) and prev->>k is not null) then to_jsonb('md5:' || md5(prev->>k)) else prev->k end,
          'new', case when length(coalesce(rec->>k, '')) > 300 or (k = any(v_hidden) and rec->>k is not null) then to_jsonb('md5:' || md5(rec->>k)) else rec->k end));
      end if;
    end loop;
  end if;
  insert into public.audit_events (idea_id, org_id, actor_id, table_name, row_id, action, detail)
  values (
    v_idea, v_org, auth.uid(), tg_table_name,
    coalesce(rec->>'id', concat_ws(':', rec->>'assumption_id', rec->>'claim_id', rec->>'observation_id', rec->>'idea_id')),
    lower(tg_op),
    case
      when tg_op = 'UPDATE' then jsonb_build_object('changes', v_changes)
      when tg_op = 'DELETE' then jsonb_build_object('deleted', (
        select jsonb_object_agg(key, case when length(value::text) > 300 or (key = any(v_hidden) and value <> 'null'::jsonb) then to_jsonb('md5:' || md5(value::text)) else value end)
        from jsonb_each(rec)))
      else null
    end
  );
  return null;
end $$;

do $$
declare t text;
begin
  foreach t in array array['test_payments', 'test_commitments', 'test_bookings', 'test_booking_hooks'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_audit', t);
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function public.audit_row()', t || '_audit', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Rechten op functies
-- ---------------------------------------------------------------------------

revoke execute on function
  public.payment_settings_status(uuid), public.set_mollie_key(uuid, text, text, text), public.mollie_key_for_idea(uuid),
  public.deposit_checkout(text, text, text, text, text), public.register_test_payment(text, text, text, text, numeric, text, text, text),
  public.mollie_webhook_lookup(text, text, text), public.record_mollie_status(text, text, text, text), public.mark_refund_requested(uuid),
  public.get_commitment_invite(text, text), public.sign_commitment(text, text, text, text, text, boolean, text),
  public.record_test_booking(text, text, text, text, text, text, timestamptz, timestamptz), public.experiment_action_counts(uuid),
  public.commitment_document_idea(text)
  from public, anon, authenticated;
grant execute on function
  public.payment_settings_status(uuid), public.set_mollie_key(uuid, text, text, text), public.mollie_key_for_idea(uuid),
  public.mark_refund_requested(uuid), public.experiment_action_counts(uuid), public.commitment_document_idea(text)
  to authenticated;
-- Met de ingest-sleutel (alleen op de app-server): de publieke betaalroute, de webhooks en de toezeggingslink (anon);
-- record_mollie_status ook vanuit een ingelogde terugbetaling.
grant execute on function
  public.deposit_checkout(text, text, text, text, text), public.register_test_payment(text, text, text, text, numeric, text, text, text),
  public.mollie_webhook_lookup(text, text, text), public.record_mollie_status(text, text, text, text),
  public.get_commitment_invite(text, text), public.sign_commitment(text, text, text, text, text, boolean, text),
  public.record_test_booking(text, text, text, text, text, text, timestamptz, timestamptz)
  to anon, authenticated;
revoke execute on function public.guard_test_commitment(), public.guard_experiment_go_live() from public, anon, authenticated;

commit;
