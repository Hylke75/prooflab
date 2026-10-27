# ProofLab — volledig handoffpakket voor Claude Code

Dit pakket bevat alles wat Claude Code nodig heeft om het visuele ontwerp van de interactieve mock-ups zo nauwkeurig mogelijk over te nemen en daarna de functionele applicatie te bouwen.

## Wat zit in het pakket?

1. **CLAUDE.md** — direct te gebruiken projectinstructies voor Claude Code, inclusief exacte designcontracten en visuele acceptatiecriteria.
2. **design/REFERENCE_MOCKUPS.html** — de volledige werkende bron van de mock-ups: zeven hoofdschermen, HTML, alle CSS, kleuren, typografie, responsive regels, logo, SVG-iconen en demo-interacties.
3. **docs/FUNCTIONEEL_ONTWERP.md** — volledig functioneel en technisch ontwerp met AI-onderzoeksprocessen, marktonderzoek, bedrijfsmodel, experimenten, datamodel, privacy, API's en QA.

**Klikbare privépreview:** https://prooflab-interactieve-mockups.rosycomet4.chatgpt.site

## Zo gebruik je het met Claude Code

1. Pak het zip-bestand uit in de root van een **nieuwe projectmap** voor ProofLab. Gebruik je een bestaande repository, pak het dan daar uit zonder bestaande bestanden te overschrijven.
2. Controleer of CLAUDE.md in de projectroot staat. Claude Code kan deze instructies dan automatisch in de context opnemen.
3. Start Claude Code vanuit die projectmap.
4. Plak de onderstaande startopdracht.

### Kopieerbare startopdracht

> Ik wil ProofLab nu daadwerkelijk bouwen. Lees eerst CLAUDE.md, daarna docs/FUNCTIONEEL_ONTWERP.md en design/REFERENCE_MOCKUPS.html volledig. Die HTML is de bindende visuele bron: bouw het ontwerp met dezelfde kleuren, typografie, componenten, animaties, spacing, responsive regels en zeven hoofdschermen. Maak geen eigen redesign. Begin met een werkende, responsieve Next.js/React-reproductie en controleer die visueel tegen de mock-up. Implementeer daarna gefaseerd de echte functies: idee-intake, diepgaand brongebonden marktonderzoek, concurrentieanalyse, transparante TAM/SAM/SOM, aannames, hypotheses, experimenten, bewijs, besluiten en rapportages. Behandel de bestaande demo-data nooit als echte onderzoeksresultaten. Houd het systeem intuïtief, met één logische volgende stap. Gebruik echte testen, migraties, rollen en veiligheid. Houd IMPLEMENTATION_STATUS.md en DESIGN_DIFF_LOG.md bij. Begin met repositoryinspectie en fase 0.

## Designafspraak

De kleurwaardes en componentvormgeving uit de definitieve HTML-mock-ups **hebben voorrang** op een eventuele iets andere hex-kleur in het eerdere functionele ontwerp. Hierdoor kan Claude de interface werkelijk één-op-één reproduceren.

## Wat is al af en wat niet?

- **Af:** volledig visueel prototype met navigatie, mock-upinteracties, market-sizing calculator, experimentselectie en demo-rapport.
- **Nog niet af:** productiebackend, echte AI-onderzoeksengine, externe data, multi-user login, live experimenten en echte rapportgeneratie. Die moet Claude Code volgens het functioneel ontwerp bouwen.

De mock-ups zijn bewust uitsluitend gevuld met **fictieve of als placeholder gemarkeerde data**. Een klikbaar prototype mag nooit worden gepresenteerd als een daadwerkelijk uitgevoerd marktonderzoek.
