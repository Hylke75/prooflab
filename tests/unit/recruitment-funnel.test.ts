import { describe, expect, it } from "vitest";
import {
  activeBookings,
  buildFunnel,
  deadlineRisk,
  deadlineRiskText,
  describeCount,
  plannedConversations,
  responseClaimText,
  responseRate,
  stepsFor,
  type BookedAppointment,
  type FunnelInput,
} from "@/lib/domain/recruitment-funnel";
import { wilson } from "@/lib/domain/stats";
import { checkQuote } from "@/lib/domain/verify";
import { evidenceTypeError, defaultsForSource } from "@/lib/domain/source-defaults";

// Fase 2 · punt 5: werving bijhouden. Trechter, respons, Wilson, deadline en de tekst van de bevinding.

const NOW = Date.parse("2026-11-10T10:00:00Z");
const DAY = 86_400_000;
const iso = (d: number) => new Date(NOW + d * DAY).toISOString();

function input(over: Partial<FunnelInput> = {}): FunnelInput {
  return { testType: "interview", entries: [], outreach: [], bookings: [], held: [], now: NOW, ...over };
}

describe("buildFunnel", () => {
  it("telt handmatige regels netto per kanaal en stap; een correctie trekt af", () => {
    const f = buildFunnel(
      input({
        entries: [
          { entry_date: "2026-11-02", channel: "linkedin", step: "approached", quantity: 20 },
          { entry_date: "2026-11-05", channel: "linkedin", step: "approached", quantity: 12 },
          { entry_date: "2026-11-06", channel: "linkedin", step: "approached", quantity: -2 },
          { entry_date: "2026-11-06", channel: "linkedin", step: "responded", quantity: 6 },
          { entry_date: "2026-11-07", channel: "linkedin", step: "appointment", quantity: 4 },
          { entry_date: "2026-11-03", channel: "network", step: "approached", quantity: 5 },
        ],
        held: [{ channel: "linkedin", n: 3 }],
      }),
    );
    const li = f.channels.find((c) => c.channel === "linkedin")!;
    expect(li.steps.approached.total).toBe(30);
    expect(li.steps.responded.total).toBe(6);
    expect(li.steps.appointment.total).toBe(4);
    expect(li.steps.held).toEqual({ total: 3, parts: [{ source: "interviews", count: 3 }] });
    expect(li.steps.approached.parts).toEqual([{ source: "manual", count: 30 }]);
    expect(li.period).toEqual({ from: "2026-11-02", to: "2026-11-06" });
    expect(f.totals.approached.total).toBe(35);
    expect(f.held).toBe(3);
    // 4 afspraken, 3 gehouden: 1 gepland.
    expect(f.planned).toBe(1);
    // Kanaal met de meeste benaderden eerst.
    expect(f.channels[0].channel).toBe("linkedin");
  });

  it("telt Expandi als unieke contacten onder outreach, naast handmatige regels", () => {
    const f = buildFunnel(
      input({
        entries: [{ entry_date: "2026-11-01", channel: "outreach", step: "approached", quantity: 10 }],
        outreach: [
          { event_type: "connection_request", contact_hash: "a", received_at: "2026-11-03T08:00:00Z" },
          { event_type: "connection_accepted", contact_hash: "a", received_at: "2026-11-04T08:00:00Z" },
          { event_type: "reply", contact_hash: "a", received_at: "2026-11-05T08:00:00Z" },
          { event_type: "reply", contact_hash: "a", received_at: "2026-11-06T08:00:00Z" },
          { event_type: "message_sent", contact_hash: "b", received_at: "2026-11-04T09:00:00Z" },
          { event_type: "other", contact_hash: "c", received_at: "2026-11-04T09:00:00Z" },
        ],
      }),
    );
    const o = f.channels.find((c) => c.channel === "outreach")!;
    expect(o.steps.approached.parts).toEqual([
      { source: "manual", count: 10 },
      { source: "expandi", count: 2 },
    ]);
    expect(o.steps.responded).toEqual({ total: 1, parts: [{ source: "expandi", count: 1 }] });
    expect(describeCount(o.steps.approached)).toBe("12 (handmatig 10, Expandi 2)");
    expect(o.period).toEqual({ from: "2026-11-01", to: "2026-11-06" });
  });

  it("agenda-afspraken: alleen de laatste boeking per persoon, geannuleerd telt niet", () => {
    const bookings: BookedAppointment[] = [
      { person_key: "p1", status: "booked", booked_at: iso(-3), scheduled_for: iso(2) },
      { person_key: "p2", status: "booked", booked_at: iso(-3), scheduled_for: iso(3) },
      { person_key: "p2", status: "cancelled", booked_at: iso(-1), scheduled_for: iso(3) },
      { person_key: "p3", status: "booked", booked_at: iso(-5), scheduled_for: iso(-1) },
    ];
    expect(activeBookings(bookings).map((b) => b.person_key).sort()).toEqual(["p1", "p3"]);
    const f = buildFunnel(input({ bookings, held: [{ channel: "linkedin", n: 1 }] }));
    expect(f.totals.appointment).toEqual({ total: 2, parts: [{ source: "agenda", count: 2 }] });
    // p1 in de toekomst (gepland); p3 is voorbij en gehouden (1 gesprek).
    expect(f.planned).toBe(1);
    expect(plannedConversations({ manualAppointments: 0, bookings, held: 0, now: NOW })).toBe(2);
  });

  it("andere tests: geen afspraakstap, deelgenomen komt uit de meting", () => {
    expect(stepsFor("landing")).toEqual(["approached", "responded", "held"]);
    const f = buildFunnel(
      input({
        testType: "landing",
        entries: [
          { entry_date: "2026-11-01", channel: "email", step: "approached", quantity: 40 },
          { entry_date: "2026-11-01", channel: "email", step: "appointment", quantity: 3 },
        ],
        held: [{ channel: "email", n: 18 }],
      }),
    );
    const e = f.channels[0];
    expect(e.steps.appointment.total).toBe(0);
    expect(e.steps.held.parts).toEqual([{ source: "measurement", count: 18 }]);
    expect(f.planned).toBe(0);
  });

  it("waarschuwt bij meer reacties dan benaderden en berekent dan geen respons", () => {
    const f = buildFunnel(
      input({
        entries: [
          { entry_date: "2026-11-01", channel: "linkedin", step: "approached", quantity: 3 },
          { entry_date: "2026-11-01", channel: "linkedin", step: "responded", quantity: 5 },
        ],
      }),
    );
    expect(f.channels[0].response).toBeNull();
    expect(f.channels[0].warnings[0]).toMatch(/Meer reacties dan benaderden/);
  });
});

describe("responseRate", () => {
  it("gebruikt het Wilson-interval", () => {
    const r = responseRate(7, 30)!;
    expect(r.rate).toBeCloseTo(7 / 30);
    expect(r.interval).toEqual(wilson(7, 30));
    expect(r.interval.low).toBeCloseTo(0.118, 2);
    expect(r.interval.high).toBeCloseTo(0.409, 2);
  });
  it("geen respons zonder benaderden", () => {
    expect(responseRate(0, 0)).toBeNull();
    expect(responseRate(4, 3)).toBeNull();
  });
});

describe("responseClaimText", () => {
  const f = buildFunnel(
    input({
      entries: [
        { entry_date: "2026-11-01", channel: "linkedin", step: "approached", quantity: 30 },
        { entry_date: "2026-11-14", channel: "linkedin", step: "responded", quantity: 7 },
      ],
    }),
  );
  const text = responseClaimText({ channel: f.channels[0], testTitle: "Interviews sportclubs" })!;

  it("Kanaal X levert Y% respons (n = …, periode …)", () => {
    expect(text.statement).toBe("Kanaal LinkedIn (organisch) levert 23% respons (n = 30, periode 2026-11-01 t/m 2026-11-14).");
    expect(text.period).toBe("2026-11-01 t/m 2026-11-14");
  });

  it("het citaat staat letterlijk in het fragment met alle getallen: de citaatcontrole is exact", () => {
    expect(text.fragment).toContain(text.quote);
    expect(text.fragment).toContain("Benaderd: 30; gereageerd: 7");
    expect(text.fragment).toContain("95%-interval (Wilson): 12% tot 41%");
    expect(checkQuote(text.quote, text.fragment, text.statement)).toBe("exact");
  });

  it("zonder respons geen bevinding", () => {
    const empty = buildFunnel(input({ held: [{ channel: "linkedin", n: 2 }] }));
    expect(responseClaimText({ channel: empty.channels[0], testTitle: "x" })).toBeNull();
  });

  it("eigen registratie: nooit officiële statistiek of primaire bron; standaard waargenomen handeling", () => {
    expect(defaultsForSource("recruitment_log").evidenceType).toBe("observed_action");
    expect(evidenceTypeError("recruitment_log", "official_statistic")).toMatch(/eigen meting/);
    expect(evidenceTypeError("recruitment_log", "primary_document")).toMatch(/eigen meting/);
    expect(evidenceTypeError("recruitment_log", "observed_action")).toBeNull();
  });
});

describe("deadlineRisk", () => {
  const base = { state: "live", held: 2, planned: 0, minSample: 8, startedAt: iso(-10), endsAt: iso(4), decisionDeadline: null, now: NOW };

  it("in gevaar als gehouden + gepland + tempo de steekproef niet haalt", () => {
    const r = deadlineRisk(base);
    expect(r.level).toBe("at_risk");
    expect(r.needed).toBe(6);
    expect(r.projectedExtra).toBe(0); // 2 in 10 dagen: in 4 dagen rond 0 erbij
    expect(deadlineRiskText(r, "interview")).toBe(
      "2 gehouden van minimaal 8 gesprekken: nog 6 gesprekken nodig in 4 dagen tot de einddatum van de test (14 november). In het huidige tempo komen er rond 0 bij.",
    );
  });

  it("geplande gesprekken tellen mee", () => {
    const r = deadlineRisk({ ...base, planned: 6 });
    expect(r.level).toBe("ok");
    const half = deadlineRisk({ ...base, planned: 3 });
    expect(half.level).toBe("at_risk");
    expect(deadlineRiskText(half, "interview")).toMatch(/^2 gehouden \+ 3 gepland van minimaal 8 gesprekken: nog 3 gesprekken nodig/);
  });

  it("een eerdere beslisdatum gaat voor de einddatum", () => {
    const r = deadlineRisk({ ...base, endsAt: iso(30), held: 4, startedAt: iso(-4), decisionDeadline: "2026-11-12" });
    expect(r.deadlineKind).toBe("decision");
    expect(r.level).toBe("at_risk");
    expect(deadlineRiskText(r, "interview")).toContain("tot de beslisdatum (12 november)");
    // Zonder beslisdatum is het tempo genoeg (4 in 4 dagen, nog 30 dagen).
    expect(deadlineRisk({ ...base, endsAt: iso(30), held: 4, startedAt: iso(-4) }).level).toBe("ok");
  });

  it("verstreken deadline", () => {
    const r = deadlineRisk({ ...base, endsAt: iso(-1) });
    expect(r.level).toBe("missed");
    expect(deadlineRiskText(r, "interview")).toMatch(/^De einddatum van de test \(9 november\) is verstreken met 2 gehouden van minimaal 8 gesprekken\.$/);
  });

  it("zonder tempo alleen een risico binnen een week van de deadline", () => {
    expect(deadlineRisk({ ...base, startedAt: iso(-1), held: 0, endsAt: iso(13) }).level).toBe("ok");
    const r = deadlineRisk({ ...base, startedAt: iso(-1), held: 0, endsAt: iso(5) });
    expect(r.level).toBe("at_risk");
    expect(r.projectedExtra).toBeNull();
  });

  it("niets te melden buiten een lopende test of zonder deadline", () => {
    expect(deadlineRisk({ ...base, state: "ended" }).level).toBe("none");
    expect(deadlineRisk({ ...base, endsAt: null }).level).toBe("none");
    expect(deadlineRisk({ ...base, minSample: 0 }).level).toBe("none");
    expect(deadlineRiskText(deadlineRisk({ ...base, held: 8 }), "interview")).toBeNull();
  });

  it("zelfde uitkomst als het oude tempo bij alleen een einddatum (test_pace)", () => {
    // 10 deelnemers in 5 dagen, nog 9 dagen: rond 28 op de einddatum.
    const slow = deadlineRisk({ ...base, held: 10, minSample: 80, startedAt: iso(-5), endsAt: iso(9) });
    expect(slow.level).toBe("at_risk");
    expect(slow.held + (slow.projectedExtra ?? 0)).toBe(28);
    expect(deadlineRisk({ ...base, held: 40, minSample: 80, startedAt: iso(-5), endsAt: iso(9) }).level).toBe("ok");
    expect(deadlineRiskText(slow, "landing")).toMatch(/^10 binnen van minimaal 80 deelnemers: nog 70 deelnemers nodig in 9 dagen/);
  });
});
