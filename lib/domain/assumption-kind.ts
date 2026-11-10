// Fase B0, punt 3: de maatstaf past bij de aanname. Een aanname over prijs of betalen toets je met geld of een
// toezegging, niet met een demo-aanvraag of een herkend probleem. Een technische aanname toets je met een
// technische proef, niet met klanten. Pure functies: scherm (testkaart), server (goedkeuren) en tests gebruiken
// dezelfde regels.
//
// Bewust zonder runtime-imports, zodat ook de e2e-tests deze module kunnen gebruiken.

import type { BuiltinExperimentType, ExperimentType } from "./labels";

export const ASSUMPTION_KINDS = {
  market: { label: "markt" },
  price: { label: "prijs" },
  behaviour: { label: "gedrag" },
  technical: { label: "technisch" },
  // Gebruikerstest B3: bereik en distributie, en wet- en regelgeving of vertrouwen (context).
  channel: { label: "kanaal" },
  regulation: { label: "regelgeving/context" },
} as const;
export type AssumptionKind = keyof typeof ASSUMPTION_KINDS;

const isKind = (k: unknown): k is AssumptionKind => typeof k === "string" && k in ASSUMPTION_KINDS;

// Volgorde (gebruikerstest B3): regelgeving → bouwen met termijn of budget → kanaal → prijs → overige techniek → gedrag
// → markt, met de categorie als terugval.
// - Regelgeving gaat voor alles: "AVG-conform en clubs vertrouwen ons met ledengegevens" gaat over wat mag en vertrouwen.
// - Bouwen of ontwikkelen binnen een termijn of budget gaat voor prijs: "te bouwen binnen € 15.000 en 2 maanden" gaat
//   over haalbaarheid, niet over wat de klant betaalt.
// - Kanaal gaat voor prijs: "bereiken via bonden tegen acceptabele kosten per club" gaat over bereik.
// - Prijs gaat voor overige techniek: "Makelaars betalen € 249 per maand voor een koppeling" gaat over betalen.
// Woordgrenzen voorkomen dat "wervingskosten" als prijsaanname telt.
const REGULATION = /\bregels\b|\bavg\b|\bgdpr\b|\bprivacy|\bwet(ten|geving|telijk|telijke)?\b|\bregelgeving|\bvergunning|\bcompliance|\bcompliant|\bvertrouw/;
const BUILD = /\bbouwen\b|\bte bouwen\b|\bbouwt\b|\bontwikkel/;
const TERM_OR_BUDGET = /\bbinnen\b|\b\d+\s*(dagen|weken|maanden|jaar)\b|\b(dag|week|maand)en?\b|€|\bbudget|\beuro\b/;
const CHANNEL = /\bkanaal|\bkanalen\b|\bbereik|\bdistributie|\bpartner|\bbond(en)?\b|\bleverancier|\bdoorverwijz|\boutreach\b|\bwerving|\bwerven\b|\bmarketingkanaal/;
const PRICE = /€|\bprijs|\bprijzen\b|\bbetal|\beuro|\bper (maand|jaar|stuk|gebruiker)\b|\babonnement|\bbudget|\bkosten\b|\bkost\b|\btarie(f|ven)\b|\baanbetal|willingness to pay|\bwtp\b/;
const TECHNICAL = /\bkoppel|\bintegrat|\bapi('s)?\b|\brealworks\b|\bbouwen\b|\btechnisch|\btechniek|\bsysteem|\bsystemen\b/;
// B4: "doen" telt niet meer: "vaak genoeg om er iets aan te willen doen" gaat over het probleem (markt).
const BEHAVIOUR = /\bgebruik|\bwekelijks|\bdagelijks|\boverstap|\bgedrag|\baanvra|\baanmeld|\binschrijv/;

// De soort van een aanname: het vastgelegde veld als dat er is, anders afgeleid uit de tekst. De categorie
// (bijv. levensvatbaarheid) is te grof om de soort uit af te leiden: daaronder vallen ook wervingskosten en marge.
export function assumptionKind(a: { kind?: string | null; statement: string; category: string }): AssumptionKind {
  if (isKind(a.kind)) return a.kind;
  const t = a.statement.toLowerCase();
  if (REGULATION.test(t)) return "regulation";
  if (BUILD.test(t) && TERM_OR_BUDGET.test(t)) return "technical";
  if (CHANNEL.test(t)) return "channel";
  if (PRICE.test(t)) return "price";
  if (TECHNICAL.test(t)) return "technical";
  if (BEHAVIOUR.test(t)) return "behaviour";
  // Terugval op de categorie (gebruikerstest B3): haalbaarheid is technisch, context is regelgeving/context.
  if (a.category === "feasibility") return "technical";
  if (a.category === "context") return "regulation";
  return "market";
}

export function assumptionKindLabel(kind: AssumptionKind): string {
  return ASSUMPTION_KINDS[kind].label;
}

// Een maatstaf over geld of een toezegging: wat iemand betaalt, aanbetaalt of tekent.
const MONEY_OR_COMMITMENT =
  /€|\bbetaal|\bbetaling|\bbetaald|\bbetaalt\b|\baanbetal|\bprijs|\beuro|offerte getekend|getekende offerte|\bintentieverklaring|\btoezegging|\btoegezegd|\bpre-?order|\bvoorbestel|abonnement afgesloten|\bsluit(en)? een abonnement|budget vrijgemaakt|\bvrijgemaakt budget/;

const TYPE_LABEL: Record<BuiltinExperimentType, string> = {
  landing: "een landingpage-test",
  interview: "een klantinterview",
  pricing: "een prijs-/aanbodtest",
  survey: "een enquête",
};

export type MetricFit = { ok: boolean; reason?: string; suggestedType?: ExperimentType };

export function metricFitsAssumption(
  kind: AssumptionKind,
  test: { type: string; metric_label: string; metric_numerator: string; decision_rule?: string | null; success_metric?: string | null },
): MetricFit {
  if (kind === "price") {
    if (test.type === "pricing") return { ok: true };
    // Fase 2 · punt 4: een betaalde aanbetaling of getekende toezegging op de testpagina is geld of een toezegging.
    if (test.success_metric === "payment" || test.success_metric === "commitment") return { ok: true };
    // De aantalregel telt alleen aanbetalingen en herhaalaankopen: dat is geld.
    if (test.decision_rule === "absolute") return { ok: true };
    if (MONEY_OR_COMMITMENT.test(`${test.metric_label} ${test.metric_numerator}`.toLowerCase())) return { ok: true };
    const measured = test.metric_label.trim() || test.metric_numerator.trim() || "iets anders";
    return {
      ok: false,
      reason: `Deze aanname gaat over betalen; de maatstaf meet "${measured}" maar geen geld of toezegging. Meet een betaling, aanbetaling, getekende offerte of toezegging, of kies een prijs-/aanbodtest.`,
      suggestedType: "pricing",
    };
  }
  // Gebruikerstest B3: een kanaalaanname toets je met bereik (landingpage per kanaal, outreach, interviews over hoe men
  // nu leveranciers vindt), niet met een prijskeuze.
  if (kind === "channel" && test.type === "pricing") {
    return {
      ok: false,
      reason: "Deze aanname gaat over een kanaal: kun je de doelgroep bereiken, en tegen welke kosten? Een prijs-/aanbodtest meet betaalbereidheid, geen bereik. Meet per kanaal met een landingpage (een link per kanaal) of met een outreach-proef.",
      suggestedType: "landing",
    };
  }
  // Gebruikerstest B3: of iets mag (AVG, vergunning) toets je met bureauonderzoek of een juridische check buiten ProofLab.
  // Vertrouwen kun je wel bij klanten uitvragen (interview of enquête), maar een klik of prijskeuze zegt daar niets over.
  if (kind === "regulation" && (test.type === "landing" || test.type === "pricing")) {
    const what = TYPE_LABEL[test.type as BuiltinExperimentType];
    return {
      ok: false,
      reason: `Deze aanname gaat over regelgeving of vertrouwen. ${what.charAt(0).toUpperCase()}${what.slice(1)} meet klikken of keuzes, niet of iets mag. Toets dit met bureauonderzoek of een juridische check buiten ProofLab en leg de uitkomst vast als bron; vertrouwen kun je uitvragen in interviews.`,
      suggestedType: "interview",
    };
  }
  if (kind === "technical") {
    const what = TYPE_LABEL[test.type as BuiltinExperimentType] ?? "een klanttest";
    return {
      ok: false,
      reason: `Deze aanname gaat over technische haalbaarheid. ${what.charAt(0).toUpperCase()}${what.slice(1)} meet wat klanten zeggen of doen, niet of het te bouwen is. Toets dit met een technische proef of prototype buiten ProofLab en leg de uitkomst vast als bron.`,
    };
  }
  return { ok: true };
}

// Interviewleidraad bij een prijsaanname: vragen over wat er nu werkelijk wordt uitgegeven en wie over het budget
// beslist. Gedrag in het verleden, geen hypothetische "zou je … betalen"-vragen.
export const PRICE_INTERVIEW_QUESTIONS = [
  "Wat geeft je organisatie nu per maand uit aan dit probleem (software, uren, uitbesteden)?",
  "Wie beslist over dat budget? Hoe ging dat de laatste keer?",
  "Wat kostte het jullie de laatste keer dat dit probleem misging?",
] as const;

export function interviewGuideFor(kind: AssumptionKind, neutral: readonly string[]): string[] {
  return kind === "price" ? [...neutral, ...PRICE_INTERVIEW_QUESTIONS] : [...neutral];
}
