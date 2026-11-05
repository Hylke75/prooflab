import "server-only";
import { supabaseServer } from "@/lib/supabase/server";
import { experimentMetrics } from "@/lib/experiment-metrics";
import { decisive } from "@/lib/domain/customer-research";
import {
  buildFunnel,
  deadlineRisk,
  deadlineRiskText,
  plannedConversations,
  type BookedAppointment,
  type DeadlineRisk,
  type Funnel,
  type HeldCount,
  type ManualEntry,
  type OutreachEvent,
} from "@/lib/domain/recruitment-funnel";

// Fase 2 · punt 5: de gegevens voor de wervingstrechter. De berekening zelf staat in lib/domain/recruitment-funnel.ts.
// Zonder migratie 20261117090000_fase2_werving.sql ontbreken de tabellen: dan telt de trechter alleen wat de test
// zelf meet (interviews of deelnemers) en meldt de pagina dat de registratie nog niet beschikbaar is.

export const NOT_MIGRATED = "De wervingsregistratie is nog niet beschikbaar: de database moet eerst worden bijgewerkt (migratie 20261117090000_fase2_werving.sql).";

// ---------------------------------------------------------------------------
// Agenda (punt 4)
// ---------------------------------------------------------------------------

// Geboekte afspraken uit Calendly/Cal.com voor één test.
// LET OP: wordt na samenvoegen met punt 4 gekoppeld aan test_bookings (kolommen person_key, status 'booked' of
// 'cancelled', booked_at, scheduled_for). Tot dan bestaat die tabel in deze branch niet en is de lijst leeg; de
// trechter en "deadline in gevaar" rekenen er al mee (bron "agenda", toekomstige afspraken tellen als gepland).
export async function loadBookedAppointments(experimentId: string): Promise<BookedAppointment[]> {
  void experimentId;
  return [];
}

// ---------------------------------------------------------------------------
// Testpagina
// ---------------------------------------------------------------------------

export type EntryRow = ManualEntry & { id: string; note: string | null; corrects_id: string | null; created_at: string };

export type RecruitmentView = {
  // false: de tabellen ontbreken (migratie niet toegepast). De trechter bevat dan alleen automatische getallen.
  available: boolean;
  funnel: Funnel;
  entries: EntryRow[];
  // Gekoppelde Expandi-campagnes van deze test, en campagnes uit het dossier die nog aan geen test hangen.
  campaigns: { id: string; campaign: string }[];
  campaignOptions: string[];
  risk: DeadlineRisk;
};

const PAGE = 1000;
const MAX_EVENTS = 20000;

type Db = Awaited<ReturnType<typeof supabaseServer>>;

// Alle outreach-gebeurtenissen van het dossier (gepagineerd: één select is begrensd). Alleen het team mag ze lezen.
async function outreachOfIdea(db: Db, ideaId: string): Promise<(OutreachEvent & { campaign: string | null })[]> {
  const rows: (OutreachEvent & { campaign: string | null })[] = [];
  for (let from = 0; from < MAX_EVENTS; from += PAGE) {
    const { data, error } = await db
      .from("outreach_events")
      .select("id, event_type, contact_hash, campaign, received_at")
      .eq("idea_id", ideaId)
      .order("id")
      .range(from, from + PAGE - 1);
    if (error) break;
    rows.push(...(data ?? []).map((r) => ({ event_type: r.event_type, contact_hash: r.contact_hash, campaign: r.campaign, received_at: r.received_at })));
    if ((data ?? []).length < PAGE) break;
  }
  return rows;
}

export async function loadRecruitment(input: {
  ideaId: string;
  exp: { id: string; type: string; state: string; started_at: string | null; ends_at: string | null };
  minSample: number;
  held: HeldCount[];
  decisionDeadline: string | null;
  now?: number;
}): Promise<RecruitmentView> {
  const db = await supabaseServer();
  const now = input.now ?? Date.now();
  const [entriesRes, linksRes, allLinksRes, bookings] = await Promise.all([
    db.from("recruitment_entries").select("id, entry_date, channel, step, quantity, note, corrects_id, created_at").eq("experiment_id", input.exp.id).order("created_at"),
    db.from("recruitment_campaigns").select("id, campaign").eq("experiment_id", input.exp.id).order("created_at"),
    db.from("recruitment_campaigns").select("campaign").eq("idea_id", input.ideaId),
    loadBookedAppointments(input.exp.id),
  ]);
  const available = !entriesRes.error && !linksRes.error;
  const entries: EntryRow[] = available ? (entriesRes.data ?? []) : [];
  const campaigns = available ? (linksRes.data ?? []) : [];
  const events = available ? await outreachOfIdea(db, input.ideaId) : [];
  const linked = new Set(campaigns.map((c) => c.campaign));
  const taken = new Set((allLinksRes.data ?? []).map((c) => c.campaign));
  const campaignOptions = [...new Set(events.map((e) => e.campaign?.trim()).filter((c): c is string => !!c && !taken.has(c)))].sort();
  const funnel = buildFunnel({
    testType: input.exp.type,
    entries,
    outreach: events.filter((e) => e.campaign && linked.has(e.campaign.trim())),
    bookings,
    held: input.held,
    now,
  });
  const risk = deadlineRisk({
    state: input.exp.state,
    held: funnel.held,
    planned: funnel.planned,
    minSample: input.minSample,
    startedAt: input.exp.started_at,
    endsAt: input.exp.ends_at,
    decisionDeadline: input.decisionDeadline,
    now,
  });
  return { available, funnel, entries, campaigns, campaignOptions, risk };
}

// ---------------------------------------------------------------------------
// Coach en Overzicht
// ---------------------------------------------------------------------------

// Geplande gesprekken per interviewtest (handmatige afspraken + agenda − gehouden). Tests zonder registratie: 0.
// Zonder tabel (migratie niet toegepast) is de kaart leeg en rekent iedereen zoals voorheen.
export async function plannedByExperiment(ideaId: string, tests: { id: string; type: string; held: number }[], now = Date.now()): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const interviews = tests.filter((t) => t.type === "interview");
  if (interviews.length === 0) return out;
  try {
    return await plannedFor(ideaId, interviews, now, out);
  } catch {
    return new Map();
  }
}

async function plannedFor(ideaId: string, interviews: { id: string; held: number }[], now: number, out: Map<string, number>): Promise<Map<string, number>> {
  const db = await supabaseServer();
  const { data, error } = await db.from("recruitment_entries").select("experiment_id, quantity").eq("idea_id", ideaId).eq("step", "appointment");
  const appointments = new Map<string, number>();
  if (!error) for (const r of data ?? []) appointments.set(r.experiment_id, (appointments.get(r.experiment_id) ?? 0) + r.quantity);
  await Promise.all(
    interviews.map(async (t) => {
      const planned = plannedConversations({ manualAppointments: appointments.get(t.id) ?? 0, bookings: await loadBookedAppointments(t.id), held: t.held, now });
      if (planned > 0) out.set(t.id, planned);
    }),
  );
  return out;
}

export type TestDeadlineRisk = { id: string; title: string; type: string; risk: DeadlineRisk; text: string };

// Lopende tests waarvan de steekproef de deadline (einddatum of beslisdatum) waarschijnlijk niet haalt. Voor de
// compacte regel op Overzicht. Verkennend onderzoek (zonder drempel) beslist niets en valt erbuiten.
export async function loadDeadlineRisks(ideaId: string, decisionDeadline: string | null): Promise<TestDeadlineRisk[]> {
  try {
    const db = await supabaseServer();
    const { data: exps } = await db
      .from("experiments")
      .select("id, idea_id, title, type, state, config, started_at, ends_at, ended_at, recruitment_group, hypotheses(*)")
      .eq("idea_id", ideaId)
      .in("state", ["live", "paused"]);
    const running = (exps ?? []).map((e) => ({ e, h: decisive(e.hypotheses) })).filter((x) => !!x.h);
    if (running.length === 0) return [];
    const metrics = await Promise.all(running.map(({ e, h }) => experimentMetrics(e, h!)));
    const planned = await plannedByExperiment(ideaId, running.map(({ e }, i) => ({ id: e.id, type: e.type, held: metrics[i].n })));
    const now = Date.now();
    return running
      .map(({ e, h }, i) => {
        const risk = deadlineRisk({
          state: e.state,
          held: metrics[i].n,
          planned: planned.get(e.id) ?? 0,
          minSample: h!.min_sample,
          startedAt: e.started_at,
          endsAt: e.ends_at,
          decisionDeadline,
          now,
        });
        return { id: e.id, title: e.title, type: e.type, risk, text: deadlineRiskText(risk, e.type) ?? "" };
      })
      .filter((r) => r.text !== "")
      .sort((a, b) => (a.risk.remainingDays ?? 0) - (b.risk.remainingDays ?? 0));
  } catch {
    return [];
  }
}
