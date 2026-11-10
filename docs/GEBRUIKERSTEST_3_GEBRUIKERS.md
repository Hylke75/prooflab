# Gebruikerstest met drie mensen — testkit

Doel: nagaan of de nieuwe opbouw van ProofLab ("Wat nu?", één taak per scherm, het blok *Wat jij doet / Wat AI kan*)
de drie klachten oplost waarmee het voorstel "ProofLab eenvoudiger" begon:

1. Weet je wat je moet doen?
2. Weet je wat je waar moet invullen?
3. Weet je wat jij doet en wat AI doet?

Drie mensen vinden de meeste grote problemen in een gebruiksonderzoek (Nielsen Norman Group: de eerste gebruikers laten
de meeste problemen zien; daarna herhaalt het zich). Het gaat om waar mensen vastlopen, niet om een cijfer.

---

## 1. Wie

| # | Profiel | Waarom |
|---|---|---|
| 1 | Consultant of adviseur die ProofLab nog nooit heeft gezien | De hoofdgebruiker |
| 2 | Ondernemer of productmanager met een eigen idee | Iemand zonder onderzoeksachtergrond |
| 3 | Iemand die als opdrachtgever meekijkt (beslisser) | Leest rapport en bevestigt besluiten |

Liever geen directe collega's van het ProofLab-team: die weten te veel.

## 2. Voorbereiding (Hylke)

- [ ] **Toegang**: ProofLab werkt op uitnodiging.
      - Deelnemer 1 en 2 maken zelf een werkruimte en een idee aan. Hun e-mailadres moet op de toegangslijst
        (`signup_allowlist`); daar is geen scherm voor. Geef de twee adressen aan Claude, dan zet Claude ze erop.
      - Deelnemer 3 (opdrachtgever) nodig je uit bij **Klanten** → bij het testdossier → **Uitnodigen**.
- [ ] **Testdossier voor taak 7** (besluit): maak vooraf in je eigen werkruimte één dossier met de naam
      **"TESTDOSSIER gebruikerstest"**. Geef het een afgeronde test met echte, handmatig ingevoerde resultaten (bijv. vijf
      gesprekken via een handmatige methode uit de catalogus), zodat er een leerkaart klaarstaat. Gebruik geen verzonnen
      klantdata in een echt klantdossier.
- [ ] **Opname**: scherm en stem opnemen (bijv. Teams of Zoom). Vraag vooraf toestemming (zie §6).
- [ ] **Apparaat**: deelnemer 1 en 2 op een laptop, deelnemer 3 op een telefoon (het rapport en de bevestiging worden
      vaak mobiel gelezen).
- [ ] Print §5 (observatieformulier) of open het in een tweede venster.

Duur: 45–60 minuten per persoon. Rollen: één gespreksleider; liefst één notulist.

## 3. Script voor de gespreksleider

**Begin (5 min)**

> "Dank je wel. We testen vandaag ProofLab, niet jou: als iets onduidelijk is, ligt dat aan de app. Denk hardop: zeg wat
> je zoekt, wat je verwacht en wat je verbaast. Ik help zo weinig mogelijk; als je echt vastzit, zeg je dat en gaan we
> door. Mag ik het scherm en het gesprek opnemen? De opname gebruiken we alleen om ProofLab te verbeteren en verwijderen
> we na de analyse."

Zeg tijdens de taken zo min mogelijk. Vraag bij stilte: *"Wat zoek je nu?"* Geef nooit de oplossing, behalve als iemand
langer dan 3 minuten vastzit (noteer dat als **hulp nodig**).

**Scenario** (voorlezen):

> "Je hebt een idee: een abonnement voor kleine fysiotherapiepraktijken dat afspraken automatisch herinnert en no-shows
> opvolgt, voor € 49 per maand. Je wilt binnen twee maanden besluiten of je er € 20.000 in steekt."

## 4. Taken

Lees elke taak voor, laat de deelnemer de taak in eigen woorden herhalen, en start dan de tijd.

| # | Taak (voorlezen) | Gelukt als | Vraagt naar klacht |
|---|---|---|---|
| T1 | "Leg dit idee vast in ProofLab." | Idee aangemaakt, de deelnemer komt op Markt of Wat nu? | 1, 2 |
| T2 | "Vertel me: waar sta je nu, en wat is je volgende stap?" | Noemt de fase en de volgende taak van **Wat nu?** zonder te zoeken | 1 |
| T3 | "Leg één bron vast die iets zegt over het aantal fysiotherapiepraktijken, en maak er een bevinding van." (Geef een URL of tekst als ze die zoeken.) | Bron en bevinding opgeslagen | 2 |
| T4 | "Schrijf op wat waar moet zijn voordat dit idee kan slagen, en kies de belangrijkste." | Minstens één aanname, één gekozen | 1, 2 |
| T5 | "Zet een test op voor die belangrijkste aanname, tot en met opslaan." | Testkaart opgeslagen als concept | 1, 2 |
| T6 | "Waar zie je wat ProofLab of AI voor je kan doen, en wat je zelf moet doen?" | Wijst het blok *Wat jij doet / Wat AI kan* aan en kan één voorbeeld noemen | 3 |
| T7 | (Open het TESTDOSSIER.) "De test is klaar. Neem een besluit over dit idee." | Leerkaart goedgekeurd → realiteitscheck → besluit opgeslagen | 1, 2 |
| T8 | "Je ziet het woord *leerkaart*. Wat betekent dat? Zoek het op als je het niet weet." | Vindt de uitleg (tooltip of Hulp en methode) | 2 |
| T9 *(alleen deelnemer 3, telefoon)* | "Je bent opdrachtgever. Lees wat het team besloot en waarom." | Vindt besluit, onderbouwing en wat er tegen spreekt in het rapport | 1 |

Na **elke** taak één vraag (Single Ease Question):

> "Hoe makkelijk of moeilijk was deze taak? 1 = heel moeilijk, 7 = heel makkelijk."

**Afsluiting (10 min)**

1. "Wat was het lastigst?"
2. "Was het duidelijk wat jij moest doen en wat ProofLab of AI deed? Waar niet?"
3. "Welk woord of scherm snapte je niet?"
4. "Zou je dit gebruiken voor een echt besluit? Waarom wel of niet?"

## 5. Observatieformulier (per deelnemer)

Deelnemer: ____ · Profiel: ____ · Apparaat: ____ · Datum: ____

| Taak | Gelukt (ja / met hulp / nee) | Tijd (min) | SEQ (1–7) | Waar liep hij/zij vast? (scherm + wat) | Letterlijke uitspraak |
|---|---|---|---|---|---|
| T1 | | | | | |
| T2 | | | | | |
| T3 | | | | | |
| T4 | | | | | |
| T5 | | | | | |
| T6 | | | | | |
| T7 | | | | | |
| T8 | | | | | |
| T9 | | | | | |

Onbekende woorden die genoemd werden: ______________________

## 6. Toestemming (voorlezen of laten tekenen)

> "Ik doe vrijwillig mee aan een gebruikerstest van ProofLab. Mijn scherm en stem worden opgenomen. De opname en
> aantekeningen worden alleen gebruikt om ProofLab te verbeteren, niet gedeeld buiten het team en uiterlijk 30 dagen na
> de analyse verwijderd. Ik kan op elk moment stoppen."

Gebruik in de test geen echte klantgegevens of persoonsgegevens van anderen.

## 7. Analyse

1. Zet per taak de drie uitkomsten naast elkaar (gelukt, hulp, SEQ).
2. Maak per probleem één regel: **scherm · wat ging mis · hoeveel van de 3 · ernst**.
   Ernst (Nielsen): 1 = cosmetisch, 2 = klein, 3 = groot (vertraagt of verwart), 4 = blokkerend (taak lukt niet).
3. Los eerst op: alles met ernst 3–4, en alles wat 2 of 3 deelnemers overkwam.
4. Vergelijk met het startpunt: lukt T2 en T6 zonder hulp, dan zijn klacht 1 en 3 opgelost.

**Succesmaat voor deze ronde**

- T2, T5 en T7 lukken bij minstens 2 van de 3 zonder hulp.
- Gemiddelde SEQ ≥ 5 op T2, T5 en T7.
- Bij T6 kan iedereen zonder hulp het blok *Wat jij doet / Wat AI kan* aanwijzen.

Stuur de ingevulde formulieren (of de aantekeningen) naar Claude: dan maak ik de analyse en een voorstel voor de
volgende verbeteringen, en bouw ik ze daarna.
