// Fase 2 · punt 5: werving bijhouden. Pure functies, geen I/O: de trechter per test en per kanaal, de respons per
// kanaal met Wilson-interval, de tekst van een bevinding "Kanaal X levert Y% respons" en "deadline in gevaar".
//
// Trechter: benaderd → gereageerd → afspraak → gesprek gehouden. Elk getal heeft een herkomst:
// - handmatig: regels uit recruitment_entries (alleen toevoegen; een correctie is een negatieve regel);
// - Expandi: unieke gepseudonimiseerde contacten uit outreach_events van een aan de test gekoppelde campagne;
// - agenda: geboekte afspraken (Calendly/Cal.com, punt 4; tot het samenvoegen leeg);
// - interviews of meting: "gesprek gehouden" is altijd wat de test zelf telt (echte gesprekken met toestemming, of
//   bij andere tests de gemeten deelnemers). Dat getal wordt nooit handmatig ingevoerd.
//
// Kanalen: de vaste lijst CHANNELS (lib/domain/tracking.ts), dezelfde als utm_source en interviews.recruited_via.

import { wilson, type Interval } from "./stats";
import { CHANNELS } from "./tracking";

export const FUNNEL_STEPS = {
  approached: { label: "Benaderd", explain: "Mensen die je hebt benaderd (bericht, uitnodiging, verzoek)." },
  responded: { label: "Gereageerd", explain: "Benaderde mensen die iets terugzeiden, ook een nee." },
  appointment: { label: "Afspraak", explain: "Gemaakte afspraken voor een gesprek." },
  held: { label: "Gesprek gehouden", explain: "Echte gesprekken met toestemming in deze test; telt ProofLab zelf." },
} as const;
export type FunnelStep = keyof typeof FUNNEL_STEPS;
export const FUNNEL_STEP_KEYS = Object.keys(FUNNEL_STEPS) as FunnelStep[];

// Stappen die een consultant zelf registreert. "Gesprek gehouden" hoort daar nooit bij.
export const MANUAL_STEPS = ["approached", "responded", "appointment"] as const;
export type ManualStep = (typeof MANUAL_STEPS)[number];

// Afspraken horen alleen bij interviews; bij andere tests is de laatste stap "deelgenomen" (de meting).
export function stepsFor(testType: string): FunnelStep[] {
  return testType === "interview" ? FUNNEL_STEP_KEYS : ["approached", "responded", "held"];
}
export function manualStepsFor(testType: string): ManualStep[] {
  return testType === "interview" ? [...MANUAL_STEPS] : ["approached", "responded"];
}
export function stepLabel(step: FunnelStep, testType: string): string {
  return step === "held" && testType !== "interview" ? "Deelgenomen" : FUNNEL_STEPS[step].label;
}

export const FUNNEL_SOURCES = {
  manual: "handmatig",
  expandi: "outreachtool",
  agenda: "agenda",
  interviews: "interviews",
  measurement: "meting",
} as const;
export type FunnelSource = keyof typeof FUNNEL_SOURCES;

// Expandi is LinkedIn-outreach; geboekte afspraken hebben (nog) geen kanaal.
export const EXPANDI_CHANNEL = "outreach";
export const AGENDA_CHANNEL = "direct";

export function channelLabel(channel: string): string {
  return CHANNELS[channel as keyof typeof CHANNELS] ?? channel;
}
export const isChannel = (c: unknown): c is keyof typeof CHANNELS => typeof c === "string" && c in CHANNELS;

// ---------------------------------------------------------------------------
// Invoer
// ---------------------------------------------------------------------------

export type ManualEntry = { entry_date: string; channel: string; step: string; quantity: number };
export type OutreachEvent = { event_type: string; contact_hash: string; received_at: string };
// Vorm van test_bookings (punt 4). Een persoon die eerst boekte en daarna annuleerde, telt niet.
export type BookedAppointment = { person_key: string; status: "booked" | "cancelled"; booked_at: string; scheduled_for: string | null };
// Wat de test zelf telt per kanaal: echte gesprekken (interview) of gemeten deelnemers (andere tests).
export type HeldCount = { channel: string; n: number };

export type FunnelInput = {
  testType: string;
  entries: ManualEntry[];
  outreach: OutreachEvent[];
  bookings: BookedAppointment[];
  held: HeldCount[];
  now: number;
};

// ---------------------------------------------------------------------------
// Uitvoer
// ---------------------------------------------------------------------------

export type StepCount = { total: number; parts: { source: FunnelSource; count: number }[] };
export type ResponseRate = { responded: number; approached: number; rate: number; interval: Interval };
export type Period = { from: string; to: string };
export type ChannelFunnel = {
  channel: string;
  label: string;
  steps: Record<FunnelStep, StepCount>;
  // Respons = gereageerd / benaderd. Null zonder benaderden of als er meer reacties dan benaderden zijn.
  response: ResponseRate | null;
  // De dagen waarop benaderd en gereageerd zijn vastgelegd (handmatig of Expandi).
  period: Period | null;
  warnings: string[];
};
export type Funnel = {
  testType: string;
  steps: FunnelStep[];
  channels: ChannelFunnel[];
  totals: Record<FunnelStep, StepCount>;
  // Afspraken die nog niet als gesprek zijn gehouden (zie plannedConversations).
  planned: number;
  held: number;
};

const ACTIVE_OUTREACH = ["connection_request", "connection_accepted", "message_sent", "reply"];
const day = (iso: string) => iso.slice(0, 10);

function emptySteps(): Record<FunnelStep, StepCount> {
  return { approached: { total: 0, parts: [] }, responded: { total: 0, parts: [] }, appointment: { total: 0, parts: [] }, held: { total: 0, parts: [] } };
}

function add(steps: Record<FunnelStep, StepCount>, step: FunnelStep, source: FunnelSource, count: number) {
  if (count === 0) return;
  const s = steps[step];
  s.total += count;
  const part = s.parts.find((p) => p.source === source);
  if (part) part.count += count;
  else s.parts.push({ source, count });
}

// Per persoon de laatste boeking: telt als afspraak als die niet geannuleerd is.
export function activeBookings(bookings: BookedAppointment[]): BookedAppointment[] {
  const latest = new Map<string, BookedAppointment>();
  for (const b of bookings) {
    const prev = latest.get(b.person_key);
    if (!prev || b.booked_at > prev.booked_at) latest.set(b.person_key, b);
  }
  return [...latest.values()].filter((b) => b.status === "booked");
}

export function responseRate(responded: number, approached: number): ResponseRate | null {
  if (approached <= 0 || responded < 0 || responded > approached) return null;
  return { responded, approached, rate: responded / approached, interval: wilson(responded, approached) };
}

// Geplande gesprekken: toekomstige agenda-afspraken, plus de overige afspraken (handmatig en verlopen agenda-afspraken)
// die nog niet als gesprek zijn gehouden. Een verlopen afspraak zonder gesprek telt zo als nog in te halen; dat is
// een bewuste keuze (een gesprek kan later worden ingevoerd), en de melding noemt het "gehouden + gepland".
export function plannedConversations(input: { manualAppointments: number; bookings: BookedAppointment[]; held: number; now: number }): number {
  const active = activeBookings(input.bookings);
  const future = active.filter((b) => b.scheduled_for && new Date(b.scheduled_for).getTime() > input.now).length;
  const past = active.length - future;
  return future + Math.max(0, input.manualAppointments + past - input.held);
}

export function buildFunnel(input: FunnelInput): Funnel {
  const steps = stepsFor(input.testType);
  const byChannel = new Map<string, { steps: Record<FunnelStep, StepCount>; dates: string[] }>();
  const row = (channel: string) => {
    let r = byChannel.get(channel);
    if (!r) {
      r = { steps: emptySteps(), dates: [] };
      byChannel.set(channel, r);
    }
    return r;
  };

  // Handmatig: netto per kanaal en stap (correcties zijn negatieve regels).
  let manualAppointments = 0;
  for (const e of input.entries) {
    if (!(MANUAL_STEPS as readonly string[]).includes(e.step) || !steps.includes(e.step as FunnelStep)) continue;
    const r = row(e.channel);
    add(r.steps, e.step as FunnelStep, "manual", e.quantity);
    if (e.step === "appointment") manualAppointments += e.quantity;
    if (e.step === "approached" || e.step === "responded") r.dates.push(day(e.entry_date));
  }

  // Expandi: unieke contacten. Benaderd = elk contact met een verzoek, bericht, acceptatie of antwoord; gereageerd = antwoord.
  const outreach = input.outreach.filter((o) => ACTIVE_OUTREACH.includes(o.event_type));
  if (outreach.length) {
    const r = row(EXPANDI_CHANNEL);
    add(r.steps, "approached", "expandi", new Set(outreach.map((o) => o.contact_hash)).size);
    add(r.steps, "responded", "expandi", new Set(outreach.filter((o) => o.event_type === "reply").map((o) => o.contact_hash)).size);
    r.dates.push(...outreach.map((o) => day(o.received_at)));
  }

  // Agenda: geboekte, niet geannuleerde afspraken (alleen bij interviews).
  const active = activeBookings(input.bookings);
  if (steps.includes("appointment") && active.length) add(row(AGENDA_CHANNEL).steps, "appointment", "agenda", active.length);

  // Gehouden: wat de test zelf telt.
  const heldSource: FunnelSource = input.testType === "interview" ? "interviews" : "measurement";
  let held = 0;
  for (const h of input.held) {
    if (h.n <= 0) continue;
    add(row(h.channel).steps, "held", heldSource, h.n);
    held += h.n;
  }

  const channels: ChannelFunnel[] = [...byChannel.entries()].map(([channel, r]) => {
    const warnings: string[] = [];
    const a = r.steps.approached.total;
    const re = r.steps.responded.total;
    if (re > a) warnings.push(a === 0 ? "Wel reacties, maar niemand als benaderd geregistreerd: registreer ook wie je benaderde." : "Meer reacties dan benaderden: controleer de registratie.");
    if (steps.includes("appointment") && re > 0 && r.steps.appointment.total > re) warnings.push("Meer afspraken dan reacties: controleer de registratie.");
    const dates = r.dates.sort();
    return {
      channel,
      label: channelLabel(channel),
      steps: r.steps,
      response: responseRate(re, a),
      period: dates.length ? { from: dates[0], to: dates[dates.length - 1] } : null,
      warnings,
    };
  });
  channels.sort((x, y) => y.steps.approached.total - x.steps.approached.total || y.steps.held.total - x.steps.held.total || x.label.localeCompare(y.label));

  const totals = emptySteps();
  for (const c of channels) for (const s of FUNNEL_STEP_KEYS) for (const p of c.steps[s].parts) add(totals, s, p.source, p.count);
  const planned = input.testType === "interview" ? plannedConversations({ manualAppointments, bookings: input.bookings, held, now: input.now }) : 0;
  return { testType: input.testType, steps, channels, totals, planned, held };
}

// "12 (handmatig 8, outreachtool 4)"
export function describeCount(s: StepCount): string {
  if (s.parts.length <= 1) return `${s.total}${s.parts[0] ? ` (${FUNNEL_SOURCES[s.parts[0].source]})` : ""}`;
  return `${s.total} (${s.parts.map((p) => `${FUNNEL_SOURCES[p.source]} ${p.count}`).join(", ")})`;
}

// ---------------------------------------------------------------------------
// Bevinding "Kanaal X levert Y% respons"
// ---------------------------------------------------------------------------

const wholePct = (x: number) => `${Math.round(x * 100)}%`;

export const RECRUITMENT_SOURCE_PUBLISHER = "ProofLab (eigen wervingsregistratie)";

// De bevinding, het citaat en het bronfragment. Het citaat staat letterlijk in het fragment en bevat alle getallen
// van de bevinding, zodat de citaatcontrole exact is (checkQuote).
export function responseClaimText(input: { channel: ChannelFunnel; testTitle: string }): { statement: string; quote: string; fragment: string; period: string } | null {
  const c = input.channel;
  if (!c.response || !c.period) return null;
  const r = c.response;
  const period = c.period.from === c.period.to ? c.period.from : `${c.period.from} t/m ${c.period.to}`;
  const quote = `Kanaal ${c.label} levert ${wholePct(r.rate)} respons (n = ${r.approached}, periode ${period})`;
  const origin = [c.steps.approached, c.steps.responded].some((s) => s.parts.length > 0)
    ? ` Herkomst benaderd: ${describeCount(c.steps.approached)}; gereageerd: ${describeCount(c.steps.responded)}.`
    : "";
  const fragment =
    `Eigen wervingsregistratie, test "${input.testTitle}". ${quote}. ` +
    `Benaderd: ${r.approached}; gereageerd: ${r.responded}; 95%-interval (Wilson): ${wholePct(r.interval.low)} tot ${wholePct(r.interval.high)}.${origin}`;
  return { statement: `${quote}.`, quote, fragment, period };
}

// ---------------------------------------------------------------------------
// Deadline in gevaar
// ---------------------------------------------------------------------------

const DAY = 86_400_000;
// Zonder tempo (test korter dan twee dagen bezig) is een tekort pas een risico als de deadline binnen een week ligt.
export const NO_PACE_WINDOW_DAYS = 7;
export const MIN_PACE_DAYS = 2;

export type DeadlineRisk = {
  level: "ok" | "at_risk" | "missed" | "none";
  held: number;
  planned: number;
  minSample: number;
  needed: number;
  deadline: string | null;
  deadlineKind: "test" | "decision" | null;
  remainingDays: number | null;
  // Extra deelnemers die in het huidige tempo nog bijkomen tot de deadline (null zonder tempo).
  projectedExtra: number | null;
};

// Een beslisdatum (YYYY-MM-DD) geldt tot het eind van die dag.
const deadlineMs = (iso: string) => (iso.length === 10 ? new Date(`${iso}T23:59:59`).getTime() : new Date(iso).getTime());

export function deadlineRisk(input: {
  state: string;
  held: number;
  planned: number;
  minSample: number;
  startedAt: string | null;
  endsAt: string | null;
  decisionDeadline: string | null;
  now: number;
}): DeadlineRisk {
  const base = { held: input.held, planned: input.planned, minSample: input.minSample };
  const needed = Math.max(0, input.minSample - input.held - input.planned);
  const none: DeadlineRisk = { ...base, needed, level: "none", deadline: null, deadlineKind: null, remainingDays: null, projectedExtra: null };
  if (!["live", "paused"].includes(input.state) || input.minSample <= 0) return none;
  const candidates = [
    input.endsAt ? { iso: input.endsAt, kind: "test" as const } : null,
    input.decisionDeadline ? { iso: input.decisionDeadline, kind: "decision" as const } : null,
  ].filter((c): c is { iso: string; kind: "test" | "decision" } => !!c && Number.isFinite(deadlineMs(c.iso)));
  if (candidates.length === 0) return none;
  const first = candidates.sort((a, b) => deadlineMs(a.iso) - deadlineMs(b.iso))[0];
  const remainingDays = (deadlineMs(first.iso) - input.now) / DAY;
  const started = input.startedAt ? new Date(input.startedAt).getTime() : NaN;
  const elapsedDays = Number.isFinite(started) ? (input.now - started) / DAY : 0;
  const projectedExtra = elapsedDays >= MIN_PACE_DAYS && remainingDays > 0 ? Math.floor((input.held / elapsedDays) * remainingDays) : null;
  const out = { ...base, needed, deadline: first.iso, deadlineKind: first.kind, remainingDays, projectedExtra };
  if (needed === 0) return { ...out, level: "ok" };
  if (remainingDays <= 0) return { ...out, level: "missed" };
  const atRisk = projectedExtra != null ? projectedExtra < needed : remainingDays <= NO_PACE_WINDOW_DAYS;
  return { ...out, level: atRisk ? "at_risk" : "ok" };
}

const dateNl = (iso: string) => new Date(iso.length === 10 ? `${iso}T12:00:00` : iso).toLocaleDateString("nl-NL", { day: "numeric", month: "long", timeZone: "Europe/Amsterdam" });
const n = (x: number, one: string, many: string) => `${x} ${x === 1 ? one : many}`;

// Eén zin voor testpagina, Overzicht en coach. Null als er niets te melden is.
export function deadlineRiskText(r: DeadlineRisk, testType: string): string | null {
  if (r.level !== "at_risk" && r.level !== "missed") return null;
  const unit = testType === "interview" ? ["gesprek", "gesprekken"] : ["deelnemer", "deelnemers"];
  const what = r.deadlineKind === "decision" ? `de beslisdatum (${dateNl(r.deadline!)})` : `de einddatum van de test (${dateNl(r.deadline!)})`;
  const done = testType === "interview" ? `${r.held} gehouden${r.planned ? ` + ${r.planned} gepland` : ""}` : `${r.held} binnen`;
  if (r.level === "missed") return `${what.charAt(0).toUpperCase()}${what.slice(1)} is verstreken met ${done} van minimaal ${r.minSample} ${unit[1]}.`;
  const days = Math.max(1, Math.ceil(r.remainingDays ?? 0));
  const pace = r.projectedExtra != null ? ` In het huidige tempo komen er rond ${r.projectedExtra} bij.` : "";
  return `${done} van minimaal ${r.minSample} ${unit[1]}: nog ${n(r.needed, unit[0], unit[1])} nodig in ${n(days, "dag", "dagen")} tot ${what}.${pace}`;
}
