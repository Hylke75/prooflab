// Gebruikerstest B2: standaardwaarden voor "Soort informatie" (evidence_type) en "Hoe snel veroudert dit?" (freshness_kind)
// per brontype. Het formulier vult ze voor; de consultant kan afwijken. Een afwijking is zichtbaar (hint bij het veld en
// een pill bij de bevinding; afgeleid, niet opgeslagen). Eén harde regel: wat mensen zelf zeggen (interview, outreach,
// enquête) is nooit een officiële statistiek; de server weigert die combinatie.
//
// Prijspagina's: er is geen apart brontype of kenmerk voor een prijspagina (SOURCE_TYPES kent alleen company_page), dus een
// bedrijfswebsite krijgt de versheid van productinformatie (12 maanden, net als prijzen). Kies zelf "Prijs" als het om een
// prijs gaat; dat is geen afwijking die iets verzwakt.

import { EVIDENCE_TYPES, SOURCE_TYPES, type EvidenceType, type SourceType } from "./labels";
import type { FreshnessKind } from "./verify";

export type SourceDefaults = { evidenceType: EvidenceType; freshness: FreshnessKind };

export const SOURCE_DEFAULTS: Record<SourceType, SourceDefaults> = {
  official_statistic: { evidenceType: "official_statistic", freshness: "statistic" },
  research_report: { evidenceType: "third_party_estimate", freshness: "statistic" },
  primary_document: { evidenceType: "primary_document", freshness: "general" },
  company_page: { evidenceType: "primary_document", freshness: "product" },
  news: { evidenceType: "third_party_estimate", freshness: "general" },
  review_site: { evidenceType: "qualitative_observation", freshness: "general" },
  forum: { evidenceType: "qualitative_observation", freshness: "general" },
  blog: { evidenceType: "qualitative_observation", freshness: "general" },
  interview: { evidenceType: "qualitative_observation", freshness: "general" },
  outreach: { evidenceType: "qualitative_observation", freshness: "general" },
  survey: { evidenceType: "self_reported_intent", freshness: "general" },
  dataset_upload: { evidenceType: "third_party_estimate", freshness: "statistic" },
  other: { evidenceType: "qualitative_observation", freshness: "general" },
};

const isSourceType = (t: unknown): t is SourceType => typeof t === "string" && t in SOURCE_TYPES;

// Standaard per brontype; een onbekend type valt terug op "overig".
export function defaultsForSource(type: string | null | undefined): SourceDefaults {
  return SOURCE_DEFAULTS[isSourceType(type) ? type : "other"];
}

// Wijkt de gekozen soort informatie af van de standaard voor dit brontype?
export function evidenceTypeDeviates(sourceType: string | null | undefined, evidenceType: string | null | undefined): boolean {
  return !!evidenceType && evidenceType !== defaultsForSource(sourceType).evidenceType;
}

// Bronnen met wat mensen zelf zeggen: nooit een officiële statistiek.
export const SELF_REPORTED_SOURCES: readonly SourceType[] = ["interview", "outreach", "survey"];

// De harde regel, voor addClaim en insertClaimWithQuote: null als de combinatie mag.
export function evidenceTypeError(sourceType: string | null | undefined, evidenceType: string | null | undefined): string | null {
  if (evidenceType === "official_statistic" && isSourceType(sourceType) && SELF_REPORTED_SOURCES.includes(sourceType)) {
    return `Een ${SOURCE_TYPES[sourceType].toLowerCase()} is geen officiële statistiek. Kies bij "Soort informatie" bijvoorbeeld "${EVIDENCE_TYPES[defaultsForSource(sourceType).evidenceType]}".`;
  }
  return null;
}

// Korte tekst voor de hint bij het veld en de pill bij de bevinding.
export function deviationHint(sourceType: string | null | undefined): string {
  return `Afwijkend van de standaard voor ${isSourceType(sourceType) ? SOURCE_TYPES[sourceType].toLowerCase() : "deze bron"}`;
}
