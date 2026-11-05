// Fase 1 · punt 3: de dwarsdoorsnede over interviews heen. Per thema en per aanname: "X van N geïnterviewden".
//
//   N = echte gesprekken (is_practice = false) met vastgelegde toestemming. Oefeningen, niet-aangegeven gesprekken en
//       gesprekken zonder toestemming vallen erbuiten (ook buiten X).
//   X = verschillende van die gesprekken met minstens één meetellende toewijzing:
//       - thema: het thema is geaccepteerd en de toewijzing is handmatig, of van de AI en geaccepteerd;
//       - aanname: een gekoppelde observatie (niet synthetisch) die handmatig is, of van de AI en geaccepteerd.
//   Uitsplitsing per rol in het koopproces en per wervingsgroep (een bekende is eigen netwerk).
//
// Dezelfde regel als de databasefunctie interview_theme_counts (voor opdrachtgevers, zonder citaten). Puur. Dit is
// beschrijvend: "X van N" verandert geen enkele kans. De kans van een aanname rekent met de gekoppelde observaties
// zelf (per persoon ontdubbeld), niet met deze telling.

import { interviewRecruitment, type RecruitmentGroup } from "./recruitment";

export type CountInterview = { id: string; dmuRole: string; isAcquaintance: boolean; recruitmentGroup: string | null; testGroup?: string | null; isPractice: boolean | null; consent: boolean };
export type CountAssignment = { interviewId: string; codeId: string; origin: string; reviewStatus: string | null };
export type CountLink = { interviewId: string; assumptionId: string; origin: string; reviewStatus: string | null; isSynthetic: boolean };
export type Bucket = { key: string; mentioned: number; total: number };
export type CountItem = { type: "theme" | "assumption"; id: string; label: string; mentioned: number; total: number; interviewIds: string[]; byRole: Bucket[]; byRecruitment: Bucket[] };
export type ThemeCounts = { total: number; items: CountItem[] };

export function countsInN(i: Pick<CountInterview, "isPractice" | "consent">): boolean {
  return i.isPractice === false && i.consent;
}

export function assignmentCounts(a: Pick<CountAssignment, "origin" | "reviewStatus">): boolean {
  return a.origin === "manual" || (a.origin === "ai" && a.reviewStatus === "accepted");
}

export function linkCounts(l: Pick<CountLink, "origin" | "reviewStatus" | "isSynthetic">): boolean {
  return !l.isSynthetic && (l.origin === "manual" || (l.origin === "ai" && l.reviewStatus === "accepted"));
}

function buckets(ids: Set<string>, base: CountInterview[], keyOf: (i: CountInterview) => string): Bucket[] {
  const map = new Map<string, Bucket>();
  for (const i of base) {
    const key = keyOf(i);
    const b = map.get(key) ?? { key, mentioned: 0, total: 0 };
    b.total++;
    if (ids.has(i.id)) b.mentioned++;
    map.set(key, b);
  }
  return [...map.values()].sort((a, b) => b.total - a.total || a.key.localeCompare(b.key));
}

export const recruitmentOf = (i: CountInterview): RecruitmentGroup => interviewRecruitment(i.isAcquaintance, i.recruitmentGroup, i.testGroup ?? null);

export function themeCounts(input: {
  interviews: CountInterview[];
  codes: { id: string; label: string; status: string }[];
  assignments: CountAssignment[];
  assumptions?: { id: string; statement: string }[];
  links?: CountLink[];
}): ThemeCounts {
  const base = input.interviews.filter(countsInN);
  const inN = new Set(base.map((i) => i.id));
  const item = (type: CountItem["type"], id: string, label: string, hits: string[]): CountItem => {
    const ids = new Set(hits.filter((h) => inN.has(h)));
    return {
      type,
      id,
      label,
      mentioned: ids.size,
      total: base.length,
      interviewIds: [...ids],
      byRole: buckets(ids, base, (i) => i.dmuRole),
      byRecruitment: buckets(ids, base, recruitmentOf),
    };
  };
  const themes = input.codes
    .filter((c) => c.status === "accepted")
    .map((c) => item("theme", c.id, c.label, input.assignments.filter((a) => a.codeId === c.id && assignmentCounts(a)).map((a) => a.interviewId)));
  const assumptions = (input.assumptions ?? []).map((a) =>
    item("assumption", a.id, a.statement, (input.links ?? []).filter((l) => l.assumptionId === a.id && linkCounts(l)).map((l) => l.interviewId)),
  );
  const order = (x: CountItem, y: CountItem) => y.mentioned - x.mentioned || x.label.localeCompare(y.label);
  return { total: base.length, items: [...themes.sort(order), ...assumptions.sort(order)] };
}

// De rijen van interview_theme_counts (opdrachtgevers) in dezelfde vorm, zonder interview-ids.
export type RpcRow = { item_type: string; item_id: string; label: string; dimension: string; bucket: string; mentioned: number | string; total: number | string };

export function countsFromRpc(rows: RpcRow[]): ThemeCounts {
  const items = new Map<string, CountItem>();
  let total = 0;
  for (const r of rows) {
    const k = `${r.item_type}:${r.item_id}`;
    const it = items.get(k) ?? { type: r.item_type === "assumption" ? "assumption" : "theme", id: r.item_id, label: r.label, mentioned: 0, total: 0, interviewIds: [], byRole: [], byRecruitment: [] };
    const b = { key: r.bucket, mentioned: Number(r.mentioned), total: Number(r.total) };
    if (r.dimension === "all") {
      it.mentioned = b.mentioned;
      it.total = b.total;
      total = Math.max(total, b.total);
    } else if (r.dimension === "role") it.byRole.push(b);
    else if (r.dimension === "recruitment") it.byRecruitment.push(b);
    items.set(k, it);
  }
  const order = (x: CountItem, y: CountItem) => (x.type === y.type ? 0 : x.type === "theme" ? -1 : 1) || y.mentioned - x.mentioned || x.label.localeCompare(y.label);
  for (const it of items.values()) {
    it.byRole.sort((a, b) => b.total - a.total || a.key.localeCompare(b.key));
    it.byRecruitment.sort((a, b) => b.total - a.total || a.key.localeCompare(b.key));
  }
  return { total, items: [...items.values()].sort(order) };
}

export function xOfN(i: Pick<CountItem, "mentioned" | "total">): string {
  return `${i.mentioned} van ${i.total} ${i.total === 1 ? "geïnterviewde" : "geïnterviewden"}`;
}
