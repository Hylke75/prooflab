import { expect, type Page } from "@playwright/test";

// Fase B3: de intake in drie vragen en één bevestiging. Gedeeld door de e2e-tests die een dossier aanmaken.
// Na de drie vragen staat er een voorstel op de samenvattingskaart (AI of regels, afhankelijk van de omgeving);
// de tests zetten de velden die ze later nodig hebben expliciet, zodat ze niet van het AI-voorstel afhangen.

// Een datum over `days` dagen, zoals een consultant hem schrijft ("3 januari 2027").
export function dutchDate(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toLocaleDateString("nl-NL", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Amsterdam" });
}

export function isoDate(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
}

export type IntakeInput = {
  idea: string;
  decision: string;
  uncertainty: string;
  // Velden op de samenvattingskaart die de test vastzet (label → waarde). Selects krijgen de optiewaarde.
  fill?: Record<string, string>;
  select?: Record<string, string>;
};

// Een veld op de kaart op zijn label; verplichte velden hebben "(verplicht)" achter het label.
export function cardField(page: Page, label: string) {
  return page.locator("form.intake-summary").getByLabel(new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}( \\(verplicht\\))?$`));
}

// De drie vragen; eindigt op de samenvattingskaart.
export async function answerIntake(page: Page, input: Pick<IntakeInput, "idea" | "decision" | "uncertainty">) {
  await page.goto("/app/ideas/new");
  await expect(page.getByText("Vraag 1 / 3")).toBeVisible();
  await page.getByLabel("Het idee en voor wie", { exact: true }).fill(input.idea);
  await page.getByRole("button", { name: "Volgende stap" }).click();
  await page.getByLabel("De beslissing, met inzet en datum", { exact: true }).fill(input.decision);
  await page.getByRole("button", { name: "Volgende stap" }).click();
  await page.getByLabel("Mijn grootste onzekerheid", { exact: true }).fill(input.uncertainty);
  await page.getByRole("button", { name: "Maak het voorstel" }).click();
  await expect(page.getByRole("heading", { name: "Klopt dit?" })).toBeVisible({ timeout: 60_000 });
}

// De hele intake: drie vragen, velden vastzetten, bevestigen. Geeft de URL van het nieuwe dossier terug.
export async function createIdeaViaIntake(page: Page, input: IntakeInput): Promise<string> {
  await answerIntake(page, input);
  // Eerst de keuzes: het label van de inzet hangt af van de soort ("Inzet (euro)").
  const select = { ...(input.fill && "Inzet (euro)" in input.fill ? { "Wat staat er op het spel?": "amount" } : {}), ...input.select };
  for (const [label, value] of Object.entries(select)) await cardField(page, label).selectOption(value);
  for (const [label, value] of Object.entries(input.fill ?? {})) await cardField(page, label).fill(value);
  await page.getByRole("button", { name: "Klopt, start de marktverkenning" }).click();
  await page.waitForURL(/\/research/, { timeout: 60_000 });
  return page.url().replace(/\/research.*$/, "");
}
