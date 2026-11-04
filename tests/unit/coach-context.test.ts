import { describe, expect, it } from "vitest";
import { coachContextLines, experimentLines, intakeLines, interviewLines, priceFromText, type CoachContextInput } from "@/lib/coach/context";
import { parseInline, parseMarkdown, safeHref } from "@/lib/domain/markdown";

const input: CoachContextInput = {
  idea: {
    decision_question: "Lanceren we dit aanbod in het eerste kwartaal, of stoppen we?",
    decision_stakes: "€ 40.000",
    decision_deadline: "2027-01-15",
    target_audience: "Zakelijke klanten (B2B)",
    audience_detail: "zelfstandige NVM-makelaars",
    region: "Nederland",
    description: "Een AI-assistent voor makelaars die woningteksten schrijft, voor € 249 per maand.",
    key_uncertainty: "Of makelaars echt betalen",
    outcome_min_value_per_customer: 249,
  },
  experiments: [
    {
      id: "e1",
      title: "Prijstest <script>",
      type: "pricing",
      state: "analyzed",
      hypotheses: { metric_label: "Kiest een aanbod met prijs", success_threshold_pct: 8, fail_threshold_pct: 2, min_sample: 150, assumptions: { statement: "Makelaars betalen € 249" } },
      metrics: { successes: 14, n: 160, verdict: { kind: "pass" } },
    },
    { id: "e2", title: "Interviews", type: "interview", state: "draft", hypotheses: null, metrics: null },
  ],
  learningCards: [{ experiment_id: "e1", status: "approved", verdict: "pass" }],
  interviews: [
    { id: "i1", is_practice: false, dmu_role: "beslisser", record_type: "notes", is_acquaintance: true },
    { id: "i2", is_practice: false, dmu_role: "gebruiker", record_type: "notes", is_acquaintance: false },
    { id: "i3", is_practice: true, dmu_role: "gebruiker" },
    { id: "i4", is_practice: null },
  ],
  observations: [
    { interview_id: "i1", kind: "problem_confirmed", is_synthetic: false },
    { interview_id: "i3", kind: "problem_confirmed", is_synthetic: true },
    { interview_id: "i2", kind: "current_spend", is_synthetic: false },
  ],
};

describe("coachcontext (B4/B6)", () => {
  it("intake: beslisvraag, doelgroep, prijs en grootste onzekerheid", () => {
    const t = intakeLines(input.idea).join("\n");
    expect(t).toMatch(/Beslisvraag: Lanceren we dit aanbod/);
    expect(t).toMatch(/Doelgroep: Zakelijke klanten \(B2B\) — zelfstandige NVM-makelaars \(Nederland\)/);
    expect(t).toMatch(/Prijs: € 249 per maand; minimumwaarde per klant in het succescriterium € 249/);
    expect(t).toMatch(/Grootste onzekerheid: Of makelaars echt betalen/);
    expect(intakeLines({}).join("\n")).toMatch(/Beslisvraag: onbekend[\s\S]*Prijs: niet genoemd/);
    expect(priceFromText("Kost €1.250 per jaar")).toBe("€1.250 per jaar");
  });

  it("experimenten: type, status, drempels en uitkomst, zonder punthaken", () => {
    const t = experimentLines(input.experiments, input.learningCards).join("\n");
    expect(t).toMatch(/Prijstest\s+script\s*\[prijs-\/aanbodtest, geanalyseerd\]/);
    expect(t).toMatch(/geslaagd bij ≥ 8%, niet geslaagd bij ≤ 2%, minimaal 150 deelnemers/);
    expect(t).toMatch(/Uitkomst: 14 van 160, geslaagd; Learning Card goedgekeurd: geslaagd\./);
    expect(t).toMatch(/Interviews \[klantinterviews, concept\]\. Maatstaf: onbekend; geen drempels vastgelegd\. Uitkomst: nog geen meting\./);
    expect(t).not.toMatch(/</);
    expect(experimentLines([], [])).toEqual(["Experimenten: nog geen."]);
  });

  it("interviews: alleen echte gesprekken, zonder persoonsgegevens", () => {
    const t = interviewLines(input.interviews, input.observations).join("\n");
    expect(t).toMatch(/^Interviews: 2 echte gesprekken \(2 oefen- of niet als echt aangegeven gesprekken niet meegeteld\)/);
    expect(t).toMatch(/Rollen: beslisser 1, gebruiker 1/);
    expect(t).toMatch(/Bekenden van de consultant: 1 van 2/);
    // De waarneming uit het oefengesprek telt niet.
    expect(t).toMatch(/Waarnemingen per soort: problem_confirmed 1, current_spend 1/);
    expect(interviewLines([{ id: "x", is_practice: true }], [])).toEqual(["Interviews: nog geen echte gesprekken (1 oefen- of niet als echt aangegeven gesprek niet meegeteld)."]);
  });

  it("bundelt intake, experimenten en interviews", () => {
    const t = coachContextLines(input);
    expect(t[0]).toBe("Intake:");
    expect(t.some((l) => l.startsWith("Experimenten"))).toBe(true);
    expect(t.some((l) => l.startsWith("Interviews"))).toBe(true);
  });
});

describe("markdown van de coach (veilig)", () => {
  it("koppen, lijsten, vet en alinea's", () => {
    const b = parseMarkdown("## Advies\n\nDit is **belangrijk** en *zacht*.\n\n- een\n- twee\n\n1. eerst\n2. dan");
    expect(b.map((x) => x.t)).toEqual(["h", "p", "ul", "ol"]);
    expect(b[0]).toMatchObject({ t: "h", level: 2 });
    expect(b[1]).toEqual({ t: "p", c: [{ t: "text", v: "Dit is " }, { t: "strong", c: [{ t: "text", v: "belangrijk" }] }, { t: "text", v: " en " }, { t: "em", c: [{ t: "text", v: "zacht" }] }, { t: "text", v: "." }] });
    expect(b[2]).toMatchObject({ t: "ul", items: [[{ t: "text", v: "een" }], [{ t: "text", v: "twee" }]] });
    expect(b[3]).toMatchObject({ t: "ol", start: 1 });
  });

  it("links alleen naar http(s), mailto of een pad in de app", () => {
    expect(safeHref("https://cbs.nl/x")).toEqual({ href: "https://cbs.nl/x", external: true });
    expect(safeHref("/app/ideas/1/assumptions")).toEqual({ href: "/app/ideas/1/assumptions", external: false });
    expect(safeHref("javascript:alert(1)")).toBeNull();
    expect(safeHref("//evil.example")).toBeNull();
    expect(safeHref("data:text/html,x")).toBeNull();
    expect(parseInline("[klik](javascript:alert(1))")[0]).toEqual({ t: "text", v: "klik" });
    expect(parseInline("zie [CBS](https://cbs.nl)")[1]).toMatchObject({ t: "link", href: "https://cbs.nl", external: true });
  });

  it("HTML blijft tekst; de renderer maakt alleen React-elementen", () => {
    const b = parseMarkdown('<script>alert(1)</script> <img src=x onerror="y">');
    expect(b).toEqual([{ t: "p", c: [{ t: "text", v: '<script>alert(1)</script> <img src=x onerror="y">' }] }]);
  });

  it("onafgesloten markeringen blijven letterlijk; snake_case is geen cursief", () => {
    expect(parseInline("2 * 3 = 6")).toEqual([{ t: "text", v: "2 * 3 = 6" }]);
    expect(parseInline("**half")).toEqual([{ t: "text", v: "**half" }]);
    expect(parseInline("is_practice_flag")).toEqual([{ t: "text", v: "is_practice_flag" }]);
  });
});
