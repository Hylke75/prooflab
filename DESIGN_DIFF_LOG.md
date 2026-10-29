# Design diff log

Afwijkingen van `design/REFERENCE_MOCKUPS.html`, elk met een UX-, toegankelijkheids- of technische reden
(CLAUDE.md §1). De CSS van de mock-up is letterlijk overgenomen in `app/globals.css`; aanvullingen staan in een apart
blok in dezelfde visuele taal.

| # | Onderdeel | Mock-up | Implementatie | Reden |
|---|---|---|---|---|
| 1 | Grijze tekstkleuren | `--muted #747d8e` en lichtere grijzen (#7b8492 … #9aa1ab) | `--muted #646d7e`, kleine grijze tekst `#5f6879` | WCAG 2.2 AA: de originele tinten halen 2,4–3,9:1 op crème; nieuw ≥ 4,7:1 |
| 2 | Koraal-pill | tekst `#b35a46` | `#9c4533` | Contrast op `#ffebe5` naar ≥ 4,5:1 |
| 3 | Lettertypen | Google Fonts via CDN | `next/font` (zelf gehost) | AVG: geen IP-adres naar Google per bezoek; identieke fonts en gewichten |
| 4 | Intake | 4 vragen, start bij het idee | 5 vragen, start bij **de beslissing**; daarna idee, doelgroep, regio, projecttype | Besluit na review (analyse §12): elk onderzoek krijgt een doel en stopcriterium |
| 5 | Stappenbalk | "Stap x van 9" | "Stap x van 5" (Idee · Markt · Aannames · Testen · Besluiten) | Eenvoudiger route; de 9 stappen blijven het datamodel |
| 6 | Risicokaart | Assen *effect × onzekerheid* (geschat) | *belangrijk × bewijs*; bewijsas berekend uit gekoppelde bevindingen en waargenomen gedrag | Methode van *Testing Business Ideas*; besluit §11.5 |
| 7 | Prioriteitsnummers | Brede grijze balk met nummer | Compacte badge (bestaande `.count`) | De brede balk oogde als layoutfout |
| 8 | Besluitopties | 4 opties zonder *Stoppen* en *Doorgaan* | Doorgaan · Bijsturen · Verder testen · Pauzeren · Stoppen; advies van de Reality Check gemarkeerd | Stoppen is een volwaardige uitkomst (methode, review #15) |
| 9 | Marktbeeld-grafiek | Illustratieve staafgrafiek | Weggelaten; marktdynamiek staat als bevindingen met bron | Geen grafiek zonder echte, gedateerde reeks (CLAUDE.md: geen nepresultaten) |
| 10 | Test Card | 4 velden | Volledige kaart: geloof, doelgroep, methode, teller/noemer, succes- en faaldrempel, steekproef, looptijd, vertekeningen, kanalen, bereik, kosten | Vooraf geregistreerde beslisregel; anders is "onbeslist" niet vast te stellen |
| 11 | Live experiment | Conversie als kaal percentage | Aantallen + 95%-interval + drempels in één meter; oordeel pas na eindconditie | Geen schijnprecisie bij kleine aantallen (review #11) |
| 12 | Bovenbalk | "Interactieve mock-up"-label | Contextlabel alleen waar relevant (bijv. "Snelle marktcheck · voorlopig") en uitloggen via avatar | Productie heeft geen demolabel nodig; wel status van voorlopige resultaten |
| 13 | Zijbalk | Vaste lijst schermen | Werkruimte (Overzicht, Klanten) + per open idee de vijf stappen | Meerdere ideeën en klanten; zelfde stijl en gedrag |
| 14 | Coach | Vaste tips per scherm | Zelfde paneel en layout; inhoud berekend uit de stand van het dossier; vraagveld werkt alleen met AI-koppeling | Review #5: reageren op het project, niet op vaste tips |
| 15 | Loginpagina (mobiel) | n.v.t. | Koraalcirkel kleiner en transparanter | Witte kop over koraal haalde geen AA-contrast |
| 16 | Nieuwe schermen | — | Inloggen, klanten, help, experimentdetail, publieke testpagina, Learning Cards, rapportversies | Nodig voor een werkende route; opgebouwd uit bestaande componenten |
| 17 | Smalle schermen (≤ 560 px) | Kruimelpad volledig, pills op één regel, tabellen op volle breedte | Alleen de laatste kruimel (afgekapt met …), pills mogen afbreken, tabellen scrollen binnen hun kaart, grids met `minmax(0,1fr)` | Op 320–390 px schoof de pagina horizontaal (12–152 px); nu nergens overloop, gemeten op alle ingelogde schermen |
| 18 | Sprintplanning | Geen sprint- of trajectcontext | Smalle sprintbalk boven elk ideescherm ("Week 2 van 5", fase, weekblokjes, "loopt achter", beslisdatum) en sprintkaarten op het overzicht met de mijlpalen uit §9c | Consultancytraject van 4–6 weken (analyse §9c, §11.2 "Klant · Idee · Sprintweek"); opgebouwd uit bestaande kaart-, pill- en voortgangsstijlen |
| 19 | KPI's overzicht | Aantallen (ideeën, risico's, experimenten) | Kritieke aannames met sterk bewijs (x van y), lopende tests met "dag X van Y", besluiten die wachten op bevestiging | Bewijsmetrics in plaats van activiteitsmetrics (analyse §11.2); zelfde kaartopmaak |
| 20 | Overzicht voor opdrachtgevers | n.v.t. (mock-up kent alleen de consultant) | Zelfde hero zonder CTA, een opvallende "Actie nodig: bevestig het besluit"-kaart, dossierkaarten met sprintweek, laatst gedeeld rapport en besluitstatus | Rol `client_decider` (analyse §11.5): meekijken en besluit bevestigen, geen consultantacties |
| 21 | Avatar | Rond blokje, klik logt uit (eerdere implementatie) | Klik opent een klein menu met naam/e-mail, Werkruimte, Uitleg en Uitloggen; Escape sluit | Uitloggen per ongeluk voorkomen; naam en account zichtbaar |
| 22 | Uitlegknop mobiel | Bovenbalkknoppen verborgen ≤ 560 px | Uitlegknop (i) blijft zichtbaar | Hulp moet op elk scherm bereikbaar zijn |
| 23 | Zijbalk mobiel | Drawer zonder sluitknop (sluit via overlay) | Kleine sluitknop rechtsboven in de drawer | Toetsenbord- en schermlezergebruikers hebben een zichtbare sluitactie nodig (WCAG 2.1.2/2.4.3) |
| 24 | Drawers en coach | Overlay en `transform` | Zelfde animatie; daarnaast focus naar binnen, Tab blijft in het paneel, Escape sluit, focus terug naar de knop, achtergrond en gesloten panelen `inert` (gesloten panelen ook `visibility:hidden` na de animatie) | Verborgen panelen waren met Tab bereikbaar; WCAG 2.4.3/2.4.11 |
| 25 | Aanraakdoelen | `.round-btn` 37 px, `.top-avatar` 35 px, tekstlinks, risicopunten 39 px | Getekende maat ongewijzigd; onzichtbaar klikvlak van minimaal 44 × 44 px; checkboxlabels minimaal 44 px hoog | WCAG 2.5.8 en CLAUDE.md §3 (touch targets ≥ 44 px) zonder de compositie te veranderen |
| 26 | Focus en skiplink | Focusring alleen op knoppen en velden | Zelfde ring ook op links, selects en samenvattingen; skiplink "Naar de inhoud" verschijnt bij Tab | WCAG 2.4.1 en 2.4.7 |
| 27 | Koppen | Kaarttitels als `h3` direct onder de `h1` | Kaarttitels direct onder de paginatitel zijn `h2` met dezelfde grootte (19 px, klasse `as-h3`); rapporttitel in het papier `h2` op 41 px | Geen sprongen in de kopstructuur (WCAG 1.3.1); visueel identiek |
| 28 | Risicokaart (plaatsing) | Punten op vaste posities, aslabels binnen het kader | Punten met dezelfde positie spreiden deterministisch (2–4) of worden één clusterbadge met lijst (≥ 5); punten blijven binnen het kader; de horizontale as-labels ("← Veel bewijs · Weinig bewijs →") staan onder het kader en houden ≤ 1160 px ruimte vrij voor de coachknop | Overlappende punten waren onklikbaar; labels vielen op 390 px weg of onder de zwevende knop |
| 29 | Coach zonder AI | Vraagveld altijd zichtbaar | Zonder AI-koppeling alleen één regel uitleg; bij opdrachtgevers uitleg in plaats van taken ("Lees verder") | Geen dode bediening (CLAUDE.md §7 fase 3) |
| 30 | Rapport | Eén document | Versielijst boven het papier met status (gedeeld, bekeken door opdrachtgever, besluit bevestigd), "Deel versie X met opdrachtgever" en JSON-export per versie | Opdrachtgevers zien alleen gedeelde, onveranderlijke versies; auditspoor per versie |
| 31 | Klanten | Geen | Per meekijker de status "Uitgenodigd, nog niet ingelogd" of "Actief", "Stuur inloglink opnieuw" en een vaste notitie over de e-mailserver | Uitnodigingen komen anders stil niet aan bij externe adressen (Supabase-standaard-SMTP) |
| 32 | Begrippen | Geen uitleg | Korte uitleg bij eerste gebruik van Test Card, 95%-interval, Learning Card en Reality Check, en een begrippenlijst op de helppagina | Consultancyklanten kennen de methodebegrippen niet |
| 33 | Ideekaart | "Verder →" kon afbreken | "Verder →" breekt niet meer af | Leesbaarheid op smalle kaarten |
