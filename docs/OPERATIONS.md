# ProofLab beheren

Praktisch draaiboek voor wie ProofLab in productie houdt: omgevingen, migraties, back-ups, geheimen, de auth-hook,
de opschoontaak, foutmonitoring, de Content-Security-Policy en CI. Snelle controle van een omgeving: log in als
eigenaar van een werkruimte en open **Systeemstatus** (`/app/status`).

## 1. Omgevingen

| Omgeving | Database | App | Doel |
|---|---|---|---|
| Lokaal | `supabase start` (Docker, `supabase/config.toml`) of een kale Postgres voor `npm run test:db` | `npm run dev` | Ontwikkelen, migraties proberen |
| CI | Lokale Supabase-stack in GitHub Actions (job `e2e`) | `npm run build && npm start` | Elke push en PR |
| Staging | Supabase-branch of tweede project | Vercel preview | Migraties en releases controleren vóór productie |
| Productie | Supabase-project `prooflab` | Vercel productie | Echte klanten |

### Staging opzetten

**Optie A: Supabase-branch** (Pro-plan, Branching aan). Een branch is een aparte database met eigen URL en sleutels, gemaakt
uit `supabase/migrations`.

1. Supabase-dashboard → Branches → *Create branch* (of koppel de GitHub-repo zodat elke PR een preview-branch krijgt).
2. Neem de URL en de publishable key van de branch over in de Vercel-previewomgeving (`NEXT_PUBLIC_SUPABASE_URL`,
   `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`) en zet staging-eigen waarden voor `INGEST_SECRET`, `TRACKING_SALT` en
   `NEXT_PUBLIC_APP_URL`.
3. Registreer de ingest-sleutel en de toegangslijst op de branch (zie README → Database) en zet de auth-hook aan (§6).

**Optie B: tweede project** (`prooflab-staging`), goedkoper en los van productie.

```bash
supabase link --project-ref <staging-ref>
supabase db push            # past alle migraties in volgorde toe
```

Gebruik op staging nooit productiedata met persoonsgegevens. Testgebruikers: een domein op `signup_allowlist`
(bijv. `@example.com`), aangemaakt via Authentication → Users of de admin-API.

## 2. Migraties

Migraties staan in `supabase/migrations/` en worden **op bestandsnaam (tijdstempel) gesorteerd** toegepast:

| Versie | Bestand | Inhoud |
|---|---|---|
| 20261027190000 | `core_schema.sql` | Tabellen |
| 20261027190100 | `security.sql` | Toegangsfuncties, RLS, triggers, publieke RPC's |
| 20261028090000 | `hardening.sql` | Rechten aangescherpt |
| 20261029090000 | `integrity.sql` | Integriteit, AI-budget, opschoontaak (pg_cron), registratie op uitnodiging, auth-hook-functie |
| 20261103090000 | `prediction.sql` | Voorspellus |
| 20261103100000 | `coach_and_signals.sql` | Coach, klantsignalen, webhooks |
| 20261103120000 | `surveys.sql` | Enquêtes |
| 20261103130000 | `review_fixes.sql` | Herstelpunten review |
| 20261103140000 | `survey_key_answers.sql` | Kernvraag voor opdrachtgevers |
| 20261104110000 | `ops.sql` | `system_status()` voor de statuspagina |

Regels:

- **Pas een toegepaste migratie nooit aan.** Elke wijziging is een nieuw bestand met een latere tijdstempel.
- Migraties zijn zo geschreven dat ze herhaalbaar zijn (`create or replace`, `if not exists`, `drop policy if exists`).
- Volgorde bij een release: eerst de migratie op staging, E2E/handmatige controle, dan `supabase db push` op productie,
  daarna pas de app uitrollen (nieuwe code verwacht het nieuwe schema; oud schema + nieuwe code geeft lege pagina's met
  "nog niet beschikbaar").
- Na het toepassen: `/app/status` toont de laatste migratie en markers per onderdeel. Lokaal: `npm run test:db` draait alle
  migraties op een kale Postgres met `tests/db/supabase-shim.sql`.

### Migratiegeschiedenis herstellen

De CLI houdt bij wat is toegepast in `supabase_migrations.schema_migrations`. Die tabel raakt uit de pas als een migratie
via de SQL-editor of een MCP-tool is toegepast in plaats van met `supabase db push`.

```bash
supabase migration list                                   # lokaal versus remote naast elkaar
supabase migration repair --status applied 20261104110000 # wel toegepast, maar niet geregistreerd
supabase migration repair --status reverted 20261104110000 # geregistreerd, maar niet (meer) aanwezig
supabase db push --dry-run                                 # controle: er staat niets meer open
```

Controleer vóór `repair --status applied` dat de migratie echt is toegepast (bijv. via de markers op `/app/status`
of `select to_regprocedure('public.system_status(uuid)')`). Een migratie die half is gelukt: los de oorzaak op en voer het
bestand opnieuw uit (ze zijn herhaalbaar), registreer daarna pas.

## 3. Back-ups en herstel

- **Automatisch**: Supabase maakt dagelijkse back-ups (Pro: 7 dagen). Zet voor productie **Point-in-Time Recovery** aan
  (Database → Backups) zodat herstel tot op de minuut kan, bijvoorbeeld vlak vóór een foute migratie.
- **Handmatig vóór elke migratie op productie**:

  ```bash
  supabase db dump --linked -f backup/schema.sql
  supabase db dump --linked --data-only -f backup/data.sql
  supabase db dump --linked --role-only -f backup/roles.sql
  ```

  Bewaar dumps versleuteld en buiten de repository (ze bevatten persoonsgegevens: e-mailadressen, interviews).
  Verwijder ze na de bewaartermijn uit het verwerkingsregister.
- **Hersteltest** (elk kwartaal): zet een dump terug op een staging-project of lokaal
  (`psql "$DB_URL" -f roles.sql -f schema.sql -f data.sql`), open de app ertegen en controleer `/app/status` en één dossier.
- `auth.users` zit in de data-dump; wachtwoorden zijn gehasht. Na herstel op een ander project werken bestaande sessies niet
  meer (andere JWT-sleutels): gebruikers loggen opnieuw in.

## 4. Geheimen roteren

| Geheim | Waar | Roteren |
|---|---|---|
| `INGEST_SECRET` | Vercel (server) + hash in `public.ingest_keys` | Zonder onderbreking: (1) hash van de nieuwe waarde toevoegen (`insert into public.ingest_keys (key_hash) values (encode(extensions.digest('<nieuw>', 'sha256'), 'hex'))`), (2) nieuwe waarde in Vercel zetten en uitrollen, (3) oude hash verwijderen. Meerdere hashes tegelijk zijn toegestaan |
| `TRACKING_SALT` | Vercel (server) | Let op: de salt zit in de cookieloze bezoekerscode, in de contact-hash van webhooks en in de HMAC van afmeldlinks. Na roteren tellen terugkerende bezoekers van vandaag opnieuw mee en werken afmeldlinks uit al verstuurde e-mails niet meer. Alleen roteren bij een lek, liefst tussen twee metingen |
| `ANTHROPIC_API_KEY` | Vercel (server) | Nieuwe sleutel in de Anthropic-console, in Vercel zetten, uitrollen, oude intrekken |
| `OPENAI_API_KEY` | Vercel (server) | Zelfde patroon in het OpenAI-platform (API keys) |
| `GEMINI_API_KEY` | Vercel (server) | Zelfde patroon in Google AI Studio (API keys) |
| `RESEND_API_KEY` | Vercel (server) | Zelfde patroon in Resend. `EMAIL_FROM` alleen wijzigen naar een geverifieerd domein |
| Supabase publishable key | Vercel (`NEXT_PUBLIC_…`) | Project settings → API keys: nieuwe publishable key maken, uitrollen, oude intrekken |
| Supabase secret/service-role key | Standaard niet in de app. Optioneel `SUPABASE_SERVICE_ROLE_KEY` (Vercel, server), alleen voor eenmalige inloglinks in uitnodigingen (§10) | Bij een lek intrekken in het dashboard en uit Vercel halen; uitnodigingen vallen dan terug op de link naar de inlogpagina |
| Supabase JWT-signeersleutel | Supabase | Project settings → JWT keys: nieuwe sleutel als standby, roteren; ingelogde gebruikers loggen opnieuw in |
| `SENTRY_DSN` | Vercel (server) | Nieuwe client key in het monitoringproject, uitrollen, oude intrekken |
| Webhook-tokens (Expandi) | Per dossier, alleen de hash in de database | Bij een lek: endpoint uitschakelen en een nieuwe maken op "Bronnen & koppelingen"; de URL in Expandi vervangen |
| Wachtwoord database | Supabase | Database settings → Reset password; alleen beheertools gebruiken het |

Na elke rotatie: `/app/status` (koppelingen) en één testpagina-bezoek of webhook-test.

## 5. Opschoontaak persoonsgegevens (pg_cron)

Migratie `integrity` plant dagelijks om 03:17 UTC `public.purge_expired_personal_data()` in als job
`prooflab-purge-personal-data` (interviewtranscripten en citaten na de bewaartermijn). `/app/status` toont de laatste run.

Controle in de SQL-editor:

```sql
select jobid, schedule, active from cron.job where jobname = 'prooflab-purge-personal-data';
select start_time, status, return_message from cron.job_run_details d
  join cron.job j using (jobid) where j.jobname = 'prooflab-purge-personal-data'
  order by start_time desc limit 10;
```

- **Geen job**: was pg_cron niet beschikbaar toen de migratie draaide? Zet de extensie aan (Database → Extensions) en plan
  opnieuw: `select cron.schedule('prooflab-purge-personal-data', '17 3 * * *', 'select public.purge_expired_personal_data()');`
- **Status `failed`**: lees `return_message`, los op en draai één keer handmatig: `select public.purge_expired_personal_data();`
- Zonder pg_cron (bijv. eigen Postgres): plan dezelfde aanroep met een andere scheduler; de statuspagina toont dan
  "pg_cron niet beschikbaar".
- Supabase ruimt `cron.job_run_details` niet automatisch op; houd het klein met een tweede job, bijv.
  `delete from cron.job_run_details where end_time < now() - interval '30 days'`.

## 6. Auth-hook "Before user created"

Registratie werkt op uitnodiging. De app controleert dit vóór het versturen van een inloglink; de hook dwingt het ook af
voor directe aanroepen van Supabase Auth.

**Productie/staging**: Authentication → Hooks → *Before user created* → type *Postgres*, schema `public`, functie
`hook_before_user_created` → opslaan. De migratie heeft de rechten voor `supabase_auth_admin` al gezet. Controle:
een registratie met een adres dat niet uitgenodigd is en niet op `signup_allowlist` staat geeft "ProofLab werkt op
uitnodiging".

**Lokaal/CI**: staat aan in `supabase/config.toml` (`[auth.hook.before_user_created]`). `scripts/e2e-seed.sh` zet het
testdomein op de toegangslijst voordat de testgebruiker wordt gemaakt.

Toegang geven: `insert into public.signup_allowlist (entry, note) values ('@bureau.nl', 'Bureau X');` (een heel domein) of
een volledig adres.

## 7. Foutmonitoring en logs

- Elke serverfout die Next.js opvangt (pagina's, route handlers, server actions, proxy) gaat via `instrumentation.ts`
  (`onRequestError`) naar `lib/log.ts`: één JSON-regel per gebeurtenis op stdout/stderr (zichtbaar in Vercel → Logs of een
  log drain).
- **Optioneel `SENTRY_DSN`**: dan stuurt `lib/monitoring.ts` foutregels als Sentry-envelope naar die DSN. Werkt met Sentry,
  GlitchTip, Bugsink en andere Sentry-compatibele diensten. Geen SDK: één `fetch` per fout, maximaal 3 s, nooit een fout voor
  de gebruiker. `SENTRY_ENVIRONMENT` en `SENTRY_RELEASE` zijn optioneel (anders `VERCEL_ENV` / `VERCEL_GIT_COMMIT_SHA`).
  De officiële `@sentry/nextjs` installeert wel met Next 16, maar voegt ~180 pakketten en een buildplugin toe; voor
  serverfouten is dat niet nodig.
- **Privacy**: `redact()` verwijdert velden als `email`, `to`, `answers`, `transcript`, `quote`, `text`, `password`,
  `token` en vervangt e-mailadressen, bearer-tokens, API-sleutels, persoonlijke linktokens (`?u=`) en webhook-tokens in
  tekst. Gebruikers-id's, IP-adressen, cookies en headers gaan nooit mee. Log ids, aantallen, statussen en codes; nooit
  inhoud. Let op: Next.js schrijft bij een onverwachte fout zelf ook de ruwe foutmelding naar stderr; gooi daarom geen
  fouten met persoonsgegevens in de tekst.
- Gebeurtenissen om op te alarmeren:

| Event | Niveau | Betekenis |
|---|---|---|
| `request_failed` | error | Onverwachte serverfout (route, pagina, actie) |
| `ai_call_failed` | error / warn | AI-aanroep mislukt (warn bij weigering of ontbrekende sleutel) |
| `ai_ledger_insert_failed`, `ai_budget_check_failed` | error | AI-kostenregistratie of budgetcontrole faalt: het maandplafond is dan niet betrouwbaar |
| `research_task_failed`, `research_advance_failed` | error | Stap van een onderzoeksrun mislukt (met `willRetry`) |
| `email_send_failed` | error / warn | Resend weigert of is onbereikbaar (warn als opnieuw proberen zin heeft) |
| `webhook_rejected` | warn / error | Expandi-webhook geweigerd (`reason`: `unknown_token`, `rate_limited`, `invalid_json`, `rpc_error`, …) |
| `coach_review_failed` | error | Achtergrondreview van de coach mislukt |

## 8. Content-Security-Policy

`proxy.ts` zet op elke pagina (ook de publieke `/t` en `/s`) een CSP met een nieuwe nonce per verzoek (`lib/csp.ts`):
`script-src 'self' 'nonce-…' 'strict-dynamic'`, `style-src-elem` met nonce, `style-src-attr 'unsafe-inline'` (React
`style`-props), `img-src 'self' data: blob:`, `connect-src 'self'` + Supabase (+ Sentry-host als `SENTRY_DSN` is gezet),
`frame-ancestors 'none'`, `base-uri 'none'`, `form-action 'self'`, `object-src 'none'`, en `upgrade-insecure-requests` als
`NEXT_PUBLIC_APP_URL` https is.

- Alle pagina's worden per verzoek gerenderd (de root-layout roept `connection()` aan); een statisch voorgerenderde pagina
  kan geen nonce krijgen en zou zonder scripts laden.
- Een externe bron toevoegen (bijv. een analytics-domein): breid `buildCsp` uit en voeg een test toe in
  `tests/unit/ops.test.ts`. Gebruik nooit `'unsafe-inline'` of `'unsafe-eval'` in `script-src` (alleen in `next dev`).
- Controle: `curl -sI https://<domein>/login | grep -i content-security-policy`; de E2E-tests (`public.spec.ts`) falen bij
  CSP-meldingen in de console.

## 9. CI

`.github/workflows/ci.yml` draait op elke push en elke pull request:

- **check**: lint, typecheck, unit- en eval-tests, database-tests (Postgres-service + shim), build.
- **e2e**: Supabase CLI (`supabase/setup-cli`) → `supabase start` (alle migraties, auth-hook aan) → controle dat elke
  migratie is toegepast → `scripts/e2e-seed.sh` (ingest-sleutel, toegangslijst, bevestigde testgebruiker) → build met de
  lokale URL en publishable key → Playwright (Chromium; journey + publieke pagina's, desktop en mobiel). Bij een fout:
  artifact `playwright-report` (HTML-rapport, traces) en de logs van de auth-, rest- en db-containers.

Lokaal hetzelfde draaien (Docker nodig):

```bash
supabase start
eval "$(supabase status -o env)"
export INGEST_SECRET=local-ingest TRACKING_SALT=local-salt E2E_EMAIL=e2e@example.com E2E_PASSWORD=e2e-Journey-Passw0rd
export NEXT_PUBLIC_SUPABASE_URL="$API_URL" NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY="$PUBLISHABLE_KEY" NEXT_PUBLIC_APP_URL=http://localhost:3000
scripts/e2e-seed.sh
npm run build
npx playwright test tests/e2e/journey.spec.ts tests/e2e/public.spec.ts
supabase stop --no-backup
```

Inloglinks (magic links) uit de lokale stack staan in Mailpit: <http://127.0.0.1:54324>.

## 10. Uitnodigingen aan opdrachtgevers en e-mail via Resend

Een uitnodiging (Klanten → dossier → "Uitnodigen", of "Stuur inloglink opnieuw") maakt de rij in `idea_members` aan en
verstuurt een eigen e-mail via Resend (`lib/invite.ts`, `lib/email.ts`), niet meer de standaardmail van Supabase Auth.

**Gekozen route zonder service-rol-sleutel (standaard).** De e-mail bevat een link naar
`/login?email=<adres>`. De inlogpagina opent dan op "Inloggen zonder wachtwoord" met het adres ingevuld; de opdrachtgever
vraagt zelf een magic link aan ("log in met een magic link"). Waarom dit de veiligste route is:

- er staat geen inlogtoken in onze e-mail: een doorgestuurde of gelekte uitnodiging geeft geen toegang;
- de app heeft geen service-rol-sleutel nodig (die omzeilt alle RLS) en blijft bij het principe "elke query met de JWT
  van de gebruiker";
- Supabase verstuurt de magic link alleen naar het adres zelf, en maakt alleen een account aan voor uitgenodigde adressen
  (`may_create_account` en de auth-hook, §6).

**Optioneel: eenmalige link.** Staat `SUPABASE_SERVICE_ROLE_KEY` in Vercel (alleen server), dan maakt de app met Supabase
admin `generateLink` (type `magiclink`, of `invite` voor een nieuw adres) een eenmalige link naar
`/auth/confirm?token_hash=…`. De sleutel wordt nergens anders gebruikt. Mislukt `generateLink`, dan valt de app terug op de
link naar de inlogpagina.

**Zonder `RESEND_API_KEY`/`EMAIL_FROM`** wordt niets verstuurd. De app meldt eerlijk "E-mail niet gekoppeld" en toont de
link om te kopiëren en zelf te delen. Weigert Resend (bijv. een niet-geverifieerd domein), dan volgt dezelfde kopieerbare
link met de foutmelding.

### Resend als SMTP voor Supabase Auth instellen

De magic link die de opdrachtgever op de inlogpagina aanvraagt, verstuurt Supabase Auth zelf. Zonder eigen SMTP gebruikt
Supabase een gedeelde testserver met een zeer lage limiet. Stel daarom Resend in als SMTP (eigenaar van het project):

1. Resend → Domains: verifieer het afzenderdomein (SPF/DKIM-records bij de DNS-beheerder) en maak een API-sleutel met
   alleen "Sending access".
2. Supabase-dashboard → Authentication → Emails → **SMTP Settings** → *Enable custom SMTP*:
   - **Host**: `smtp.resend.com`
   - **Port**: `465`
   - **Username**: `resend`
   - **Password**: de Resend-API-sleutel
   - **Sender email**: een adres op het geverifieerde domein (bijv. `inloggen@jouwdomein.nl`), **Sender name**: `ProofLab`
3. Opslaan, en onder Authentication → Rate Limits de limiet voor e-mails verhogen naar wat past (bijv. 30 per uur).
4. Controle: vraag op `/login` een inloglink aan voor een uitgenodigd testadres en kijk in Resend → Emails of hij is
   verstuurd.

Dezelfde sleutel mag als `RESEND_API_KEY` in Vercel staan; `EMAIL_FROM` moet ook op het geverifieerde domein liggen.

## 11. Onderzoeksruns op de server (fase B2)

Een onderzoeksrun (snelle marktcheck of diep onderzoek) loopt op de server en gaat door als het tabblad dicht is.

**Hoe het werkt.**

1. *Start* (server action `startResearchRun`) maakt de run en zijn stappen aan, vernieuwt zo nodig de sessie van de
   consultant (de nieuwe cookies gaan met de response mee naar de browser) en plant met `after()` uit `next/server`
   een aanroep van `POST /api/research/[runId]/advance` met het toegangstoken van de consultant.
2. *Portie*: die route controleert token, run en schrijfrecht, antwoordt direct `202` en werkt ná de response een
   portie af (`lib/research-worker.ts`): lease op de run (`research_run_lease`, tabel `research_run_leases`), stappen
   uitvoeren tot de portie ongeveer een minuut bezig is, lease vrijgeven en zichzelf opnieuw aanroepen voor de
   volgende portie. Elke stap bewaart zijn resultaat voordat de volgende start (`lib/research-runner.ts`); een
   afgebroken portie verliest dus niets, de onderbroken stap wordt na zes minuten opnieuw opgepakt.
3. *Klaar*: de run krijgt status `done` en er komt een coachnotitie "Snelle marktcheck klaar" / "Diep onderzoek klaar"
   (bron `system`) met bevindingen, kosten en wat niet is gedaan. Die staat in het coachpaneel en als badge op het
   dashboard.
4. *Open tabblad*: het paneel voert zelf geen stappen meer uit. Het ververst elke 5 s en vraagt elke minuut om
   hervatten; werkt er al een portie (lease), dan doet de server niets.

**Waarom zo, en niet Vercel Cron.** De bestaande cron (`/api/jobs/run`) werkt zonder gebruiker en zonder
service-rol-sleutel, via functies die het ingest-geheim controleren. Het onderzoek schrijft in veel tabellen (bronnen,
fragmenten, bevindingen, zoeklogboek, AI-grootboek) onder RLS als de consultant; dat allemaal omzetten naar
geheim-gecontroleerde functies, of de service-rol-sleutel gebruiken (die RLS omzeilt), is een veel groter risico. De
keten van porties met `after()` werkt op elk Vercel-plan (ook Hobby, waar cron maar één keer per dag mag), heeft geen
externe dienst nodig en houdt RLS intact.

**Grenzen.** Het werk draait met het toegangstoken van de consultant zonder het te vernieuwen (een vernieuwing buiten
de browser zou zijn sessie ongeldig maken). Bij de start wordt een token dat binnen 45 minuten verloopt eerst
vernieuwd, dus een run heeft minstens een uur. Is het token te kort geldig om nog een stap af te maken, dan pauzeert
de run netjes; hij hervat zodra iemand van het team de Marktverkenning opent of op "Snelle marktcheck" klikt. Supabase
→ Authentication → Sessions → *JWT expiry* (standaard 3600 s) bepaalt dit uur.

**Instellen.**

- Geen nieuwe omgevingsvariabelen nodig. `vercel.json` is niet gewijzigd.
- Previews met Vercel Deployment Protection: zet *Protection Bypass for Automation* aan; Vercel levert dan
  `VERCEL_AUTOMATION_BYPASS_SECRET`, die de vervolgaanroep meestuurt. Zonder bypass loopt een run op een beveiligde
  preview alleen door zolang het tabblad open is (productie heeft dit niet nodig).
- De vervolgaanroep gaat alleen naar de eigen app: de host van het verzoek als die bij deze deployment hoort
  (`APP_URL`/`NEXT_PUBLIC_APP_URL`, `VERCEL_URL`, `VERCEL_BRANCH_URL`, `VERCEL_PROJECT_PRODUCTION_URL`), anders `APP_URL`.
- Migratie `20261109090000_b2_onderzoek.sql` voegt de lease toe. Zonder die migratie werkt de keten ook, maar zonder
  lease (de claim per stap voorkomt dan nog steeds dat een stap twee keer loopt).

**Kosten.** Elke stap heeft een bovengrens (`lib/research-steps.ts`); een stap start alleen als uitgegeven + bovengrens
≤ plafond van de run (snelle check max $1,50, diep onderzoek `RESEARCH_BUDGET_USD`). Het paneel toont vóór de start
"geschat: $x–$y van max $z".

**Storingen.** Logregels `research_hop_refused`/`research_hop_failed` (vervolgaanroep lukte niet: kijk naar
Deployment Protection of het app-adres), `research_run_paused` (token te kort geldig) en `research_slice_failed`.

## 12. Notities en documenten per stap (Storage)

Migratie `20261110130000_notities_documenten.sql` (nog **niet** live; pas toepassen na akkoord van de product owner).
Ze is herhaalbaar en wijzigt geen bestaande gegevens.

**Tabellen** (beide met RLS en de gewone audit-trigger `audit_row`; bij verwijderen staat de hele rij in `audit_events`):

- `step_notes`: `idea_id`, `step` (`overview`, `market`, `assumptions`, `test`, `decide`), `title` (≤ 200), `body`
  (1–20.000 tekens), `author_name`, `created_by`, `created_at`, `updated_at`. Auteur, naam en tijden zet de database
  (trigger `stamp_step_item`); bij bewerken blijven dossier, stap en auteur vast.
- `step_documents`: `idea_id`, `step`, `storage_path` (uniek), `file_name`, `mime_type`, `size_bytes` (≤ 20 MB),
  `description` (≤ 500), `author_name`, `created_by`, `created_at`. Een check eist dat het pad bij hetzelfde idee en
  dezelfde stap hoort. Geen update: vervangen = nieuw uploaden en het oude verwijderen.

**Rechten**: lezen `can_read_idea` (team en opdrachtgever); toevoegen `can_write_idea` (team); bewerken en verwijderen
`can_edit_step_item(idea, created_by)` = mag schrijven én eigen item, of eigenaar van de werkruimte.

**Bucket `step-documents`** (privé, `insert … on conflict do nothing`): `file_size_limit` 20 MB (20971520 bytes),
`allowed_mime_types` PDF, DOCX, XLSX, PPTX, CSV, TXT, MD, PNG, JPEG, WEBP. Objectpad
`<idea_id>/<stap>/<uuid>-<veilige-naam>`; `step_document_idea(name)` leest het idee uit het pad en geeft `null` bij elk
afwijkend pad (dan weigeren alle policies). Policies op `storage.objects`:

| Policy | Wie |
|---|---|
| `step_documents_objects_select` | `can_read_idea(idee uit pad)` |
| `step_documents_objects_insert` | `can_write_idea(idee uit pad)` |
| `step_documents_objects_delete` | `can_edit_step_item(idee uit pad, uploader)`: de uploader of de eigenaar van de werkruimte |

Geen update-policy (overschrijven kan niet).

**Stroom**: de server action `prepareStepUpload` controleert naam, extensie, mime-type en grootte
(`lib/domain/step-files.ts`) en maakt met de sessie van de gebruiker een eenmalige uploadlink (`createSignedUploadUrl`,
dus de insert-policy geldt). De browser stuurt het bestand rechtstreeks naar Storage (niet via Vercel, dus geen limiet
op de grootte van een request). Daarna leest `recordStepDocument` grootte en type van het opgeslagen object zelf,
controleert opnieuw en legt de rij vast; klopt iets niet, dan wordt het object weer verwijderd. Downloaden gaat via
`/app/ideas/<id>/documenten/<docId>`: een doorverwijzing naar een `createSignedUrl` van 60 seconden, als bijlage met de
oorspronkelijke naam. Verwijderen: eerst het object, dan de rij.

**Controle na het toepassen**: Storage moet in het Supabase-project aan staan (Storage → Buckets toont
`step-documents`, privé). Upload als consultant een klein PDF'je bij een idee en download het; als opdrachtgever alleen
lezen en downloaden. Zonder migratie toont het blok "nog niet beschikbaar" en werkt de rest van de pagina gewoon.

**Bekende grenzen**: wordt een heel idee verwijderd, dan verdwijnen de rijen (cascade) maar blijven de bestanden in de
bucket staan; ruim die zo nodig op via het pad (`<idea_id>/…`). Een upload die halverwege wordt afgebroken (na het
uploaden, vóór het vastleggen) laat een los object achter. De inhoud van een bestand wordt niet gescand (alleen
extensie, mime-type en grootte); downloads gaan altijd als bijlage.

## 13. Interviews importeren en Fathom (fase 1 · punt 3)

**Migratie**: `20261115090000_interviews_import.sql` (idempotent). Zonder migratie meldt het importscherm dat de
database nog moet worden bijgewerkt; plakken bij "Interview toevoegen" blijft werken, thema's zijn niet beschikbaar.

**Bestanden**: TXT, MD, DOCX (ook Teams), VTT (Teams/Zoom) en SRT tot 4 MB (`lib/domain/transcript-parse.ts`). Het
bestand gaat alleen in het geheugen naar een server action (`experimental.serverActions.bodySizeLimit: "4.5mb"` in
`next.config.ts`, net onder de grens van Vercel) en wordt **nergens bewaard** (niet in Storage of `step_documents`).
Bewaard worden de gepseudonimiseerde tekst, segmenten zonder tekst, labels met aantallen en een SHA-256 van de
originele tekst tegen dubbele import. Pseudonimiseren is regelgebaseerd; een AI-dienst ziet alleen het resultaat.

**Bewaartermijn**: `retention_until` = gespreksdatum (`held_on`) + 12 maanden, door de database gezet bij een import.
`purge_expired_personal_data()` (pg_cron, §5) wist daarna transcript, segmenten en citaatposities; thema's,
toewijzingen, labels en de aantallen ("X van N") blijven.

**Fathom instellen** (optioneel; zonder koppeling exporteert het team het transcript uit Fathom als tekst en
importeert het als bestand):

1. Zet in de omgeving (Vercel → Project → Settings → Environment Variables, per omgeving) `FATHOM_ENABLED=1`.
   Optioneel `FATHOM_API_URL` als Fathom een andere basis-URL gebruikt (standaard `https://api.fathom.ai/external/v1`).
2. Redeploy.
3. Een eigenaar van de werkruimte maakt in Fathom een API-sleutel (Settings → API Access) en plakt die op
   `/app/status` onder "Fathom (interviewtranscripten)". De sleutel staat per werkruimte in
   `org_transcript_settings`: geen policies, alleen via `set_fathom_api_key`, `transcript_settings_status` (alleen
   of er een sleutel is en de laatste vier tekens) en `fathom_api_key_for_idea` (alleen voor wie het dossier mag
   bewerken). Hij komt niet in het auditspoor; wel wie hem zette of verwijderde.
4. Controle: op een lopende interviewtest staat bij "Transcript importeren" een keuzelijst met recente
   Fathom-opnames. Ophalen gebeurt pas bij "Lees het transcript in"; daarna dezelfde controle als bij een bestand.

**Sleutel roteren**: maak in Fathom een nieuwe sleutel, plak hem op `/app/status` ("Vervang sleutel") en trek de oude
in bij Fathom. Verwijderen kan met "Verwijder sleutel"; de koppeling staat dan op "niet verbonden".

**Bekende grenzen**: de sleutel staat onversleuteld in de database (alleen via functies leesbaar); versleutelen met
Supabase Vault is een mogelijke vervolgstap. Het auditspoor van een kort transcript kan
(≤ 300 tekens) de oude tekst bevatten na "Een gemiste naam vervangen".
