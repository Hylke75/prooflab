import { describe, expect, it } from "vitest";
import { getDossierStatus, type DossierInput } from "@/lib/domain/dossier-status";
import { buildDecisionSheet, oneSentence, reachableRevenue, sheetFromSnapshot, strongestEvidence, type LegacySnapshot, type SheetInput } from "@/lib/report-sheet";
import { runRealityCheck, regionMismatch, regionTally, type DossierFacts } from "@/lib/domain/reality-check";
import { planTestMore, testMoreNextStep } from "@/lib/domain/extension";
import { DECISIONS } from "@/lib/domain/labels";

// Fase B6: het beslisblad (pagina 1 van het rapport), de samengevoegde keuze "Verder testen", de regio in de Reality
// Check en "Niet vastgesteld" in plaats van € 0.

const emptyStatus: DossierInput = {
  questions: 1,
  claims: 2,
  verifiedClaims: 1,
  decisiveQuestion: { status: "answered", verifiedClaims: 1 },
  assumptions: 2,
  criticalWithPrimaryTest: 1,
  assumptionsWithEvidence: 1,
  experiments: 1,
  experimentsLive: 0,
  experimentsEnded: 1,
  testsWithVerdict: 1,
  realTestObservations: 5,
  decisions: 1,
  latestDecisionAction: "continue",
  decisionRule: "saved",
};

function input(over: Partial<SheetInput> = {}, status: Partial<DossierInput> = {}): SheetInput {
  return {
    status: getDossierStatus({ ...emptyStatus, ...status }),
    decision: { action: "continue", label: "Doorgaan", decidedOn: "2026-11-04", nextStep: "Start een betaalde pilot met drie bureaus", extendWeeks: null, ruleMet: true, deviation: false },
    evidenceLevel: "Eerste gedragsbewijs",
    ladder: "Klantbewijs: 3 waarnemingen (per persoon).",
    claims: [
      { statement: "Er zijn 4.200 eventbureaus in Nederland. Dat is een stijging.", verified: true, contradicted: false, notes: [1], source: "CBS, Bedrijven naar branche", url: "https://www.cbs.nl/x", strong: true },
      { statement: "Bureaus plannen vooral in Excel.", verified: false, contradicted: false, notes: [], source: null, url: null, strong: false },
      { statement: "Een blog noemt 300 nieuwe bureaus per jaar.", verified: true, contradicted: false, notes: [2], source: "Eventblog", url: null, strong: false },
    ],
    observations: [
      { text: "2 van 5 unieke relevante bezoekers: lieten hun e-mailadres achter (40%).", source: 'Meting (landingpagina), test "Wachtlijst"', level: "small_action", strength: 2, against: false, group: "exp:1" },
      { text: "Gebruikt nu Excel en betaalt een freelancer.", source: "Klantgesprek (Gebruiker)", level: "problem", strength: 3, against: false, group: "iv:a" },
      { text: "Zegt het idee leuk te vinden.", source: "Klantgesprek (Gebruiker)", level: "opinion", strength: 0, against: false, group: "iv:a" },
    ],
    assumptions: [
      { statement: "Bureaus betalen 49 euro per maand.", importance: 5, status: "testing", evidence: 0.3 },
      { statement: "Planners willen een app.", importance: 3, status: "untested", evidence: 0 },
    ],
    decisiveQuestion: { question: "Hoe plannen eventbureaus nu?", answered: true, verifiedClaims: 1 },
    paymentShown: false,
    labelMissing: ["een tweede geslaagd gedragsexperiment"],
    dates: { today: "2026-11-04", sprintEnd: "2026-11-30", decisionDeadline: "2026-12-15", outcomeDue: "2027-05-04" },
    fallbackNext: null,
    ...over,
  };
}

describe("beslisblad: besluit en 'Nog niet beslisbaar'", () => {
  it("toont Doorgaan met het bewijsniveau als het besluit definitief is en het bewijs volstaat", () => {
    const sh = buildDecisionSheet(input());
    expect(sh.verdict).toBe("continue");
    expect(sh.verdictLabel).toBe("Doorgaan");
    expect(sh.reasons).toEqual([]);
    expect(sh.evidenceLevel).toBe("Eerste gedragsbewijs");
  });

  it("toont Stoppen bij een definitief stopbesluit, ook zonder geslaagde test", () => {
    const sh = buildDecisionSheet(input({ decision: { ...input().decision!, action: "stop", label: "Stoppen" } }, { latestDecisionAction: "stop", testsWithVerdict: 0 }));
    expect(sh.verdictLabel).toBe("Stoppen");
  });

  it("is nog niet beslisbaar zonder besluit", () => {
    const sh = buildDecisionSheet(input({ decision: null }, { decisions: 0, latestDecisionAction: null }));
    expect(sh.verdictLabel).toBe("Nog niet beslisbaar");
    expect(sh.reasons).toContain("Er is nog geen besluit vastgelegd.");
  });

  it.each(["test_more", "extend", "adjust", "pause"])("is nog niet beslisbaar na %s", (action) => {
    const sh = buildDecisionSheet(input({ decision: { ...input().decision!, action, label: DECISIONS[action as keyof typeof DECISIONS].label } }, { latestDecisionAction: action }));
    expect(sh.verdict).toBe("undecidable");
    expect(sh.reasons[0]).toMatch(/geen definitief besluit/);
    expect(sh.decisionLine).toMatch(/vastgelegd op 4 november 2026/);
  });

  it("is nog niet beslisbaar zonder echt bewijs, ook na doorgaan", () => {
    const sh = buildDecisionSheet(input({}, { verifiedClaims: 0, realTestObservations: 0, assumptionsWithEvidence: 0 }));
    expect(sh.verdict).toBe("undecidable");
    expect(sh.reasons.join(" ")).toMatch(/geen echt bewijs/);
  });

  it("is nog niet beslisbaar bij doorgaan zonder afgeronde test met uitslag", () => {
    const sh = buildDecisionSheet(input({}, { testsWithVerdict: 0 }));
    expect(sh.verdict).toBe("undecidable");
    expect(sh.reasons.join(" ")).toMatch(/afgeronde test met een uitslag/);
  });
});

describe("beslisblad: de 3 sterkste bewijsstukken", () => {
  it("sorteert op bewijsniveau, telt per persoon één keer en laat niet-geverifieerde bronnen weg", () => {
    const s = strongestEvidence(input());
    expect(s).toHaveLength(3);
    expect(s[0]).toMatchObject({ level: "kleine handeling", source: 'Meting (landingpagina), test "Wachtlijst"' });
    expect(s[0].text).toContain("2 van 5");
    expect(s[1]).toMatchObject({ level: "probleem in eigen gedrag" });
    // De officiële bron gaat vóór de blog; de mening van dezelfde geïnterviewde telt niet nog eens.
    expect(s[2]).toMatchObject({ source: "CBS, Bedrijven naar branche", note: 1, url: "https://www.cbs.nl/x" });
    expect(s.map((x) => x.text).join(" ")).not.toMatch(/Excel\./);
    expect(s.map((x) => x.text).join(" ")).not.toMatch(/leuk/);
  });

  it("geeft elk bewijsstuk in één zin", () => {
    expect(oneSentence("Er zijn 4.200 eventbureaus in Nederland. Dat is een stijging.")).toBe("Er zijn 4.200 eventbureaus in Nederland.");
    expect(oneSentence("Zonder punt")).toBe("Zonder punt.");
    expect(oneSentence("x".repeat(300)).length).toBeLessThanOrEqual(201);
  });
});

describe("beslisblad: wat níét bewezen is", () => {
  it("noemt hooguit 3 punten: beslissende vraag, kritieke aanname en ontbrekende meting", () => {
    const sh = buildDecisionSheet(
      input({ decisiveQuestion: { question: "Hoe plannen eventbureaus nu?", answered: false, verifiedClaims: 0 } }, { testsWithVerdict: 0, latestDecisionAction: "test_more" }),
    );
    expect(sh.notProven).toHaveLength(3);
    expect(sh.notProven[0]).toBe("De beslissende vraag is nog niet beantwoord: Hoe plannen eventbureaus nu?");
    expect(sh.notProven[1]).toMatch(/^Kritieke aanname niet aangetoond \(wordt getest\): Bureaus betalen 49 euro/);
    expect(sh.notProven[2]).toMatch(/Nog geen afgeronde test met een uitslag/);
    expect(sh.notProvenMore).toBeGreaterThan(0);
    // Een aanname met belang 3 is niet kritiek.
    expect(sh.notProven.join(" ")).not.toMatch(/Planners willen een app/);
  });

  it("laat een beantwoorde beslissende vraag en ondersteunde aannames weg", () => {
    const sh = buildDecisionSheet(input({ assumptions: [{ statement: "Bureaus betalen", importance: 5, status: "supported", evidence: 0.8 }], paymentShown: true, labelMissing: [] }));
    expect(sh.notProven).toEqual([]);
  });
});

describe("beslisblad: volgende stap met datum", () => {
  it("neemt na doorgaan de volgende stap uit het besluit en de meetdatum van de uitkomst", () => {
    const sh = buildDecisionSheet(input());
    expect(sh.nextStep).toEqual({ text: "Start een betaalde pilot met drie bureaus.", date: "2027-05-04", dateLabel: "meetdatum van de uitkomst" });
  });

  it("neemt na verder testen het einde van de testperiode", () => {
    const sh = buildDecisionSheet(input({ decision: { ...input().decision!, action: "extend", label: "Verder testen", extendWeeks: 4, nextStep: null } }, { latestDecisionAction: "extend" }));
    expect(sh.nextStep.date).toBe("2026-12-02");
    expect(sh.nextStep.text).toMatch(/^Verder testen tot 2 december 2026/);
  });

  it("valt terug op de coach en de sprint, en verzint geen datum", () => {
    const sh = buildDecisionSheet(input({ decision: null, fallbackNext: "Doe de Reality Check" }, { decisions: 0, latestDecisionAction: null }));
    expect(sh.nextStep).toEqual({ text: "Doe de Reality Check.", date: "2026-11-30", dateLabel: "einde van de sprint" });
    const none = buildDecisionSheet(input({ decision: null, dates: { today: "2026-11-04", sprintEnd: "2026-10-01", decisionDeadline: null, outcomeDue: null } }, { decisions: 0, latestDecisionAction: null }));
    expect(none.nextStep.date).toBeNull();
    expect(none.nextStep.dateLabel).toBe("Nog geen datum vastgelegd");
  });
});

describe("beslisblad: oudere rapporten", () => {
  const legacy: LegacySnapshot = {
    generatedAt: "2026-11-03T10:00:00.000Z",
    label: "Onderbouwd marktbeeld",
    labelMissing: ["een afgerond gedragsexperiment met goedgekeurde Learning Card"],
    questions: [{ position: 1, question: "Hoe plannen eventbureaus nu?", status: "open" }],
    claims: [{ statement: "Er zijn 4.200 eventbureaus in Nederland.", statusKey: "verified", notes: [1], contradicted: false }],
    counts: { claims: 1, verified: 1 },
    assumptions: [{ statement: "Bureaus betalen 49 euro per maand.", importance: 5, status: "testing", evidence: 30 }],
    experiments: [{ title: "Wachtlijst", type: "Landingpagina", state: "decided", n: 5, successes: 2, metric: "aanmeldingen / bezoekers", verdict: "inconclusive", level: "small_action" }],
    learningCards: [{ verdict: "inconclusive" }],
    decision: { action: "Verder testen", nextStep: null, at: "2026-11-02T10:00:00.000Z" },
    sources: [{ n: 1, title: "Bedrijven naar branche", url: "https://www.cbs.nl/x", publisher: "CBS", type: "Officiële statistiek", primary: true }],
  };

  it("leidt het beslisblad af uit de bestaande velden en zegt dat erbij", () => {
    const sh = sheetFromSnapshot(legacy, null);
    expect(sh.derived).toBe(true);
    expect(sh.verdictLabel).toBe("Nog niet beslisbaar");
    expect(sh.strongest[0].text).toContain("2 van 5");
    expect(sh.strongest[1]).toMatchObject({ source: "CBS, Bedrijven naar branche", note: 1 });
    expect(sh.notProven[0]).toMatch(/beslissende vraag is nog niet beantwoord/);
  });

  it("gebruikt het opgeslagen beslisblad als dat er is", () => {
    const stored = buildDecisionSheet(input());
    expect(sheetFromSnapshot({ ...legacy, sheet: stored }, null)).toBe(stored);
  });
});

describe("rapport: bereikbare jaaromzet", () => {
  it("toont 'Niet vastgesteld' met reden in plaats van € 0 als de marktomvang niet is vastgesteld", () => {
    const k = reachableRevenue({ somRevenue: 0, status: "Verkennend scenario; marktomvang niet vastgesteld", established: false });
    expect(k.value).toBe("Niet vastgesteld");
    expect(k.note).toMatch(/basisomvang/);
    expect(k.value).not.toMatch(/€/);
  });

  it("herkent een niet vastgestelde marktomvang ook in oudere rapporten (zonder established)", () => {
    expect(reachableRevenue({ somRevenue: 125000, status: "Verkennend scenario; marktomvang niet vastgesteld" }).value).toBe("Niet vastgesteld");
  });

  it("toont geen € 0 bij een vastgestelde omvang met een factor op nul, en wel het bedrag als het klopt", () => {
    expect(reachableRevenue({ somRevenue: 0, status: "Onderbouwd scenario", established: true })).toMatchObject({ value: "Niet vastgesteld", established: false });
    expect(reachableRevenue({ somRevenue: 72000, status: "Onderbouwd scenario", established: true })).toEqual({ established: true, value: "€ 72.000", note: "Onderbouwd scenario" });
    expect(reachableRevenue(null).value).toBe("Niet vastgesteld");
  });
});

describe("Reality Check: regio onbekend is geen andere regio", () => {
  const facts: DossierFacts = {
    ideaAgeDays: 3,
    ideaRegion: "Nederland",
    clientDeciderInvited: true,
    claims: [],
    competitors: [{ kind: "direct" }, { kind: "alternative" }],
    sizing: null,
    assumptions: [],
    experiments: [],
    interviews: [],
    observations: [],
    learningCards: [],
    decisionsAfterLastLearning: 0,
    isB2B: true,
  };
  const claim = (region: string | null) => ({ status: "verified" as const, section: "market", sourceTypes: ["official_statistic"], region });

  it("telt een onbekende regio niet als afwijkend, maar apart als onbekend", () => {
    expect(regionMismatch("Nederland", "onbekend")).toBe(false);
    expect(regionMismatch("Nederland", "Duitsland")).toBe(true);
    expect(regionTally("Nederland", [claim("onbekend"), claim("Unknown"), claim(""), claim("Duitsland"), claim("Nederland")])).toEqual({ other: 1, unknown: 3 });
  });

  it("geeft bij alleen onbekende regio's geen waarschuwing 'andere regio', wel een melding 'onbekend'", () => {
    const r = runRealityCheck({ ...facts, claims: [claim("onbekend"), claim("onbekend")] });
    const codes = r.findings.map((f) => f.code);
    expect(codes).not.toContain("other_region");
    const unknown = r.findings.find((f) => f.code === "unknown_region")!;
    expect(unknown).toMatchObject({ severity: "info", title: "2 bevinding(en) met onbekende regio" });
  });

  it("waarschuwt wel bij een echte andere regio", () => {
    const r = runRealityCheck({ ...facts, claims: [claim("Verenigde Staten"), claim("onbekend")] });
    expect(r.findings.find((f) => f.code === "other_region")?.title).toBe("1 bevinding(en) over een andere regio");
  });
});

describe("Verder testen: één keuze met een duur (B6)", () => {
  it("wordt een verlengde testfase als het dossier die nog niet had", () => {
    expect(planTestMore(4, [], "2026-11-04", false)).toMatchObject({ action: "extend", extendWeeks: 4, until: "2026-12-02", binding: true });
    // De duur blijft binnen 2 tot 8 weken.
    expect(planTestMore(12, [], "2026-11-04", false).extendWeeks).toBe(8);
  });

  it("wordt test_more met een streefdatum als de verlengde fase al geweest is of de klok loopt", () => {
    const had = [{ action: "extend", decidedOn: "2026-09-01", extendWeeks: 3 }];
    expect(planTestMore(3, had, "2026-11-04", false)).toMatchObject({ action: "test_more", extendWeeks: null, until: "2026-11-25", binding: false });
    expect(planTestMore(3, [], "2026-11-04", true).note).toMatch(/uitkomstklok loopt al/);
    expect(testMoreNextStep(3, "25 november 2026", "Prijs-test met drie prijspunten")).toBe("Verder testen: 3 weken, tot 25 november 2026. Prijs-test met drie prijspunten");
  });
});
