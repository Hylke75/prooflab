import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  applyPseudonyms,
  detectPii,
  labelSummary,
  nameVariants,
  proposePseudonyms,
  pseudonymizeText,
  recheckPseudonymized,
  resolveDecisions,
  type PseudonymDecision,
} from "@/lib/domain/pseudonymize";
import { parseVtt, type Segment } from "@/lib/domain/transcript-parse";

// Fase 1 · punt 3, deelstap 2: regelgebaseerd pseudonimiseren vóór opslag en vóór AI.
const seg = (speaker: string | null, text: string): Segment => ({ speaker, startMs: null, endMs: null, text });
const decide = (items: ReturnType<typeof proposePseudonyms>): PseudonymDecision[] => items.map(({ term, kind, label, enabled }) => ({ term, kind, label, enabled }));

const GESPREK = [
  seg("Sanne de Vries", "Goedemorgen Peter, fijn dat je tijd hebt. Ik ben Sanne."),
  seg("Peter Bakker", "Bij VV Oranje doen we alles via de app. Mijn mail is peter.bakker@vvoranje.nl en bel gerust op 06-12345678."),
  seg("Peter Bakker", "De contributie gaat naar NL91 ABNA 0417 1643 00, ons adres is 1234 AB. Kees van der Berg van Stichting Sportpark Noord regelt dat."),
  seg("Sanne de Vries", "En meneer Jansen van tennisclub De Kei? Werkt die ook met Bakkerij Smit BV?"),
];

describe("detectie", () => {
  it("vindt e-mail, telefoon, IBAN, postcode, clubs, organisaties en personen", () => {
    const found = detectPii(GESPREK.map((s) => s.text).join("\n"));
    const by = (k: string) => found.filter((f) => f.kind === k).map((f) => f.term);
    expect(by("email")).toEqual(["peter.bakker@vvoranje.nl"]);
    expect(by("phone")).toEqual(["06-12345678"]);
    expect(by("iban")).toEqual(["NL91 ABNA 0417 1643 00"]);
    expect(by("postcode")).toEqual(["1234 AB"]);
    expect(by("club")).toEqual(expect.arrayContaining(["VV Oranje", "tennisclub De Kei"]));
    expect(by("organisation")).toEqual(expect.arrayContaining(["Stichting Sportpark Noord", "Bakkerij Smit BV"]));
    expect(by("person")).toEqual(expect.arrayContaining(["Peter", "Sanne", "Kees van der Berg", "meneer Jansen"]));
  });

  it("geen namen midden in woorden, geen jaartallen als telefoon, geen gewone zinswoorden", () => {
    const found = detectPii("In januari belde Janssen. Ben je er in 2026? Wil je 1500 euro? Mark het aan.");
    expect(found.map((f) => f.term)).toEqual(["Mark"]);
  });

  it("varianten van een naam: voornaam, met tussenvoegsel en achternaam", () => {
    expect(nameVariants("Sanne de Vries")).toEqual(["Sanne de Vries", "Sanne", "de Vries", "Vries"]);
    expect(nameVariants("Peter Bakker")).toEqual(["Peter Bakker", "Peter", "Bakker"]);
    expect(nameVariants("Bo")).toEqual(["Bo"]);
  });
});

describe("voorstel", () => {
  it("sprekers krijgen Spreker A/B; hun voornaam in de tekst hetzelfde label; e-mail, telefoon en IBAN zijn vergrendeld", () => {
    const items = proposePseudonyms(GESPREK);
    const label = (t: string) => items.find((i) => i.term === t)?.label;
    expect(label("Sanne de Vries")).toBe("Spreker A");
    expect(label("Sanne")).toBe("Spreker A");
    expect(label("Peter Bakker")).toBe("Spreker B");
    expect(label("Peter")).toBe("Spreker B");
    expect(label("VV Oranje")).toBe("Club 1");
    expect(label("meneer Jansen")).toBe("Persoon 1");
    expect(label("Kees van der Berg")).toBe("Persoon 2");
    expect(label("Kees")).toBe("Persoon 2");
    expect(items.find((i) => i.kind === "email")?.locked).toBe(true);
    expect(items.find((i) => i.kind === "postcode")?.locked).toBe(false);
    expect(items.find((i) => i.term === "Peter Bakker")?.count).toBe(2); // twee keer als spreker
  });

  it("rolnamen als spreker (Interviewer) worden niet vervangen", () => {
    const items = proposePseudonyms([seg("Interviewer", "Hoe gaat het?"), seg("Penningmeester", "Prima, dank je.")]);
    expect(items.filter((i) => i.kind === "speaker")).toEqual([]);
  });

  it("extra namen die de consultant markeert, worden personen", () => {
    const items = proposePseudonyms([seg(null, "Gisteren sprak ik Ozan Yilmaz, en Yilmaz vond het prima.")], ["Ozan Yilmaz"]);
    expect(items.filter((i) => i.label === "Persoon 1").map((i) => i.term)).toEqual(expect.arrayContaining(["Ozan Yilmaz", "Yilmaz"]));
  });
});

describe("toepassen", () => {
  it("vervangt overal, langste term eerst; de originele namen staan nergens meer", () => {
    const decisions = decide(proposePseudonyms(GESPREK));
    const after = applyPseudonyms(GESPREK, decisions);
    const all = after.map((s) => `${s.speaker}: ${s.text}`).join("\n");
    for (const name of ["Sanne", "Peter", "Bakker", "Vries", "Oranje", "peter.bakker", "06-12345678", "NL91", "1234 AB", "Kees", "Jansen", "De Kei", "Sportpark", "Smit"]) expect(all).not.toContain(name);
    expect(after[0].speaker).toBe("Spreker A");
    expect(after[1].text).toContain("Bij Club 1 doen we alles");
    expect(after[1].text).toContain("Mijn mail is E-mail 1 en bel gerust op Telefoon 1.");
    expect(recheckPseudonymized(after, decisions)).toEqual({ ok: true, problems: [] });
  });

  it("een uitgezet label blijft staan (de consultant beslist), behalve vergrendelde soorten", () => {
    const decisions = decide(proposePseudonyms(GESPREK)).map((d) => (d.kind === "postcode" ? { ...d, enabled: false } : d));
    const after = applyPseudonyms(GESPREK, decisions);
    expect(after[2].text).toContain("1234 AB");
  });

  it("met een aangepast label", () => {
    const decisions = decide(proposePseudonyms(GESPREK)).map((d) => (d.label === "Spreker B" ? { ...d, label: "Penningmeester" } : d));
    expect(applyPseudonyms(GESPREK, decisions)[1].speaker).toBe("Penningmeester");
  });

  it("werkt op een echt geparseerd Teams-transcript", () => {
    const parsed = parseVtt(readFileSync(path.join(__dirname, "fixtures/transcripts/teams.vtt"), "utf8"));
    const after = applyPseudonyms(parsed.segments, decide(proposePseudonyms(parsed.segments)));
    expect(after.map((s) => s.speaker)).toEqual(["Spreker A", "Spreker B"]);
    expect(after[1].text).toContain("Bij Club 1 doen we alles");
  });

  it("pseudonymizeText laat woorden met een naam erin staan", () => {
    expect(pseudonymizeText("Jan en Janssen in januari", [{ term: "Jan", kind: "person", label: "Persoon 1", enabled: true }])).toBe("Persoon 1 en Janssen in januari");
  });
});

describe("hercontrole op de server", () => {
  it("een weggelaten keuze blijft aan; vergrendelde soorten kunnen niet uit", () => {
    const { decisions, errors } = resolveDecisions(GESPREK, [
      { term: "peter.bakker@vvoranje.nl", kind: "email", label: "E-mail 1", enabled: false },
      { term: "1234 AB", kind: "postcode", label: "Postcode 1", enabled: false },
    ]);
    expect(errors).toEqual([]);
    expect(decisions.find((d) => d.kind === "email")?.enabled).toBe(true);
    expect(decisions.find((d) => d.kind === "postcode")?.enabled).toBe(false);
    expect(decisions.find((d) => d.term === "Sanne de Vries")?.enabled).toBe(true);
  });

  it("een label met de naam erin wordt geweigerd", () => {
    const { errors, decisions } = resolveDecisions(GESPREK, [{ term: "Sanne de Vries", kind: "speaker", label: "Sanne (interviewer)", enabled: true }]);
    expect(errors.length).toBe(1);
    expect(decisions.find((d) => d.term === "Sanne de Vries")?.label).toBe("Spreker A");
  });

  it("een extra term van de consultant wordt toegevoegd als hij echt in de tekst staat", () => {
    const { decisions } = resolveDecisions(GESPREK, [
      { term: "Sportpark Noord", kind: "organisation", label: "Locatie 1", enabled: true },
      { term: "Bestaat Niet", kind: "person", label: "Persoon 9", enabled: true },
    ]);
    expect(decisions.some((d) => d.term === "Sportpark Noord")).toBe(true);
    expect(decisions.some((d) => d.term === "Bestaat Niet")).toBe(false);
  });

  it("de hercontrole vindt een overgebleven e-mailadres of een niet vervangen term", () => {
    const decisions: PseudonymDecision[] = [{ term: "Peter", kind: "person", label: "Persoon 1", enabled: true }];
    expect(recheckPseudonymized([seg(null, "Mail naar a@b.nl")], decisions).ok).toBe(false);
    expect(recheckPseudonymized([seg("Peter", "Hoi")], decisions).problems).toEqual(['"Persoon" is niet overal vervangen.']);
  });
});

describe("wat er bewaard wordt", () => {
  it("alleen labels, soorten en aantallen, nooit de originele termen", () => {
    const decisions = decide(proposePseudonyms(GESPREK));
    const summary = labelSummary(GESPREK, decisions);
    const json = JSON.stringify(summary);
    for (const name of ["Sanne", "Peter", "Oranje", "@", "0417"]) expect(json).not.toContain(name);
    expect(summary.labels.find((l) => l.label === "Spreker B")).toEqual({ label: "Spreker B", kind: "speaker", count: 3 });
    expect(summary.labels.find((l) => l.label === "Spreker A")).toEqual({ label: "Spreker A", kind: "speaker", count: 3 });
    expect(summary.declined).toBe(0);
  });
});
