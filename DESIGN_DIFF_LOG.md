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
