import { describe, expect, it } from "vitest";
import { auditGuide, auditQuestion, auditTranscript, guideSummary } from "@/lib/domain/interview-audit";
import { codingAcceptance, codingIsProposalOnly, supportAgreement } from "@/lib/domain/ai-quality";
import { claimStatusWithSupport, keepAfterSupportCheck, type EvidenceWithSupport } from "@/lib/domain/support";
import { isSignalSource, painAsAssumption, topPains, verifySignalGroups, type SignalExcerpt } from "@/lib/domain/customer-signals";
import { priceOnPage, recheckChanges, recheckDue, recheckQuotes } from "@/lib/domain/recheck";
import { honestyWarnings, prepareVariants } from "@/lib/domain/copy-honesty";
import { NEUTRAL_INTERVIEW_GUIDE } from "@/lib/domain/labels";

const kinds = (q: string, names: string[] = []) => auditQuestion(q, { productNames: names }).map((i) => i.kind);

describe("interview guide audit", () => {
  it("flags hypothetical and future questions", () => {
    expect(kinds("Zou u een app gebruiken om uw evenementen te plannen?")).toContain("hypothetical");
    expect(kinds("Zou je hiervoor betalen?")).toContain("hypothetical");
    expect(kinds("Hoeveel zou jij ervoor over hebben?")).toContain("hypothetical");
    expect(kinds("Gaat u dit volgend jaar inkopen?")).toContain("hypothetical");
    expect(kinds("Wilt u overstappen naar een nieuwe leverancier?")).toContain("hypothetical");
    expect(auditQuestion("Zou u dit gebruiken?")[0].message).toMatch(/toekomstig gebruik of betalen/);
  });

  it("does not flag polite requests to tell about the past", () => {
    expect(kinds("Zou u kunnen vertellen wanneer u dit voor het laatst deed?")).toEqual([]);
    expect(kinds("Wilt u beschrijven hoe dat ging?")).toEqual([]);
  });

  it("flags leading questions", () => {
    expect(kinds("Vindt u niet dat plannen veel te lang duurt?")).toContain("leading");
    expect(kinds("Bent u het ermee eens dat offertes te duur zijn?")).toContain("leading");
    expect(kinds("Is het niet zo dat iedereen hier last van heeft?")).toContain("leading");
    expect(kinds("Dat kost veel tijd, toch?")).toContain("leading");
  });

  it("flags pitching: our product or the idea's name", () => {
    expect(kinds("Wat vindt u van ons product?")).toContain("pitch");
    expect(kinds("Hoe zou onze oplossing u helpen?")).toEqual(expect.arrayContaining(["pitch", "hypothetical"]));
    expect(kinds("Kent u EventMatch al?", ["EventMatch"])).toEqual(expect.arrayContaining(["pitch", "closed"]));
  });

  it("flags closed yes/no openings", () => {
    expect(kinds("Heeft u last van dubbele boekingen?")).toContain("closed");
    expect(kinds("Bent u tevreden met uw huidige leverancier?")).toContain("closed");
    expect(kinds("Is het lastig om een locatie te vinden?")).toContain("closed");
    expect(kinds("Doet u dat zelf?")).toContain("closed");
    expect(kinds("Hoe vaak heeft u dit probleem?")).not.toContain("closed");
  });

  it("flags double-barrelled questions with one question mark", () => {
    expect(kinds("Hoe plant u nu een event en wat kost dat?")).toContain("double");
    expect(kinds("Wat kost je dat nu, in tijd of geld?")).not.toContain("double");
    expect(kinds("Hoe plant u nu een event? En wat kost dat?")).not.toContain("double");
  });

  it("suggests a past-behaviour rewrite in the same form of address", () => {
    expect(auditQuestion("Zou u dit gebruiken?")[0].suggestion).toContain("Wanneer heeft u voor het laatst");
    expect(auditQuestion("Zou je dit gebruiken?")[0].suggestion).toContain("Wanneer heb je voor het laatst");
  });

  it("finds nothing in ProofLab's own neutral guide", () => {
    const audit = auditGuide(NEUTRAL_INTERVIEW_GUIDE);
    expect(guideSummary(audit)).toEqual({ flagged: 0, total: NEUTRAL_INTERVIEW_GUIDE.length });
  });

  it("audits a guide line by line and skips empty lines", () => {
    const audit = auditGuide(["Wanneer heeft u voor het laatst een event georganiseerd?", "", "Zou u ons platform aanraden?"]);
    expect(audit).toHaveLength(2);
    expect(audit[1].index).toBe(2);
    expect(guideSummary(audit).flagged).toBe(1);
  });
});

describe("transcript audit", () => {
  const transcript = [
    "I: Wanneer heeft u voor het laatst een event georganiseerd?",
    "R: Vorige maand, een congres voor 200 mensen.",
    "Interviewer: Zou u ons platform daarvoor gebruiken?",
    "R: Ja, zeker!",
    "[00:12:03] Q: Vindt u niet dat zoeken naar locaties te lang duurt?",
    "Hylke de Vries: Heeft u dat met EventMatch geprobeerd?",
    "R: Nee. Hylke de Vries kwam ook langs.",
  ].join("\n");

  it("flags steering, hypothetical and pitching interviewer turns only", () => {
    const turns = auditTranscript(transcript, { interviewerNames: ["Hylke de Vries"], productNames: ["EventMatch"] });
    expect(turns.map((t) => t.line)).toEqual([3, 5, 6]);
    expect(turns[0].issues.map((i) => i.kind)).toEqual(expect.arrayContaining(["hypothetical", "pitch"]));
    expect(turns[1].issues.map((i) => i.kind)).toContain("leading");
    expect(turns[2].issues.map((i) => i.kind)).toEqual(["pitch"]);
  });

  it("ignores respondent lines and the consultant's name without a prefix", () => {
    expect(auditTranscript("R: Zou ik dat gebruiken? Ons product is beter.")).toEqual([]);
    expect(auditTranscript(transcript).map((t) => t.line)).toEqual([3, 5]);
  });
});

describe("AI quality measures", () => {
  const row = (ai: string, consultant: string) => ({ support_check: consultant, support_checked_by: "consultant", ai_support_check: ai });

  it("measures support agreement only where both AI and consultant judged", () => {
    const rows = [
      ...Array.from({ length: 9 }, () => row("supports", "supports")),
      row("supports", "not_supported"),
      { support_check: "supports", support_checked_by: "consultant", ai_support_check: null },
      { support_check: "partial", support_checked_by: "ai", ai_support_check: "partial" },
    ];
    const m = supportAgreement(rows);
    expect(m.reviewed).toBe(10);
    expect(m.agreed).toBe(9);
    expect(m.rate).toBeCloseTo(0.9);
    expect(m.level).toBe("meets");
  });

  it("is below the bar under 90% and reports too few samples under 10", () => {
    const below = supportAgreement([...Array.from({ length: 8 }, () => row("supports", "supports")), row("partial", "supports"), row("supports", "partial")]);
    expect(below.level).toBe("below");
    expect(supportAgreement([row("supports", "supports")]).level).toBe("too_few");
    expect(supportAgreement([]).rate).toBeNull();
  });

  it("computes the coding acceptance rate and keeps AI coding a proposal below 70% or under 10 reviews", () => {
    const rows = [...Array.from({ length: 7 }, () => ({ review_status: "accepted" })), ...Array.from({ length: 3 }, () => ({ review_status: "rejected" })), { review_status: null }];
    const m = codingAcceptance(rows);
    expect(m.rate).toBeCloseTo(0.7);
    expect(m.level).toBe("meets");
    expect(codingIsProposalOnly(m)).toBe(false);
    const low = codingAcceptance([...Array.from({ length: 6 }, () => ({ review_status: "accepted" })), ...Array.from({ length: 4 }, () => ({ review_status: "rejected" }))]);
    expect(low.message).toContain("AI-codering blijft een voorstel");
    expect(codingIsProposalOnly(low)).toBe(true);
    const few = codingAcceptance([{ review_status: "accepted" }]);
    expect(few.level).toBe("too_few");
    expect(few.message).toContain("AI-codering blijft een voorstel");
  });

});

const ev = (o: Partial<EvidenceWithSupport>): EvidenceWithSupport => ({
  sourceType: "official_statistic",
  isPrimary: false,
  domain: "cbs.nl",
  publishedOn: "2026-03-01",
  contentHash: null,
  quoteCheck: "exact",
  stance: "supports",
  support: "unchecked",
  ...o,
});
const claim = { evidenceType: "official_statistic" as const, freshness: "statistic" as const };
const now = new Date("2026-11-03");

describe("support rule in the claim status", () => {
  it("does not count a literal quote that does not carry the claim", () => {
    const r = claimStatusWithSupport(claim, [ev({ support: "not_supported" })], now);
    expect(r.status).toBe("insufficient");
    expect(r.reason).toContain("draagt de bewering inhoudelijk niet");
  });

  it("keeps a verified status when another source supports it", () => {
    expect(claimStatusWithSupport(claim, [ev({ support: "not_supported" }), ev({ support: "supports", domain: "europa.eu" })], now).status).toBe("verified");
  });

  it("keeps the status for a partial support, with a note", () => {
    const r = claimStatusWithSupport(claim, [ev({ support: "partial" })], now);
    expect(r.status).toBe("verified");
    expect(r.reason).toContain("maar deels");
  });

  it("treats unchecked and supporting quotes as before", () => {
    expect(claimStatusWithSupport(claim, [ev({})], now).status).toBe("verified");
    expect(claimStatusWithSupport(claim, [ev({ support: "supports" })], now).reason).not.toContain("deels");
  });

  it("makes a finding outdated when its quote disappeared from the live page", () => {
    const r = claimStatusWithSupport(claim, [ev({ liveMissing: true })], now);
    expect(r.status).toBe("outdated");
    expect(r.reason).toContain("niet meer op de live pagina");
    expect(claimStatusWithSupport(claim, [ev({ liveMissing: true }), ev({ domain: "europa.eu" })], now).status).toBe("verified");
  });

  it("drops only claims judged not supported in the research runner", () => {
    expect(keepAfterSupportCheck("not_supported")).toBe(false);
    expect(keepAfterSupportCheck("partial")).toBe(true);
    expect(keepAfterSupportCheck("unchecked")).toBe(true);
  });
});

describe("competitor recheck", () => {
  it("is due after 30 days or when never checked", () => {
    expect(recheckDue(null, now)).toBe(true);
    expect(recheckDue("2026-10-20T10:00:00Z", now)).toBe(false);
    expect(recheckDue("2026-09-20T10:00:00Z", now)).toBe(true);
  });

  it("finds quotes on the fresh page and lists what changed", () => {
    const page = "Prijzen. Het Basis-pakket kost € 49 per maand. Voor teams vanaf 10 gebruikers.";
    const r = recheckQuotes([{ id: "a", quote: "Basis-pakket kost € 49 per maand" }, { id: "b", quote: "Basis-pakket kost € 39 per maand" }], page);
    expect(r.map((x) => x.found)).toEqual([true, false]);
    const changes = recheckChanges({ name: "X", pages: [{ url: "https://x.nl", reachable: true, quotes: r }], website: { reachable: true, priceFound: priceOnPage("€ 39 per maand", page) } });
    expect(changes[0]).toContain("Citaat niet meer gevonden op de pagina");
    expect(changes[1]).toContain("prijs staat niet meer");
    expect(priceOnPage("€ 49", page)).toBe(true);
    expect(priceOnPage(null, page)).toBeNull();
  });

});

describe("customer signals", () => {
  const excerpts: SignalExcerpt[] = [
    { ref: "K1", id: "e1", source_id: "s1", source_title: "Reviews op Trustpilot", text: "Offertes vergelijken kost me elke keer twee dagen. De klantenservice reageert traag." },
    { ref: "K2", id: "e2", source_id: "s2", source_title: "Forum Eventplanners", text: "Ik wil gewoon in één overzicht zien welke locatie vrij is." },
  ];

  it("keeps only literal quotes and counts verified quotes, not the model's count", () => {
    const { kept, droppedQuotes, droppedGroups } = verifySignalGroups(
      [
        { kind: "pain", label: "Offertes vergelijken kost veel tijd", quotes: [{ excerpt_ref: "K1", quote: "Offertes vergelijken kost me elke keer twee dagen" }, { excerpt_ref: "K1", quote: "Offertes vergelijken duurt een week" }] },
        { kind: "job", label: "Beschikbaarheid in één overzicht", quotes: [{ excerpt_ref: "K2", quote: "in één overzicht zien welke locatie vrij is" }, { excerpt_ref: "K2", quote: "In één  overzicht zien welke locatie vrij is" }] },
        { kind: "objection", label: "Te duur", quotes: [{ excerpt_ref: "K9", quote: "Veel te duur voor kleine bureaus" }] },
      ],
      excerpts,
    );
    expect(kept).toHaveLength(2);
    expect(kept[0].mentions).toBe(1);
    expect(kept[0].quotes[0]).toMatchObject({ excerpt_id: "e1", source_id: "s1", source_title: "Reviews op Trustpilot" });
    expect(kept[1].mentions).toBe(1); // duplicate quote counted once
    expect(droppedQuotes).toBe(3);
    expect(droppedGroups).toBe(1);
  });

  it("selects signal sources: review sites, forums and outreach always, other types only when added by hand", () => {
    expect(isSignalSource({ source_type: "review_site", origin: "ai_search" })).toBe(true);
    expect(isSignalSource({ source_type: "forum", origin: "manual" })).toBe(true);
    expect(isSignalSource({ source_type: "outreach", origin: "manual" })).toBe(true);
    expect(isSignalSource({ source_type: "other", origin: "manual" })).toBe(true);
    expect(isSignalSource({ source_type: "other", origin: "ai_search" })).toBe(false);
    expect(isSignalSource({ source_type: "official_statistic", origin: "manual" })).toBe(false);
  });

  it("suggests the most mentioned pains as assumptions", () => {
    const list = [
      { id: "1", kind: "pain", mentions: 2 },
      { id: "2", kind: "gain", mentions: 9 },
      { id: "3", kind: "pain", mentions: 5 },
    ];
    expect(topPains(list, 1).map((s) => s.id)).toEqual(["3"]);
    expect(painAsAssumption("offertes vergelijken kost veel tijd.", "Eventmanagers")).toBe(
      "Eventmanagers: Offertes vergelijken kost veel tijd is een probleem waar ze nu tijd of geld aan kwijt zijn.",
    );
  });
});

describe("honest test pages", () => {
  it("flags promises the product cannot keep yet", () => {
    expect(honestyWarnings("Gegarandeerd 100% minder planningswerk")).toHaveLength(2);
    expect(honestyWarnings("De beste eventtool van Nederland, al duizenden klanten")).toHaveLength(2);
    expect(honestyWarnings("Vind sneller een passende locatie voor je teamuitje")).toEqual([]);
  });

  it("trims AI variants and adds the deterministic warnings", () => {
    const [v] = prepareVariants([{ headline: "  Nooit meer zoeken  ", subline: "x".repeat(400), offer: "Een demo", angle: "tijd", ai_honesty_notes: ["", "Belooft te veel"] }]);
    expect(v.headline).toBe("Nooit meer zoeken");
    expect(v.subline).toHaveLength(300);
    expect(v.ai_honesty_notes).toEqual(["Belooft te veel"]);
    expect(v.warnings.length).toBe(1);
  });
});
