// Wervingsgroep (golf A, punten 4 en 13): via welke weg zijn de deelnemers van een test of een signaal geworven?
// Mensen uit dezelfde groep lijken op elkaar en op wie de test opzette; herhaalde signalen uit dezelfde groep zijn
// daarom geen onafhankelijk bewijs. In methode 2026-11-c telt herhaling binnen dezelfde wervingsgroep over
// verschillende bronnen heen afnemend mee (lib/domain/evidence.ts assumptionProbabilityV3).
//
// Definitie (docs/ProofLab_Voorspelkracht_v1.md 10.1):
// - eigen netwerk: mensen die de onderzoeker of opdrachtgever persoonlijk kent (vrienden, collega's, klanten,
//   volgers van het eigen account); bij interviews de vlag "bekende";
// - warm contact: geen bekende, maar via een introductie, een gedeelde community of een eerdere interactie;
// - koud: zonder eerdere relatie bereikt (koude outreach, advertenties, een open oproep op een platform);
// - betaald panel: een ingekocht onderzoekspanel of een betaalde werving van deelnemers;
// - onbekend: niet vastgelegd. Onbekend telt als één groep: zonder herkomst kunnen we niet aannemen dat signalen
//   onafhankelijk zijn.

export const RECRUITMENT_GROUPS = {
  own_network: { label: "Eigen netwerk", explain: "Mensen die jij of de opdrachtgever persoonlijk kent (ook volgers van het eigen account)." },
  warm: { label: "Warm contact", explain: "Geen bekenden, maar via een introductie, een gedeelde community of eerder contact." },
  cold: { label: "Koud", explain: "Zonder eerdere relatie bereikt: koude outreach, advertenties of een open oproep." },
  paid_panel: { label: "Betaald panel", explain: "Een ingekocht onderzoekspanel of betaalde werving van deelnemers." },
  unknown: { label: "Onbekend", explain: "Niet vastgelegd. Telt als één groep: we kunnen niet aannemen dat deze signalen onafhankelijk zijn." },
} as const;
export type RecruitmentGroup = keyof typeof RECRUITMENT_GROUPS;
export const RECRUITMENT_KEYS = Object.keys(RECRUITMENT_GROUPS) as [RecruitmentGroup, ...RecruitmentGroup[]];

// Testtypes waarbij de wervingsgroep op de Test Card verplicht is. Bij interviews legt de consultant per gesprek
// vast of het een bekende is (eigen netwerk) en anders de groep.
export const RECRUITMENT_REQUIRED_TYPES = ["survey", "landing", "pricing"] as const;

// Ontbreekt een verplichte wervingsgroep op de Test Card?
export function recruitmentMissing(type: string, group: unknown): boolean {
  return (RECRUITMENT_REQUIRED_TYPES as readonly string[]).includes(type) && asRecruitmentGroup(group) == null;
}

export function asRecruitmentGroup(v: unknown): RecruitmentGroup | null {
  return typeof v === "string" && v in RECRUITMENT_GROUPS ? (v as RecruitmentGroup) : null;
}

export function recruitmentLabel(v: unknown): string {
  const g = asRecruitmentGroup(v);
  return g ? RECRUITMENT_GROUPS[g].label : RECRUITMENT_GROUPS.unknown.label;
}

// Groep van één interview: een bekende is altijd eigen netwerk; anders de vastgelegde groep, of die van de test.
export function interviewRecruitment(isAcquaintance: boolean, group: unknown, testGroup: unknown = null): RecruitmentGroup {
  if (isAcquaintance) return "own_network";
  return asRecruitmentGroup(group) ?? asRecruitmentGroup(testGroup) ?? "unknown";
}

// "3 signalen uit dezelfde wervingsgroep (eigen netwerk): herhaling telt afnemend mee."
export function explainRecruitment(r: { group: string; sources: number }): string {
  return `${r.sources} signalen uit dezelfde wervingsgroep (${recruitmentLabel(r.group).toLowerCase()}): herhaling telt afnemend mee.`;
}
