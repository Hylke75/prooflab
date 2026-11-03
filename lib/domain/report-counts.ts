// Momentopname van aantallen bij elk rapport (verbeterplan golf C, punt 19). Na de bewaartermijn verdwijnen
// e-mailadressen, transcripten, citaten en open antwoorden (purge_expired_personal_data). Wat blijft herleidbaar?
// Alleen de aantallen: per test n en successen, uitgesplitst per bron, per kanaal en per wervingsgroep, en bij een
// enquête de kernvraag per bron. Deze momentopname staat in reports.snapshot (veld `tallies`) en valt niet onder de
// bewaartermijn: er staat geen persoonsgegeven in (geen namen, adressen, citaten, open antwoorden of tijdstippen per
// persoon), alleen tellingen per groep.
//
// Puur en deterministisch: dezelfde invoer geeft dezelfde momentopname.

export const REPORT_COUNTS_VERSION = 1;

type Split = { n: number; successes: number };

export type CountsExperiment = {
  title: string;
  type: string;
  state: string;
  metrics: {
    n: number;
    successes: number;
    byChannel: { channel: string; visitors: number; actions: number }[];
    survey: { invitation: Split & { responses?: number }; openLink: Split & { responses?: number }; responses: number } | null;
  } | null;
  // Interviews van deze test: wervingskanaal en of de geïnterviewde een bekende is (de wervingsgroep).
  interviews?: { recruitedVia: string; isAcquaintance: boolean; consent: boolean }[];
};

export type TestCounts = {
  test: string;
  type: string;
  state: string;
  n: number;
  successes: number;
  byChannel: { channel: string; n: number; successes: number }[];
  bySource: { source: string; n: number; successes: number }[];
  // Per wervingsgroep alleen het aantal: successen worden niet per groep vastgelegd (null).
  byGroup: { group: string; n: number; successes: number | null }[];
  // Enquêtes: de kernvraag per bron (uitnodiging of open link), met het aantal opgeslagen antwoorden.
  keyQuestion: { source: string; n: number; successes: number; responses: number }[] | null;
};

export type ReportCounts = {
  version: number;
  // Wat deze momentopname wel en niet is, voor wie het rapport na jaren opent.
  note: string;
  tests: TestCounts[];
  totals: { tests: number; n: number; successes: number };
};

const SOURCE_LABEL = { invitation: "uitnodiging", openLink: "open link" } as const;

const byKey = <T extends { n: number }>(rows: T[], key: (r: T) => string) => [...rows].sort((a, b) => b.n - a.n || key(a).localeCompare(key(b)));

export function buildReportCounts(experiments: CountsExperiment[]): ReportCounts {
  const tests: TestCounts[] = experiments.map((e) => {
    const m = e.metrics;
    const byChannel = byKey(
      (m?.byChannel ?? []).filter((c) => c.visitors > 0).map((c) => ({ channel: c.channel || "onbekend", n: c.visitors, successes: c.actions })),
      (c) => c.channel,
    );
    const keyQuestion = m?.survey
      ? (["invitation", "openLink"] as const).map((k) => ({
          source: SOURCE_LABEL[k],
          n: m.survey![k].n,
          successes: m.survey![k].successes,
          responses: m.survey![k].responses ?? 0,
        }))
      : null;
    // Bron: bij een enquête uitnodiging of open link; bij interviews het wervingskanaal; anders het kanaal.
    const bySource = keyQuestion
      ? keyQuestion.map(({ source, n, successes }) => ({ source, n, successes }))
      : byChannel.map(({ channel, n, successes }) => ({ source: channel, n, successes }));
    const groups = new Map<string, number>();
    for (const i of e.interviews ?? []) {
      if (!i.consent) continue;
      const g = i.isAcquaintance ? "bekenden" : "onbekenden";
      groups.set(g, (groups.get(g) ?? 0) + 1);
    }
    return {
      test: e.title,
      type: e.type,
      state: e.state,
      n: m?.n ?? 0,
      successes: m?.successes ?? 0,
      byChannel,
      bySource,
      byGroup: byKey([...groups].map(([group, n]) => ({ group, n, successes: null })), (g) => g.group),
      keyQuestion,
    };
  });
  return {
    version: REPORT_COUNTS_VERSION,
    note: "Geanonimiseerde aantallen op het moment van dit rapport. Ze vallen niet onder de bewaartermijn; na die termijn kan herleiding alleen op deze aantallen, niet op antwoorden, citaten of contactgegevens.",
    tests,
    totals: { tests: tests.length, n: tests.reduce((s, t) => s + t.n, 0), successes: tests.reduce((s, t) => s + t.successes, 0) },
  };
}
