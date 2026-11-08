import { describe, expect, it } from "vitest";
import {
  evidenceFileName,
  manualOutcome,
  manualSummary,
  sniffEvidence,
  tallyManual,
  validateManualEntry,
  validateWithdrawReason,
} from "@/lib/domain/manual-results";
import { methodOf } from "@/lib/domain/method";


// Experimentencatalogus: handmatig ingevoerde resultaten → telling → oordeel volgens de vooraf vastgelegde beslisregel.

const row = (units: number, successes: number, extra: Partial<{ withdrawn_at: string | null; evidence_path: string | null }> = {}) => ({
  units,
  successes,
  withdrawn_at: null,
  evidence_path: null,
  ...extra,
});

describe("invoer", () => {
  const ok = { observed_on: "2026-11-10", units: 12, successes: 3, note: "Dagdeel ochtend bij de ingang, telformulier A", today: "2026-11-12", startedOn: "2026-11-08" };
  it("een geldige regel", () => {
    expect(validateManualEntry(ok)).toEqual({});
    expect(validateManualEntry({ ...ok, successes: 0 })).toEqual({});
    expect(validateManualEntry({ ...ok, observed_on: "2026-11-08" })).toEqual({});
  });
  it("geen datum in de toekomst en niets van vóór de start", () => {
    expect(validateManualEntry({ ...ok, observed_on: "2026-11-13" }).observed_on).toMatch(/toekomst/);
    expect(validateManualEntry({ ...ok, observed_on: "2026-11-07" }).observed_on).toMatch(/start/);
    expect(validateManualEntry({ ...ok, observed_on: "12-11-2026" }).observed_on).toBeTruthy();
  });
  it("aantallen: minstens 1, successen niet meer dan het aantal", () => {
    expect(validateManualEntry({ ...ok, units: 0 }).units).toBeTruthy();
    expect(validateManualEntry({ ...ok, units: null }).units).toBeTruthy();
    expect(validateManualEntry({ ...ok, units: 2.5 }).units).toBeTruthy();
    expect(validateManualEntry({ ...ok, successes: 13 }).successes).toMatch(/niet meer/);
    expect(validateManualEntry({ ...ok, successes: -1 }).successes).toBeTruthy();
  });
  it("een notitie zonder contactgegevens", () => {
    expect(validateManualEntry({ ...ok, note: "ok" }).note).toBeTruthy();
    expect(validateManualEntry({ ...ok, note: "Mail van jan@club.nl, wil meedoen" }).note).toMatch(/e-mailadres/i);
    expect(validateManualEntry({ ...ok, note: "Belde vanaf 06-12345678 terug" }).note).toBeTruthy();
  });
  it("een bewijsbestand: alleen bekende typen en hooguit 4 MB", () => {
    expect(validateManualEntry({ ...ok, evidence: { mime: "application/pdf", size: 1000 } })).toEqual({});
    expect(validateManualEntry({ ...ok, evidence: { mime: "onbekend", size: 1000 } }).evidence).toBeTruthy();
    expect(validateManualEntry({ ...ok, evidence: { mime: "image/png", size: 5 * 1024 * 1024 } }).evidence).toMatch(/4 MB/);
  });
  it("intrekken vraagt een reden", () => {
    expect(validateWithdrawReason("fout")).toBeTruthy();
    expect(validateWithdrawReason("Dubbel ingevoerd, zie regel van dinsdag")).toBeNull();
  });
  it("het bestandstype volgt de inhoud", () => {
    expect(sniffEvidence(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]), "image/png")).toBe("application/pdf");
    expect(sniffEvidence(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d]), "")).toBe("image/png");
    expect(sniffEvidence(new TextEncoder().encode("datum;aantal\n2026-11-10;12\n"), "text/csv")).toBe("text/csv");
    expect(sniffEvidence(new TextEncoder().encode("datum;aantal"), "application/x-msdownload")).toBeNull();
    expect(sniffEvidence(new Uint8Array([0x4d, 0x5a, 0x00, 0x00]), "text/csv")).toBeNull();
    expect(evidenceFileName("Telformulier dag 1 (ochtend).PDF", "application/pdf")).toBe("Telformulier-dag-1-ochtend.pdf");
    expect(evidenceFileName("../../etc/passwd", "text/csv")).toBe("etc-passwd.csv");
  });
});

describe("telling", () => {
  it("telt eenheden en successen; ingetrokken regels tellen niet", () => {
    expect(tallyManual([row(10, 2), row(5, 5, { evidence_path: "a/b/c" }), row(100, 100, { withdrawn_at: "2026-11-10T10:00:00Z" })])).toEqual({
      n: 15,
      successes: 7,
      entries: 2,
      withdrawn: 1,
      withEvidence: 1,
    });
    expect(tallyManual([])).toEqual({ n: 0, successes: 0, entries: 0, withdrawn: 0, withEvidence: 0 });
  });
  it("de samenvatting zegt altijd dat het handmatig is ingevoerd", () => {
    const s = manualSummary({ methodName: "Conciërgetest", unitMany: "klanten", n: 7, successes: 4, metricLabel: "Klant gebruikt de dienst opnieuw", interval: "57%", entries: 7 });
    expect(s).toMatch(/^Handmatig ingevoerd \(Conciërgetest\): 4 van 7 klanten/);
    expect(s.length).toBeLessThanOrEqual(400);
  });
});

describe("handmatige resultaten → oordeel", () => {
  // De drempels komen uit de vergrendelde Test Card; het oordeel volgt pas na de eindconditie (geen tussentijdse conclusie).
  const h = { decision_rule: "probability", success_count: null, success_threshold_pct: 30, fail_threshold_pct: 10, min_sample: 10 };
  const rows = [row(6, 4), row(6, 3)];

  it("geen oordeel vóór de eindconditie, hoe goed de cijfers ook zijn", () => {
    const v = manualOutcome(h, rows, { endConditionReached: false, method: "2026-11-e" });
    expect(v.n).toBe(12);
    expect(v.successes).toBe(7);
    expect(v.verdict.kind).toBe("running");
  });
  it("na de eindconditie het oordeel van de vooraf vastgelegde regel", () => {
    expect(manualOutcome(h, rows, { endConditionReached: true, method: "2026-11-e" }).verdict.kind).toBe("pass");
    expect(manualOutcome(h, [row(20, 0)], { endConditionReached: true, method: "2026-11-e" }).verdict.kind).toBe("fail");
  });
  it("een ingetrokken regel verandert het oordeel; een latere drempel niet (de regel leest de vergrendelde drempels)", () => {
    const withdrawn = [row(6, 4), row(6, 3, { withdrawn_at: "2026-11-11T09:00:00Z" }), row(6, 0)];
    const v = manualOutcome(h, withdrawn, { endConditionReached: true, method: "2026-11-e" });
    expect(v.n).toBe(12);
    expect(v.successes).toBe(4);
    // Zelfde aantallen, andere (achteraf verlaagde) drempel: dat is een andere hypothese, niet deze Test Card.
    const same = methodOf("2026-11-e").verdict(h, { successes: 4, n: 12, successThresholdPct: 30, failThresholdPct: 10, minSample: 10, endConditionReached: true });
    expect(v.verdict.kind).toBe(same.kind);
  });
  it("onder de minimale steekproef geen geslaagd", () => {
    expect(manualOutcome(h, [row(4, 4)], { endConditionReached: true, method: "2026-11-e" }).verdict.kind).not.toBe("pass");
  });
});
