import { describe, expect, it } from "vitest";
import { TEST_PROGRESS_STEPS, testProgress } from "@/lib/domain/test-progress";
import { errorsPerTab, isOtherTabField, tabForField, testCardTabs } from "@/lib/domain/test-card-tabs";
import { EXPERIMENT_STATES } from "@/lib/domain/labels";

const statuses = (p: ReturnType<typeof testProgress>) => p.steps.map((s) => s.status);

describe("voortgang van een test", () => {
  it("heeft zes stappen over het hele testproces", () => {
    expect(TEST_PROGRESS_STEPS.map((s) => s.label)).toEqual(["Test Card invullen", "Ter review", "Goedgekeurd", "Loopt (meten)", "Afgerond", "Learning Card"]);
    expect(testProgress({ state: "draft" }).steps.map((s) => s.number)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("leidt de huidige stap af uit de experimentstatus", () => {
    expect(statuses(testProgress({ state: "draft", saved: false }))).toEqual(["current", "todo", "todo", "todo", "todo", "todo"]);
    expect(statuses(testProgress({ state: "draft" }))).toEqual(["current", "todo", "todo", "todo", "todo", "todo"]);
    expect(statuses(testProgress({ state: "ready_for_review" }))).toEqual(["done", "current", "todo", "todo", "todo", "todo"]);
    expect(statuses(testProgress({ state: "approved" }))).toEqual(["done", "done", "current", "todo", "todo", "todo"]);
    expect(statuses(testProgress({ state: "live" }))).toEqual(["done", "done", "done", "current", "todo", "todo"]);
    expect(statuses(testProgress({ state: "paused" }))).toEqual(["done", "done", "done", "current", "todo", "todo"]);
    expect(statuses(testProgress({ state: "ended", learningCards: 0 }))).toEqual(["done", "done", "done", "done", "current", "todo"]);
    expect(statuses(testProgress({ state: "ended", learningCards: 1 }))).toEqual(["done", "done", "done", "done", "done", "current"]);
    expect(statuses(testProgress({ state: "analyzed", learningCards: 1 }))).toEqual(Array(6).fill("done"));
    expect(statuses(testProgress({ state: "decided", learningCards: 1 }))).toEqual(Array(6).fill("done"));
  });

  it("kent een stap voor elke experimentstatus, met precies één huidige stap tot alles klaar is", () => {
    for (const state of Object.keys(EXPERIMENT_STATES)) {
      const p = testProgress({ state, learningCards: state === "analyzed" || state === "decided" ? 1 : 0 });
      const current = p.steps.filter((s) => s.status === "current").length;
      expect(current).toBe(p.current === null ? 0 : 1);
      expect(p.next.text.length).toBeGreaterThan(5);
    }
  });

  it("geeft een compacte tekst en een balk voor mobiel", () => {
    expect(testProgress({ state: "ready_for_review" }).compact).toBe("Stap 2 van 6 · Ter review");
    expect(testProgress({ state: "decided" }).compact).toBe("Alle 6 stappen afgerond");
    expect(testProgress({ state: "draft" }).fraction).toBeCloseTo(0.5 / 6);
    expect(testProgress({ state: "decided" }).fraction).toBe(1);
  });

  it("noemt de volgende stap met de plek van de primaire actie", () => {
    expect(testProgress({ state: "draft", saved: false }).next.target).toBe("save");
    expect(testProgress({ state: "draft" }).next.target).toBe("review");
    expect(testProgress({ state: "ready_for_review" }).next.target).toBe("approve");
    expect(testProgress({ state: "approved" }).next.target).toBe("start");
    expect(testProgress({ state: "live" }).next.target).toBe("end");
    expect(testProgress({ state: "paused" }).note).toMatch(/Gepauzeerd/);
    expect(testProgress({ state: "ended" }).next.target).toBe("learning");
    expect(testProgress({ state: "ended", learningCards: 2 }).next.target).toBe("evidence");
    expect(testProgress({ state: "analyzed", learningCards: 1 }).next.target).toBe("evidence");
    expect(testProgress({ state: "decided" }).next).toMatchObject({ target: null, cta: null });
  });

  it("valt bij een onbekende status veilig terug op het begin zonder actie", () => {
    const p = testProgress({ state: "iets-anders" });
    expect(p.current).toBe(0);
    expect(p.next.target).toBeNull();
  });
});

describe("tabs van de Test Card-builder", () => {
  const keys = (type: string, manualPlaybook = false) => testCardTabs(type, { manualPlaybook }).map((t) => t.label);
  it("toont per testtype alleen tabs met inhoud", () => {
    expect(keys("landing")).toEqual(["Test Card", "Testpagina", "Voorbeeld"]);
    expect(keys("pricing")).toEqual(["Test Card", "Testpagina", "Voorbeeld"]);
    expect(keys("survey")).toEqual(["Test Card", "Vragenlijst", "Voorbeeld"]);
    expect(keys("interview")).toEqual(["Test Card", "Gespreksleidraad", "Voorbeeld"]);
    expect(keys("manual", true)).toEqual(["Test Card", "Draaiboek"]);
    expect(keys("manual")).toEqual(["Test Card"]);
  });

  it("wijst elk veld met een fout aan precies één tab toe", () => {
    const pricing = testCardTabs("pricing");
    expect(tabForField("headline", pricing)).toBe("page");
    expect(tabForField("privacy_contact", pricing)).toBe("page");
    expect(tabForField("we_believe", pricing)).toBe("card");
    expect(tabForField("channels", pricing)).toBe("card");
    expect(tabForField("survey", testCardTabs("survey"))).toBe("survey");
    expect(tabForField("guide", testCardTabs("interview"))).toBe("guide");
    // Een veld van een tab die het type niet heeft, staat op de Test Card.
    expect(tabForField("headline", testCardTabs("survey"))).toBe("card");
    expect(errorsPerTab(["headline", "price_points", "title"], pricing)).toEqual({ page: 2, card: 1 });
    expect(isOtherTabField("guide")).toBe(true);
    expect(isOtherTabField("channels")).toBe(false);
  });
});
