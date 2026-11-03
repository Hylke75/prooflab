import { describe, expect, it } from "vitest";
import { compareFingerprints, describeChanges, makeFingerprint, parseFingerprint } from "@/lib/coach/fingerprint";
import { slugify, validateAiNotes } from "@/lib/coach/ai-notes";

const ID = "00000000-0000-4000-8000-000000000001";
const data = { claims: 3, claims_at: "2026-11-01T10:00:00Z", experiments: 1, experiment_states: "live:1", outcome: false, sprint_week: 2 };

describe("dossier fingerprint", () => {
  it("is stable regardless of key order and round-trips", () => {
    const a = makeFingerprint({ day: "2026-11-03", data });
    const b = makeFingerprint({ day: "2026-11-03", data: { sprint_week: 2, outcome: false, experiment_states: "live:1", experiments: 1, claims_at: "2026-11-01T10:00:00Z", claims: 3 } });
    expect(a).toBe(b);
    expect(parseFingerprint(a)).toEqual({ day: "2026-11-03", data });
    expect(parseFingerprint("garbage")).toBeNull();
  });

  it("changes when the dossier changes, and separates a new day from new data", () => {
    const a = makeFingerprint({ day: "2026-11-03", data });
    expect(compareFingerprints(a, a)).toEqual({ any: false, data: false });
    expect(compareFingerprints(a, makeFingerprint({ day: "2026-11-04", data }))).toEqual({ any: true, data: false });
    expect(compareFingerprints(a, makeFingerprint({ day: "2026-11-03", data: { ...data, claims: 4 } }))).toEqual({ any: true, data: true });
    expect(compareFingerprints(a, makeFingerprint({ day: "2026-11-03", data: { ...data, experiment_states: "ended:1" } })).data).toBe(true);
    expect(compareFingerprints(null, a)).toEqual({ any: true, data: true });
    expect(compareFingerprints("", a)).toEqual({ any: true, data: true });
  });

  it("describes what changed in Dutch", () => {
    const a = makeFingerprint({ day: "2026-11-03", data });
    const b = makeFingerprint({ day: "2026-11-03", data: { ...data, claims: 5, claims_at: "2026-11-03T09:00:00Z", outcome: true } });
    expect(describeChanges(a, b)).toEqual(["Bevindingen: 3 → 5", "Uitkomst vastgelegd: nee → ja"]);
    const c = makeFingerprint({ day: "2026-11-03", data: { ...data, claims_at: "2026-11-03T09:00:00Z" } });
    expect(describeChanges(a, c)).toEqual(["Laatste bevinding bijgewerkt (2026-11-03)"]);
    expect(describeChanges(null, a)[0]).toMatch(/Eerste keer/);
  });
});

describe("AI coach notes", () => {
  const note = (over: Record<string, unknown> = {}) => ({
    kind: "warning",
    title: "Prijs nog niet getest",
    body: "Er is veel interesse, maar niemand heeft een prijs gezien. Zonder prijs weet je niet of het verdienmodel klopt.",
    target: "experiments",
    slug: "Pricing untested",
    ...over,
  });

  it("builds the code and link itself and labels nothing as evidence", () => {
    const out = validateAiNotes({ notes: [note()] }, ID, []);
    expect(out).toEqual([
      {
        code: "ai:pricing-untested",
        kind: "warning",
        title: "Prijs nog niet getest",
        body: note().body,
        href: `/app/ideas/${ID}/experiments`,
        audience: "consultant",
      },
    ]);
  });

  it("drops unknown targets and kinds, duplicates of open notes, and keeps at most two", () => {
    expect(validateAiNotes({ notes: [note({ target: "https://evil.example" })] }, ID, [])).toEqual([]);
    expect(validateAiNotes({ notes: [note({ kind: "evidence" })] }, ID, [])).toEqual([]);
    expect(validateAiNotes({ notes: [note()] }, ID, [{ code: "ai:pricing-untested", title: "iets anders" }])).toEqual([]);
    expect(validateAiNotes({ notes: [note({ slug: "other" })] }, ID, [{ code: "x", title: "Prijs nog niet getest!" }])).toEqual([]);
    const three = { notes: [note({ slug: "a" }), note({ slug: "b", title: "Twee" + "x" }), note({ slug: "c", title: "Drie" + "y" })] };
    expect(validateAiNotes(three, ID, [])).toHaveLength(2);
    const partial = { notes: [note({ slug: "a" }), { kind: "tip" }, note({ slug: "b", title: "Iets anders" })] };
    expect(validateAiNotes(partial, ID, []).map((n) => n.code)).toEqual(["ai:a", "ai:b"]);
  });

  it("cleans and clips text", () => {
    const long = validateAiNotes({ notes: [note({ title: "  Kop\nmet\tregels  ", body: "Zin. ".repeat(200), slug: "" })] }, ID, []);
    expect(long[0].title).toBe("Kop met regels");
    expect(long[0].body.length).toBeLessThanOrEqual(600);
    expect(long[0].code).toBe("ai:kop-met-regels");
    expect(validateAiNotes({ notes: [note({ body: "kort" })] }, ID, [])).toEqual([]);
    expect(validateAiNotes(null, ID, [])).toEqual([]);
    expect(slugify("Één prijs — nog onbekend!")).toBe("een-prijs-nog-onbekend");
  });
});
