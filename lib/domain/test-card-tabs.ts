// Tabs van de Test Card-builder (feedback eigenaar: tabs in plaats van twee kolommen). Per testtype alleen de tabs
// die iets te doen of te zien hebben; geen lege tabs. Elk veld met een validatiefout hoort bij precies één tab, zodat
// de builder naar die tab kan springen en de tab het aantal fouten kan tonen. Puur, zonder React.

export type TestCardTabKey = "card" | "page" | "guide" | "playbook" | "survey" | "preview";
export type TestCardTab = { key: TestCardTabKey; label: string };

export const TEST_CARD_TAB_LABELS: Record<TestCardTabKey, string> = {
  card: "Test Card",
  page: "Testpagina",
  guide: "Gespreksleidraad",
  playbook: "Draaiboek",
  survey: "Vragenlijst",
  preview: "Voorbeeld",
};

// Velden (sleutels van FieldErrors, zie test-card.ts) die niet op de tab "Test Card" staan.
const FIELD_TAB: Record<string, TestCardTabKey> = {
  headline: "page",
  price_points: "page",
  privacy_controller: "page",
  privacy_contact: "page",
  guide: "guide",
  survey: "survey",
};

// manualPlaybook: er is een draaiboek uit de catalogus (handmatig sjabloon). Zonder draaiboek heeft een handmatige
// test niets naast de Test Card.
export function testCardTabs(type: string, opts: { manualPlaybook?: boolean } = {}): TestCardTab[] {
  const keys: TestCardTabKey[] =
    type === "landing" || type === "pricing"
      ? ["card", "page", "preview"]
      : type === "survey"
        ? ["card", "survey", "preview"]
        : type === "interview"
          ? ["card", "guide", "preview"]
          : type === "manual" && opts.manualPlaybook
            ? ["card", "playbook"]
            : ["card"];
  return keys.map((key) => ({ key, label: TEST_CARD_TAB_LABELS[key] }));
}

// De tab waar het veld staat. Een veld van een tab die dit type niet heeft, staat op de Test Card.
export function tabForField(field: string, tabs: TestCardTab[]): TestCardTabKey {
  const t = FIELD_TAB[field];
  return t && tabs.some((x) => x.key === t) ? t : "card";
}

// Aantal fouten per tab (alleen tabs met fouten).
export function errorsPerTab(fields: string[], tabs: TestCardTab[]): Partial<Record<TestCardTabKey, number>> {
  const out: Partial<Record<TestCardTabKey, number>> = {};
  for (const f of fields) {
    const t = tabForField(f, tabs);
    out[t] = (out[t] ?? 0) + 1;
  }
  return out;
}

// Velden die niet op de tab "Test Card" staan (ongeacht het type): die horen ook niet onder "Details".
export function isOtherTabField(field: string): boolean {
  return field in FIELD_TAB;
}
