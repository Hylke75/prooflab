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
- Claude API (`claude-opus-5-5`) met server-side webzoeken/-ophalen en citaten, gestructureerde uitvoer (Zod)
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
| `TRACKING_SALT` | voor live tests | Geheim voor de cookieloze, per test verschillende bezoekerscode (HMAC) |
| `ANTHROPIC_API_KEY` | nee | Zet AI-onderzoek, AI-aannames, interviewcodering en AI-vragen in de Reality Check aan |
| `RESEARCH_BUDGET_USD` | nee | Maximum per diepe onderzoeksrun (standaard 3) |

Zonder `ANTHROPIC_API_KEY` toont de app overal "AI niet verbonden" en werkt alles handmatig: bronnen en citaten
toevoegen, interviews coderen, aannames vanuit een sjabloon. Er worden nooit gesimuleerde resultaten getoond als echt.

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

## Tests

```bash
npm run check            # lint + typecheck + unit + eval (deterministisch); CI draait dit plus test:db en build
npm run test:db          # RLS- en integriteitstests tegen een lokale Postgres (PGHOST/PGPORT)
npm run test:e2e         # Playwright; E2E_EMAIL/E2E_PASSWORD van een bevestigde testgebruiker
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
