import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createFathomSource, fathomEnabled, fathomToText, FATHOM_ALTERNATIVE } from "@/lib/integrations/transcripts/fathom";
import { fileSource } from "@/lib/integrations/transcripts/file";
import { readTranscriptText } from "@/lib/transcript-file";
import { prepareImport } from "@/lib/domain/interview-import";

// Fase 1 · punt 3, deelstap 8: bronnen van transcripten. Geen echte netwerkverzoeken: de Fathom-bron krijgt een
// nep-fetch, en de echte fetch faalt de test als hij toch wordt aangeroepen.
const realFetch = globalThis.fetch;
beforeAll(() => {
  globalThis.fetch = (() => {
    throw new Error("Geen netwerk in tests");
  }) as typeof fetch;
});
afterAll(() => {
  globalThis.fetch = realFetch;
});

const TRANSCRIPT = {
  title: "Gesprek penningmeester VV Oranje",
  recording_start_time: "2026-10-28T14:00:00Z",
  transcript: [
    { speaker: { display_name: "Sanne de Vries", matched_calendar_invitee_email: "sanne@bureau.nl" }, text: "Hoe innen jullie de contributie?", timestamp: "00:00:04" },
    { speaker: { display_name: "Peter Bakker" }, text: "Met een Excel-lijst. Dat kost me elke maand een avond.", timestamp: "00:00:11" },
    { speaker: { display_name: "Peter Bakker" }, text: "Mail me gerust op peter@vvoranje.nl.", timestamp: "00:00:20" },
  ],
};

function fake(responses: Record<string, { status: number; body?: unknown } | "throw">) {
  const calls: { url: string; headers: Record<string, string> }[] = [];
  const fetchFn = vi.fn(async (url: string, init: { headers: Record<string, string> }) => {
    calls.push({ url, headers: init.headers });
    const key = Object.keys(responses).find((k) => url.includes(k));
    const r = key ? responses[key] : { status: 404 };
    if (r === "throw") throw new Error("netwerk");
    return { ok: r.status >= 200 && r.status < 300, status: r.status, json: async () => r.body };
  });
  return { fetchFn, calls };
}

describe("feature-flag", () => {
  it("staat standaard uit", () => {
    expect(fathomEnabled({})).toBe(false);
    expect(fathomEnabled({ FATHOM_ENABLED: "1" })).toBe(true);
    expect(fathomEnabled({ FATHOM_ENABLED: "true" })).toBe(true);
    expect(fathomEnabled({ FATHOM_ENABLED: "nee" })).toBe(false);
  });
});

describe("Fathom: status 'niet verbonden' met handmatig alternatief", () => {
  it("flag uit: niet verbonden, geen verzoek", async () => {
    const { fetchFn } = fake({});
    const s = createFathomSource({ enabled: false, apiKey: async () => "k".repeat(20), fetch: fetchFn });
    expect(await s.status("idee")).toMatchObject({ state: "not_connected", alternative: FATHOM_ALTERNATIVE });
    expect(await s.fetchTranscript("idee", "123")).toMatchObject({ ok: false });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("geen sleutel voor de werkruimte: niet verbonden", async () => {
    const { fetchFn } = fake({});
    const s = createFathomSource({ enabled: true, apiKey: async () => null, fetch: fetchFn });
    expect((await s.status("idee")).state).toBe("not_connected");
    expect(await s.listRecordings("idee")).toMatchObject({ ok: false });
    expect(fetchFn).not.toHaveBeenCalled();
  });
});

describe("Fathom: verbonden (nep-API)", () => {
  it("lijst met opnames en het transcript, met de sleutel in de kop", async () => {
    const { fetchFn, calls } = fake({
      "/meetings": { status: 200, body: { items: [{ recording_id: 123, title: "Gesprek penningmeester", recording_start_time: "2026-10-28T14:00:00Z", url: "https://fathom.video/calls/1" }, { title: "zonder id" }] } },
      "/recordings/123/transcript": { status: 200, body: TRANSCRIPT },
    });
    const s = createFathomSource({ enabled: true, baseUrl: "https://fathom.test/v1/", apiKey: async () => "fathom-sleutel-0123456789", fetch: fetchFn });
    expect((await s.status("idee")).state).toBe("connected");
    expect(await s.listRecordings("idee", { limit: 5 })).toEqual({ ok: true, recordings: [{ id: "123", title: "Gesprek penningmeester", heldOn: "2026-10-28", url: "https://fathom.video/calls/1" }] });
    const t = await s.fetchTranscript("idee", "123");
    expect(t.ok).toBe(true);
    if (!t.ok) return;
    expect(t.heldOn).toBe("2026-10-28");
    expect(t.text).toBe(
      "[00:00:04] Sanne de Vries: Hoe innen jullie de contributie?\n[00:00:11] Peter Bakker: Met een Excel-lijst. Dat kost me elke maand een avond.\n[00:00:20] Peter Bakker: Mail me gerust op peter@vvoranje.nl.",
    );
    expect(calls[0].url).toBe("https://fathom.test/v1/meetings?limit=5");
    expect(calls.every((c) => c.headers["X-Api-Key"] === "fathom-sleutel-0123456789")).toBe(true);

    // Daarna precies dezelfde weg als een bestand: segmenten en pseudonimisering.
    const read = readTranscriptText("fathom", t.text);
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    const prepared = prepareImport(read.parsed.segments, []);
    expect(prepared.ok && prepared.transcript).not.toMatch(/Sanne|Peter|vvoranje|Oranje/);
    expect(prepared.ok && prepared.transcript).toContain("Spreker B: Met een Excel-lijst. Dat kost me elke maand een avond. Mail me gerust op E-mail 1.");
  });

  it("fouten: verkeerde sleutel, wachten, niet gevonden, niet bereikbaar, ongeldige opname", async () => {
    const make = (r: { status: number } | "throw") => createFathomSource({ enabled: true, apiKey: async () => "k".repeat(20), fetch: fake({ "/recordings/": r }).fetchFn });
    expect(await make({ status: 401 }).fetchTranscript("i", "1")).toMatchObject({ ok: false, error: expect.stringMatching(/weigert de sleutel/) });
    expect(await make({ status: 429 }).fetchTranscript("i", "1")).toMatchObject({ ok: false, error: expect.stringMatching(/wachten/) });
    expect(await make({ status: 404 }).fetchTranscript("i", "1")).toMatchObject({ ok: false, error: expect.stringMatching(/niet gevonden/) });
    expect(await make("throw").fetchTranscript("i", "1")).toMatchObject({ ok: false, error: expect.stringMatching(/niet bereikbaar/) });
    expect(await make({ status: 200 }).fetchTranscript("i", "../../etc")).toMatchObject({ ok: false, error: "Ongeldige Fathom-opname." });
  });

  it("zet Fathom-regels om, ook met seconden en zonder spreker", () => {
    expect(fathomToText([{ text: "Hallo daar", start_time: 75.4 }, { speaker: "Interviewer", text: "  Dag  " }, { text: "" }, null])).toBe("[00:01:15] Hallo daar\nInterviewer: Dag");
    expect(fathomToText({ niets: true })).toBe("");
  });
});

describe("bestand of plakken", () => {
  it("is altijd verbonden en leest in het geheugen", async () => {
    expect((await fileSource.status("idee")).state).toBe("connected");
    const r = fileSource.readFile("gesprek.srt", new TextEncoder().encode("1\n00:00:01,000 --> 00:00:04,000\nSanne: Hoe gaat het met de vrijwilligers bij jullie club?\n"));
    expect(r.ok && r.parsed.segments[0].speaker).toBe("Sanne");
    expect(fileSource.readFile("gesprek.pdf", new Uint8Array([1])).ok).toBe(false);
    expect(fileSource.readPasted("Te kort").ok).toBe(false);
  });
});
