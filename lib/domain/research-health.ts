// Gezondheid van onderzoeksruns: hoeveel letterlijke passages (bronfragmenten) een run opleverde. Een run zonder
// enkele passage is een signaal (geblokkeerde pagina's, lege zoekresultaten, budget); twee op rij voor hetzelfde
// idee is een incident (lib/research-runner.ts meldt dan "research_zero_sources"). Puur, zonder database.

export type TaskOutput = { run_id: string; kind: string; output: unknown };

// Aantal bewaarde passages per run, uit de uitvoer van de zoekstappen.
export function passagesPerRun(tasks: TaskOutput[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const t of tasks) {
    if (t.kind !== "search") continue;
    const ids = (t.output as { excerpt_ids?: unknown } | null)?.excerpt_ids;
    out.set(t.run_id, (out.get(t.run_id) ?? 0) + (Array.isArray(ids) ? ids.length : 0));
  }
  return out;
}

// Afgeronde runs (met minstens één zoekstap) die geen enkele passage opleverden.
export function zeroSourceRuns(runIds: string[], tasks: TaskOutput[]): string[] {
  const counts = passagesPerRun(tasks);
  return runIds.filter((id) => counts.has(id) && counts.get(id) === 0);
}

// Twee opeenvolgende runs van hetzelfde idee zonder bronnen.
export function twoZeroRunsInARow(current: number | undefined, previous: number | undefined): boolean {
  return current === 0 && previous === 0;
}
