# ProofLab

Van beslisvraag naar onderbouwd besluit. ProofLab is een consultancytool voor validatiesprints:
marktonderzoek waarbij elke bewering een controleerbaar citaat heeft, experimenten met vooraf
vergrendelde drempels, een verplichte Reality Check en een reproduceerbaar rapport voor de opdrachtgever.

> Een AI-antwoord is een hypothese of een bevinding met bron, nooit automatisch bewijs dat de markt zal kopen.

Productbronnen: [`CLAUDE.md`](CLAUDE.md) (bouw- en designafspraken), [`docs/FUNCTIONEEL_ONTWERP.md`](docs/FUNCTIONEEL_ONTWERP.md),
[`docs/ProofLab_Analyse_en_Verbeteringen_v1.1.md`](docs/ProofLab_Analyse_en_Verbeteringen_v1.1.md) (besluiten en eerste route),
[`design/REFERENCE_MOCKUPS.html`](design/REFERENCE_MOCKUPS.html). Voortgang: [`IMPLEMENTATION_STATUS.md`](IMPLEMENTATION_STATUS.md).
Visuele afwijkingen: [`DESIGN_DIFF_LOG.md`](DESIGN_DIFF_LOG.md).

## De route (v1)

Beslisvraag → idee en projecttype → onderzoekskaart (≤ 5 vragen) → marktverkenning met verificatie per bewering →
marktomvang van onderaf → aannamekaart (belangrijk × bewijs) → één van drie experimenten (landingspagina, interviews,
prijs-/aanbodtest) → bewijs met onzekerheidsinterval → Reality Check → besluit (opdrachtgever bevestigt) → rapport.

## Stack

- Next.js 16 (App Router, Turbopack), React 19, TypeScript strict, Tailwind v4 + de CSS uit de referentie-mock-ups
- Supabase: Postgres met row level security op elke tabel, Auth (wachtwoord en magic link)
- Drie AI-aanbieders achter één interface (`lib/ai/providers`): Claude (Anthropic, server-side webzoeken/-ophalen met citaten), ChatGPT (OpenAI Responses API met `web_search`) en Gemini (`generateContent` met `google_search`); gestructureerde uitvoer (Zod), modellen en prijzen in `lib/ai/providers/config.ts`
- Vitest (unit, RLS en eval), Playwright (E2E)

## Lokaal starten

```bash
npm install
cp .env.example .env.local   # vul de waarden in, zie hieronder
npm run dev                  # http://localhost:3000
```

### Omgevingsvariabelen

| Variabele | Verplicht | Waarvoor |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | ja | Supabase-project (publishable key is browser-veilig) |
| `NEXT_PUBLIC_APP_URL` | ja | Basis-URL voor inloglinks en deelbare testlinks |
| `INGEST_SECRET` | voor live tests | Gedeeld geheim tussen app-server en de ingest-RPC's van testpagina's |
| `TRACKING_SALT` | voor live tests | Geheim voor de cookieloze, per test verschillende bezoekerscode (HMAC); geldt als sleutelversie `v1` |
| `TRACKING_SALTS` | nee | Geheimen met versie, voor rotatie: `v2:nieuwgeheim,v1:oudgeheim` (eerste = huidige, elk geheim ≥ 16 tekens, geen komma's). Zonder deze variabele is `TRACKING_SALT` de enige versie (`v1`) |
| `RESEND_WEBHOOK_SECRET` | nee | Ondertekeningsgeheim (`whsec_...`) van de Resend-webhook naar `/api/email/resend` voor harde bounces en spammeldingen |
| `ANTHROPIC_API_KEY` | nee | Claude (Anthropic). Eén AI-sleutel is genoeg om AI-onderzoek, AI-aannames, interviewcodering, de coach en AI-vragen in de Reality Check aan te zetten |
| `OPENAI_API_KEY` | nee | ChatGPT (OpenAI, Responses API met `web_search`) |
| `GEMINI_API_KEY` | nee | Gemini (Google, `generateContent` met `google_search`) |
| `ANTHROPIC_MODEL`, `OPENAI_MODEL`, `GEMINI_MODEL` | nee | Ander model per aanbieder; standaardmodellen en prijzen staan in `lib/ai/providers/config.ts` |
| `RESEARCH_BUDGET_USD` | nee | Maximum per diepe onderzoeksrun (standaard 3) |
| `RESEND_API_KEY`, `EMAIL_FROM` | nee | Persoonlijke enquête-uitnodigingen en uitnodigingen aan opdrachtgevers via Resend (docs/OPERATIONS.md §10) |
| `SENTRY_DSN` | nee | Serverfouten naar een Sentry-compatibele dienst (Sentry, GlitchTip, Bugsink); zonder: alleen JSON-logregels |
| `SENTRY_ENVIRONMENT`, `SENTRY_RELEASE` | nee | Labels bij gemelde fouten (standaard `VERCEL_ENV` / `VERCEL_GIT_COMMIT_SHA`) |
| `RESEND_API_KEY`, `EMAIL_FROM` | nee | Verstuurt persoonlijke enquête-uitnodigingen via Resend (afzender op een geverifieerd domein); zonder deze twee download je de persoonlijke links als CSV |
| `CRON_SECRET` | voor achtergrondtaken via cron | Geheim (minstens 16 tekens) waarmee Vercel Cron of een externe planner `/api/jobs/run` aanroept (`Authorization: Bearer <CRON_SECRET>`) |

Zonder een van `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` of `GEMINI_API_KEY` toont de app overal "AI niet verbonden" en werkt
alles handmatig: bronnen en citaten toevoegen, interviews coderen, aannames vanuit een sjabloon. Er worden nooit gesimuleerde
resultaten getoond als echt. Eigenaren kiezen onder Systeemstatus → AI-aanbieders per taak welke aanbieder werkt; is de gekozen
aanbieder niet verbonden, dan neemt een verbonden aanbieder het over. Met meerdere sleutels zoeken de aanbieders los van elkaar
naar bronnen (een bevinding telt alleen met een letterlijk citaat uit de opgehaalde pagina) en voorspelt elk model apart.

Enquêtes verspreiden: persoonlijke links (`/s/<slug>?u=<token>`) en afmeldlinks (`/s/afmelden?u=<token>&e=<hash>`) zijn
afgeleid van het trackinggeheim (token = HMAC van het willekeurige uitnodigings-id, alleen de sha256 wordt opgeslagen; e = HMAC
van het e-mailadres voor de afmeldlijst per organisatie). Zet in Resend open- en kliktracking uit.

Geheim roteren: elke uitnodiging bewaart zijn sleutelversie (`survey_invitations.salt_version`, standaard `v1`). Zet het
nieuwe geheim vooraan in `TRACKING_SALTS` en laat het oude erachter staan, bijv. `TRACKING_SALTS=v2:<nieuw>,v1:<oud>`. Nieuwe
uitnodigingen gebruiken `v2`; herinneringen, CSV-export en afmeldlinks van oude uitnodigingen blijven werken met `v1`, en de
afmeldlijst wordt onder alle versies gecontroleerd. Haal een oude versie pas weg als er geen lopende uitnodigingen meer onder
vallen. Beperking: bezoekerscodes van testpagina's (`lib/domain/tracking.ts`) en contactcodes van Expandi gebruiken altijd
de huidige versie. Roteer daarom tussen tests: tijdens een lopende test telt een terugkerende bezoeker na de rotatie
opnieuw mee en kan hij een ander prijspunt zien.

Bounces en spammeldingen: maak in Resend → Webhooks een endpoint `<NEXT_PUBLIC_APP_URL>/api/email/resend` voor de events
`email.bounced` en `email.complained` (`email.delivered` en `email.delivery_delayed` worden geaccepteerd en genegeerd) en zet
het ondertekeningsgeheim in `RESEND_WEBHOOK_SECRET`. De handtekening (Svix: `svix-id`, `svix-timestamp`, `svix-signature`)
wordt gecontroleerd, tijdstempels ouder dan vijf minuten worden geweigerd en elk `svix-id` wordt één keer verwerkt. Een
harde bounce of klacht zet de uitnodiging op mislukt (met reden) en het adres op de afmeldlijst van de organisatie.

Expandi: per experiment kan een consultant de "Assign people by using a webhook"-URL van een Expandi-campagne opslaan en
bij het LinkedIn-DM-bericht contacten (profiel-URL, voornaam) naar die campagne sturen, met de placeholders
`{prooflab_message}` en `{prooflab_link}` (link met `utm_source=outreach&utm_content=<postcode>`). Expandi kan via deze
webhook geen berichtsjabloon instellen; zet de placeholders zelf in het campagnebericht. Alternatief: CSV voor de
Expandi-import. Uitgaande verzoeken gaan alleen via https naar `api.liaufa.com` of `*.expandi.io`.

### Achtergrondtaken

Het versturen van enquête-uitnodigingen en herinneringen loopt als taak in de Postgres-wachtrij `public.jobs`
(migratie `20261104120000_jobs.sql`), niet meer in het browsertabblad. De worker `/api/jobs/run` pakt taken met
`FOR UPDATE SKIP LOCKED`, werkt maximaal ~50 seconden, probeert tijdelijke fouten opnieuw met oplopende wachttijd
(30 s, 1 min, 2 min, … max. 1 uur; standaard 5 pogingen) en praat met de database via de publishable key plus
`INGEST_SECRET` (er is geen service-role-sleutel). Elke uitnodiging wordt vóór het mailen geclaimd, dus een herhaalde
of dubbele run mailt niemand twee keer.

- `vercel.json` plant de worker elke minuut (`* * * * *`). Dat schema vraagt Vercel Pro; Vercel stuurt dan zelf
  `Authorization: Bearer $CRON_SECRET` mee.
- Zonder minutencron (Vercel Hobby staat één run per dag toe): de app start de worker ook direct na het inplannen
  (`after()` in de server action) en elke keer dat het Verspreiden-paneel de voortgang opvraagt (elke 3 seconden zolang
  er een taak loopt). Sluit de gebruiker het tabblad, dan gaat een taak verder bij de volgende cronrun of het volgende
  bezoek. Alternatief: laat een externe planner (bijv. GitHub Actions of cron-job.org) elke minuut
  `curl -H "Authorization: Bearer $CRON_SECRET" https://<app>/api/jobs/run` aanroepen.
- Zonder `RESEND_API_KEY`/`EMAIL_FROM` wordt niets ingepland (eerlijke status "e-mail niet gekoppeld").

### Rapport als PDF

`/app/ideas/<id>/report/pdf?v=<versie>` maakt de PDF op de server met `@react-pdf/renderer` (geen headless browser).
Zelfde zichtbaarheid als de rapportpagina: opdrachtgevers alleen gedeelde versies.

### Database

Migraties staan in `supabase/migrations/` en worden in volgorde toegepast (Supabase CLI `supabase db push`, of via
het dashboard). Daarna één keer de hash van `INGEST_SECRET` registreren:

```sql
insert into public.ingest_keys (key_hash) values (encode(extensions.digest('<INGEST_SECRET>', 'sha256'), 'hex'));
```

E-mail: de standaard-SMTP van Supabase verstuurt alleen naar teamleden van het Supabase-project. Stel voor
uitnodigingen aan opdrachtgevers een eigen SMTP-provider in (bijv. Resend) onder Authentication → SMTP.

Toegang op uitnodiging, eenmalig in het Supabase-dashboard:

1. **Authentication → Hooks → Before user created**: kies de Postgres-functie `public.hook_before_user_created`.
   Alleen uitgenodigde adressen en adressen op de toegangslijst kunnen dan een account aanmaken.
2. **Authentication → Email Templates → Magic Link**: laat de link wijzen naar
   `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email&next={{ .RedirectTo }}`, zodat een uitnodiging
   op elk apparaat werkt.
3. Consultants op de toegangslijst zetten: `insert into public.signup_allowlist (entry) values ('@jouwbureau.nl');`
   (of een exact e-mailadres).

Het AI-maandbudget per werkruimte staat in `organizations.ai_monthly_cap_usd` (standaard $50).

Beheer (staging, migratiegeschiedenis, back-ups, geheimen roteren, auth-hook, opschoontaak, monitoring, CSP):
[`docs/OPERATIONS.md`](docs/OPERATIONS.md). Eigenaren van een werkruimte zien de stand op **Systeemstatus** (`/app/status`).

## Tests

```bash
npm run check            # lint + typecheck + unit + eval (deterministisch); CI draait dit plus test:db en build
npm run test:db          # RLS- en integriteitstests tegen een lokale Postgres (PGHOST/PGPORT)
npm run test:e2e         # Playwright; E2E_EMAIL/E2E_PASSWORD van een bevestigde testgebruiker
                         # (CI draait dit tegen een lokale Supabase-stack, zie docs/OPERATIONS.md §9)
npm run dogfood          # zet het dossier "ProofLab op ProofLab" via de UI in de werkruimte van DOGFOOD_EMAIL
EVAL_LIVE=1 npm test     # 30 praktijkcases, live tegen het model (kost geld; vereist ANTHROPIC_API_KEY)
```

`npm run test:db` maakt een wegwerpdatabase met een kleine Supabase-shim (`tests/db/supabase-shim.sql`) en draait alle
migraties. Een lokale Postgres 16 is genoeg; Docker is niet nodig.

## Architectuur in het kort

- **Toegang**: elke query loopt met de JWT van de gebruiker, dus RLS geldt altijd. Consultants (organisatieleden)
  schrijven; opdrachtgevers (`idea_members`) lezen alleen hun dossier, zonder ruwe interviews of e-mailadressen,
  en bevestigen besluiten via `confirm_decision()`.
- **Integriteit in de database**: hypotheses vergrendelen bij goedkeuring, experimenten volgen een state machine,
  besluiten en rapporten zijn onveranderlijk, alles wordt gelogd in `audit_events`.
- **Verificatie zonder LLM** (`lib/domain/verify.ts`): een citaat moet letterlijk in het bewaarde bronfragment staan
  en elk getal uit de bewering moet in het citaat voorkomen. De status van een bewering wordt berekend uit bronsoort,
  onafhankelijkheid, tegenspraak en actualiteit.
- **Onderzoeksrun** (`lib/research-runner.ts`): één stap per verzoek, elke stap persistent, herstartbaar en met
  kostenplafond. AI-bevindingen waarvan het citaat niet letterlijk terug te vinden is, worden niet opgeslagen.
- **Testpagina's** (`/t/[slug]`): merkneutraal, geen cookies, eerlijke uitleg na elke klik; bezoekers en
  prijsvarianten worden server-side bepaald; events komen alleen binnen via RPC's met ingest-sleutel en zijn ontdubbeld.
- **Statistiek** (`lib/domain/stats.ts`): Wilson-interval; een oordeel pas na de eindconditie.

## Bekende beperkingen

Zie `IMPLEMENTATION_STATUS.md` → "Nog niet gebouwd". Onder meer: AI-gemodereerde interviews, koppelingen met
advertentie-API's, betalingen, weekritmes met Fathom-import en de volledige experimentencatalogus volgen na de route.
PDF loopt via de printfunctie van de browser (printstylesheet met paginanummers).
