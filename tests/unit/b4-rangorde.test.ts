import { describe, expect, it } from "vitest";
import {
  MAX_SELECTED_FOR_TEST,
  rankByInformationValue,
  selectionError,
  splitBySelection,
  TEMPLATE_ASSUMPTIONS,
  testsForKind,
  valueOfInformation,
  type VoiInput,
} from "@/lib/domain/recommend";
import { assumptionKind } from "@/lib/domain/assumption-kind";
import { pickDecisiveQuestion, relatesToDecisive, sharedWords } from "@/lib/domain/decisive-question";
import { DEFAULT_CAPS } from "@/lib/domain/evidence";

// Zonder bewijs staat elke aanname op het plafond van het laagste bewijsniveau (startkans 50%, begrensd op 40%).
const CAPPED = DEFAULT_CAPS.opinion;
const input = (id: string, statement: string, extra: Partial<VoiInput> = {}): VoiInput => ({
  id,
  statement,
  importance: 5,
  probability: CAPPED,
  category: "desirability",
  evidence: 0,
  hasDiscoveryEvidence: false,
  ...extra,
});

describe("fase B4: oorzaak van de gelijke scores", () => {
  it("vóór B4 kregen drie kritieke aannames zonder bewijs dezelfde test en dus dezelfde score", () => {
    // Dezelfde soort (markt) = dezelfde test: dit is precies wat vóór B4 voor elke soort gold.
    const r = rankByInformationValue([input("a", "Probleem A komt vaak voor"), input("b", "Probleem B komt vaak voor"), input("c", "Probleem C komt vaak voor")]);
    expect(r.map((x) => x.index)).toEqual([100, 100, 100]);
    expect(new Set(r.map((x) => x.score)).size).toBe(1);
    // "21% of 63%": klantinterviews vanaf 40%.
    expect(Math.round(r[0].after.negative * 100)).toBe(21);
    expect(Math.round(r[0].after.positive * 100)).toBe(63);
    // De volgorde is dan stabiel (invoervolgorde) en dat staat erbij.
    expect(r.map((x) => x.id)).toEqual(["a", "b", "c"]);
    expect(r[0].tieBreak).toBe("order");
  });

  it("met een test per soort vallen markt, prijs, gedrag en techniek uiteen", () => {
    const r = rankByInformationValue([
      input("prijs", "Makelaars betalen € 249 per maand voor de assistent"),
      input("gedrag", "Makelaars gebruiken de assistent wekelijks"),
      input("tech", "De koppeling met Realworks is te bouwen"),
      input("markt", "Zelfstandige makelaars ervaren tijdgebrek bij woningteksten"),
    ]);
    expect(new Set(r.map((x) => x.score)).size).toBe(4);
    expect(r.map((x) => x.id)).toEqual(["markt", "prijs", "tech", "gedrag"]);
    expect(r[0].index).toBe(100);
    expect(r.slice(1).every((x) => x.index < 100)).toBe(true);
    expect(r.every((x) => x.tieBreak === null)).toBe(true);
  });

  it("de standaardset geeft geen drie gelijke scores bovenaan meer", () => {
    const r = rankByInformationValue(TEMPLATE_ASSUMPTIONS.map((a, i) => input(`t${i}`, a.statement, { importance: a.importance, category: a.category })));
    const top = r.slice(0, 3).map((x) => x.score);
    expect(new Set(top).size).toBe(3);
    // Probleem (belang 5) voor prijs (belang 5, interviews met betaalvragen: zwakker anker), dan wervingskosten (4).
    expect(r.map((x) => x.id)).toEqual(["t0", "t2", "t3", "t5", "t1", "t4"]);
    expect(r.map((x) => x.index)).toEqual([100, 90, 80, 60, 47, 42]);
    expect(r.find((x) => x.id === "t4")!.test.type).toBe("prototype");
  });
});

describe("fase B4: testtype past bij de soort", () => {
  it("een technische aanname krijgt geen klanttest maar een technische proef buiten ProofLab", () => {
    const v = valueOfInformation(input("t", "De koppeling met Realworks is te bouwen"));
    expect(v.kind).toBe("technical");
    expect(v.test.type).toBe("prototype");
    expect(v.test.external).toBe(true);
    expect(v.why).not.toMatch(/klantinterview/);
    // Ook met ontdekkend bewijs nooit een klanttest.
    expect(testsForKind("technical", true).map((t) => t.type)).toEqual(["prototype"]);
  });

  it("prijs: interviews met betaalvragen, met ontdekkend bewijs ook de prijs-/aanbodtest", () => {
    expect(testsForKind("price", false).map((t) => t.label)).toEqual(["klantinterviews met betaalvragen"]);
    expect(testsForKind("price", true).map((t) => t.type)).toEqual(["interview", "pricing"]);
  });

  it("gedrag: landingpage of enquête; markt: interviews (naast bureauonderzoek)", () => {
    expect(testsForKind("behaviour", false).map((t) => t.type)).toEqual(["landing", "survey"]);
    expect(valueOfInformation(input("g", "Makelaars gebruiken de assistent wekelijks")).test.type).toBe("landing");
    expect(testsForKind("market", false).map((t) => t.type)).toEqual(["interview"]);
    expect(testsForKind("market", true).map((t) => t.type)).toEqual(["interview", "landing"]);
  });

  it("de vastgelegde soort gaat voor de afgeleide", () => {
    const statement = "Makelaars betalen € 249 per maand voor de assistent";
    expect(valueOfInformation(input("p", statement)).kind).toBe("price");
    expect(valueOfInformation(input("p", statement, { kind: assumptionKind({ kind: "technical", statement, category: "viability" }) })).test.type).toBe("prototype");
  });
});

describe("fase B4: tiebreak bij gelijke score", () => {
  it("eerst de directe relatie met de beslissende vraag", () => {
    const r = rankByInformationValue([input("a", "Probleem A komt vaak voor"), input("b", "Probleem B komt vaak voor", { decisive: true })]);
    expect(r.map((x) => x.id)).toEqual(["b", "a"]);
    expect(r[0].tieBreak).toBe("decisive");
    expect(r[0].reason).toMatch(/Ze raakt direct de beslissende vraag\./);
    expect(r[0].reason).toMatch(/maar deze raakt direct de beslissende vraag/);
    expect(r[1].reason).toMatch(/die gaat voor omdat die direct de beslissende vraag raakt/);
  });

  it("de beslissende vraag weegt niet zwaarder dan een hogere score", () => {
    const r = rankByInformationValue([input("laag", "Probleem A komt vaak voor", { importance: 3, decisive: true }), input("hoog", "Probleem B komt vaak voor")]);
    expect(r.map((x) => x.id)).toEqual(["hoog", "laag"]);
    expect(r[0].tieBreak).toBeNull();
  });

  it("daarna de laagste testkosten", () => {
    // Markt (interviews, goedkoop) tegen gedrag (landingpage, duurder). De score is lineair in het belang: met een
    // lager belang voor de marktaanname worden de scores gelijk en beslissen de kosten.
    const a = valueOfInformation(input("x", "Probleem A komt vaak voor"));
    const b = valueOfInformation(input("y", "Makelaars gebruiken de assistent wekelijks"));
    expect(a.cost).toBeLessThan(b.cost);
    const importance = (5 * b.score) / a.score;
    expect(importance).toBeLessThan(5);
    const r = rankByInformationValue([input("y", "Makelaars gebruiken de assistent wekelijks"), input("x", "Probleem A komt vaak voor", { importance })]);
    expect(r[0].score).toBeCloseTo(r[1].score, 12);
    expect(r.map((v) => v.id)).toEqual(["x", "y"]);
    expect(r[0].tieBreak).toBe("cost");
  });
});

describe("fase B4: rangorde in gewone taal", () => {
  it("begint met 'Test deze eerst, omdat' en noemt geen IW of plafond", () => {
    const r = rankByInformationValue([input("m", "Zelfstandige makelaars ervaren tijdgebrek"), input("t", "De koppeling met Realworks is te bouwen")]);
    expect(r[0].reason).toMatch(/^Test deze eerst, omdat het idee omvalt als dit niet klopt, we nog niet weten of het klopt en klantinterviews/);
    expect(r[1].reason).toMatch(/^Test deze als tweede, omdat .*technische proef of prototype buiten ProofLab \(1–2 weken\) hier de passende toets is, geen klanttest\./);
    for (const x of r) {
      expect(x.reason).not.toMatch(/IW|begrensd|%/);
      expect(x.why).toMatch(/%/); // de cijfers staan in het uitklapdeel
    }
  });
});

describe("fase B4: beslissende vraag", () => {
  const qs = [
    { id: "q2", question: "Hoeveel makelaars zijn er?", position: 2 },
    { id: "q1", question: "Betalen zelfstandige makelaars € 249 per maand voor woningteksten?", position: 1 },
  ];
  it("is_decisive wint; anders de laagste position", () => {
    expect(pickDecisiveQuestion(qs)?.id).toBe("q1");
    expect(pickDecisiveQuestion([...qs, { id: "q3", question: "x", position: 3, is_decisive: true }])?.id).toBe("q3");
    expect(pickDecisiveQuestion([])).toBeNull();
  });
  it("relatie via een gekoppelde bevinding of tekstoverlap", () => {
    const q = { id: "q1", text: qs[1].question };
    expect(relatesToDecisive("Iets heel anders", q, ["q1"])).toBe(true);
    expect(relatesToDecisive("Zelfstandige makelaars willen woningteksten uitbesteden", q, [])).toBe(true);
    expect(relatesToDecisive("De koppeling met Realworks is te bouwen", q, ["q2"])).toBe(false);
    expect(relatesToDecisive("Wat dan ook", null, ["q1"])).toBe(false);
    // Stopwoorden en korte woorden tellen niet mee.
    expect(sharedWords("de klanten van het idee", "het idee voor de klanten")).toBe(0);
  });
});

describe("fase B4: maximaal 3 kiezen", () => {
  it("weigert een vierde keuze, maar 'later' of opnieuw kiezen mag altijd", () => {
    expect(MAX_SELECTED_FOR_TEST).toBe(3);
    expect(selectionError(2, true, false)).toBeNull();
    expect(selectionError(3, true, false)).toMatch(/al 3 aannames gekozen/);
    expect(selectionError(3, true, true)).toBeNull();
    expect(selectionError(3, false, true)).toBeNull();
  });
  it("gekozen eerst, de rest als later, in rangorde", () => {
    const list = [{ id: "a" }, { id: "b", selectedForTest: true }, { id: "c" }, { id: "d", selectedForTest: true }];
    const { now, later } = splitBySelection(list);
    expect(now.map((x) => x.id)).toEqual(["b", "d"]);
    expect(later.map((x) => x.id)).toEqual(["a", "c"]);
  });
});
