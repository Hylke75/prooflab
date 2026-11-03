# Redesign-logboek (visuele laag)

Uitvoering van `docs/REDESIGN_INSTRUCTIE.md`. Alleen styling, tokens, spacing, typografie en layoutverhoudingen zijn
aangepast; functionaliteit, routes, datamodel, componentlogica en informatie-architectuur zijn ongewijzigd.

## 1. Inventarisatie vóór de wijziging (commit `261707b`)

**Waar staan kleuren, fonts en radii?**

| Plek | Wat | Opmerking |
|---|---|---|
| `app/globals.css` | Vrijwel alle styling: 283 regels, deels als minified regels uit de mock-up geport (`.app`, `.sidebar`, `.topbar`, `.workspace`, `.coach`, `.card`, `.btn`, `.pill`, `.tabs`, `.stepper`, …) | `:root` met 16 CSS-variabelen (`--ink`, `--blue`, `--blueDark`, `--coral`, `--lime`, `--mint`, `--cream`, `--white`, `--line`, `--muted`, `--soft`, `--red`, `--amber`, `--green`, `--shadow`, `--radius`) |
| `app/layout.tsx` | Fonts via `next/font/google`: Space Grotesk (koppen, `--font-space-grotesk`) en DM Sans (body, `--font-dm-sans`); `themeColor` `#151b28` | |
| Tailwind | v4 via `@import "tailwindcss"` bovenaan `globals.css` (`@tailwindcss/turbopack`); géén `tailwind.config`, géén `@theme`, en componenten gebruiken geen Tailwind-utilities, alleen de eigen klassen | Tokens zijn nu ook in een `@theme`-blok gekoppeld |
| Componenten | 485 inline `style={{…}}`-objecten, waarvan een deel met kleur of radius | |
| `lib/report-pdf.tsx` | Eigen kleurconstanten voor de PDF (react-pdf, geen CSS) | Bewust niet aangepast |
| `lib/domain/survey-distribution.ts` | Inline e-mail-HTML met vaste kleuren | E-mailclients kennen geen CSS-variabelen |

**Radii:** door elkaar 4, 8, 9, 10, 11, 12, 13, 14, 16, 18, 20 (`--radius`), 22, 25, 42, 50px en 50%.

**Hardcoded hex-waarden per bestand** (aantal voorkomens, incl. de 16 in `:root`):

| Bestand | Hex |
|---|---|
| app/globals.css | 276 |
| lib/report-pdf.tsx | 16 |
| components/forecast/CalibrationChart.tsx | 12 |
| app/app/page.tsx | 12 |
| components/research/SizingPanel.tsx | 9 |
| app/app/ideas/[id]/report/page.tsx | 8 |
| app/app/ideas/[id]/research/page.tsx | 7 |
| lib/domain/survey-distribution.ts | 4 |
| components/survey/SurveyEditor.tsx | 3 |
| components/experiments/ResultMeter.tsx | 3 |
| components/shell/Sidebar.tsx, components/research/CompetitorPanel.tsx, components/assumptions/RiskBoard.tsx, app/app/ideas/[id]/experiments/[expId]/page.tsx, app/app/ideas/[id]/evidence/page.tsx | 2 per bestand |
| components/ui/Stepper.tsx, components/survey/PromoPosts.tsx, components/research/CustomerSignals.tsx, components/experiments/ExperimentBuilder.tsx, app/s/[slug]/page.tsx, app/s/[slug]/SurveyForm.tsx, app/login/page.tsx, app/layout.tsx, app/app/ideas/new/page.tsx, app/app/clients/page.tsx | 1 per bestand |

Daarnaast 4 `rgba()`-waarden in `globals.css` (focusring, knopschaduw, topbar-achtergrond).

## 2. Centrale tokens

Alle tokens staan in `:root` bovenaan `app/globals.css` en zijn via `@theme inline` ook aan het Tailwind-thema gekoppeld
(`bg-primary`, `text-heading`, `rounded-card`, `shadow-card`, `font-heading`, …).

- **Kleuren uit de instructie:** `--color-bg`, `--color-surface`, `--color-surface-soft`, `--color-surface-soft-2`,
  `--color-primary`, `--color-primary-hover`, `--color-accent`, `--color-heading`, `--color-text`, `--color-text-muted`,
  `--color-border`, en per status `--color-success|warning|risk` met `-soft`.
- **Aanvullingen (met reden):** `--color-surface-muted` (`#F1F4F6`, de grijze icoonknop- en hovertint uit de instructie),
  `--color-accent-text` (`#0B6E9F`), `--color-*-text` voor statustekst, `--color-border-strong`, `--color-border-input`,
  `--color-on-dark`, `--color-on-dark-muted`, `--color-overlay`, `--focus-ring`.
- **Vorm en diepte:** `--radius-card` 24, `--radius-panel` 20, `--radius-inner` 16, `--radius-hero` 32, `--radius-input` 12,
  `--radius-pill` 9999; `--shadow-lg` (`0 32px 99px rgba(0,0,0,.08)`), `--shadow-sm` (`0 8px 24px rgba(0,0,0,.05)`),
  `--shadow-hover`.
- **Typografie:** `--font-heading` (Plus Jakarta Sans), `--font-body` (Inter), beide via `next/font` in `app/layout.tsx`.
- **Oude namen** (`--ink`, `--blue`, `--cream`, `--line`, …) blijven als alias naar de nieuwe tokens bestaan; alle
  verwijzingen in CSS en componenten zijn gemigreerd naar de nieuwe namen.

## 3. Wijzigingen per component

| Component | Wat is er veranderd |
|---|---|
| App-shell | Kolommen 248 / flexibel / 320 px (1480 px: 228/292). Contentbreedte max. 1200 px, ruimere padding (40/56/96 px). |
| Sidebar | Wit met 1px rand rechts, donkere tekst; actief item als petrolblauwe pill met witte tekst; groepslabels in muted zonder hoofdletters; woordmerk-cirkel petrolblauw; idee-kaartje en werkruimtechip op zachtblauw; scrollen binnen de kolom blijft. Mobiel (≤ 850 px) ongewijzigd een drawer, nu 280 px breed met lichte sluitknop. |
| Topbar | Wit, 76 px, onderrand; ronde icoonknoppen van 44 px op `#F1F4F6` met primair icoon; avatar 44 px petrolblauw. |
| Coachpaneel | Achtergrond `--color-surface-soft`, witte kaarten (radius 20) zonder rand; suggesties als witte vlakken met primaire tekst; coachnotities zonder rand (waarschuwing/lof als dunne binnenlijn links); invoerveld 48 px; knop primair. ≤ 1160 px slide-over boven de overlay; ≤ 768 px bottom-sheet (radius 24 bovenaan, max. 86 vh). |
| Typografie | Koppen Plus Jakarta Sans 600–700, antraciet, -0.01em; body Inter 16/26; H1 40/48 (mobiel 32/40), H2 28/36, H3 20/28, lead 18/29, klein 14/20; kleine labels van 10–12 px naar 12–14 px. Eyebrows en labels in zinshoofdletters (15px/600, accent). |
| Knoppen | Pill, padding 12 × 28, min. 48 px (klein 44 px). Primair petrol → hover donkerder; secundair wit met 1,5px primaire rand; zacht (`.soft`) zachtblauw; tertiair/tekstlink primair met onderstreping bij hover. 200 ms ease-out. |
| Kaarten | Radius 24, padding 28, één zachte schaduw en geen rand. Binnenste kaarten zonder schaduw (minder kaart-in-kaart); bevindingen binnen een kaart als lijstitems met scheidingslijn. KPI-cijfers 40 px in het kopfont. Ideekaarten en linkkaarten tillen 2 px op bij hover. Rekenkaart (marktomvang) petrolblauw. Modals, lades, menu's, pop-ups, toast en opslaan-overlay in dezelfde vorm. |
| Tabs | Pill-segment in een witte container met rand; actieve tab petrol gevuld met witte tekst, hover `#F1F4F6`. Filters en scenarioknoppen als pills. |
| Stepper | Bolletjes 32 px; voltooid petrol met wit vinkje, actief petrolkern met accentring, toekomstig `#F1F4F6` met muted cijfer; lijn 2px. |
| Badges | Volledig pill, zachte achtergrond + donkere tekst per status. Tegenargumenten: klein rond icoon in zachte risicotint. |
| Formulieren | Inputs/selects 48 px, radius 12, focus: accentrand + ring 2px accent op 30%. Fout/succes als zachte vlakken. Keuzekaarten (intake, besluit, aannames, testtypes) met 1,5px rand en primaire selectie. |
| Lijsten / accordions | Kaarten met lijsten (onderzoeksvragen, bronnen, bewijs, aanbevelingen) krijgen de zware zachte schaduw; items 1px gescheiden, ruimere padding; uitklapbare `details.quickline` krijgen een chevron in een rond knopje. |
| Paginakop / hero | Eyebrow + H1 + lead in een zachtblauw blok met gradient naar transparant, radius 32 met zwaardere hoek linksonder (96 px); CTA staat eronder in plaats van rechtsboven (puur CSS, volgorde in de DOM ongewijzigd). Dashboard-hero in dezelfde vorm, met de eigen ProofLab-vormen in petrol/wit. |
| Beslisvraag-kaart | Zachtblauw, geen rand, radius 24; label als eyebrow in accentkleur; vraag als H2 (28/36); status als zachte pill. |
| Lege staten | Gecentreerd op zachtblauw vlak, radius 24, ruime padding. |
| Terug naar boven | Nieuw `components/ui/BackToTop.tsx`: ronde knop 56 px in accent, verschijnt na 640 px scrollen, scrolt naar boven (direct bij reduced motion) en zet de focus op de inhoud; boven de coachknop op smallere schermen; verborgen bij printen. |
| Inlogpagina | Petrolblauw merkvlak in plaats van navy, eyebrow in lichte tint (AA). |
| Systeemstatus / privacy / enquête | Volgen automatisch de tokens; rijkoppen in tabellen krijgen een minimumbreedte zodat ze niet per letter afbreken; de knop "Test verbinding" is een zachte pill. |
| Print | Printstylesheet verbergt nog steeds navigatie, coach, coachknop, overlay, opslaan-overlay en de terug-naar-boven-knop; rapportpapier zonder radius/schaduw. |

**Teksten:** de woorden zijn ongewijzigd. Eyebrows die in de bron in HOOFDLETTERS getypt stonden (in de mock-up deed
CSS dat al met `text-transform`) staan nu in zinshoofdletters, zoals de instructie vraagt; drie `.toUpperCase()`-aanroepen
die alleen voor eyebrow-weergave dienden zijn weggehaald.

## 4. Toegankelijkheid

- `--color-accent` `#1E9BD7` haalt op wit 3,1:1: alleen voor niet-tekst (focusring, terug-naar-boven-knop, decoratie).
  Eyebrows van 15 px/600 zijn volgens WCAG geen "grote tekst" (dat is ≥ 18,66 px vet), dus die gebruiken
  `--color-accent-text` `#0B6E9F` (5,6:1 op wit, 4,5:1 op `--color-surface-soft-2`).
- De statustinten uit de instructie halen als tekst op hun eigen zachte achtergrond geen 4,5:1 (succes 3,8:1,
  waarschuwing 3,8:1). Badgetekst gebruikt daarom `--color-success-text` `#1F6B43` en `--color-warning-text` `#8A5200`
  (beide ≈ 5,8:1); de basiskleuren blijven voor stippen, lijnen en iconen.
- Invoervelden, radio's en checkboxen krijgen rand `--color-border-input` `#87959E` (3:1 tegen wit, WCAG 1.4.11);
  `--color-border` `#E6ECF1` alleen voor scheidingslijnen.
- Focus zichtbaar op alles wat klikbaar is (2px accentring met offset; op velden accentrand + ring). Knoppen, tabs,
  navigatie-items, icoonknoppen en stepperlinks zijn minimaal 44 px hoog.
- `prefers-reduced-motion`: geen animaties of transities en geen optil-effecten bij hover.
- Bestaande fout gevonden en opgelost: op ≤ 1160 px lag het geopende coachpaneel onder de overlay (z-index 25 tegen 28).

## 5. Voor/na-screenshots

Playwright (Chromium, deviceScaleFactor 2), lokale Supabase-stack met de E2E-gebruiker en één idee via de intake:

| Pagina | Voor (`261707b`) | Na |
|---|---|---|
| Overzicht `/app`, 1440 px | `docs/redesign/before-overzicht-1440.png` | `docs/redesign/after-overzicht-1440.png` |
| Overzicht `/app`, 390 px | `docs/redesign/before-overzicht-390.png` | `docs/redesign/after-overzicht-390.png` |
| Onderzoek `/app/ideas/[id]/research`, 1440 px | `docs/redesign/before-research-1440.png` | `docs/redesign/after-research-1440.png` |
| Onderzoek, 390 px | `docs/redesign/before-research-390.png` | `docs/redesign/after-research-390.png` |

Op 390 px is `document.documentElement.scrollWidth` 390 op beide pagina's (geen horizontale scroll). De sticky zijbalk en
coach zijn op een volledige-paginaschermafbeelding maar één schermhoogte hoog; dat is het gedrag van `position: sticky`.

## 6. Niet getokeniseerd (bewust of niet mogelijk)

| Plek | Waarde | Reden |
|---|---|---|
| `app/layout.tsx` `viewport.themeColor` | `#ffffff` | Metatag; CSS-variabelen werken daar niet. |
| `app/globals.css` `@page` voettekst | `#5b666c` | Paginamarges in `@page` erven geen variabelen van `:root` betrouwbaar. |
| `app/globals.css` chevron in `details.quickline` | `%23004A6D` in een data-URI-SVG | Variabelen werken niet binnen een data-URI. |
| `app/globals.css` `.section-row` gradient | `rgba(238,244,250,0)` | Transparante variant van `--color-surface-soft` voor een vloeiende gradient (geen `color-mix` nodig). |
| `app/globals.css` `.calc-dark .divider`, `.login-art:after` | `rgba(255,255,255,.2/.22)` | Halfdoorzichtig wit op petrol; geen apart token waard. |
| `app/globals.css` tokens `--shadow-*`, `--color-overlay`, `--focus-ring` | `rgba(…)` | Dit zíjn de tokens. |
| `lib/report-pdf.tsx` | 16 hex-waarden | react-pdf kent geen CSS-variabelen; bewust niet aangepast (opdracht). De PDF behoudt de oude rapportkleuren. |
| `lib/domain/survey-distribution.ts` | 4 hex-waarden | Inline-HTML voor e-mail; e-mailclients ondersteunen geen CSS-variabelen. |
| Inline stijlen in componenten | ca. 490 `style={{…}}` | Kleuren en radii daarin zijn nu tokens; marges, maten en fontgroottes (getallen) zijn blijven staan. Opruimen naar klassen is een aparte, grotere refactor. |
| Mock-up-decoratie in hero en inlogpagina | vormen, rotaties | Eigen ProofLab-vormen, alleen herkleurd. |

## 7. Controles

`npm run lint`, `npm run typecheck`, `npx vitest run tests/unit tests/eval` (433 geslaagd, 3 overgeslagen),
`npm run build` en `npx playwright test tests/e2e/journey.spec.ts tests/e2e/public.spec.ts` tegen de lokale
Supabase-stack (9/9 geslaagd, desktop + mobiel) slagen na de redesign.
