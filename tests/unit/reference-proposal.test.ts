import { afterEach, describe, expect, it, vi } from "vitest";
import { parseReferenceAnswer, percentagesIn, verifyReference } from "@/lib/domain/reference-proposal";

// Een referentie met bron: alleen als het citaat met het percentage letterlijk op de opgehaalde pagina staat.
// Geen echte AI-API of webpagina: fetch en de pagina-ophaler zijn gemockt.

const PAGE = "Kop\nVan de nieuwe dienstverlenende bedrijven had 38% binnen zes maanden een eerste betalende klant.\nVoet";

describe("percentages in een citaat", () => {
  it("herkent %, procent en percent met komma of punt", () => {
    expect(percentagesIn("38% en 12,5 procent en 7.5 percent")).toEqual([0.38, 0.125, 0.075]);
    expect(percentagesIn("geen getal")).toEqual([]);
    expect(percentagesIn("140%")).toEqual([]);
  });
});

describe("het antwoord van het model", () => {
  it("leest REFERENTIE, BRON, CITAAT en PERCENTAGE per voorstel", () => {
    const r = parseReferenceAnswer(
      "REFERENTIE: Nieuwe B2B-diensten\nBRON: https://example.org/rapport.\nCITAAT: “Van de nieuwe dienstverlenende bedrijven had 38% binnen zes maanden een eerste betalende klant.”\nPERCENTAGE: 38\n\n- **REFERENTIE**: Tweede\nBRON: https://example.org/b\nCITAAT: iets met 10%",
    );
    expect(r).toHaveLength(2);
    expect(r[0]).toEqual({
      label: "Nieuwe B2B-diensten",
      url: "https://example.org/rapport",
      quote: "Van de nieuwe dienstverlenende bedrijven had 38% binnen zes maanden een eerste betalende klant.",
      percentage: 38,
    });
    expect(r[1].percentage).toBeNull();
    expect(parseReferenceAnswer("onbekend")).toEqual([]);
  });
});

describe("controle op de bronpagina", () => {
  const claim = { label: "Nieuwe B2B-diensten", url: "https://example.org/rapport", quote: "had 38% binnen zes maanden een eerste betalende klant", percentage: 38 };

  it("accepteert alleen een citaat dat letterlijk op de pagina staat, met het opgegeven percentage", () => {
    const ok = verifyReference(claim, PAGE);
    expect(ok).toMatchObject({ ok: true, reference: { rate: 0.38, passage: PAGE.split("\n")[1] } });
  });

  it("weigert een geparafraseerd citaat, een citaat zonder percentage of een ander percentage", () => {
    expect(verifyReference({ ...claim, quote: "had 38% binnen een half jaar een klant" }, PAGE)).toEqual({ ok: false, reason: "Het citaat staat niet letterlijk op de opgegeven pagina." });
    expect(verifyReference({ ...claim, quote: "binnen zes maanden een eerste betalende klant" }, PAGE)).toMatchObject({ ok: false, reason: expect.stringMatching(/geen letterlijk percentage/) });
    expect(verifyReference({ ...claim, percentage: 45 }, PAGE)).toMatchObject({ ok: false, reason: expect.stringMatching(/percentage staat niet/) });
    expect(verifyReference({ ...claim, url: "ftp://x" }, PAGE).ok).toBe(false);
  });
});

describe("proposeReference met een gemockte aanbieder", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("haalt elke pagina zelf op en houdt alleen teruggevonden citaten", async () => {
    vi.resetModules();
    for (const k of ["ANTHROPIC_API_KEY", "GEMINI_API_KEY"]) vi.stubEnv(k, "");
    vi.stubEnv("OPENAI_API_KEY", "sk-test");
    const text = [
      "REFERENTIE: Nieuwe B2B-diensten",
      "BRON: https://example.org/rapport",
      "CITAAT: Van de nieuwe dienstverlenende bedrijven had 38% binnen zes maanden een eerste betalende klant.",
      "PERCENTAGE: 38",
      "REFERENTIE: Verzonnen",
      "BRON: https://example.org/verzonnen",
      "CITAAT: 90% van alle bureaus slaagt meteen.",
      "PERCENTAGE: 90",
    ].join("\n");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({ model: "gpt-x", output: [{ type: "message", content: [{ type: "output_text", text, annotations: [] }] }], usage: { input_tokens: 100, output_tokens: 50 } }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      ),
    );
    const fetchPage = vi.fn(async (url: string) => ({ url, title: "Rapport", text: url.endsWith("rapport") ? PAGE : "Andere tekst zonder dat citaat." }));
    const { proposeReference } = await import("@/lib/ai/reference");
    const idea = { title: "Bureau", decisionQuestion: "Starten we?", description: "d", targetAudience: "MKB", region: "Nederland", projectType: "new_business", sector: "smb", keyUncertainty: null };
    const r = await proposeReference({ idea, outcome: "10 klanten" }, "openai", { fetchPage });
    expect(fetchPage).toHaveBeenCalledTimes(2);
    expect(r.accepted).toEqual([expect.objectContaining({ label: "Nieuwe B2B-diensten", url: "https://example.org/rapport", rate: 0.38, title: "Rapport" })]);
    expect(r.rejected).toEqual([{ url: "https://example.org/verzonnen", reason: "Het citaat staat niet letterlijk op de opgegeven pagina." }]);
  });
});
