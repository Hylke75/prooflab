// Momentopname van aantallen bij elk rapport (verbeterplan golf C, punt 19). Na de bewaartermijn verdwijnen
// e-mailadressen, transcripten, citaten en open antwoorden (purge_expired_personal_data). Wat blijft herleidbaar?
// Alleen de aantallen: per test n en successen, uitgesplitst per bron, per kanaal en per wervingsgroep, en bij een
// enquête de kernvraag per bron. Deze momentopname staat in reports.snapshot (veld `tallies`) en valt niet onder de
// bewaartermijn: er staat geen persoonsgegeven in (geen namen, adressen, citaten, open antwoorden of tijdstippen per
// persoon), alleen tellingen per groep.
//
// Wervingsgroep (golf A: eigen netwerk, warm contact, koud, betaald panel, onbekend): per test n en successen per
// groep. Bij enquête-, landing- en prijstests geldt de groep van de test voor alle deelnemers; bij interviews de groep
// per gesprek (een bekende is eigen netwerk), met de groep van de test als standaard. Tests zonder groep tellen als
// onbekend. Versie 1 (vóór deze koppeling) telde bij interviews alleen bekenden en onbekenden, zonder successen.
//
// Puur en deterministisch: dezelfde invoer geeft dezelfde momentopname.

import { asRecruitmentGroup, RECRUITMENT_GROUPS, RECRUITMENT_KEYS } from "./recruitment";

export const REPORT_COUNTS_VERSION = 2;

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
    // Interviews: n en successen per wervingsgroep van het gesprek (lib/experiment-metrics.ts).
    byRecruitment?: { group: string; n: number; successes: number }[];
  } | null;
  // De wervingsgroep van de test (experiments.recruitment_group); null of onbekend = "unknown".
  recruitmentGroup?: string | null;
};

export type TestCounts = {
  test: string;
  type: string;
  state: string;
  n: number;
  successes: number;
  byChannel: { channel: string; n: number; successes: number }[];
  bySource: { source: string; n: number; successes: number }[];
  // Per wervingsgroep (golf A) n en successen. group is de sleutel (own_network, warm, cold, paid_panel, unknown),
  // label de leesbare naam. Rapporten met versie 1 hebben hier bekenden/onbekenden zonder label en met successen null.
  byGroup: { group: string; label?: string; n: number; successes: number | null }[];
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
    // Interviews: de verdeling per gesprek. Andere tests: één groep voor alle deelnemers.
    const groups = new Map<string, Split>();
    const rows = m?.byRecruitment ?? (m && m.n > 0 ? [{ group: e.recruitmentGroup ?? "unknown", n: m.n, successes: m.successes }] : []);
    for (const r of rows) {
      if (r.n <= 0) continue;
      const g = asRecruitmentGroup(r.group) ?? "unknown";
      const cur = groups.get(g) ?? { n: 0, successes: 0 };
      groups.set(g, { n: cur.n + r.n, successes: cur.successes + r.successes });
    }
    const byGroup = RECRUITMENT_KEYS.filter((g) => groups.has(g)).map((g) => ({ group: g, label: RECRUITMENT_GROUPS[g].label, ...groups.get(g)! }));
    return {
      test: e.title,
      type: e.type,
      state: e.state,
      n: m?.n ?? 0,
      successes: m?.successes ?? 0,
      byChannel,
      bySource,
      byGroup: byKey(byGroup, (g) => g.group),
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

// Eén cel "Per wervingsgroep" voor de rapporttabel: "Eigen netwerk 2/5 · Koud 1/3". Rapporten met versie 1 hebben
// alleen bekenden/onbekenden met een aantal: "bekenden 2".
export function formatGroups(byGroup: TestCounts["byGroup"]): string {
  return byGroup.map((x) => `${x.label ?? x.group} ${x.successes == null ? x.n : `${x.successes}/${x.n}`}`).join(" · ");
}
