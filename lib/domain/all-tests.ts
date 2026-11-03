// "Alle tests" in het rapport (golf A, punt 12). Wie alleen de geslaagde test laat zien, kiest achteraf welke test
// telt. Daarom staat in elk rapport verplicht de volledige lijst van tests die vooraf zijn vastgelegd (goedgekeurd
// of verder), ook afgebroken, mislukte, onbesliste en verkennende tests, en het aantal tests per aanname.

import { LEVEL_SHORT, type EvidenceLevel } from "@/lib/domain/evidence";
import { TEST_ROLES, type TestRole } from "@/lib/domain/primary-test";

export type AllTestsInput = {
  title: string;
  type: string; // label van het testtype
  state: string;
  assumptionId: string | null;
  assumption: string | null;
  role: TestRole;
  locked: boolean; // de Test Card is ooit goedgekeurd (vergrendeld)
  endedEarly: boolean;
  label: string | null; // uitkomst volgens de beslisregel ("geslaagd", "niet geslaagd", …)
  level: EvidenceLevel | null;
  n: number;
  successes: number;
};

export type AllTestsRow = {
  title: string;
  type: string;
  assumption: string;
  role: string; // "Hoofdtest" of "Verkennend"
  status: string; // "afgebroken · niet geslaagd", "loopt nog", …
  outcome: string; // "geslaagd · niveau: mening" of "—"
  result: string; // "6 van 20"
  aborted: boolean;
  failed: boolean;
};

export type AllTestsPerAssumption = { assumption: string; total: number; primary: number; exploratory: number };

const STATE_TEXT: Record<string, string> = {
  approved: "goedgekeurd, nog niet gestart",
  live: "loopt nog",
  paused: "gepauzeerd",
  ended: "afgerond",
  analyzed: "afgerond en geanalyseerd",
  decided: "afgerond, besluit genomen",
  draft: "na goedkeuring teruggezet naar concept",
  ready_for_review: "na goedkeuring teruggezet, ter review",
};

// Telt mee als "vooraf vastgelegd": de Test Card is vergrendeld, of de test is goedgekeurd of verder.
export function isRegistered(t: { state: string; locked: boolean }): boolean {
  return t.locked || !["draft", "ready_for_review"].includes(t.state);
}

export function buildAllTests(tests: AllTestsInput[]): { rows: AllTestsRow[]; perAssumption: AllTestsPerAssumption[] } {
  const registered = tests.filter(isRegistered);
  const done = (s: string) => ["ended", "analyzed", "decided"].includes(s);
  const rows = registered.map((t) => {
    const outcome = done(t.state) && t.label ? `${t.label}${t.level ? ` · niveau: ${LEVEL_SHORT[t.level]}` : ""}` : "—";
    const status = [t.endedEarly ? "afgebroken" : null, STATE_TEXT[t.state] ?? t.state].filter(Boolean).join(" · ");
    return {
      title: t.title,
      type: t.type,
      assumption: t.assumption ?? "onbekende aanname",
      role: TEST_ROLES[t.role].label,
      status,
      outcome,
      result: `${t.successes} van ${t.n}`,
      aborted: t.endedEarly,
      failed: done(t.state) && t.label === "niet geslaagd",
    };
  });
  const per = new Map<string, AllTestsPerAssumption>();
  for (const t of registered) {
    const key = t.assumptionId ?? t.assumption ?? "";
    const row = per.get(key) ?? { assumption: t.assumption ?? "onbekende aanname", total: 0, primary: 0, exploratory: 0 };
    row.total++;
    if (t.role === "primary") row.primary++;
    else row.exploratory++;
    per.set(key, row);
  }
  return { rows, perAssumption: [...per.values()].sort((a, b) => b.total - a.total || a.assumption.localeCompare(b.assumption)) };
}

// Eén zin met de telling, voor boven de lijst.
export function allTestsSummary(rows: AllTestsRow[]): string {
  if (rows.length === 0) return "Er zijn nog geen tests vooraf vastgelegd.";
  const failed = rows.filter((r) => r.failed).length;
  const aborted = rows.filter((r) => r.aborted).length;
  const exploratory = rows.filter((r) => r.role === TEST_ROLES.exploratory.label).length;
  return `${rows.length} ${rows.length === 1 ? "test" : "tests"} vooraf vastgelegd: ${failed} niet geslaagd, ${aborted} afgebroken, ${exploratory} verkennend.`;
}
