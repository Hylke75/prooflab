import { describe, expect, it } from "vitest";
import { scrubAll, scrubPersonalData } from "@/lib/signals/scrub";

describe("scrubPersonalData", () => {
  it("removes e-mail addresses, links, handles and phone numbers", () => {
    const r = scrubPersonalData("Mail me op jan.devries@bedrijf.nl of bel 06-12345678. Zie www.bedrijf.nl en volg @jandevries.");
    expect(r.text).toBe("Mail me op [e-mailadres] of bel [telefoonnummer]. Zie [link] en volg [account].");
    expect(r.removed).toMatchObject({ email: 1, url: 1, handle: 1, phone: 1 });
  });

  it("handles international numbers", () => {
    expect(scrubPersonalData("Bel +31 (0)20 123 4567 morgen").text).toBe("Bel [telefoonnummer] morgen");
  });

  it("keeps amounts, years and percentages", () => {
    const t = "We betalen nu €1.200.000 per jaar, sinds 2019, en 35% minder dan in 2018.";
    expect(scrubPersonalData(t).text).toBe(t);
  });

  it("drops the signature from the closing line onwards", () => {
    const r = scrubPersonalData("Klinkt interessant, we zoeken zoiets.\n\nMet vriendelijke groet,\nJan de Vries\nHead of Events");
    expect(r.text).toBe("Klinkt interessant, we zoeken zoiets.");
    expect(r.removed.signature).toBe(true);
    expect(scrubPersonalData("Thanks for reaching out, interesting.\nBest regards,\nAnna").text).toBe("Thanks for reaching out, interesting.");
    expect(scrubPersonalData("Groeten,\nPiet").text).toBe("Groeten,\nPiet");
  });

  it("does not cut on the word groet inside a sentence", () => {
    const t = "Ik groet je collega's, maar we hebben geen budget.";
    expect(scrubPersonalData(t).text).toBe(t);
  });

  it("counts changed texts and drops texts that become empty", () => {
    const r = scrubAll(["info@x.nl", "Geen gegevens hier", "Bel 0612345678"]);
    expect(r.texts).toEqual(["[e-mailadres]", "Geen gegevens hier", "Bel [telefoonnummer]"]);
    expect(r.changed).toBe(2);
  });
});
