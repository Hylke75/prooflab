// Fase 2 · punt 4: wat telt als succes bij een landing- of prijstest. Vooraf gekozen op de testkaart en na goedkeuring
// vergrendeld (hypotheses.success_metric). Puur en zonder imports.

export const SUCCESS_METRICS = {
  signup: { label: "Aanmelding of klik", short: "aanmelding", evidence: "Waargenomen handeling" },
  payment: { label: "Betaalde aanbetaling (terugbetaalbaar)", short: "betaling", evidence: "Geverifieerde betaling" },
  commitment: { label: "Getekende toezegging", short: "toezegging", evidence: "Geverifieerde toezegging" },
  booking: { label: "Geboekte afspraak", short: "afspraak", evidence: "Waargenomen handeling" },
} as const;
export type SuccessMetric = keyof typeof SUCCESS_METRICS;
export const SUCCESS_METRIC_KEYS = Object.keys(SUCCESS_METRICS) as [SuccessMetric, ...SuccessMetric[]];

// De maatstaf op de testkaart bij elke succesmaat: teller per persoon, noemer = unieke bezoekers van de testpagina.
export const SUCCESS_METRIC_CARD: Record<Exclude<SuccessMetric, "signup">, { metric_label: string; metric_numerator: string; metric_denominator: string }> = {
  payment: {
    metric_label: "Betaalde aanbetaling",
    metric_numerator: "unieke bezoekers die een terugbetaalbare aanbetaling betaalden (live, niet terugbetaald)",
    metric_denominator: "unieke bezoekers van de testpagina",
  },
  commitment: {
    metric_label: "Getekende toezegging",
    metric_numerator: "unieke personen met een getekende intentieverklaring of digitaal akkoord",
    metric_denominator: "unieke bezoekers van de testpagina",
  },
  booking: {
    metric_label: "Geboekte afspraak",
    metric_numerator: "unieke bezoekers die een afspraak boekten (niet geannuleerd)",
    metric_denominator: "unieke bezoekers van de testpagina",
  },
};

// Een vast aantal ("3 betaalde aanbetalingen") past bij sterke handelingen: in gesprekken (aanbetaling, herhaalaankoop)
// en op een testpagina bij betaling, toezegging of afspraak. Bij een aanmelding of klik telt alleen de kansregel.
export function absoluteRuleAllowed(type: string, metric: SuccessMetric | null | undefined): boolean {
  if (type === "interview") return true;
  return (type === "landing" || type === "pricing") && !!metric && metric !== "signup";
}

export function asSuccessMetric(v: unknown): SuccessMetric {
  return typeof v === "string" && v in SUCCESS_METRICS ? (v as SuccessMetric) : "signup";
}

// Knoptekst per succesmaat: de knop zegt wat er na de klik gebeurt.
export function ctaFor(type: "landing" | "pricing", metric: SuccessMetric): string {
  if (metric === "payment") return "Reserveer je plek";
  if (metric === "booking") return "Plan een kennismaking";
  if (metric === "commitment") return "Ik wil dit gebruiken";
  return type === "pricing" ? "Kies dit aanbod" : "Zet me op de lijst";
}
