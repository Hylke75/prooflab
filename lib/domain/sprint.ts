// Validation sprint of 4–6 weeks (decisions doc §9c): week 1 research, week 2 assumptions and test
// design, the middle weeks testing, the last week decision and report. Pure date arithmetic on
// calendar dates (YYYY-MM-DD), so the result does not depend on the server's time zone.

export type SprintPhase = "research" | "assumptions" | "test" | "decide";

export const SPRINT_PHASES: Record<SprintPhase, { label: string; detail: string; order: number }> = {
  research: { label: "Onderzoek", detail: "Idee-brief bevestigd, eerste marktbeeld met bronnen", order: 1 },
  assumptions: { label: "Aannames + testontwerp", detail: "Top 3 risicovolle aannames, Test Card goedgekeurd", order: 2 },
  test: { label: "Testen", detail: "Tests live, werving loopt, nog geen uitspraak", order: 3 },
  decide: { label: "Besluit + rapport", detail: "Learning Cards, Reality Check, besluit en rapport", order: 4 },
};

export const SPRINT_LENGTHS = [4, 5, 6] as const;
export const DAY_MS = 86_400_000;

export type SprintMilestone = { phase: SprintPhase; fromWeek: number; toWeek: number; label: string };

// Where the dossier actually is: 1 research … 4 decide, 5 decided and reported.
export type SprintStage = 1 | 2 | 3 | 4 | 5;

export type SprintStatus =
  | { planned: false }
  | {
      planned: true;
      state: "not_started" | "running" | "finished";
      week: number; // 1-based, clamped to 1..weeks
      weeks: number;
      phase: SprintPhase;
      startDate: string;
      endDate: string; // last day of the sprint
      daysToStart: number;
      daysLeft: number; // including today; 0 when finished
      milestones: (SprintMilestone & { status: "done" | "current" | "upcoming" })[];
      behind: boolean;
      behindReason: string | null;
    };

export function phaseOfWeek(week: number, weeks: number): SprintPhase {
  if (week >= weeks) return "decide";
  if (week <= 1) return "research";
  if (week === 2) return "assumptions";
  return "test";
}

export function sprintMilestones(weeks: number): SprintMilestone[] {
  const out: SprintMilestone[] = [];
  for (let w = 1; w <= weeks; w++) {
    const phase = phaseOfWeek(w, weeks);
    const last = out[out.length - 1];
    if (last && last.phase === phase) last.toWeek = w;
    else out.push({ phase, fromWeek: w, toWeek: w, label: SPRINT_PHASES[phase].label });
  }
  return out;
}

export function weekRange(m: { fromWeek: number; toWeek: number }): string {
  return m.fromWeek === m.toWeek ? `Week ${m.fromWeek}` : `Week ${m.fromWeek}–${m.toWeek}`;
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;

function dayNumber(date: string): number {
  const [y, m, d] = date.slice(0, 10).split("-").map(Number);
  return Math.floor(Date.UTC(y, m - 1, d) / DAY_MS);
}

export function addDays(date: string, days: number): string {
  return new Date((dayNumber(date) + days) * DAY_MS).toISOString().slice(0, 10);
}

// Today's calendar date in the Netherlands (the app's only market and language).
export function todayInNL(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Amsterdam", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export function sprintStatus(input: {
  start: string | null | undefined;
  weeks: number | null | undefined;
  today: string;
  stage: SprintStage;
  testsStarted: boolean; // at least one test live or finished
}): SprintStatus {
  if (!input.start || !ISO.test(input.start.slice(0, 10))) return { planned: false };
  const weeks = Math.min(12, Math.max(2, Math.round(input.weeks ?? 5)));
  const start = input.start.slice(0, 10);
  const endDate = addDays(start, weeks * 7 - 1);
  const offset = dayNumber(input.today) - dayNumber(start);
  const state = offset < 0 ? "not_started" : offset >= weeks * 7 ? "finished" : "running";
  const week = Math.min(weeks, Math.max(1, Math.floor(offset / 7) + 1));
  const phase = phaseOfWeek(week, weeks);
  const expected = state === "not_started" ? 0 : SPRINT_PHASES[phase].order;

  let behindReason: string | null = null;
  if (state === "finished" && input.stage < 5) {
    behindReason = "De sprint is voorbij, maar besluit en rapport zijn nog niet rond.";
  } else if (state === "running" && input.stage < expected) {
    const nowAt = ["", "onderzoek", "aannames", "testen", "besluit"][input.stage];
    behindReason = `Week ${week} vraagt ${SPRINT_PHASES[phase].label.toLowerCase()}, het dossier zit nog in ${nowAt}.`;
  } else if (state === "running" && phase === "test" && !input.testsStarted) {
    behindReason = `Week ${week}: er loopt nog geen test. Werving en meting kosten tijd.`;
  }

  const milestones = sprintMilestones(weeks).map((m) => {
    const order = SPRINT_PHASES[m.phase].order;
    const status: "done" | "current" | "upcoming" =
      input.stage > order ? "done" : state !== "not_started" && m.phase === phase && state === "running" ? "current" : "upcoming";
    return { ...m, status };
  });

  return {
    planned: true,
    state,
    week,
    weeks,
    phase,
    startDate: start,
    endDate,
    daysToStart: Math.max(0, -offset),
    daysLeft: state === "finished" ? 0 : Math.max(0, weeks * 7 - Math.max(0, offset)),
    milestones,
    behind: behindReason !== null,
    behindReason,
  };
}

// "Dag X van Y" for a live test from its timestamps.
export function testDay(startedAt: string | null, endsAt: string | null, now: Date = new Date()): { day: number; of: number } | null {
  if (!startedAt || !endsAt) return null;
  const s = new Date(startedAt).getTime();
  const e = new Date(endsAt).getTime();
  if (!Number.isFinite(s) || !Number.isFinite(e) || e <= s) return null;
  const of = Math.max(1, Math.round((e - s) / DAY_MS));
  const day = Math.min(of, Math.max(1, Math.floor((now.getTime() - s) / DAY_MS) + 1));
  return { day, of };
}
