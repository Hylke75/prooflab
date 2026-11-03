// Invitation posts for social media and newsletters, for every test with a public link. Honest by design:
// a survey says it is research and sells nothing; a landing or price test invites people to look at the offer
// without lying about it and without giving the test away. No fake scarcity, no incentives unless the consultant
// enters one. Every post carries its own channel link (utm_source) so responses are attributed per channel.

import { honestyWarnings } from "./copy-honesty";

export const PROMO_PLATFORMS = {
  linkedin: { label: "LinkedIn-bericht", channel: "linkedin", max: 1300, hint: "Organisch bericht op je eigen profiel of bedrijfspagina." },
  linkedin_dm: { label: "LinkedIn-DM (Expandi)", channel: "outreach", max: 500, hint: "Kort en persoonlijk. {first_name} vult Expandi zelf in. Zonder link in het eerste bericht, tenzij je dat kiest." },
  instagram: { label: "Instagram-caption", channel: "meta", max: 2200, hint: "Links in captions zijn niet klikbaar: zet de link ook in je bio of story." },
  facebook: { label: "Facebook-bericht", channel: "meta", max: 1200, hint: "Voor je tijdlijn, pagina of een relevante groep (check de groepsregels)." },
  x: { label: "X-bericht", channel: "x", max: 280, hint: "Maximaal 280 tekens, inclusief de link." },
  whatsapp: { label: "WhatsApp-bericht", channel: "network", max: 700, hint: "Voor je eigen netwerk; vraag of mensen het willen doorsturen." },
  newsletter: { label: "E-mail / nieuwsbrief", channel: "newsletter", max: 1200, hint: "Blokje voor je nieuwsbrief of een e-mail aan je eigen lijst." },
} as const;
export type PromoPlatform = keyof typeof PROMO_PLATFORMS;
export const PROMO_PLATFORM_KEYS = Object.keys(PROMO_PLATFORMS) as PromoPlatform[];
export const isPromoPlatform = (s: unknown): s is PromoPlatform => typeof s === "string" && s in PROMO_PLATFORMS;

export const PROMO_MIN = 10; // database minimum

export type PromoInput = {
  kind: "survey" | "landing" | "pricing";
  topic: string; // survey title, or the headline of the offer
  purpose: string; // survey intro, or the offer's subline
  audience: string;
  researcher: string;
  minutes: number | null; // surveys only
  incentive: string | null; // only when the consultant entered one
  dmIncludesLink: boolean;
};

const oneLine = (s: string) => s.replace(/\s+/g, " ").trim();

// Shortens at a word boundary and marks the cut.
export function shorten(s: string, max: number): string {
  const t = oneLine(s);
  if (t.length <= max) return t;
  if (max <= 1) return "…".slice(0, max);
  const cut = t.slice(0, max - 1);
  const at = cut.lastIndexOf(" ");
  return `${(at > max * 0.5 ? cut.slice(0, at) : cut).replace(/[\s,.;:–-]+$/, "")}…`;
}

// The first sentence(s) of a longer purpose text, up to max characters.
function lead(s: string, max: number): string {
  const sentences = oneLine(s).match(/[^.!?]+[.!?]+/g) ?? [oneLine(s)];
  let out = "";
  for (const x of sentences) {
    if ((out + x).length > max) break;
    out += x;
  }
  return shorten(out.trim() || s, max);
}

const sentence = (s: string) => (!s || /[.!?…:]$/.test(s) ? s : `${s}.`);

// Deterministic, honest default per platform. "{link}" marks where the channel link goes.
export function templatePost(platform: PromoPlatform, p: PromoInput): string {
  const audience = oneLine(p.audience) || "mensen in deze situatie";
  const topic = oneLine(p.topic);
  const thanks = p.incentive ? ` Als dank: ${oneLine(p.incentive)}.` : "";
  const mins = p.minutes ? `${p.minutes} ${p.minutes === 1 ? "minuut" : "minuten"}` : "een paar minuten";
  if (p.kind === "survey") {
    // The survey title is shown as a title ("Onderzoek: …"), never squeezed into a sentence.
    const intro = lead(p.purpose, 160);
    const title = /^(onderzoek|enquête)\b/i.test(topic) ? topic : `Onderzoek: ${topic}`;
    switch (platform) {
      case "linkedin":
        return `${title}\n\n${intro}\n\nHoor je bij ${audience}? Dan hoor ik graag hoe het bij jou gaat. Het invullen duurt ongeveer ${mins}. Het is onderzoek: er wordt niets verkocht.${thanks}\n\n{link}\n\nKen je iemand voor wie dit herkenbaar is? Delen wordt erg gewaardeerd.\n\nOnderzoek door ${p.researcher}.`;
      case "linkedin_dm":
        return p.dmIncludesLink
          ? `Hoi {first_name}, ik doe een kort onderzoek onder ${audience}. Zou je ${mins} willen meedenken? Het is echt onderzoek, ik verkoop niets.${thanks} De vragenlijst staat hier: {link}`
          : `Hoi {first_name}, ik doe een kort onderzoek onder ${audience}. Zou je ${mins} willen meedenken? Het is echt onderzoek, ik verkoop niets.${thanks} Als je het goed vindt, stuur ik je de link.`;
      case "instagram":
        return `${title}\n\nHoor jij bij ${audience}? Ik hoor graag hoe het bij jou gaat. ${mins}, en er wordt niets verkocht.${thanks}\n\nMeedoen kan via de link in mijn bio of via {link}\n\n#onderzoek #enquête`;
      case "facebook":
        return `${title}\n\n${intro}\n\nHoor je bij ${audience}? Het invullen duurt ongeveer ${mins} en er wordt niets verkocht.${thanks} Meedoen of doorsturen naar iemand voor wie dit herkenbaar is? Graag!\n\n{link}`;
      case "x":
        return `${sentence(shorten(title, 110))} Hoor je bij ${audience}? ${mins}, niets te koop.${thanks} Meedoen: {link}`;
      case "whatsapp":
        return `Hoi! Ik doe een kort onderzoek en zoek ${audience} die ongeveer ${mins} willen meedenken (${shorten(topic, 100)}). Het is echt onderzoek, er wordt niets verkocht.${thanks} Wil je meedoen of het doorsturen naar iemand voor wie het herkenbaar is?\n\n{link}`;
      case "newsletter":
        return `Denk je mee? ${topic}\n\n${intro}\n\nWe zoeken ${audience} die ongeveer ${mins} willen meedenken. Het is onderzoek: er wordt niets verkocht.${thanks}\n\nNaar de vragenlijst: {link}\n\nOnderzoek door ${p.researcher}.`;
    }
  }
  // Landing and price tests: invite people to look at the offer. Do not call it a test, do not claim it exists.
  const sub = p.purpose ? lead(p.purpose, 300) : "";
  switch (platform) {
    case "linkedin":
      return `We werken aan iets nieuws voor ${audience}: ${topic}\n\n${sub}\n\nBenieuwd of dit iets voor jou is? Bekijk het hier: {link}\n\nIk hoor ook graag wat je ervan vindt.`;
    case "linkedin_dm":
      return p.dmIncludesLink
        ? `Hoi {first_name}, we werken aan iets voor ${audience}: ${sentence(shorten(topic, 120))} Ik ben benieuwd of dit voor jou relevant is. Bekijk het hier: {link}`
        : `Hoi {first_name}, we werken aan iets voor ${audience}: ${sentence(shorten(topic, 120))} Ik ben benieuwd of dit voor jou relevant is. Mag ik je de link sturen?`;
    case "instagram":
      return `${topic}\n\n${sub}\n\nBekijk het via de link in mijn bio of via {link}`;
    case "facebook":
      return `We werken aan iets nieuws voor ${audience}: ${topic}\n\n${sub}\n\nBekijk het hier: {link}`;
    case "x":
      return `Voor ${audience}: ${sentence(topic)} Bekijk het hier: {link}`;
    case "whatsapp":
      return `Hoi! We werken aan iets voor ${audience}: ${sentence(topic)} Ik ben benieuwd wat je ervan vindt. Bekijk het hier: {link}`;
    case "newsletter":
      return `${topic}\n\n${sub}\n\nWe werken hieraan voor ${audience}. Bekijk het hier: {link}`;
  }
}

// Puts the channel link in place (or appends it) and enforces the platform's length, shortening the text and
// never the link. For a first LinkedIn DM without link the placeholder is removed.
export function finalizePost(platform: PromoPlatform, body: string, link: string, opts: { includeLink?: boolean } = {}): string {
  const { max } = PROMO_PLATFORMS[platform];
  const includeLink = platform === "linkedin_dm" ? !!opts.includeLink : true;
  let text = body.replace(/\r\n/g, "\n").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  if (!includeLink) {
    text = text.replaceAll("{link}", "").replaceAll(link, "").replace(/[ \t]{2,}/g, " ").trim();
    return text.length > max ? shorten(text, max) : text;
  }
  if (!text.includes("{link}") && !text.includes(link)) text = `${text}${platform === "x" ? " " : "\n\n"}{link}`;
  text = text.replaceAll(link, "{link}");
  const full = text.replaceAll("{link}", link);
  if (full.length <= max) return full;
  // Too long: keep the link once, at the end, and shorten the words before it.
  const words = text.replaceAll("{link}", " ").replace(/[ \t]{2,}/g, " ").trim();
  const sep = platform === "x" ? " " : "\n\n";
  return `${shorten(words, Math.max(1, max - link.length - sep.length))}${sep}${link}`;
}

export function templatePosts(p: PromoInput, links: Record<PromoPlatform, string>, platforms: readonly PromoPlatform[] = PROMO_PLATFORM_KEYS) {
  return platforms.map((platform) => ({
    platform,
    body: finalizePost(platform, templatePost(platform, p), links[platform], { includeLink: p.dmIncludesLink }),
  }));
}

const SCARCITY = /\b(nog maar|laatste kans|beperkt aantal|beperkte plekken|alleen vandaag|op=op|op is op|wees er snel bij|snel zijn|bijna vol|deadline)\b/i;
const INCENTIVE = /\b(win|winnen|gratis|cadeau|cadeaubon|kans op|verloting|verloten|beloning|korting)\b/i;
const REVEALS_TEST = /\b(test|testpagina|nep|fake|experiment|neppagina)\b/i;
const SELLS = /\b(koop nu|nu kopen|bestel nu|nu bestellen|bestel het|aanbieding|actieprijs)\b/i;

// Warnings for a post (AI or edited by hand). Warnings only: the consultant decides.
export function promoWarnings(platform: PromoPlatform, body: string, p: Pick<PromoInput, "kind" | "incentive">): string[] {
  const out: string[] = [];
  const max = PROMO_PLATFORMS[platform].max;
  if (body.length > max) out.push(`Te lang voor ${PROMO_PLATFORMS[platform].label}: ${body.length} van maximaal ${max} tekens.`);
  if (SCARCITY.test(body)) out.push("Wekt schaarste of tijdsdruk die er niet is.");
  if (!p.incentive && INCENTIVE.test(body)) out.push("Noemt een beloning of iets gratis, terwijl er geen beloning is ingevuld.");
  if (p.kind === "survey" && SELLS.test(body)) out.push("Klinkt als verkoop; een enquête verkoopt niets.");
  if (p.kind !== "survey" && REVEALS_TEST.test(body)) out.push("Verraadt dat het om een test gaat; dat beïnvloedt het gedrag van bezoekers.");
  if (p.kind !== "survey" && SELLS.test(body)) out.push("Vraagt om te kopen of te bestellen; nodig mensen alleen uit om het aanbod te bekijken.");
  return [...out, ...honestyWarnings(body)];
}
