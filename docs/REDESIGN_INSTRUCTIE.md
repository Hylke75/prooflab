# Instructie voor Claude Code — Redesign ProofLab (visuele laag)

## Rol en doel
Je bent een senior product designer + front-end developer. Herontwerp de **visuele laag** van ProofLab (app-omgeving onder `/app/...`) zodat die aanvoelt als de website van FrieslandCampina Ingredients: licht, ruim, zacht afgerond, rustig en betrouwbaar — "expert-led" in plaats van "dashboard vol kaartjes".

**Niet aanpassen:** functionaliteit, routes, datamodel, teksten/copy, informatie-architectuur, componentlogica. Alleen styling, design tokens, spacing, typografie en layoutverhoudingen. Werk in het Nederlands (commentaar, commits).

## Werkwijze (verplicht)
1. Inventariseer eerst: waar staan kleuren/fonts/radii nu gedefinieerd (Tailwind-config, `globals.css`, CSS-variabelen, losse hex-waarden in componenten)? Rapporteer kort wat je vindt **vóór** je wijzigt.
2. Zet één centrale set **design tokens** op (CSS-variabelen in `:root` + gekoppeld in Tailwind-theme). Vervang hardcoded kleuren door tokens.
3. Pas daarna de componenten aan in deze volgorde: layout-shell (sidebar, topbar, rechterpaneel) → typografie → knoppen → kaarten → tabs/stepper → badges → formulieren/accordions.
4. Commit per stap met een duidelijke Nederlandse commitboodschap. Maak screenshots (Playwright, 1440px en 390px) vóór en na van: `/app/ideas/[id]/research` en het overzicht.

## Design tokens

### Kleuren
| Token | Waarde | Gebruik |
|---|---|---|
| `--color-bg` | `#FEFEFE` | Paginaachtergrond (vrijwel wit, géén crème/beige meer) |
| `--color-surface` | `#FFFFFF` | Kaarten, panelen |
| `--color-surface-soft` | `#EEF4FA` | Zachte blauwe vlakken (hero-blok, beslisvraag, coach-tips) |
| `--color-surface-soft-2` | `#DCE9F5` | Iets sterkere tint voor accentvlakken/gradiënten |
| `--color-primary` | `#004A6D` | Primaire knoppen, actieve states, links (diep petrolblauw) |
| `--color-primary-hover` | `#003A57` | Hover primair |
| `--color-accent` | `#1E9BD7` | Eyebrows/labels, focusring, kleine accenten, "terug naar boven"-knop |
| `--color-heading` | `#2C353A` | Koppen (antraciet, niet puur zwart) |
| `--color-text` | `#0A0A0A` | Bodytekst |
| `--color-text-muted` | `#5B666C` | Secundaire tekst, meta |
| `--color-border` | `#E6ECF1` | Subtiele lijnen/scheidingen |
| Status | succes `#2E8B57` op `#E8F5EE`, waarschuwing `#B26A00` op `#FFF4E0`, risico `#C0392B` op `#FDECEA` | Badges en "advocaat van de duivel"-punten — altijd zachte achtergrond + donkere tekst |

**Weg ermee:** het felle elektrisch blauw (`#3B4BF5`-achtig), de paarsige beslisvraag-kaart en de donkere navy sidebar.

### Typografie
- **Koppen:** een geometrische sans met karakter. FC gebruikt CentraNo1 (betaald); gebruik als vrij alternatief **"Plus Jakarta Sans"** of **"Outfit"** (Google Fonts) — kies één en wees consequent. Gewicht 600–700, kleur `--color-heading`, letter-spacing `-0.01em`.
- **Body/UI:** **Inter**, 400/500/600.
- Schaal: H1 40/48 (mobiel 32/40), H2 28/36, H3 20/28, body 16/26, lead-tekst 18/29, klein 14/20.
- **Eyebrow-labels** (zoals "STAP 2 VAN 5 · ONDERZOEK", "PROOFLAB COACH"): niet meer in uppercase-spaced kleine letters, maar normale zinshoofdletters, 15–16px, weight 600, kleur `--color-accent`, direct boven de kop (zoals "Insights" boven "Read the latest insights…").
- Vermijd puntjes achter koppen ("Begrijp je markt.") niet — copy blijft zoals hij is.

### Vorm, ruimte en diepte
- **Radius:** kaarten en panelen `24px`; grote hero-/introblokken `32px` met optioneel één "zwaardere" hoek (bijv. `border-radius: 32px 32px 32px 96px` linksonder, zoals de FC-hero); inputs `12px`; knoppen, badges, tabs en stepper-bolletjes **volledig pill** (`9999px`).
- **Schaduw:** één zachte, diffuse schaduw voor verhoogde kaarten: `0 32px 99px rgba(0,0,0,0.08)`; een lichtere variant `0 8px 24px rgba(0,0,0,0.05)` voor kleine kaarten. Geen harde borders + schaduw tegelijk.
- **Witruimte:** fors meer lucht. Sectie-afstand 64–96px desktop, 40–56px mobiel. Kaart-padding 28–32px. Content max-breedte ~1200px.
- **Minder kaartjes-in-kaartjes:** waar een blok in een blok zit, haal de binnenste rand/achtergrond weg en werk met witruimte + typografie.

## Componenten

**App-shell**
- Sidebar: **licht** (`--color-surface` of `--color-surface-soft`), donkere tekst, actief item als pill met `--color-primary` achtergrond en witte tekst (of zachte tint + primaire tekst). Groepslabels in `--color-text-muted`, geen uppercase.
- Topbar: wit, 72–80px hoog, onderrand `--color-border` of zachte schaduw; ronde icoonknoppen (44px) met `#F1F4F6` achtergrond, primaire actie-icoon in `--color-primary` (zoals de mail-knop bij FC).
- Rechterpaneel (coach): `--color-surface-soft` achtergrond, kaarten erin wit met radius 20px; tip-blokken zonder rand.

**Knoppen**
- Primair: `--color-primary`, wit, weight 600, padding `12px 28px`, pill, hover `--color-primary-hover`; pijltje (→) rechts mag blijven.
- Secundair: wit met 1.5px rand `--color-primary`, tekst primair, pill.
- Tertiair/link: tekst `--color-primary`, weight 600, onderstreping bij hover.

**Hero / paginakop** (bijv. "Begrijp je markt.")
- Eyebrow + H1 + lead-tekst links, in een groot blok met `--color-surface-soft` → transparant gradient (links naar rechts) en radius 32px; CTA "Naar aannames" als primaire pill-knop eronder i.p.v. als blok rechtsboven.

**Stepper (Idee → Besluiten)**
- Pill-bolletjes 32px; voltooid = `--color-primary` met wit vinkje, actief = `--color-accent` ring + gevulde kern, toekomstig = `#F1F4F6` met muted cijfer. Verbindingslijn 2px `--color-border`.

**Beslisvraag-kaart**
- `--color-surface-soft` achtergrond, geen rand, radius 24px, eyebrow in accentkleur, vraag als H2. Status-badge als zachte pill.

**Tabs** (Marktbeeld / Concurrenten / …)
- Pill-segment-stijl: actieve tab `--color-primary` gevuld met witte tekst, overige tekst `--color-heading` zonder achtergrond, hover `#F1F4F6`.

**KPI-kaarten** (0/5, 00, open vraag)
- Wit, radius 24px, lichte schaduw, geen rand. Cijfer groot (40px, kopfont, `--color-heading`), label erboven in muted 14px.

**Lijsten / onderzoeksvragen / tegenargumenten**
- Stijl als de FC-accordion: één witte container met radius 24px en zware zachte schaduw, items gescheiden door 1px `--color-border`, 24px verticale padding, chevron/actie rechts in een rond knopje.
- "Advocaat van de duivel"-punten: klein rond icoon in zachte risico-tint i.p.v. rode uitroeptekens.

**Lege staten**
- Gecentreerd, eyebrow + korte kop + één primaire knop, op `--color-surface-soft` vlak met radius 24px.

**Formulieren**
- Inputs 48px hoog, radius 12px, rand `--color-border`, focus: 2px ring `--color-accent` op 30% opacity.

## Interactie & beweging
- Transities 200ms ease-out op hover (knoppen kleur, kaarten `translateY(-2px)` + iets sterkere schaduw).
- Ronde "terug naar boven"-knop (56px, `--color-accent`) rechtsonder op lange pagina's.
- Respecteer `prefers-reduced-motion`.

## Toegankelijkheid & responsive
- Contrast minimaal WCAG AA (controleer accentblauw op wit alleen voor tekst ≥ 16px/600; anders `--color-primary`).
- Zichtbare focus-states op alles wat klikbaar is.
- Mobiel (≤ 768px): sidebar wordt drawer, rechterpaneel schuift onder de content of wordt een bottom-sheet, kaarten één kolom, 16px zijmarge, geen horizontale scroll.

## Opleveren
1. Korte samenvatting van wat er veranderd is, per component.
2. Voor/na-screenshots (desktop + mobiel) van de twee genoemde pagina's.
3. Lijst van plekken waar nog hardcoded kleuren/stijlen stonden die je niet kon tokeniseren.
4. Geen functionele regressies: draai lint, typecheck en bestaande tests.
