import { describe, expect, it } from "vitest";
import { truncateWords } from "@/lib/domain/truncate";

describe("truncateWords (B1)", () => {
  it("laat een korte titel ongemoeid", () => {
    expect(truncateWords("Prijstest makelaars", 40)).toBe("Prijstest makelaars");
    expect(truncateWords("  Prijstest   makelaars ", 40)).toBe("Prijstest makelaars");
  });

  it("breekt af op een woordgrens met … erachter", () => {
    const t = "Landingpage-test voor zelfstandige NVM-makelaars met abonnement";
    const r = truncateWords(t, 30);
    expect(r).toBe("Landingpage-test voor…");
    expect(r.length).toBeLessThanOrEqual(30);
    expect(t.startsWith(r.slice(0, -1))).toBe(true);
  });

  it("houdt een woord heel als het precies tot de grens loopt", () => {
    expect(truncateWords("Kies dit aanbod nu meteen", 16)).toBe("Kies dit aanbod…");
  });

  it("laat geen leesteken of streepje voor het weglatingsteken staan", () => {
    expect(truncateWords("Prijstest, makelaars en notarissen", 12)).toBe("Prijstest…");
    expect(truncateWords("Prijstest – makelaars en notarissen", 14)).toBe("Prijstest…");
  });

  it("kapt een enkel te lang woord af", () => {
    expect(truncateWords("Arbeidsongeschiktheidsverzekering", 10)).toBe("Arbeidson…");
  });
});
