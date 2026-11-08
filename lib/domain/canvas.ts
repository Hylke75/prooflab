// Propositie- en businessmodelcanvas (ontwerp §6.1, §11 /model). Pure functies, zonder database: bouwstenen, herkomst,
// validatie, volgorde, de bewijsstand per onderdeel (via de gekoppelde aanname), overnemen uit intake en onderzoek en de
// vergelijking tussen twee versies. Scherm, server, rapport en tests gebruiken dezelfde regels.
//
// Uitgangspunt: een canvas is een verzameling aannames, geen bewijs. Een gevuld vak zegt niets; de bewijsstand komt
// alleen uit de gekoppelde aanname (status van de hoofdtest, klantbewijs op de bewijsschaal, meetellende bevindingen).
// Een AI-voorstel telt nergens mee tot een consultant het accepteert, en ook daarna is het geen bewijs.

import { EVIDENCE_LEVELS, type EvidenceLevel, type RegisterItem } from "./evidence";
import { scaleLabel, scaleOf, type ScaleStep } from "./evidence-scale";

export type CanvasKind = "business" | "value";

export type CanvasBlock = {
  key: string;
  canvas: CanvasKind;
  label: string;
  // De vraag in gewone taal (simpele weergave en hulptekst in het vak).
  question: string;
  hint: string;
};

// Volgorde = leesvolgorde in de simpele weergave (eerst voor wie en wat, daarna hoe, geld en kosten).
export const BUSINESS_BLOCKS: readonly CanvasBlock[] = [
  { key: "customer_segments", canvas: "business", label: "Klantsegmenten", question: "Voor wie?", hint: "Welke klanten of gebruikers bedienen we, en wie betaalt?" },
  { key: "value_propositions", canvas: "business", label: "Waardepropositie", question: "Wat bieden we en waarom wij?", hint: "Welk probleem lossen we op, en waarom kiezen klanten ons boven hun huidige alternatief?" },
  { key: "channels", canvas: "business", label: "Kanalen", question: "Hoe bereiken we ze?", hint: "Via welke kanalen vinden, kopen en ontvangen klanten het aanbod?" },
  { key: "customer_relationships", canvas: "business", label: "Klantrelaties", question: "Hoe houden we ze?", hint: "Welke relatie verwacht de klant: zelfbediening, persoonlijk, community?" },
  { key: "revenue_streams", canvas: "business", label: "Inkomstenstromen", question: "Waar verdienen we aan?", hint: "Waarvoor betaalt de klant, hoeveel en hoe vaak?" },
  { key: "key_activities", canvas: "business", label: "Kernactiviteiten", question: "Wat moeten we goed doen?", hint: "De belangrijkste dingen die we moeten doen om het aanbod te leveren." },
  { key: "key_resources", canvas: "business", label: "Kernmiddelen", question: "Wat hebben we nodig?", hint: "Mensen, kennis, data, technologie of geld die onmisbaar zijn." },
  { key: "key_partners", canvas: "business", label: "Kernpartners", question: "Met wie werken we samen?", hint: "Leveranciers en partners zonder wie het model niet werkt." },
  { key: "cost_structure", canvas: "business", label: "Kostenstructuur", question: "Wat kost het?", hint: "De grootste vaste en variabele kosten." },
];

// Waardepropositie: klantprofiel (taken, pijnen, winsten) en waardekaart (aanbod, pijnverzachters, winstmakers).
export const VALUE_BLOCKS: readonly CanvasBlock[] = [
  { key: "customer_jobs", canvas: "value", label: "Klanttaken", question: "Wat probeert de klant gedaan te krijgen?", hint: "Taken, problemen en behoeften in het werk of leven van de klant." },
  { key: "pains", canvas: "value", label: "Pijnen", question: "Wat zit de klant dwars?", hint: "Ergernissen, risico's en obstakels bij die taken." },
  { key: "gains", canvas: "value", label: "Winsten", question: "Wat wil de klant bereiken?", hint: "Uitkomsten en voordelen die de klant wil of verwacht." },
  { key: "products_services", canvas: "value", label: "Producten & diensten", question: "Wat bieden we aan?", hint: "Het aanbod waar de waardepropositie op rust." },
  { key: "pain_relievers", canvas: "value", label: "Pijnverzachters", question: "Hoe nemen we pijn weg?", hint: "Hoe het aanbod een specifieke pijn kleiner maakt." },
  { key: "gain_creators", canvas: "value", label: "Winstmakers", question: "Hoe maken we winst mogelijk?", hint: "Hoe het aanbod een gewenste uitkomst dichterbij brengt." },
];

export const CANVAS_BLOCKS: readonly CanvasBlock[] = [...BUSINESS_BLOCKS, ...VALUE_BLOCKS];

export const CANVAS_LABELS: Record<CanvasKind, { label: string; short: string }> = {
  business: { label: "Businessmodel", short: "Businessmodel" },
  value: { label: "Waardepropositie", short: "Waardepropositie" },
};

export const blocksOf = (canvas: CanvasKind): readonly CanvasBlock[] => (canvas === "business" ? BUSINESS_BLOCKS : VALUE_BLOCKS);
export const blockOf = (key: string): CanvasBlock | undefined => CANVAS_BLOCKS.find((b) => b.key === key);
export const isCanvasKind = (v: unknown): v is CanvasKind => v === "business" || v === "value";
export const isBlockOf = (canvas: CanvasKind, block: unknown): boolean => blocksOf(canvas).some((b) => b.key === block);

// De soort aanname bij een bouwsteen (voor "Maak er een aanname van"): klant en aanbod gaan over wenselijkheid,
// activiteiten, middelen en partners over haalbaarheid, inkomsten en kosten over levensvatbaarheid.
export type AssumptionCategoryKey = "desirability" | "feasibility" | "viability" | "context";
const FEASIBILITY = new Set(["key_activities", "key_resources", "key_partners"]);
const VIABILITY = new Set(["revenue_streams", "cost_structure"]);
export function blockCategory(block: string): AssumptionCategoryKey {
  if (FEASIBILITY.has(block)) return "feasibility";
  if (VIABILITY.has(block)) return "viability";
  return "desirability";
}

// Een aanname is één toetsbare bewering van 10 tot 400 tekens (zelfde grens als de aannamekaart).
export const ASSUMPTION_MIN = 10;
export const ASSUMPTION_MAX = 400;
export function validateAssumptionStatement(v: unknown): { ok: true; value: string } | { ok: false; error: string } {
  const t = typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "";
  if (t.length < ASSUMPTION_MIN) return { ok: false, error: "Formuleer de aanname als één toetsbare bewering (minstens 10 tekens)." };
  if (t.length > ASSUMPTION_MAX) return { ok: false, error: `Houd de aanname korter dan ${ASSUMPTION_MAX} tekens (nu ${t.length}).` };
  return { ok: true, value: t };
}

// Bevinding 20: bij "Maak aanname" staat een toetsbare formulering klaar ("We geloven dat …") in plaats van de kale
// tekst van het onderdeel. Deterministisch per bouwsteen; de gebruiker past hem aan vóór het opslaan.
const DRAFT_FRAME: Record<string, string> = {
  customer_segments: "We geloven dat deze klanten het probleem echt ervaren en willen betalen voor een oplossing",
  value_propositions: "We geloven dat klanten dit verkiezen boven hun huidige oplossing",
  products_services: "We geloven dat klanten dit verkiezen boven hun huidige oplossing",
  pain_relievers: "We geloven dat dit de pijn van klanten merkbaar kleiner maakt",
  gain_creators: "We geloven dat dit klanten merkbaar dichter bij hun gewenste uitkomst brengt",
  channels: "We geloven dat we klanten via dit kanaal tegen acceptabele kosten bereiken",
  customer_relationships: "We geloven dat klanten deze vorm van contact willen",
  revenue_streams: "We geloven dat klanten hiervoor willen betalen",
  cost_structure: "We geloven dat deze kosten binnen het budget blijven",
  key_activities: "We geloven dat we dit kunnen organiseren en volhouden",
  key_resources: "We geloven dat we hierover kunnen beschikken",
  key_partners: "We geloven dat deze partner met ons wil samenwerken",
  customer_jobs: "We geloven dat klanten dit echt gedaan willen krijgen",
  pains: "We geloven dat klanten hier echt last van hebben",
  gains: "We geloven dat klanten dit echt willen bereiken",
};
export function assumptionDraft(block: string, body: string): string {
  const b = body.replace(/\s+/g, " ").trim().replace(/[.!?;:,]+$/, "");
  if (!b) return "";
  if (/^(we|wij) (geloven|denken)\b/i.test(b)) return `${b}.`.slice(0, ASSUMPTION_MAX);
  const frame = DRAFT_FRAME[block] ?? "We geloven dat dit klopt";
  const text = `${frame}: ${b}.`;
  return text.length <= ASSUMPTION_MAX ? text : `${text.slice(0, ASSUMPTION_MAX - 1).replace(/\s+\S*$/, "")}.`;
}

// ---------------------------------------------------------------------------
// Herkomst
// ---------------------------------------------------------------------------

export type CanvasOrigin = "manual" | "intake" | "research" | "ai";
export const CANVAS_ORIGINS: Record<CanvasOrigin, string> = {
  manual: "Eigen invoer",
  intake: "Uit de intake",
  research: "Uit het onderzoek",
  ai: "AI-voorstel",
};

export const asCanvasOrigin = (v: unknown): CanvasOrigin => (typeof v === "string" && v in CANVAS_ORIGINS ? (v as CanvasOrigin) : "manual");

// Een AI-voorstel dat nog niet is geaccepteerd: gelabeld, telt nergens mee, niet zichtbaar voor de opdrachtgever.
export const isOpenProposal = (i: { origin: string; accepted: boolean }) => i.origin === "ai" && !i.accepted;

export function originLabel(i: { origin: string; accepted: boolean }): string {
  const o = asCanvasOrigin(i.origin);
  if (o !== "ai") return CANVAS_ORIGINS[o];
  return i.accepted ? "AI-voorstel, geaccepteerd" : "AI-voorstel · nog niet geaccepteerd";
}

// ---------------------------------------------------------------------------
// Validatie
// ---------------------------------------------------------------------------

export const ITEM_MAX = 500;
export const NOTE_MAX = 1000;

export type ItemInput = { canvas: unknown; block: unknown; body: unknown };
export type ValidItem = { canvas: CanvasKind; block: string; body: string };

// De tekst van een onderdeel: één korte bewering of beschrijving, 2 tot 500 tekens, witruimte samengevoegd.
export function validateItem(input: ItemInput): { ok: true; value: ValidItem } | { ok: false; field: "canvas" | "block" | "body"; error: string } {
  if (!isCanvasKind(input.canvas)) return { ok: false, field: "canvas", error: "Onbekend canvas." };
  if (!isBlockOf(input.canvas, input.block)) return { ok: false, field: "block", error: "Kies een bouwsteen van dit canvas." };
  const body = typeof input.body === "string" ? input.body.replace(/\s+/g, " ").trim() : "";
  if (body.length < 2) return { ok: false, field: "body", error: "Schrijf kort op wat hier hoort (minstens twee tekens)." };
  if (body.length > ITEM_MAX) return { ok: false, field: "body", error: `Houd het kort: hooguit ${ITEM_MAX} tekens (nu ${body.length}).` };
  return { ok: true, value: { canvas: input.canvas, block: input.block as string, body } };
}

export function validateNote(note: unknown): { ok: true; value: string } | { ok: false; error: string } {
  const v = typeof note === "string" ? note.trim() : "";
  if (v.length > NOTE_MAX) return { ok: false, error: `De notitie is te lang: hooguit ${NOTE_MAX} tekens (nu ${v.length}).` };
  return { ok: true, value: v };
}

// ---------------------------------------------------------------------------
// Volgorde binnen een bouwsteen
// ---------------------------------------------------------------------------

export type Positioned = { id: string; position: number; createdAt?: string };

export function sortByPosition<T extends Positioned>(items: T[]): T[] {
  return [...items].sort((a, b) => a.position - b.position || (a.createdAt ?? "").localeCompare(b.createdAt ?? "") || a.id.localeCompare(b.id));
}

// Eén plek omhoog of omlaag; geeft de nieuwe positie (0, 1, 2, …) van elk onderdeel dat verandert. Leeg als er niets
// te verschuiven is (al bovenaan/onderaan of onbekend onderdeel). Hernummert ook gaten en dubbele posities.
export function moveItem(items: Positioned[], id: string, direction: "up" | "down"): { id: string; position: number }[] {
  const list = sortByPosition(items);
  const i = list.findIndex((x) => x.id === id);
  const j = direction === "up" ? i - 1 : i + 1;
  if (i < 0 || j < 0 || j >= list.length) return [];
  [list[i], list[j]] = [list[j], list[i]];
  const byId = new Map(items.map((x) => [x.id, x.position]));
  return list.map((x, n) => ({ id: x.id, position: n })).filter((x) => byId.get(x.id) !== x.position);
}

// De positie voor een nieuw onderdeel: onderaan de bouwsteen.
export const nextPosition = (items: Positioned[]): number => (items.length ? Math.max(...items.map((x) => x.position)) + 1 : 0);

// ---------------------------------------------------------------------------
// Bewijsstand per onderdeel (via de gekoppelde aanname)
// ---------------------------------------------------------------------------

export type StandingKey = "proposal" | "unlinked" | "belief" | "sourced" | "customer" | "testing" | "supported" | "refuted" | "inconclusive";
// De drie groepen die het canvas zichtbaar maakt: getoetst, onderbouwd of nog geloof. Een open AI-voorstel apart.
export type StandingGroup = "tested" | "sourced" | "belief" | "proposal";

export const STANDING_GROUPS: Record<StandingGroup, { label: string; pill: string; explain: string }> = {
  tested: { label: "Getoetst", pill: "green", explain: "De gekoppelde aanname heeft klantbewijs of een uitslag van de hoofdtest." },
  sourced: { label: "Onderbouwd", pill: "blue", explain: "De gekoppelde aanname steunt op meetellende bevindingen uit bronnen, nog niet op klantbewijs." },
  belief: { label: "Nog geloof", pill: "gray", explain: "Nog niet gekoppeld aan een aanname, of de aanname heeft nog geen meetellend bewijs." },
  proposal: { label: "AI-voorstel", pill: "orange", explain: "Nog niet geaccepteerd door een consultant. Telt nergens mee en is nooit bewijs." },
};

export type AssumptionEvidence = {
  id: string;
  statement: string;
  status: string; // untested | testing | supported | refuted | inconclusive
  register: Pick<RegisterItem, "itemType" | "fate" | "direction" | "level" | "notes">[];
};

export type ItemStanding = {
  key: StandingKey;
  group: StandingGroup;
  label: string;
  pill: string;
  detail: string;
  step: ScaleStep; // hoogste klantbewijs op de bewijsschaal (verkenning zonder)
  counts: { deskFor: number; deskAgainst: number; customerFor: number; customerAgainst: number };
};

const LEVEL_RANK = new Map<EvidenceLevel, number>(EVIDENCE_LEVELS.map((l, i) => [l.level, i]));

// Volwaardig klantbewijs voor de trede (zoals de Stand van het bewijs): meetellend, ondersteunend, geen half gewicht.
const fullCustomerSupport = (i: AssumptionEvidence["register"][number]) =>
  i.itemType === "observation" && i.fate === "counted" && i.direction === "supports" && !i.notes.includes("ai_half");

export function evidenceCounts(register: AssumptionEvidence["register"]) {
  const counted = register.filter((i) => i.fate === "counted");
  return {
    deskFor: counted.filter((i) => i.itemType === "claim" && i.direction === "supports").length,
    deskAgainst: counted.filter((i) => i.itemType === "claim" && i.direction === "contradicts").length,
    customerFor: counted.filter((i) => i.itemType === "observation" && i.direction === "supports").length,
    customerAgainst: counted.filter((i) => i.itemType === "observation" && i.direction === "contradicts").length,
  };
}

function highestCustomerLevel(register: AssumptionEvidence["register"]): EvidenceLevel | null {
  let best: EvidenceLevel | null = null;
  for (const i of register) if (fullCustomerSupport(i) && (best == null || (LEVEL_RANK.get(i.level) ?? 0) > (LEVEL_RANK.get(best) ?? 0))) best = i.level;
  return best;
}

const ZERO = { deskFor: 0, deskAgainst: 0, customerFor: 0, customerAgainst: 0 };

// De bewijsstand van één onderdeel. Volgorde: open AI-voorstel → niet gekoppeld → uitslag van de hoofdtest (status) →
// klantbewijs → bevindingen uit bronnen → geloof. Tegenbewijs staat altijd in de toelichting.
export function itemStanding(item: { origin: string; accepted: boolean; assumptionId: string | null }, a: AssumptionEvidence | null | undefined): ItemStanding {
  const mk = (key: StandingKey, group: StandingGroup, label: string, detail: string, step: ScaleStep = "exploration", counts = ZERO): ItemStanding => ({
    key,
    group,
    label,
    pill: key === "refuted" ? "coral" : key === "inconclusive" ? "orange" : key === "testing" ? "blue" : STANDING_GROUPS[group].pill,
    detail,
    step,
    counts,
  });
  if (isOpenProposal(item)) return mk("proposal", "proposal", "AI-voorstel", "Nog niet geaccepteerd door een consultant; telt nergens mee.");
  if (!item.assumptionId) return mk("unlinked", "belief", "Nog geloof", "Niet gekoppeld aan een aanname: er is niets over getoetst.");
  if (!a) return mk("unlinked", "belief", "Nog geloof", "De gekoppelde aanname is niet (meer) gevonden.");
  const counts = evidenceCounts(a.register);
  const step = scaleOf(highestCustomerLevel(a.register));
  const against = counts.deskAgainst + counts.customerAgainst;
  const againstText = against ? ` Er is ook tegenbewijs (${against}).` : "";
  if (a.status === "supported") return mk("supported", "tested", "Getoetst · ondersteund", `De hoofdtest van de aanname is geslaagd. Sterkste klantbewijs: ${scaleLabel(step).toLowerCase()}.${againstText}`, step, counts);
  if (a.status === "refuted") return mk("refuted", "tested", "Getoetst · weerlegd", `De hoofdtest van de aanname is niet geslaagd: dit deel van het model klopt waarschijnlijk niet.${againstText}`, step, counts);
  if (a.status === "inconclusive") return mk("inconclusive", "tested", "Getoetst · onbeslist", `De hoofdtest gaf geen duidelijke uitslag.${againstText}`, step, counts);
  if (step !== "exploration") {
    return mk("customer", "tested", `Klantbewijs · ${scaleLabel(step).toLowerCase()}`, `${counts.customerFor} meetellende klantwaarneming${counts.customerFor === 1 ? "" : "en"}; nog geen uitslag van een hoofdtest.${againstText}`, step, counts);
  }
  if (a.status === "testing") return mk("testing", "belief", "Wordt getest", `Er loopt een test, maar er is nog geen meetellend klantbewijs.${againstText}`, step, counts);
  if (counts.deskFor > 0) {
    return mk("sourced", "sourced", "Onderbouwd met bronnen", `${counts.deskFor} meetellende bevinding${counts.deskFor === 1 ? "" : "en"} uit bureauonderzoek; nog geen klantbewijs.${againstText}`, step, counts);
  }
  return mk("belief", "belief", "Nog geloof", `De aanname heeft nog geen meetellend bewijs.${againstText}`, step, counts);
}

export type StandingSummary = Record<StandingGroup, number> & { total: number };

// Hoeveel onderdelen getoetst, onderbouwd of nog geloof zijn. Bewust geen "percentage ingevuld" (ontwerp §14: niet sturen
// op vulling van het canvas).
export function standingSummary(standings: Pick<ItemStanding, "group">[]): StandingSummary {
  const s: StandingSummary = { tested: 0, sourced: 0, belief: 0, proposal: 0, total: standings.length };
  for (const x of standings) s[x.group] += 1;
  return s;
}

export function summaryLine(s: StandingSummary): string {
  const counted = s.total - s.proposal;
  if (counted === 0) return s.proposal ? `${s.proposal} AI-voorstel${s.proposal === 1 ? "" : "len"} wacht${s.proposal === 1 ? "" : "en"} op beoordeling; nog geen eigen onderdelen.` : "Nog geen onderdelen.";
  const parts = [`${s.tested} getoetst`, `${s.sourced} onderbouwd met bronnen`, `${s.belief} nog geloof`];
  return `${counted} onderde${counted === 1 ? "el" : "len"}: ${parts.join(", ")}${s.proposal ? ` · ${s.proposal} AI-voorstel${s.proposal === 1 ? "" : "len"} nog niet geaccepteerd` : ""}.`;
}

// ---------------------------------------------------------------------------
// Overnemen uit intake en onderzoek (deterministisch, zonder AI)
// ---------------------------------------------------------------------------

export type DraftItem = { canvas: CanvasKind; block: string; body: string; origin: "intake" | "research"; sourceRef: string };

export type ImportSources = {
  idea: { target_audience?: string | null; audience_detail?: string | null; description?: string | null; offer_price?: string | null };
  segments: { id: string; label: string; role?: string | null; job_to_be_done?: string | null; pain?: string | null }[];
  // Klantsignalen uit reviews, fora en outreach (soort job, pain, gain, objection).
  signals: { id: string; kind: string; label: string }[];
};

// Rollen van een segment (tabel segments): gebruiker, betaler/beslisser, aanbodzijde, overig.
const ROLE_LABEL: Record<string, string> = { user: "gebruiker", buyer: "betaler / beslisser", supplier: "aanbodzijde" };

const clip = (s: string, max = ITEM_MAX) => {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length <= max ? t : `${t.slice(0, max - 1).trimEnd()}…`;
};

// Wat ProofLab al weet, als voorstel voor het canvas: de doelgroep en het aanbod uit de intake, segmenten met hun taak en
// pijn uit het klantonderzoek en klantsignalen (taak, pijn, winst). Elk voorstel draagt zijn bron (sourceRef), zodat
// opnieuw overnemen niets dubbel toevoegt. Het blijft een aanname tot het gekoppeld en getoetst is.
export function draftsFromSources(src: ImportSources): DraftItem[] {
  const out: DraftItem[] = [];
  const add = (canvas: CanvasKind, block: string, body: string | null | undefined, origin: DraftItem["origin"], sourceRef: string) => {
    const t = clip(body ?? "");
    if (t.length >= 2) out.push({ canvas, block, body: t, origin, sourceRef });
  };
  const audience = [src.idea.target_audience, src.idea.audience_detail].map((x) => x?.trim()).filter(Boolean).join(" — ");
  add("business", "customer_segments", audience, "intake", "intake:audience");
  add("business", "value_propositions", src.idea.description, "intake", "intake:description");
  add("value", "products_services", src.idea.description, "intake", "intake:offer");
  if (src.idea.offer_price?.trim()) add("business", "revenue_streams", `Prijs uit de intake: ${src.idea.offer_price.trim()}`, "intake", "intake:price");
  for (const s of src.segments) {
    const role = s.role && ROLE_LABEL[s.role] ? ` (${ROLE_LABEL[s.role]})` : "";
    add("business", "customer_segments", `${s.label}${role}`, "research", `segment:${s.id}`);
    add("value", "customer_jobs", s.job_to_be_done, "research", `segment-job:${s.id}`);
    add("value", "pains", s.pain, "research", `segment-pain:${s.id}`);
  }
  const SIGNAL_BLOCK: Record<string, string> = { job: "customer_jobs", pain: "pains", gain: "gains" };
  for (const g of src.signals) if (SIGNAL_BLOCK[g.kind]) add("value", SIGNAL_BLOCK[g.kind], g.label, "research", `signal:${g.id}`);
  return out;
}

// ---------------------------------------------------------------------------
// Versies vergelijken
// ---------------------------------------------------------------------------

export type VersionItem = {
  id: string;
  canvas: CanvasKind;
  block: string;
  body: string;
  position?: number;
  origin?: string;
  accepted?: boolean;
  assumption_id?: string | null;
  assumption_statement?: string | null;
  assumption_status?: string | null;
};

export function asVersionItems(v: unknown): VersionItem[] {
  if (!Array.isArray(v)) return [];
  return v.filter(
    (x): x is VersionItem => !!x && typeof x === "object" && typeof (x as VersionItem).id === "string" && isCanvasKind((x as VersionItem).canvas) && typeof (x as VersionItem).block === "string" && typeof (x as VersionItem).body === "string",
  );
}

export type ChangeKind = "added" | "removed" | "changed";
export type ItemChange = { kind: ChangeKind; id: string; body: string; before?: string; what: string[] };
export type BlockDiff = { block: CanvasBlock; changes: ItemChange[] };
export type CanvasDiff = { blocks: BlockDiff[]; added: number; removed: number; changed: number };

// Vergelijkt twee momentopnamen (oud → nieuw) per bouwsteen. Onderdelen worden op id gevolgd: nieuw = toegevoegd,
// weg = verwijderd, zelfde id met andere tekst, bouwsteen, koppeling of acceptatie = gewijzigd. Alleen een andere
// volgorde telt niet als wijziging. Een onderdeel dat naar een andere bouwsteen ging, staat bij de nieuwe bouwsteen.
export function diffVersions(before: VersionItem[], after: VersionItem[], canvas?: CanvasKind): CanvasDiff {
  const inCanvas = (i: VersionItem) => !canvas || i.canvas === canvas;
  const a = new Map(before.filter(inCanvas).map((i) => [i.id, i]));
  const b = new Map(after.filter(inCanvas).map((i) => [i.id, i]));
  const changes = new Map<string, ItemChange[]>();
  const push = (block: string, c: ItemChange) => changes.set(block, [...(changes.get(block) ?? []), c]);
  for (const [id, n] of b) {
    const o = a.get(id);
    if (!o) {
      push(n.block, { kind: "added", id, body: n.body, what: [] });
      continue;
    }
    const what: string[] = [];
    if (o.body !== n.body) what.push("tekst");
    if (o.block !== n.block) what.push(`verplaatst van ${blockOf(o.block)?.label ?? o.block}`);
    if ((o.assumption_id ?? null) !== (n.assumption_id ?? null)) what.push(n.assumption_id ? (o.assumption_id ? "andere aanname gekoppeld" : "aan aanname gekoppeld") : "koppeling met aanname verwijderd");
    else if (n.assumption_id && (o.assumption_status ?? null) !== (n.assumption_status ?? null)) what.push("status van de aanname veranderd");
    if (!!o.accepted !== !!n.accepted && n.origin === "ai") what.push(n.accepted ? "AI-voorstel geaccepteerd" : "acceptatie vervallen");
    if (what.length) push(n.block, { kind: "changed", id, body: n.body, before: o.body !== n.body ? o.body : undefined, what });
  }
  for (const [id, o] of a) if (!b.has(id)) push(o.block, { kind: "removed", id, body: o.body, what: [] });
  const order = canvas ? blocksOf(canvas) : CANVAS_BLOCKS;
  const blocks = order.filter((bl) => changes.has(bl.key)).map((bl) => ({ block: bl, changes: changes.get(bl.key)! }));
  const all = blocks.flatMap((x) => x.changes);
  return { blocks, added: all.filter((c) => c.kind === "added").length, removed: all.filter((c) => c.kind === "removed").length, changed: all.filter((c) => c.kind === "changed").length };
}

export function diffLine(d: CanvasDiff): string {
  if (!d.added && !d.removed && !d.changed) return "Geen verschillen.";
  const p = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  return [p(d.added, "toegevoegd", "toegevoegd"), p(d.removed, "verwijderd", "verwijderd"), p(d.changed, "gewijzigd", "gewijzigd")].join(" · ");
}

// ---------------------------------------------------------------------------
// Rapport: compacte weergave met de bewijsstand per onderdeel
// ---------------------------------------------------------------------------

export type ReportCanvas = {
  version: 1;
  summary: string;
  latestVersion: { number: number; at: string; author: string } | null;
  canvases: { canvas: CanvasKind; label: string; blocks: { label: string; items: { body: string; origin: string; standing: string; group: StandingGroup }[] }[] }[];
  openProposals: number;
};

// Alleen onderdelen die een mens heeft ingevoerd, overgenomen of geaccepteerd; open AI-voorstellen worden geteld, niet
// getoond. Lege bouwstenen blijven weg (een lege bouwsteen is "onbekend", geen fout).
export function reportCanvas(
  items: { canvas: CanvasKind; block: string; body: string; position: number; origin: string; accepted: boolean; standing: ItemStanding }[],
  latestVersion: ReportCanvas["latestVersion"],
): ReportCanvas | null {
  const shown = items.filter((i) => !isOpenProposal(i));
  const openProposals = items.length - shown.length;
  if (shown.length === 0 && openProposals === 0) return null;
  const canvases = (["business", "value"] as CanvasKind[])
    .map((canvas) => ({
      canvas,
      label: CANVAS_LABELS[canvas].label,
      blocks: blocksOf(canvas)
        .map((bl) => ({
          label: bl.label,
          items: [...shown]
            .filter((i) => i.canvas === canvas && i.block === bl.key)
            .sort((x, y) => x.position - y.position)
            .map((i) => ({ body: i.body, origin: originLabel(i), standing: i.standing.label, group: i.standing.group })),
        }))
        .filter((bl) => bl.items.length > 0),
    }))
    .filter((c) => c.blocks.length > 0);
  return { version: 1, summary: summaryLine(standingSummary(items.map((i) => i.standing))), latestVersion, canvases, openProposals };
}

export function asReportCanvas(v: unknown): ReportCanvas | null {
  const c = v as Partial<ReportCanvas> | null | undefined;
  return c && c.version === 1 && Array.isArray(c.canvases) && typeof c.summary === "string" ? (c as ReportCanvas) : null;
}
