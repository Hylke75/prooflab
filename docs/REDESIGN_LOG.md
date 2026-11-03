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
