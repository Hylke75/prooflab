// Dutch labels for every enum in the data model. One source for UI, reports and tests.

export const PROJECT_TYPES = {
  new_business: { label: "Nieuw bedrijf", focus: "Marktbehoefte, doelgroep en betalingsbereidheid" },
  new_product: { label: "Nieuw product", focus: "Probleemvalidatie, concurrentie en productgebruik" },
  expansion: { label: "Bestaand bedrijf uitbreiden", focus: "Marktpotentieel, kanalen en businesscase" },
  revenue_model: { label: "Nieuw verdienmodel", focus: "Prijsmodellen, marges en klantacceptatie" },
  internal_innovation: { label: "Innovatie binnen een organisatie", focus: "Strategische fit, haalbaarheid en draagvlak" },
} as const;
export type ProjectType = keyof typeof PROJECT_TYPES;

export const SECTOR_TEMPLATES = {
  generic: "Algemeen",
  smb: "MKB / ondernemers",
  events: "Events, MICE en venues",
  media_culture: "Media, cultuur en publiek",
} as const;
export type SectorTemplate = keyof typeof SECTOR_TEMPLATES;

export const CLAIM_STATUS = {
  verified: { label: "Geverifieerd", pill: "green", explain: "Citaat letterlijk teruggevonden in een primaire of officiële bron, of in twee onafhankelijke bronnen." },
  estimate: { label: "Onderbouwde schatting", pill: "blue", explain: "Citaat klopt, maar steunt op één secundaire bron of een schatting van derden." },
  insufficient: { label: "Onvoldoende bewijs", pill: "orange", explain: "Geen controleerbaar citaat, of alleen een aanname of AI-afleiding." },
  contested: { label: "Tegenstrijdige bronnen", pill: "coral", explain: "Er is minstens één gecontroleerde bron die iets anders zegt." },
  outdated: { label: "Verouderd", pill: "gray", explain: "De bron is te oud voor dit soort gegevens; opnieuw controleren." },
} as const;
export type ClaimStatus = keyof typeof CLAIM_STATUS;

export const EVIDENCE_TYPES = {
  official_statistic: "Officiële statistiek",
  third_party_estimate: "Schatting van derden",
  primary_document: "Primaire bron (prijspagina, jaarverslag)",
  qualitative_observation: "Kwalitatieve observatie",
  self_reported_intent: "Uitgesproken intentie",
  observed_action: "Waargenomen handeling",
  verified_transaction: "Geverifieerde betaling",
  verified_commitment: "Geverifieerde toezegging",
  ai_inference: "AI-afleiding",
  internal_assumption: "Eigen aanname",
  synthetic_simulation: "Synthetische simulatie (geen bewijs)",
} as const;
export type EvidenceType = keyof typeof EVIDENCE_TYPES;

export const SOURCE_TYPES = {
  official_statistic: "Officiële statistiek",
  primary_document: "Primair document",
  company_page: "Bedrijfswebsite",
  research_report: "Onderzoeksrapport",
  news: "Nieuws",
  review_site: "Reviewsite",
  blog: "Blog / opinie",
  dataset_upload: "Eigen dataset",
  interview: "Interview",
  other: "Overig",
} as const;
export type SourceType = keyof typeof SOURCE_TYPES;

export const COMPETITOR_KINDS = {
  direct: { label: "Direct", pill: "blue" },
  indirect: { label: "Indirect", pill: "coral" },
  alternative: { label: "Huidig alternatief", pill: "green" },
  status_quo: { label: "Niets doen", pill: "gray" },
} as const;
export type CompetitorKind = keyof typeof COMPETITOR_KINDS;

export const ASSUMPTION_CATEGORIES = {
  desirability: "Wenselijkheid",
  feasibility: "Haalbaarheid",
  viability: "Levensvatbaarheid",
  context: "Context",
} as const;
export type AssumptionCategory = keyof typeof ASSUMPTION_CATEGORIES;

export const ASSUMPTION_STATUS = {
  untested: { label: "Niet getest", pill: "gray" },
  testing: { label: "Wordt getest", pill: "blue" },
  supported: { label: "Ondersteund", pill: "green" },
  refuted: { label: "Weerlegd", pill: "coral" },
  inconclusive: { label: "Onbeslist", pill: "orange" },
} as const;
export type AssumptionStatus = keyof typeof ASSUMPTION_STATUS;

export const EXPERIMENT_TYPES = {
  landing: {
    label: "Landingpage-test",
    short: "Meet of relevante bezoekers echt een demo of aanvraag doen.",
    icon: "↗",
    phase: "valideren",
    evidence: "Waargenomen handeling",
  },
  interview: {
    label: "Klantinterviews",
    short: "Begrijp het werkelijke probleem en huidig gedrag.",
    icon: "◉",
    phase: "ontdekken",
    evidence: "Kwalitatieve observatie",
  },
  pricing: {
    label: "Prijs-/aanbodtest",
    short: "Onderzoek concrete belangstelling bij een prijs.",
    icon: "€",
    phase: "valideren",
    evidence: "Waargenomen keuze bij een prijs",
  },
} as const;
export type ExperimentType = keyof typeof EXPERIMENT_TYPES;

export const EXPERIMENT_STATES = {
  draft: { label: "Concept", pill: "gray" },
  ready_for_review: { label: "Ter review", pill: "orange" },
  approved: { label: "Goedgekeurd", pill: "blue" },
  live: { label: "Loopt", pill: "green" },
  paused: { label: "Gepauzeerd", pill: "orange" },
  ended: { label: "Afgerond", pill: "dark" },
  analyzed: { label: "Geanalyseerd", pill: "blue" },
  decided: { label: "Besloten", pill: "green" },
} as const;
export type ExperimentState = keyof typeof EXPERIMENT_STATES;

export const DECISIONS = {
  continue: { label: "Doorgaan", hint: "Het bewijs draagt de volgende investering." },
  adjust: { label: "Bijsturen", hint: "Verander aanbod, doelgroep of belofte en toets opnieuw." },
  test_more: { label: "Verder testen", hint: "Het bewijs is nog te zwak of onbeslist." },
  pause: { label: "Pauzeren", hint: "Leg de redenen vast en kom later terug." },
  stop: { label: "Stoppen", hint: "Het bewijs spreekt het idee tegen. Dat bespaart geld." },
} as const;
export type DecisionAction = keyof typeof DECISIONS;

export const OBSERVATION_KINDS = {
  problem_confirmed: "Probleem herkend in eigen recent gedrag",
  problem_absent: "Probleem niet herkend",
  current_behaviour: "Huidige werkwijze",
  current_spend: "Huidige uitgaven",
  counter_example: "Tegenvoorbeeld",
  objection: "Bezwaar",
  waitlist_signup: "Aanmelding wachtlijst",
  demo_request: "Demo aangevraagd",
  quote_request: "Offerte aangevraagd",
  deposit: "Aanbetaling gedaan",
  repeat_purchase: "Opnieuw gekocht",
  opinion: "Mening (\"leuk idee\")",
  other: "Overig",
} as const;
export type ObservationKind = keyof typeof OBSERVATION_KINDS;

export const DMU_ROLES = {
  user: "Gebruiker",
  buyer: "Inkoper / betaler",
  decider: "Beslisser / budgethouder",
  influencer: "Beïnvloeder",
  other: "Anders",
} as const;
export type DmuRole = keyof typeof DMU_ROLES;

export const STEPS = [
  { key: "idea", label: "Idee", path: "" },
  { key: "market", label: "Markt", path: "/research" },
  { key: "assumptions", label: "Aannames", path: "/assumptions" },
  { key: "test", label: "Testen", path: "/experiments" },
  { key: "decide", label: "Besluiten", path: "/evidence" },
] as const;
