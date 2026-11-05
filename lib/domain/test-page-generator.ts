// Fase 2 · punt 4: "Maak testpagina uit de Test Card". Een voorstel voor de landing- of prijspagina, afgeleid uit wat
// de consultant al vastlegde (hypothese, doelgroep, aanbod uit de intake, prijs uit de intake en de succesmaat). Puur en
// deterministisch, zonder AI: niets wordt verzonnen. Alles blijft aanpasbaar en de eerlijkheidscontrole
// (copy-honesty) geldt onverminderd: de waarschuwingen komen mee in het resultaat.

import { honestyWarnings } from "./copy-honesty";
import { formatAmount, headlineFromIdea, type IntakePrice } from "./test-card";

export const SUCCESS_METRICS = {
  signup: { label: "Aanmelding of klik", short: "aanmelding", evidence: "Waargenomen handeling" },
  payment: { label: "Betaalde aanbetaling (terugbetaalbaar)", short: "betaling", evidence: "Geverifieerde betaling" },
  commitment: { label: "Getekende toezegging", short: "toezegging", evidence: "Geverifieerde toezegging" },
  booking: { label: "Geboekte afspraak", short: "afspraak", evidence: "Waargenomen handeling" },
} as const;
export type SuccessMetric = keyof typeof SUCCESS_METRICS;
export const SUCCESS_METRIC_KEYS = Object.keys(SUCCESS_METRICS) as [SuccessMetric, ...SuccessMetric[]];

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

export type GeneratedPage = {
  headline: string;
  subline: string;
  offer: string;
  cta_label: string;
  product_name: string;
  price_points: { label: string; amount: string; period: string }[];
  // Waar elk deel vandaan komt, zodat de consultant ziet wat hij nog moet controleren.
  notes: string[];
  // Eerlijkheidscontrole over het voorstel (zelfde regels als bij eigen tekst).
  warnings: string[];
};

export type GeneratorInput = {
  type: "landing" | "pricing";
  weBelieve: string;
  targetGroup: string;
  ideaTitle: string;
  description: string;
  intakePrice: IntakePrice | null;
  successMetric?: SuccessMetric;
};

const LEAD = /^(wij|we|ik)\s+(denken|geloven|verwachten|vermoeden)\s+(dat\s+)?/i;

// De belofte uit "Wij denken dat …": de hoofdzin, zonder de reden ("omdat …", "want …") en zonder slotpunt.
export function promiseFrom(weBelieve: string): { main: string; reason: string | null } {
  const t = weBelieve.trim().replace(LEAD, "").replace(/^dat\s+/i, "");
  const m = t.match(/^(.*?)(?:,?\s+(?:omdat|want|doordat|aangezien)\s+)(.*)$/i);
  const main = (m ? m[1] : t).replace(/[.!?\s]+$/, "").trim();
  const reason = m ? m[2].replace(/[.!?\s]+$/, "").trim() || null : null;
  return { main, reason };
}

const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
const clip = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1).replace(/\s+\S*$/, "")}…` : s);

// Prijspunten uit de intakeprijs: de intakeprijs in het midden, met een lagere en een hogere variant (afgerond op hele
// euro's). Zonder intakeprijs blijven de bedragen leeg: ProofLab verzint geen prijs.
export function pricePointsFrom(price: IntakePrice | null): { label: string; amount: string; period: string }[] {
  const period = price?.period ?? "per maand";
  if (!price) {
    return [
      { label: "Basis", amount: "", period },
      { label: "Plus", amount: "", period },
      { label: "", amount: "", period },
    ];
  }
  const round = (n: number) => (n >= 20 ? Math.round(n) : Math.round(n * 100) / 100);
  return [
    { label: "Instap", amount: formatAmount(round(price.amount * 0.8)), period },
    { label: "Standaard", amount: formatAmount(price.amount), period },
    { label: "Plus", amount: formatAmount(round(price.amount * 1.25)), period },
  ];
}

export function pageFromTestCard(i: GeneratorInput): GeneratedPage {
  const metric = i.successMetric ?? "signup";
  const notes: string[] = [];
  const { main, reason } = promiseFrom(i.weBelieve);
  const fromDescription = headlineFromIdea(i.description, "");
  let headline: string;
  if (fromDescription.length >= 5) {
    headline = fromDescription;
    notes.push("Kop: de eerste zin van het aanbod uit de intake (zonder prijs).");
  } else if (main.length >= 5) {
    headline = cap(main);
    notes.push("Kop: de belofte uit \"Wij denken dat …\".");
  } else {
    headline = i.ideaTitle.trim();
    notes.push("Kop: de naam van het idee (geen aanbod of hypothese gevonden).");
  }
  const target = i.targetGroup.trim();
  const subline = target ? (reason ? `Voor ${target}: ${reason}.` : `Speciaal voor ${target}.`) : reason ? `${cap(reason)}.` : "";
  if (subline) notes.push(reason ? "Ondertitel: doelgroep en de reden uit de hypothese." : "Ondertitel: de doelgroep uit de Test Card.");
  const offer = (i.description.trim() || (main ? `${cap(main)}.` : "")).slice(0, 600);
  notes.push(i.description.trim() ? "Aanbod: de beschrijving uit de intake." : "Aanbod: de hypothese (de intake heeft geen beschrijving).");
  const price_points = i.type === "pricing" ? pricePointsFrom(i.intakePrice) : [];
  if (i.type === "pricing") notes.push(i.intakePrice ? `Prijspunten: rond de intakeprijs (${i.intakePrice.text}); controleer of deze stappen kloppen.` : "Prijspunten: de intake noemt geen prijs; vul zelf bedragen in.");
  const cta_label = ctaFor(i.type, metric);
  notes.push(`Knoptekst: past bij de succesmaat (${SUCCESS_METRICS[metric].short}).`);
  const out = {
    headline: clip(headline, 140),
    subline: clip(subline, 300),
    offer,
    cta_label: cta_label.slice(0, 40),
    product_name: i.ideaTitle.trim().slice(0, 80),
    price_points,
    notes,
  };
  return { ...out, warnings: honestyWarnings(out.headline, out.subline, out.offer) };
}

// Linkbouwer: per kanaal een kant-en-klare URL met utm_source en optioneel utm_content (zelfde schoonmaakregel als de
// meting: kleine letters, cijfers, - en _, hooguit 40 tekens; anders telt de link als "zonder code").
export function testLink(publicUrl: string, channel: string, content?: string | null): string {
  const code = (content ?? "").toLowerCase().trim();
  const valid = /^[a-z0-9_-]{1,40}$/.test(code);
  return `${publicUrl}?utm_source=${encodeURIComponent(channel)}${valid ? `&utm_content=${encodeURIComponent(code)}` : ""}`;
}

export function contentCodeProblem(content: string): string | null {
  const c = content.trim();
  if (!c) return null;
  if (c.length > 40) return "Hooguit 40 tekens.";
  if (!/^[a-z0-9_-]+$/.test(c)) return "Alleen kleine letters, cijfers, - en _ (bijv. post-1).";
  return null;
}
