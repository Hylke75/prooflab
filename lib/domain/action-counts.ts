// Fase 2 · punt 4: per persoon tellen wat er op een testpagina gebeurt. Eén persoonssleutel = HMAC(TRACKING_SALT,
// genormaliseerd e-mailadres) (zelfde afleiding als emailHash, zodat een privacyverzoek ze vindt), of voor anonieme
// bezoekers de bezoekerscode. De database telt (experiment_action_counts); hier staan de regels voor wat als succes telt
// en de tekst van de automatische waarneming. Puur, zonder database.

import { emailHash } from "./survey-tokens";
import { SUCCESS_METRICS, type SuccessMetric } from "./test-page-generator";
import type { EvidenceType, ObservationKind } from "./labels";

export type ActionCounts = {
  visitors: number; // unieke bezoekers (bezoekerscode, weergave)
  clickers: number; // unieke bezoekers die op de knop klikten
  submitters: number; // unieke bezoekers die het formulier verstuurden
  payers: number; // unieke personen met een live, betaalde en niet terugbetaalde aanbetaling
  testPayers: number; // idem in testmodus: telt nooit als bewijs
  refunded: number; // terugbetaalde of teruggeboekte betalingen (tellen niet meer)
  unrefunded: number; // betaalde aanbetalingen die nog niet zijn terugbetaald (live en test)
  committers: number; // unieke personen met een getekende toezegging
  bookers: number; // unieke personen met een geboekte (niet geannuleerde) afspraak
  cancelledBookings: number;
};

export const EMPTY_COUNTS: ActionCounts = {
  visitors: 0,
  clickers: 0,
  submitters: 0,
  payers: 0,
  testPayers: 0,
  refunded: 0,
  unrefunded: 0,
  committers: 0,
  bookers: 0,
  cancelledBookings: 0,
};

// De persoonssleutel uit een e-mailadres. Zonder geldig adres geen sleutel (en dus geen telling).
export function personKey(salt: string, email: string | null | undefined): string | null {
  const e = (email ?? "").trim().toLowerCase();
  if (!salt || e.length > 254 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) return null;
  return emailHash(salt, e);
}

export function countsFromRow(r: Record<string, unknown> | null | undefined): ActionCounts {
  if (!r) return { ...EMPTY_COUNTS };
  const n = (k: string) => {
    const v = Number(r[k]);
    return Number.isFinite(v) && v >= 0 ? v : 0;
  };
  return {
    visitors: n("visitors"),
    clickers: n("clickers"),
    submitters: n("submitters"),
    payers: n("payers"),
    testPayers: n("test_payers"),
    refunded: n("refunded"),
    unrefunded: n("unrefunded"),
    committers: n("committers"),
    bookers: n("bookers"),
    cancelledBookings: n("cancelled_bookings"),
  };
}

// Het aantal successen volgens de vooraf gekozen succesmaat. Aanmelding: zoals voorheen (formulier als er om een
// e-mailadres wordt gevraagd, anders de klik). n is altijd het aantal unieke bezoekers.
export function successesFor(metric: SuccessMetric, c: ActionCounts, opts: { collectEmail: boolean }): number {
  if (metric === "payment") return c.payers;
  if (metric === "commitment") return c.committers;
  if (metric === "booking") return c.bookers;
  return opts.collectEmail ? c.submitters : c.clickers;
}

// Soort waarneming en soort bewijs van de systeemwaarneming bij de leerkaart.
export function systemObservationKind(type: string, metric: SuccessMetric, collectEmail: boolean): { kind: ObservationKind; evidenceType: EvidenceType | null } {
  if (type === "survey") return { kind: "survey_answer", evidenceType: null };
  if (metric === "payment") return { kind: "deposit", evidenceType: "verified_transaction" };
  if (metric === "commitment") return { kind: "quote_request", evidenceType: "verified_commitment" };
  if (metric === "booking") return { kind: "demo_request", evidenceType: "observed_action" };
  return { kind: type === "pricing" ? "quote_request" : collectEmail ? "demo_request" : "waitlist_signup", evidenceType: "observed_action" };
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

// De telling per persoon in gewone taal, voor de toelichting van de automatische waarneming en het scherm.
export function perPersonLine(c: ActionCounts, opts: { deposit?: boolean; commitments?: boolean; bookings?: boolean } = {}): string {
  const parts = [plural(c.visitors, "unieke bezoeker", "unieke bezoekers"), plural(c.clickers, "unieke klikker", "unieke klikkers"), plural(c.submitters, "unieke aanmelder", "unieke aanmelders")];
  if (opts.deposit || c.payers || c.testPayers || c.refunded) parts.push(plural(c.payers, "unieke betaler (live)", "unieke betalers (live)"));
  if (opts.commitments || c.committers) parts.push(plural(c.committers, "unieke toezegger", "unieke toezeggers"));
  if (opts.bookings || c.bookers || c.cancelledBookings) parts.push(plural(c.bookers, "unieke booker", "unieke bookers"));
  return parts.join(", ");
}

export function systemObservationSummary(i: {
  type: string;
  metric: SuccessMetric;
  counts: ActionCounts;
  successes: number;
  n: number;
  metricLabel: string;
  interval: string; // "12,0%, 95%-interval 6,1%–20,3%"
}): string {
  const label = SUCCESS_METRICS[i.metric].evidence;
  const exclusions: string[] = [];
  if (i.metric === "payment") {
    if (i.counts.refunded) exclusions.push(`${plural(i.counts.refunded, "terugbetaalde betaling telt", "terugbetaalde betalingen tellen")} niet`);
    if (i.counts.testPayers) exclusions.push("betalingen in testmodus tellen niet");
  }
  if (i.metric === "booking" && i.counts.cancelledBookings) exclusions.push(`${plural(i.counts.cancelledBookings, "geannuleerde afspraak telt", "geannuleerde afspraken tellen")} niet`);
  const tail = exclusions.length ? ` (${exclusions.join("; ")})` : "";
  return `${label}, automatisch per persoon geteld: ${perPersonLine(i.counts, { deposit: i.metric === "payment", commitments: i.metric === "commitment", bookings: i.metric === "booking" })}. ${i.successes} van ${i.n}: ${i.metricLabel.toLowerCase()} (${i.interval})${tail}.`;
}
