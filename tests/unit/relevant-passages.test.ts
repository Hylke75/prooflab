import { describe, expect, it } from "vitest";
import { relevantPassages } from "@/lib/ai/web-evidence";

const page = [
  "Home | Over ons | Contact",
  "Wij gebruiken cookies om deze website goed te laten werken en om het gebruik te analyseren.",
  "Nederland telde in 2025 ongeveer 41.000 mkb-bedrijven met 10 tot 250 werknemers, volgens cijfers van het CBS over bedrijven.",
  "Ons team staat altijd klaar om u te helpen met al uw vragen over onze diensten en producten.",
  "Van die mkb-bedrijven gebruikt 38% nog geen enkele vorm van procesautomatisering, vooral in de bouw en de detailhandel.",
].join("\n");

describe("relevantPassages", () => {
  it("keeps the verbatim paragraphs that match the question, in page order", () => {
    const out = relevantPassages(page, "Hoeveel Nederlandse mkb-bedrijven (10-250 werknemers) gebruiken nog geen procesautomatisering?");
    expect(out).toHaveLength(2);
    expect(out[0]).toContain("41.000 mkb-bedrijven");
    expect(out[1]).toContain("38% nog geen");
    for (const p of out) expect(page.includes(p)).toBe(true);
  });

  it("drops navigation, cookie banners and unrelated text", () => {
    const out = relevantPassages(page, "Hoeveel mkb-bedrijven zijn er?");
    expect(out.join(" ")).not.toMatch(/cookies|Ons team/);
  });

  it("returns nothing when nothing matches", () => {
    expect(relevantPassages(page, "Wat kost een vliegticket naar Tokio?")).toEqual([]);
  });
});
