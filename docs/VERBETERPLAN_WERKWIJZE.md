# Verbeterplan werkwijze (3 november 2026)

Dit plan volgt op de kritische controle van de hele werkwijze, van intake tot uitkomst. De product owner gaf akkoord om alles op te pakken "volgens jouw voorkeuren". Hieronder staan per punt de keuze en de golf waarin het wordt gebouwd. Elke golf start pas als prioriteit 1–7 is samengevoegd, omdat de golven dezelfde bestanden raken.

Punt 9 (de onderzoeksstap kan op 0 bronnen uitkomen) zit al in prioriteit 1–3.

## Golf A – Bewijs en testen (bouwt voort op methode 2026-11-b)

| # | Zwakte | Keuze |
|---|---|---|
| 3 | Leren duurt jaren; kansen ogen te precies | Zolang er geen eigen kalibratie is, kansen tonen in banden van 10 procentpunt met het label "niet gekalibreerd" (scherm en rapport). De exacte waarde staat in een tooltip. |
| 4 | Bewijs wordt als onafhankelijk behandeld | Per signaal de wervingsgroep vastleggen (eigen netwerk, warm contact, koud, betaald panel, onbekend). Herhaling binnen dezelfde groep over verschillende bronnen heen krijgt een afnemende factor (zelfde functie als `diminishing`). |
| 5 | De startkans van een aanname is willekeurig | Een afwijking van 50% vraagt een korte onderbouwing. De startkans wordt vergrendeld zodra er bewijs aan de aanname hangt; wijzigen daarna kan alleen met een reden, en dat wordt geaudit. |
| 11 | Kleine steekproeven, meerdere tests | Per aanname één hoofdtest aanwijzen; de rest heet "verkennend" en telt in de beslisregel voor het besluit niet mee als doorslag. Bij een geslaagde kansregel staat de kans op toeval (1 − P) erbij. |
| 12 | Je kunt kiezen welke test telt | Het rapport bevat een verplichte lijst "Alle tests", met afgebroken, mislukte en verkennende tests en het aantal tests per aanname. |
| 13 | Werving is scheef | De wervingsbron is verplicht bij enquêtes, landing- en prijstests (net als "bekende" bij interviews) en weegt mee volgens punt 4. |
| 14 | Zwakke metingen kunnen als "geslaagd" tellen | De Learning Card en het rapport tonen het bewijsniveau naast de uitkomst, bijvoorbeeld "Geslaagd · niveau: mening". |
| 16 | Brier-scores bij weinig dossiers | Onder 30 uitkomsten tonen de scores de waarschuwing "te weinig dossiers voor een betrouwbaar oordeel". |
| 17 | AI-codering telt te makkelijk mee | Onbeoordeelde AI-codering telt niet meer mee, alleen na beoordeling door een consultant. Bij AI-concepten (vragen, enquête, berichten) wordt zichtbaar wat de mens heeft aangepast. Bestaande dossiers houden hun rekenwijze (methodeversie). |

## Golf B – Besluit en voorspelling

| # | Zwakte | Keuze |
|---|---|---|
| 1 | Uitkomst na een stop-besluit is niet meetbaar | Na stop of pauze vervalt de oorspronkelijke uitkomstvraag. In plaats daarvan komt na 6 maanden de vraag "Was stoppen achteraf terecht?" (ja / nee / onbekend, met bewijs). Deze dossiers tellen niet mee in de kalibratie van slagingskansen en de eigen basisrate; ze krijgen een eigen telling "terechte stops". |
| 2 | De uitkomst meet uitvoering | Bij de uitkomst wordt ook de inzet vastgelegd (gestart ja/nee, uren, budget t.o.v. plan). Dossiers met onvoldoende uitvoering worden apart gemarkeerd en kunnen uit de kalibratie worden gehaald, met reden. |
| 6 | Geen brug van bewijs naar besluit | Bij de intake of uiterlijk vóór de eerste test wordt een beslisregel vastgelegd: welke aannames boven welke kans moeten uitkomen en welke hoofdtest moet slagen. Die wordt vergrendeld bij de eerste goedgekeurde test. Bij het besluit toont het systeem of de regel is gehaald. Wie afwijkt, moet dat motiveren (audit) en het rapport vermeldt het. |
| 15 | Voorspellingen zijn niet onafhankelijk | Op elk voorspelmoment geeft men eerst de eigen voorspelling, vóórdat berekende kansen of andermans voorspellingen zichtbaar zijn. Daarna wordt de bewijspagina getoond. De AI-voorspellingen gelden als één stem (gemiddelde) en tellen niet als onafhankelijke beoordelaars. |
| 18 | De opdrachtgever controleert weinig | Bij het bevestigen van een besluit ziet de opdrachtgever verplicht de samenvatting "Wat ging tegen": mislukte tests, tegenbewijs, begrensde aannames en afwijkingen van de beslisregel. Pas daarna kan bevestigen. |
| 20 | De sprint is te strak voor gedragsbewijs | Er komt een optionele "verlengde testfase" (2–8 weken) na de sprint, met een tussenbesluit "doorgaan met testen". Het definitieve besluit en de uitkomstklok starten pas daarna. |

## Golf C – Onderzoek en herleidbaarheid

| # | Zwakte | Keuze |
|---|---|---|
| 7 | Een letterlijk citaat zegt nog niet dat het relevant is | Bij elke bevinding de velden populatie, regio en peildatum (verplicht, of "onbekend"). Wijkt dat af van de intake, dan volgt een waarschuwing en telt de bevinding als "indirect". |
| 8 | Marktomvang combineert getallen die niet bij elkaar passen | Bij de sizing-factoren staan jaar en regio. Wijken die tussen factoren af (meer dan 2 jaar verschil of een andere regio), dan volgt een waarschuwing en een bredere onzekerheidsband. |
| 10 | Zoekinstructies zoeken bevestiging | Per onderzoeksvraag een verplichte, aparte zoekopdracht naar tegenbewijs. Die wordt apart gelogd en de resultaten worden apart getoond. |
| 19 | Bewaartermijnen gaan in tegen herleidbaarheid | Elk rapport bewaart een geanonimiseerde momentopname van alle aantallen (n, successen, verdeling per bron en kanaal) die niet onder de bewaartermijn valt. De methode vermeldt dat herleiding na de termijn alleen op aantallen mogelijk is. |

## Volgorde

1. Prioriteit 1–7 afronden, samenvoegen, testen en de migraties live zetten.
2. Golf A, B en C parallel, elk in een eigen worktree en met eigen migraties.
3. Samenvoegen, volledige tests (unit, database, e2e), migraties live, pull request.
