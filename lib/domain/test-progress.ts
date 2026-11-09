// Voortgang van één test (feedback eigenaar: "heel duidelijk aangeven waar je in het proces zit"). Zes stappen over
// het hele testproces, afgeleid uit de experimentstatus (EXPERIMENT_STATES in labels.ts) en of er al een Learning
// Card is. Dezelfde balk staat bovenaan de nieuwe Test Card (nog niet opgeslagen) en op de pagina van een test.
// Puur, zonder database of React.

export const TEST_PROGRESS_STEPS = [
  { key: "card", label: "Test Card invullen" },
  { key: "review", label: "Ter review" },
  { key: "approved", label: "Goedgekeurd" },
  { key: "live", label: "Loopt (meten)" },
  { key: "ended", label: "Afgerond" },
  { key: "learning", label: "Learning Card" },
] as const;

export type ProgressStepKey = (typeof TEST_PROGRESS_STEPS)[number]["key"];
export type ProgressStepStatus = "done" | "current" | "todo";
export type ProgressStep = { key: ProgressStepKey; number: number; label: string; status: ProgressStepStatus };

// Waar de primaire actie van de volgende stap staat. De pagina vertaalt dit naar een knop of anker.
export type NextTarget = "save" | "review" | "approve" | "start" | "end" | "learning" | "evidence" | null;

export type TestProgress = {
  steps: ProgressStep[];
  // Index (0-5) van de huidige stap; null als alle stappen zijn afgerond.
  current: number | null;
  total: number;
  // Korte tekst voor mobiel: "Stap 2 van 6 · Ter review" of "Alle 6 stappen afgerond".
  compact: string;
  // Aandeel van het proces dat achter je ligt (0-1), voor de balk.
  fraction: number;
  // Eén zin na "Volgende stap:" (of "Klaar:" als er niets meer te doen is) en de primaire actie.
  next: { text: string; target: NextTarget; cta: string | null; prefix?: "Volgende stap" | "Klaar" };
  // Toelichting bij de huidige stap (bijv. gepauzeerd), of null.
  note: string | null;
};

export type ProgressInput = {
  state: string; // experiments.state
  saved?: boolean; // false: de builder (nog geen experiment in de database)
  learningCards?: number; // aantal Learning Cards (concept of goedgekeurd) van deze test
};

type At = { index: number; allDone?: boolean; next: TestProgress["next"]; note?: string };

function position({ state, saved = true, learningCards = 0 }: ProgressInput): At {
  switch (state) {
    case "draft":
      return saved
        ? { index: 0, next: { text: "controleer de Test Card en bied hem ter review aan.", target: "review", cta: "Naar ter review aanbieden" } }
        : { index: 0, next: { text: "vul de Test Card in en sla hem op als concept. Daarna bied je hem ter review aan.", target: "save", cta: "Naar opslaan" } };
    case "ready_for_review":
      return { index: 1, next: { text: "laat de Test Card goedkeuren. Goedkeuren vergrendelt hypothese en drempels.", target: "approve", cta: "Naar goedkeuren" } };
    case "approved":
      return { index: 2, next: { text: "start de test om te gaan meten.", target: "start", cta: "Naar starten" } };
    case "live":
      return { index: 3, next: { text: "meet tot de deadline of de afgesproken eindconditie, en rond de test dan af.", target: "end", cta: "Naar afronden" } };
    case "paused":
      return {
        index: 3,
        next: { text: "hervat de meting, of rond de test af.", target: "end", cta: "Naar hervatten of afronden" },
        note: "Gepauzeerd: bezoeken en reacties worden nu niet geteld.",
      };
    case "ended":
      return learningCards > 0
        ? { index: 5, next: { text: "beoordeel de concept-Learning Card bij Bewijs & besluit en keur hem goed.", target: "evidence", cta: "Naar bewijs & besluit" } }
        : { index: 4, next: { text: "analyseer de metingen en maak de Learning Card.", target: "learning", cta: "Naar de Learning Card" } };
    case "analyzed":
      return { index: 6, allDone: true, next: { text: "neem het besluit over het idee bij Bewijs & besluit.", target: "evidence", cta: "Naar bewijs & besluit" } };
    case "decided":
      return { index: 6, allDone: true, next: { text: "het besluit is genomen; deze test is helemaal afgerond.", target: null, cta: null, prefix: "Klaar" } };
    default:
      // Onbekende status: veilig terug naar het begin, zonder actie.
      return { index: 0, next: { text: "controleer de status van deze test.", target: null, cta: null } };
  }
}

export function testProgress(input: ProgressInput): TestProgress {
  const at = position(input);
  const total = TEST_PROGRESS_STEPS.length;
  const current = at.allDone ? null : Math.min(at.index, total - 1);
  const steps: ProgressStep[] = TEST_PROGRESS_STEPS.map((s, i) => ({
    key: s.key,
    number: i + 1,
    label: s.label,
    status: current === null || i < current ? "done" : i === current ? "current" : "todo",
  }));
  const compact = current === null ? `Alle ${total} stappen afgerond` : `Stap ${current + 1} van ${total} · ${steps[current].label}`;
  // De huidige stap telt half: je bent ermee bezig.
  const fraction = current === null ? 1 : (current + 0.5) / total;
  return { steps, current, total, compact, fraction, next: { prefix: "Volgende stap", ...at.next }, note: at.note ?? null };
}
