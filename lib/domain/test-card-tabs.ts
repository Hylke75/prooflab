// Stappen van het testplan (de Test Card-builder). Eerst tabs in plaats van twee kolommen (feedback eigenaar); sinds
// het voorstel "ProofLab eenvoudiger" genummerde stappen die je één voor één doorloopt: Testtype → Wat test je →
// Wanneer geslaagd → (testpagina, gespreksleidraad, vragenlijst of draaiboek) → Voorbeeld. Per testtype alleen de
// stappen die iets te doen of te zien hebben; geen lege stappen. Elk veld met een validatiefout hoort bij precies één tab, zodat
// de builder naar die tab kan springen en de tab het aantal fouten kan tonen. Puur, zonder React.

export type TestCardTabKey = "type" | "card" | "criteria" | "page" | "guide" | "playbook" | "survey" | "preview";
export type TestCardTab = { key: TestCardTabKey; label: string };

export const TEST_CARD_TAB_LABELS: Record<TestCardTabKey, string> = {
  type: "Testtype",
  card: "Wat test je",
  criteria: "Wanneer geslaagd",
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
  const extra: TestCardTabKey[] =
    type === "landing" || type === "pricing"
      ? ["page", "preview"]
      : type === "survey"
        ? ["survey", "preview"]
        : type === "interview"
          ? ["guide", "preview"]
          : type === "manual" && opts.manualPlaybook
            ? ["playbook"]
            : [];
  const keys: TestCardTabKey[] = ["type", "card", "criteria", ...extra];
  return keys.map((key) => ({ key, label: TEST_CARD_TAB_LABELS[key] }));
}

// Velden van stap "Wat test je". Alle andere velden van de Test Card staan bij "Wanneer geslaagd" (drempels, steekproef,
// deadline en de vooringevulde Details).
const CARD_FIELDS = new Set(["title", "we_believe", "target_group"]);

// De stap waar het veld staat. Een veld van een stap die dit type niet heeft, staat bij "Wanneer geslaagd".
export function tabForField(field: string, tabs: TestCardTab[]): TestCardTabKey {
  const t = FIELD_TAB[field];
  if (t && tabs.some((x) => x.key === t)) return t;
  if (CARD_FIELDS.has(field) || !tabs.some((x) => x.key === "criteria")) return "card";
  return "criteria";
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
