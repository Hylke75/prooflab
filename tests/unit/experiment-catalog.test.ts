import { describe, expect, it } from "vitest";
import {
  CATALOG,
  catalogExperimentType,
  catalogMethod,
  catalogMethodForTest,
  catalogOption,
  checklistFor,
  evidenceLevelOf,
  evidenceSignal,
  evidenceStep,
  experimentTypeLabel,
  filterCatalog,
  filterFromParams,
  KIND_LENS,
  MANUAL_RESULT_STEP,
  manualConfigFor,
  manualConfigOf,
  optionsWithCatalog,
  TEST_CARD_STEP,
  templateToTestCard,
} from "@/lib/domain/experiment-catalog";
import { KIND_DEFAULTS, KIND_LEVEL, testEvidenceLevel } from "@/lib/domain/evidence";
import { BUILTIN_EXPERIMENT_TYPES, EXPERIMENT_TYPES } from "@/lib/domain/labels";
import { isManualObservationKind, MANUAL_OBSERVATION_KINDS } from "@/lib/domain/manual-kind";
import { validateTestCard } from "@/lib/domain/test-card";
import { recommend, type VoiTestType } from "@/lib/domain/recommend";
import { ASSUMPTION_KINDS, type AssumptionKind } from "@/lib/domain/assumption-kind";
import { EVIDENCE_SCALE } from "@/lib/domain/evidence-scale";

// Experimentencatalogus: elke methode volledig, unieke ids, bewijssterkte binnen de bestaande ladder, filters en het
// sjabloon naar de Test Card.

const LEVEL_RANK = { opinion: 0, problem: 1, small_action: 2, quote: 3, deposit: 4, repeat: 5 } as const;

describe("catalogus: volledig en uniek", () => {
  it("bevat ongeveer 40 methodes met unieke ids en namen", () => {
    expect(CATALOG.length).toBeGreaterThanOrEqual(36);
    expect(CATALOG.length).toBeLessThanOrEqual(46);
    expect(new Set(CATALOG.map((m) => m.id)).size).toBe(CATALOG.length);
    expect(new Set(CATALOG.map((m) => m.name.toLowerCase())).size).toBe(CATALOG.length);
    for (const m of CATALOG) expect(m.id).toMatch(/^[a-z0-9-]{2,60}$/);
  });

  it.each(CATALOG.map((m) => [m.id, m] as const))("%s is volledig ingevuld", (_, m) => {
    for (const s of [m.name, m.summary, m.proves, m.doesNotProve, m.costText, m.timeText, m.sample]) expect(s.trim().length).toBeGreaterThan(2);
    expect(m.lenses.length).toBeGreaterThan(0);
    expect(m.audiences.length).toBeGreaterThan(0);
    expect(m.pitfalls.length).toBeGreaterThan(0);
    expect(m.steps.before.length).toBeGreaterThan(0);
    expect(m.steps.during.length).toBeGreaterThan(0);
    expect(m.steps.after.length).toBeGreaterThan(0);
    // Een test in ProofLab heeft startwaarden voor de Test Card; bureauonderzoek niet.
    expect(m.card === null).toBe(m.runs.kind === "source");
    // Een handmatig sjabloon noemt de eenheid van invoer.
    expect(!!m.unit).toBe(m.runs.kind === "manual");
    if (m.card) {
      expect(m.card.fail_threshold_pct).toBeLessThan(m.card.success_threshold_pct);
      expect(m.card.min_sample).toBeGreaterThanOrEqual(5);
      expect(m.card.max_duration_days).toBeGreaterThanOrEqual(1);
      expect(m.card.max_duration_days).toBeLessThanOrEqual(180);
    }
  });

  it("heeft verkennende en valideringsmethodes, alle drie de lenzen en alle drie de uitvoeringen", () => {
    expect(new Set(CATALOG.map((m) => m.category))).toEqual(new Set(["verkennen", "valideren"]));
    expect(new Set(CATALOG.flatMap((m) => m.lenses))).toEqual(new Set(["desirability", "feasibility", "viability"]));
    expect(new Set(CATALOG.map((m) => m.runs.kind))).toEqual(new Set(["builtin", "manual", "source"]));
    // Elk ingebouwd testtype komt voor.
    expect(new Set(CATALOG.flatMap((m) => (m.runs.kind === "builtin" ? [m.runs.type] : [])))).toEqual(new Set(BUILTIN_EXPERIMENT_TYPES));
  });

  it("is in eigen woorden: geen verwijzing naar een methodeboek en geen sterrenbeoordelingen", () => {
    const all = JSON.stringify(CATALOG).toLowerCase();
    for (const banned of ["strategyzer", "testing business ideas", "★", "evidence strength:"]) expect(all).not.toContain(banned);
  });
});

describe("catalogus: bewijssterkte binnen de bestaande ladder", () => {
  it("een ingebouwde methode heeft precies het bewijsniveau van haar testtype", () => {
    for (const m of CATALOG) {
      if (m.runs.kind !== "builtin") continue;
      expect(m.evidenceKind, m.id).not.toBeNull();
      expect(KIND_LEVEL[m.evidenceKind!], m.id).toBe(testEvidenceLevel(m.runs.type, { successMetric: m.runs.successMetric }));
    }
  });

  it("een handmatig sjabloon komt nooit verder dan een kleine handeling", () => {
    const manual = CATALOG.filter((m) => m.runs.kind === "manual");
    expect(manual.length).toBeGreaterThanOrEqual(12);
    for (const m of manual) {
      expect(isManualObservationKind(m.evidenceKind), m.id).toBe(true);
      expect(LEVEL_RANK[evidenceLevelOf(m)!], m.id).toBeLessThanOrEqual(LEVEL_RANK.small_action);
      expect(["exploration", "opinion", "behaviour"], m.id).toContain(evidenceStep(m));
    }
    for (const k of MANUAL_OBSERVATION_KINDS) expect(LEVEL_RANK[KIND_LEVEL[k]]).toBeLessThanOrEqual(LEVEL_RANK.small_action);
  });

  it("bureauonderzoek is verkenning: geen klantbewijs, geen test", () => {
    for (const m of CATALOG.filter((x) => x.runs.kind === "source")) {
      expect(m.evidenceKind).toBeNull();
      expect(evidenceStep(m)).toBe("exploration");
      expect(evidenceSignal(m)).toBe("bureau");
      expect(catalogExperimentType(m)).toBeNull();
      expect(catalogOption(m)).toBeNull();
    }
  });

  it("zeg- of doe-gedrag volgt de bestaande bewijsfactoren", () => {
    for (const m of CATALOG.filter((x) => x.evidenceKind)) {
      expect(evidenceSignal(m)).toBe(KIND_DEFAULTS[m.evidenceKind!].isBehaviour ? "doen" : "zeggen");
    }
    expect(evidenceSignal(catalogMethod("online-enquete")!)).toBe("zeggen");
    expect(evidenceSignal(catalogMethod("schetsentest")!)).toBe("zeggen");
    expect(evidenceSignal(catalogMethod("nepdeur-pagina")!)).toBe("doen");
    // Een aanbetaling is de enige methode op de trede Betaling, en die is ingebouwd (Mollie).
    expect(CATALOG.filter((m) => evidenceStep(m) === "payment").map((m) => m.id)).toEqual(["aanbetaling"]);
  });
});

describe("zoeken en filteren", () => {
  const ids = (f: Parameters<typeof filterCatalog>[1]) => filterCatalog(CATALOG, f).map((m) => m.id);
  it("zonder filter alles", () => {
    expect(ids({})).toHaveLength(CATALOG.length);
  });
  it("zoekt in naam en tekst, zonder accenten en hoofdletters", () => {
    expect(ids({ query: "AANBETALING" })).toContain("aanbetaling");
    expect(ids({ query: "enquete" })).toContain("online-enquete");
    expect(ids({ query: "concierge" })).toContain("concierge");
    // Alle woorden moeten voorkomen.
    expect(ids({ query: "pilot organisaties" })).toEqual(["mini-pilot"]);
    expect(ids({ query: "xyzzy" })).toEqual([]);
  });
  it("filtert op categorie, lens, kosten, tijd, bewijssterkte, uitvoering en markt", () => {
    expect(filterCatalog(CATALOG, { category: "verkennen" }).every((m) => m.category === "verkennen")).toBe(true);
    expect(filterCatalog(CATALOG, { lens: "feasibility" }).every((m) => m.lenses.includes("feasibility"))).toBe(true);
    expect(filterCatalog(CATALOG, { cost: "hoog" }).every((m) => m.cost === "hoog")).toBe(true);
    expect(filterCatalog(CATALOG, { time: "maanden" }).every((m) => m.time === "maanden")).toBe(true);
    expect(filterCatalog(CATALOG, { step: "behaviour" }).every((m) => evidenceStep(m) === "behaviour")).toBe(true);
    expect(filterCatalog(CATALOG, { runs: "manual" }).every((m) => m.runs.kind === "manual")).toBe(true);
    expect(ids({ audience: "b2c" })).not.toContain("koopproces-interviews");
    const both = filterCatalog(CATALOG, { runs: "manual", lens: "viability", audience: "b2b" });
    expect(both.length).toBeGreaterThan(0);
    expect(both.every((m) => m.runs.kind === "manual" && m.lenses.includes("viability") && m.audiences.includes("b2b"))).toBe(true);
  });
  it("leest filters uit de adresbalk en negeert ongeldige waarden", () => {
    expect(filterFromParams({ q: "prijs", categorie: "valideren", toetst: "viability", uitvoering: "manual", bewijs: "behaviour", kosten: "laag", tijd: "weken", markt: "b2b" })).toEqual({
      query: "prijs",
      category: "valideren",
      lens: "viability",
      runs: "manual",
      step: "behaviour",
      cost: "laag",
      time: "weken",
      audience: "b2b",
    });
    expect(filterFromParams({ categorie: "onzin", toetst: ["desirability"], bewijs: "payment<script>" })).toMatchObject({ category: "", lens: "", step: "" });
  });
  it("elke soort aanname heeft een passende lens met methodes", () => {
    for (const k of Object.keys(ASSUMPTION_KINDS) as AssumptionKind[]) expect(filterCatalog(CATALOG, { lens: KIND_LENS[k] }).length).toBeGreaterThan(3);
  });
});

describe("sjabloon → Test Card", () => {
  const statement = "Sportclubs plannen hun vrijwilligers elke week opnieuw met de hand.";
  it.each(CATALOG.filter((m) => m.card).map((m) => [m.id, m] as const))("%s: het sjabloon is een geldige Test Card", (_, m) => {
    const type = catalogExperimentType(m)!;
    const card = templateToTestCard(m, statement, "Besturen van amateursportclubs in Nederland")!;
    const e = validateTestCard({
      type,
      title: m.name,
      we_believe: card.we_believe,
      target_group: card.target_group,
      test_method: card.test_method,
      metric_label: card.metric_label,
      metric_numerator: card.metric_numerator,
      metric_denominator: card.metric_denominator,
      success_threshold_pct: card.success_threshold_pct,
      fail_threshold_pct: card.fail_threshold_pct,
      min_sample: card.min_sample,
      max_duration_days: card.max_duration_days,
      rule: "probability",
      success_count: null,
      thresholds_locked: true,
      recruitment_group: "cold",
      channels: ["outreach"],
      headline: "Plan je vrijwilligers in twee minuten",
      price_points: 1,
      guide_questions: 5,
      required_n: null,
      ...(type === "landing" || type === "pricing"
        ? { privacy_controller: "Bureau Sport", privacy_contact: "privacy@bureau.nl", success_metric: m.runs.kind === "builtin" ? (m.runs.successMetric ?? "signup") : "signup", deposit_enabled: true }
        : {}),
    });
    expect(e).toEqual({});
  });
  it("een handmatig sjabloon vraagt een wervingsgroep, net als een testpagina", () => {
    const m = catalogMethod("concierge")!;
    const card = templateToTestCard(m, statement, "Clubbesturen")!;
    const e = validateTestCard({ ...card, type: "manual", title: m.name, rule: "probability", success_count: null, thresholds_locked: true, recruitment_group: "", channels: ["network"], headline: "", price_points: 0, guide_questions: 0 });
    expect(e.recruitment_group).toBeTruthy();
  });
  it("bureauonderzoek heeft geen Test Card", () => {
    expect(templateToTestCard(catalogMethod("juridische-check")!, statement, "x")).toBeNull();
  });
  it("de opties van de bouwer: de methode eerst, één keuze per testtype, hooguit vier", () => {
    const rec = recommend({ category: "desirability", evidence: 0.3, hasDiscoveryEvidence: true });
    const manual = optionsWithCatalog(rec.options, catalogMethod("concierge"));
    expect(manual[0]).toMatchObject({ tier: "Uit de catalogus", type: "manual" });
    expect(manual).toHaveLength(4);
    const landing = optionsWithCatalog(rec.options, catalogMethod("demo-aanvraagpagina"));
    expect(landing[0]).toMatchObject({ tier: "Uit de catalogus", type: "landing", learn: catalogMethod("demo-aanvraagpagina")!.proves });
    expect(landing.filter((o) => o.type === "landing")).toHaveLength(1);
    expect(optionsWithCatalog(rec.options, catalogMethod("zoekvolume-analyse"))).toBe(rec.options);
    expect(optionsWithCatalog(rec.options, null)).toBe(rec.options);
  });
});

describe("handmatige configuratie", () => {
  it("komt uit de catalogus: methode, soort waarneming, draaiboek en eenheid", () => {
    const m = catalogMethod("veldobservatie")!;
    const c = manualConfigFor(m, ["  Neem een klembord mee  ", "", "x".repeat(400)])!;
    expect(c).toMatchObject({ catalog_method_id: "veldobservatie", observation_kind: "current_behaviour", method_name: "Veldobservatie", unit: m.unit });
    expect(c.checklist.before[0]).toBe(TEST_CARD_STEP);
    expect(c.checklist.after[0]).toBe(MANUAL_RESULT_STEP);
    expect(c.extra_steps).toEqual(["Neem een klembord mee", "x".repeat(300)]);
    expect(manualConfigFor(catalogMethod("nepdeur-pagina")!)).toBeNull();
    expect(manualConfigFor(catalogMethod("juridische-check")!)).toBeNull();
  });
  it("wordt teruggelezen; zonder geldige soort waarneming is het geen handmatige test", () => {
    const c = manualConfigFor(catalogMethod("pop-up-stand")!)!;
    expect(manualConfigOf(JSON.parse(JSON.stringify(c)))).toEqual(c);
    expect(manualConfigOf({ ...c, observation_kind: "deposit" })).toBeNull();
    expect(manualConfigOf({ catalog_method_id: "Bad Id!", observation_kind: "opinion" })).toBeNull();
    expect(manualConfigOf(null)).toBeNull();
  });
  it("het bewijsniveau volgt de vastgelegde soort, met de mening als ondergrens en de kleine handeling als plafond", () => {
    expect(testEvidenceLevel("manual", { config: manualConfigFor(catalogMethod("concierge")!) })).toBe("small_action");
    expect(testEvidenceLevel("manual", { config: manualConfigFor(catalogMethod("schetsentest")!) })).toBe("opinion");
    expect(testEvidenceLevel("manual", { config: { catalog_method_id: "x-y", observation_kind: "deposit" } })).toBe("opinion");
    expect(testEvidenceLevel("manual")).toBe("opinion");
    // Ingebouwde types ongewijzigd.
    expect(testEvidenceLevel("landing")).toBe("small_action");
    expect(testEvidenceLevel("pricing", { successMetric: "payment" })).toBe("deposit");
  });
  it("de naam van het testtype noemt de methode en 'handmatig ingevoerd'", () => {
    expect(experimentTypeLabel("manual", manualConfigFor(catalogMethod("concierge")!))).toBe("Conciërgetest (handmatig ingevoerd)");
    expect(experimentTypeLabel("manual", {})).toBe("Handmatig sjabloon (handmatig ingevoerd)");
    expect(experimentTypeLabel("landing", { catalog_method_id: "nepdeur-pagina" })).toBe("Landingpage-test · Nepdeur-pagina");
    expect(experimentTypeLabel("landing", {})).toBe(EXPERIMENT_TYPES.landing.label);
    expect(experimentTypeLabel("landing", { catalog_method_id: "concierge" })).toBe(EXPERIMENT_TYPES.landing.label);
  });
  it("het draaiboek van bureauonderzoek heeft geen Test Card-stap", () => {
    expect(checklistFor(catalogMethod("juridische-check")!).before[0]).not.toBe(TEST_CARD_STEP);
    expect(checklistFor(catalogMethod("nepdeur-pagina")!).before[0]).toBe(TEST_CARD_STEP);
  });
});

describe("koppeling met de aanbeveler", () => {
  it("elke voorgestelde test verwijst naar een bestaande catalogusmethode", () => {
    const types: VoiTestType[] = ["interview", "landing", "pricing", "survey", "manual", "prototype", "outreach", "desk_check"];
    for (const t of types) expect(catalogMethodForTest(t), t).not.toBeNull();
    expect(catalogMethodForTest("interview", "price")!.id).toBe("uitgaveninterviews");
    expect(catalogMethodForTest("interview", "market")!.id).toBe("probleeminterviews");
    expect(catalogMethodForTest("outreach")!.id).toBe("outreach-proef");
  });
  it("een ingebouwde aanbeveling past bij het testtype van haar methode", () => {
    for (const t of BUILTIN_EXPERIMENT_TYPES) expect(catalogExperimentType(catalogMethodForTest(t)!)).toBe(t);
  });
  it("de bewijsschaal van de catalogus is de bestaande schaal", () => {
    const steps = new Set(EVIDENCE_SCALE.map((s) => s.step));
    for (const m of CATALOG) expect(steps.has(evidenceStep(m))).toBe(true);
  });
});
