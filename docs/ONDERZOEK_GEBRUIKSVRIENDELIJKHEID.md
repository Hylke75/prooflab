# Onderzoek: wat ProofLab leert van zeer gebruiksvriendelijke software (10 november)

Desk research naar TurboTax, Belastingdienst (vooraf ingevulde aangifte), Typeform, GOV.UK Design System, Stripe,
Linear, Notion/Canva, Duolingo, Monzo/Revolut/bunq, Calendly, Superhuman/Airtable, plus onderzoek van Nielsen Norman
Group, Baymard, Microsoft (Guidelines for Human-AI Interaction) en Google PAIR. Gecombineerd met een nieuwe meting van
alle schermen (1440 en 390 px). Bronnen staan onderaan; wat alleen uit analyses van derden komt, staat erbij.

## Wat we meten (10 november, na ronde 1–3)

| Scherm | Zichtbare velden | Primaire knoppen | Lengte desktop / mobiel (schermen) |
|---|---|---|---|
| Overzicht (dashboard) | 0 | 1 | 5,0 / 11,6 |
| Markt › Bronnen | 33 (10 verplicht) | 4 | 4,8 / 8,5 |
| Markt › Marktpotentieel | 37 | 4 | 5,3 / 9,6 |
| Wat nu? | 0 | 1 | 1,9 / 2,4 |
| Testkaart (nieuw) | 1 per stap | 1 | 1,9 / 3,4 |
| Besluit | 3 | 2 | 3,5 / 4,6 |

Verder: op Markt drie rijen navigatie boven elkaar (stap-tabbladen, taakstappen, onderzoekstabbladen) en dubbele koppen;
de ideekaarten op het overzicht spraken nog de oude taal ("Week 1/5", "Markt · verkenning", "0 van 4 stappen met bewijs")
naast de nieuwe takenlijst.

## Principes en wat we ermee doen

| # | Principe (bron) | In ProofLab | Stand |
|---|---|---|---|
| 1 | Eén bron van voortgang, zichtbaar en met een duidelijke volgende stap (Stripe-checklist, Nunes & Drèze) | Ideekaarten op het overzicht tonen "Fase x van 5", een balk van de vijf fasen en "Volgende taak: …" met één knop; "Volgende taken" leest dezelfde takenlijst | ✅ ronde 4 |
| 2 | Kleine taken met een tijdsindicatie (Duolingo, TurboTax "what's coming up") | Elke taak heeft een geschatte tijd ("± 10 min"), in de taakkop en op Wat nu? | ✅ ronde 4 |
| 3 | Antwoorden controleren vóór opslaan (GOV.UK check answers) | Laatste stap van de testkaart: "Controleer je antwoorden" met "Wijzigen" per regel; leeg = "Nog niet ingevuld" | ✅ ronde 4 |
| 4 | Eén vraag of taak tegelijk, volgorde vast (GOV.UK, Typeform) | Bronnen: eerst "Stap 1 · Bron toevoegen", dan "Stap 2 · Leg een bevinding vast", in één kolom; rapport importeren ingeklapt | ✅ ronde 4 |
| 5 | Progressive disclosure (NN/g) | Marktpotentieel: bandbreedte, jaar en regio per factor ingeklapt ("Meer over deze factor") | ✅ ronde 4 |
| 6 | Minder chrome, inhoud bovenaan (NN/g) | Markt zonder dubbele rij taakstappen (de tabbladen zijn de taken), geen dubbele koppen, compacter rolblok | ✅ ronde 4 |
| 7 | Vooraf invullen, de gebruiker controleert (Belastingdienst, NN/g defaults) | Testkaart wordt al voorgevuld uit intake en catalogus; volgende stap: AI-voorstel per veld met Overnemen / Aanpassen / Weggooien | ⬜ voorstel |
| 8 | AI-uitvoer per stuk accepteren of afwijzen (Microsoft G8/G9) | Overnemen / Aanpassen / Weggooien bij het leerkaart-voorstel, voorgestelde aannames (AI of standaardset, plus "Alles overnemen"), AI-varianten van de testpaginatekst en voorgestelde alternatieven (Weggooien) | ✅ ronde 5–6 |
| 9 | Herkomst per bewering (NN/g explainable AI, Microsoft G11) | Labels AI-voorstel / Berekend voorstel / Door jou bevestigd / Gemeten bewijs bestaan; overal toepassen in onderzoek en rapport | 🟡 deels |
| 10 | Automatisch opslaan, ongedaan maken in plaats van bevestigen (NN/g) | Concept op dit apparaat voor bron, bevinding, aanname en de hele testkaart (teruggezet na herladen, "Opnieuw beginnen") ("Concept bewaard op dit apparaat (12:04)", wissen kan); verwijderen van bron, bevinding, aanname en aanbieder met 6 s "Ongedaan maken"; bevestigen blijft bij delen en publiceren | ✅ ronde 5 |
| 11 | Hulp in de context ("Waarom vragen we dit?") boven rondleidingen (NN/g, TurboTax) | "Waarom vragen we dit?" (uitklapbaar, ook op telefoon) bij bronfragment, soort bron, citaat, populatie, hypothese, doelgroep, slaaggrens, deadline, aanname, belang en de onderbouwing van het besluit; `Field` heeft een `why`-veld | ✅ ronde 5 |
| 12 | Startpagina per taak: wat, hoe lang, wat heb je nodig (GOV.UK start page) | Taakkop met waarom, tijd en Wat jij doet / Wat AI kan | ✅ |
| 13 | Gewone taal en vaste schrijfgids (Monzo) | Vaktermen vervangen (ronde 3); schrijfgids in DESIGN_DIFF_LOG #79 | ✅ |
| 14 | Foutmeldingen met oorzaak, oplossing en vervolgstap (Stripe, GOV.UK error summary) | Elk formulier (ActionForm) toont bij fouten "Er is een probleem" met links naar de velden en zet de focus daarop | ✅ ronde 5 |
| 15 | Sneltoetsen en commandomenu voor ervaren gebruikers (Linear) | Commandomenu met Ctrl+K / ⌘K of de knop "Snel naar…": elke pagina, taak en idee op naam (ook op oude vaktermen), plus "Zoek in dit dossier" ("/") | ✅ ronde 7 |

## Bronnen

- GOV.UK: https://design-system.service.gov.uk/patterns/start-using-a-service/ · https://design-system.service.gov.uk/patterns/question-pages · https://design-system.service.gov.uk/patterns/check-answers/ · https://design-system.service.gov.uk/components/error-summary/
- Stripe: https://docs.stripe.com/get-started/checklist/account · https://docs.stripe.com/stripe-apps/patterns/onboarding-experience · https://docs.stripe.com/api/errors
- Belastingdienst: https://www.belastingdienst.nl/wps/wcm/connect/nl/belastingaangifte/content/vooraf-ingevulde-gegevens-kloppen-niet
- Monzo: https://monzo.com/tone-of-voice/
- Calendly: https://help.calendly.com/hc/en-us/articles/223193508
- Linear: https://www.figma.com/blog/the-linear-method-opinionated-software/
- Notion: https://www.notion.com/help/guides/the-ultimate-guide-to-notion-templates
- Superhuman: https://blog.superhuman.com/the-fastest-way-to-inbox-zero-a-single-coaching-session/
- NN/g: https://www.nngroup.com/articles/empty-state-interface-design/ · https://www.nngroup.com/articles/onboarding-tutorials/ · https://www.nngroup.com/articles/the-power-of-defaults/ · https://www.nngroup.com/articles/4-principles-reduce-cognitive-load/ · https://www.nngroup.com/articles/confirmation-dialog/ · https://www.nngroup.com/articles/explainable-ai/
- Baymard: https://baymard.com/blog/inline-form-validation
- Microsoft HAX: https://www.microsoft.com/en-us/haxtoolkit/ai-guidelines/ · Google PAIR: https://pair.withgoogle.com/chapter/explainability-trust/
- Nunes & Drèze (2006), voortgangseffect: https://www.eurekalert.org/news-releases/904084
- Alleen analyses van derden (niet zelf geverifieerd): TurboTax (appcues.com, fastcompany.com), Canva en Airtable (supademo.com), Duolingo (mobbin.com), Revolut (craftinnovations.global), Typeform-cijfers (help.typeform.com, eigen opgave).
