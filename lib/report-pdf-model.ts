// The content of the PDF report as plain blocks (no React, no PDF library), built from an immutable report
// snapshot (lib/report.ts). lib/report-pdf.tsx only draws these blocks, so the report rules are tested here:
// forecasts stay hidden until the outcome is known, survey results are labelled as self-report, every claim
// carries its footnote numbers (or "geen bron"), and the appendix holds the raw counts.

import { aiEvidenceLine } from "@/lib/domain/ai-interview";
import type { ReportSnapshot } from "@/lib/report";
import { pct } from "@/lib/domain/stats";
import { CHANNELS } from "@/lib/domain/tracking";
import { describeMethodology, ruleLabelText } from "@/lib/domain/method/describe";
import { CALIBRATION_MIN_RESOLVED, UNCALIBRATED_LABEL, formatProbability, formatProbabilityRange } from "@/lib/domain/probability-display";
import { explainRecruitment } from "@/lib/domain/recruitment";
import { asEvidenceLevel, outcomeWithLevel } from "@/lib/domain/evidence";
import { allTestsSummary, type AllTestsPerAssumption, type AllTestsRow } from "@/lib/domain/all-tests";
import { ladderSummary } from "@/lib/domain/dossier-label";
import { confirmationAuditLine, decisionParagraph, extendUntilOf, reachableRevenue, sheetDate, sheetFromSnapshot, type DecisionSheet, type LegacySnapshot } from "@/lib/report-sheet";
import { todayInNL } from "@/lib/domain/sprint";
import { endSentence } from "@/lib/text";
import { CERTAINTY_LABEL, standingFromSnapshot, type EvidenceStanding } from "@/lib/domain/evidence-standing";
import { EVIDENCE_SCALE, scaleIndex } from "@/lib/domain/evidence-scale";
import { asReportCanvas, type ReportCanvas } from "@/lib/domain/canvas";

export type Tone = "blue" | "green" | "coral" | "lime" | "gray";
export type Block =
  | { t: "h"; text: string }
  | { t: "p"; text: string; small?: boolean; muted?: boolean; mono?: boolean }
  | { t: "list"; items: string[]; ordered?: boolean; small?: boolean }
  | { t: "table"; head: string[]; rows: string[][]; widths?: number[] }
  | { t: "kpis"; items: { label: string; value: string; note: string; tone: Tone }[] }
  | { t: "note"; title: string; text: string; tone?: Tone };

export type Chapter = { id: string; eyebrow: string; title: string; blocks: Block[]; breakBefore?: boolean };

export type PdfMeta = { shared: boolean; version: number };

export type ReportPdfModel = {
  title: string;
  // Fase B6: pagina 1, het beslisblad. Het volledige dossier (cover en hoofdstukken) volgt als bijlage.
  sheet: DecisionSheet;
  // Fase 1, punt 2: de Stand van het bewijs, bovenaan pagina 1.
  standing: StandingPdf;
  sheetEyebrow: string;
  cover: {
    status: string;
    statusTone: Tone;
    eyebrow: string;
    title: string;
    preparedLine: string;
    decisionQuestion: string;
    facts: { label: string; value: string }[];
  };
  chapters: Chapter[];
  footer: string;
};

const eur = (n: number | null | undefined) => (n == null || !Number.isFinite(n) ? "onbekend" : `€ ${Math.round(n).toLocaleString("nl-NL")}`);
const int = (n: number | null | undefined) => (n == null || !Number.isFinite(n) ? "onbekend" : Math.round(n).toLocaleString("nl-NL"));
const pct0 = (n: number) => `${Math.round(n * 100)}%`;
export const nlDate = (s: string | null | undefined) =>
  s ? new Date(s).toLocaleDateString("nl-NL", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Amsterdam" }) : "onbekend";
const rate = (successes: number, n: number) => (n > 0 ? pct(successes / n) : "—");

const SECTIONS: Record<string, string> = { market: "Markt en trends", customers: "Klant en probleem", competition: "Concurrentie", pricing: "Prijs en koopproces", sizing: "Marktomvang", regulation: "Regels en context", other: "Overig" };
const SIGNAL_KINDS: Record<string, string> = { job: "Taak", pain: "Pijnpunt", gain: "Gewenst resultaat", objection: "Bezwaar" };
const ASSUMPTION_STATUS: Record<string, string> = { untested: "Niet getest", testing: "Wordt getest", supported: "Ondersteund", refuted: "Weerlegd", inconclusive: "Onbeslist" };
const VERDICT: Record<string, string> = { pass: "geslaagd", fail: "niet geslaagd", running: "loopt nog" };
const RELIABILITY: Record<string, string> = { low: "laag", medium: "middel", high: "hoog" };
const QUESTION_STATUS: Record<string, string> = { answered: "Beantwoord", open: "Open" };
const channelLabel = (c: string) => CHANNELS[c as keyof typeof CHANNELS] ?? c;
const notes = (n: number[]) => (n.length ? `[${n.join(", ")}]` : "[geen bron]");

// The period in which the research was done: first source retrieved up to the moment of the snapshot.
export function researchPeriod(r: ReportSnapshot): string {
  const times = r.sources.map((s) => Date.parse(s.retrieved_at)).filter((t) => Number.isFinite(t));
  if (!times.length) return `tot ${nlDate(r.generatedAt)}`;
  const first = new Date(Math.min(...times)).toISOString();
  return `${nlDate(first)} – ${nlDate(r.generatedAt)}`;
}

export function sourceQuality(s: ReportSnapshot["sources"][number]): string {
  return `${s.type} · ${s.primary ? "primaire bron" : "secundaire bron"}`;
}

// SOM-omzet in de scenariotabel: "Niet vastgesteld" in plaats van € 0 (B6).
export function somRevenueCell(s: { somRevenue: number | null; status: string; established?: boolean }): string {
  const k = reachableRevenue(s);
  return k.established ? k.value : s.somRevenue != null && s.somRevenue > 0 ? `${eur(s.somRevenue)} (niet vastgesteld)` : "Niet vastgesteld";
}

// Gebruikerstest D4: de kans van een aanname als platte tekst, voor rapportpagina en PDF. Geen tooltip, geen "Exacte
// waarde" en geen bandbreedte die gelijk is aan de kans zelf ("40%–40%"). Het label "niet gekalibreerd" staat één keer
// in de kolomkop, niet in elke cel; de uitleg staat één keer onder de tabel (calibrationNote).
type AssumptionProbability = { probability: { point: number; low: number; high: number } | null; recruitment?: { group: string; sources: number }[] };

export function assumptionProbabilityText(a: AssumptionProbability, calibrated: boolean): string {
  if (!a.probability) return "onbekend";
  const point = formatProbability(a.probability.point, calibrated).text;
  const range = formatProbabilityRange(a.probability.low, a.probability.high, calibrated).text;
  const recruitment = (a.recruitment ?? []).map((x) => ` ${explainRecruitment(x)}`).join("");
  return `${point}${range !== point ? ` (${range})` : ""}${recruitment}`;
}

export const probabilityColumnHead = (calibrated: boolean) => (calibrated ? "Geschatte kans" : `Geschatte kans (${UNCALIBRATED_LABEL})`);

export const PROBABILITY_EXPLAIN =
  "Geschatte kans dat de aanname klopt: een beginwaarde (meestal 50%), bijgewerkt met een vaste factor per soort bewijs. Uitspraken tellen nauwelijks, gedrag en betalingen sterk. Tussen haakjes de bandbreedte als die factoren de helft zwakker of sterker zijn.";

// De uitleg bij niet-gekalibreerde kansen, één keer onder de tabel (het label zelf staat in de kolomkop).
export function calibrationNote(calibrated: boolean): string {
  return calibrated
    ? ""
    : `Deze kansen zijn nog niet aan uitkomsten getoetst: bij dit rapport had de werkruimte minder dan ${CALIBRATION_MIN_RESOLVED} opgeloste dossiers. Daarom staan ze in banden van 10 procentpunt rond de berekende waarde.`;
}

// Gebruikerstest D13: de status van een bevinding in het rapport. "tegengesproken" staat er alleen bij als de status
// dat zelf nog niet zegt (tegenstrijdig of weerlegd), zodat er nooit "(Weerlegd, tegengesproken)" staat.
export function claimStatusText(c: { status: string; statusKey?: string; contradicted: boolean }): string {
  const already = c.statusKey === "contested" || c.statusKey === "refuted";
  return `${c.status}${c.contradicted && !already ? ", tegengesproken" : ""}`;
}

// De toelichting bij het aantal bevindingen: geverifieerd, onvoldoende en (als ze er zijn) tegenstrijdig en weerlegd.
export function claimCountsNote(counts: { verified: number; insufficient: number; contested?: number; refuted?: number }): string {
  const parts = [`${counts.verified} geverifieerd`, `${counts.insufficient} onvoldoende`];
  if (counts.contested) parts.push(`${counts.contested} tegenstrijdig`);
  if (counts.refuted) parts.push(`${counts.refuted} weerlegd`);
  return parts.join(" · ");
}

// Het beslisblad van deze momentopname: opgeslagen bij het maken van de versie, of afgeleid voor oudere rapporten.
export function sheetOf(r: ReportSnapshot): DecisionSheet {
  return sheetFromSnapshot(r as unknown as LegacySnapshot, r.observationCounts ? ladderSummary(r.observationCounts) : null);
}

// Fase 1, punt 2: de Stand van het bewijs als platte tekst voor de PDF (hetzelfde blok als op het scherm).
export type StandingPdf = { title: string; summary: string; certainty: string; scale: string; lines: string[]; notes: string[] };

export function standingPdf(st: EvidenceStanding): StandingPdf {
  const current = scaleIndex(st.strongest.step);
  const p = (x: number) => formatProbability(x, st.calibrated).text;
  return {
    title: "Stand van het bewijs",
    summary: st.summary,
    certainty: `Zekerheid ${CERTAINTY_LABEL[st.certainty]}: ${st.certaintyReason}.`,
    // "Verkenning · Mening · [Gedrag] · Betaling · Herhaling": de huidige trede tussen haken.
    scale: `Bewijsschaal (sterkste bewijs): ${EVIDENCE_SCALE.map((s, i) => (i === current ? `[${s.label}]` : s.label)).join(" · ")}`,
    lines: st.assumptions.map(
      (a) =>
        `Aanname ${a.number}: ${a.statement} Kans ${p(a.probability)} · ${a.tallyLine}${a.tally.notCounted ? ` · ${a.tally.notCounted} ${a.tally.notCounted === 1 ? "telt" : "tellen"} niet mee` : ""} · ${st.derived ? "Status" : "Hoofdtest"}: ${a.primary ? (st.derived ? a.primary.status : `${a.primary.title}, ${a.primary.status}`) : "nog niet aangewezen"}.`,
    ),
    notes: [
      ...(st.next ? [`Volgende stap: ${st.next.title}. ${st.next.detail}`] : []),
      ...(st.derived ? ["Afgeleid uit een rapportversie van vóór dit blok: zonder bewijsregister, zonder de keuze \"nu testen\" en zonder hoofdtest."] : []),
      ...(st.calibrated ? [] : [`Kansen: ${UNCALIBRATED_LABEL}, in banden van 10 procentpunt.`]),
    ],
  };
}

// De datum bij de volgende stap, in woorden.
// Het canvas als compacte tabellen (bouwsteen, onderdeel, bewijsstand) onder hoofdstuk 06.
export function canvasPdfBlocks(c: ReportCanvas): Block[] {
  return [
    { t: "h", text: "Businessmodel en propositie" },
    { t: "p", text: c.summary },
    ...c.canvases.flatMap((cv): Block[] => [
      { t: "p", text: cv.label, small: true },
      {
        t: "table",
        head: ["Bouwsteen", "Onderdeel", "Bewijsstand"],
        widths: [24, 50, 26],
        rows: cv.blocks.flatMap((b) => b.items.map((i, n) => [n === 0 ? b.label : "", i.origin === "Eigen invoer" ? i.body : `${i.body} (${i.origin.toLowerCase()})`, i.standing])),
      },
    ]),
    {
      t: "p",
      small: true,
      muted: true,
      text: `De bewijsstand komt uit de gekoppelde aanname. Een leeg vak betekent onbekend; een AI-voorstel is nooit bewijs.${c.openProposals ? ` ${c.openProposals} AI-voorstel${c.openProposals === 1 ? "" : "len"} nog niet beoordeeld en niet opgenomen.` : ""}${c.latestVersion ? ` Laatst opgeslagen canvasversie: versie ${c.latestVersion.number}.` : ""}`,
    },
  ];
}

export function nextStepDate(sh: DecisionSheet): string {
  return sh.nextStep.date ? `${sheetDate(sh.nextStep.date)} (${sh.nextStep.dateLabel})` : sh.nextStep.dateLabel;
}

export function buildReportPdfModel(r: ReportSnapshot, meta: PdfMeta): ReportPdfModel {
  const realistic = r.sizing.find((s) => s.label === "Realistisch") ?? r.sizing[1] ?? null;
  const signals = r.signals ?? [];
  const chapters: Chapter[] = [];
  const revenue = reachableRevenue(realistic);
  // Methodeversie, beslisregels en plafonds (rapporten van vóór de methodeversie: 2026-11-a).
  const methodology = describeMethodology("methodology" in r ? r.methodology : null);

  // 01 Management summary
  chapters.push({
    id: "summary",
    eyebrow: "01 / MANAGEMENTSAMENVATTING",
    title: r.decision ? `Besluit: ${r.decision.action}.` : r.realityCheck ? `Advies: ${r.realityCheck.advice}.` : "Nog geen besluit.",
    blocks: [
      {
        t: "p",
        text: `${r.decision?.rationale ?? r.realityCheck?.reason ?? "Het onderzoek loopt nog."} Bewijsniveau: ${r.label}.${r.labelMissing.length ? ` Voor een hoger niveau ontbreekt: ${endSentence(r.labelMissing.join("; "))}` : ""}${r.observationCounts ? ` ${ladderSummary(r.observationCounts)}` : ""}${r.aiInterviews && r.aiInterviews.interviews > 0 ? ` ${aiEvidenceLine(r.aiInterviews)}` : ""}`,
      },
      {
        t: "kpis",
        items: [
          { label: "Bevindingen met bron", value: String(r.counts.claims), note: claimCountsNote(r.counts), tone: "blue" },
          { label: "Experimenten", value: String(r.experiments.length).padStart(2, "0"), note: `${r.learningCards.length} met goedgekeurde leerkaart`, tone: "green" },
          // B6: geen "€ 0" als de marktomvang niet is vastgesteld.
          { label: "Bereikbare jaaromzet (realistisch)", value: revenue.value, note: revenue.note, tone: "coral" },
        ],
      },
    ],
  });

  // 02 Decision question and approach
  chapters.push({
    id: "question",
    eyebrow: "02 / BESLISVRAAG EN AANPAK",
    title: "Wat moest dit onderzoek beslissen?",
    blocks: [
      { t: "p", text: `${r.idea.decisionQuestion} Het idee: ${r.idea.description} Doelgroep: ${r.idea.audience}. Regio: ${r.idea.region}.${r.idea.budget ? ` Bedrag op het spel: ${eur(r.idea.budget)}.` : ""}` },
      r.questions.length
        ? {
            t: "table",
            head: ["#", "Onderzoeksvraag", "Klaar als", "Status"],
            widths: [6, 44, 34, 16],
            rows: r.questions.map((q) => [String(q.position), q.question, q.doneCriterion, QUESTION_STATUS[q.status] ?? "Vraagt klantonderzoek"]),
          }
        : { t: "p", text: "Er zijn geen onderzoeksvragen vastgelegd.", muted: true },
    ],
  });

  // 03 Market picture with footnotes
  const market: Block[] = [];
  for (const [key, label] of Object.entries(SECTIONS)) {
    const list = r.claims.filter((c) => c.section === key);
    if (!list.length) continue;
    market.push({ t: "h", text: label });
    market.push({
      t: "list",
      items: list.map((c) => `${c.statement} ${notes(c.notes)} (${claimStatusText(c)})${c.doesNotProve ? ` Bewijst niet: ${c.doesNotProve}` : ""}`),
    });
  }
  if (!r.claims.length) market.push({ t: "p", text: "Er zijn nog geen bevindingen met bron vastgelegd.", muted: true });
  chapters.push({ id: "market", eyebrow: "03 / MARKTBEELD", title: "Wat we weten, en op basis waarvan", blocks: market });

  // 04 Competition
  const competition: Block[] = [
    r.competitors.length
      ? { t: "table", head: ["Aanbieder", "Type", "Positionering", "Prijs"], widths: [22, 18, 36, 24], rows: r.competitors.map((c) => [c.name, c.kind, c.positioning ?? "—", c.price]) }
      : { t: "p", text: "Er zijn nog geen aanbieders of alternatieven vastgelegd.", muted: true },
  ];
  if (signals.length) {
    competition.push({ t: "p", text: "Wat klanten zelf zeggen (kwalitatieve signalen uit reviews, fora en outreach; geen gedrag):" });
    competition.push({ t: "list", items: signals.slice(0, 8).map((s) => `${SIGNAL_KINDS[s.kind] ?? s.kind}: ${s.label} (${s.mentions}× letterlijk teruggevonden)`) });
  }
  chapters.push({ id: "competition", eyebrow: "04 / CONCURRENTIE EN ALTERNATIEVEN", title: "Hoe lossen klanten het nu op?", blocks: competition });

  // 05 Market potential
  const sizing: Block[] = [];
  if (r.sizing.length) {
    sizing.push({
      t: "table",
      head: ["Scenario", "TAM", "SAM", "SOM-klanten", "SOM-omzet", "Onderbouwing"],
      widths: [16, 14, 14, 15, 17, 24],
      rows: r.sizing.map((s) => [s.label, int(s.tamCount), int(s.samCount), int(s.somCount), somRevenueCell(s), `${s.provenance.sourced}/${s.provenance.total} factoren met bron`]),
    });
    if (realistic) sizing.push({ t: "p", text: `Formule (realistisch): ${realistic.formula}`, small: true, mono: true });
    sizing.push({ t: "p", text: `${realistic?.status ?? ""}. Dit is omzetpotentieel onder de getoonde aannames, geen winst en geen voorspelling.` });
  } else {
    sizing.push({ t: "p", text: "Marktomvang is nog niet berekend.", muted: true });
  }
  if (r.simulation) {
    const s = r.simulation;
    sizing.push({
      t: "p",
      text:
        `Met bandbreedtes per factor (${int(s.draws)} trekkingen, scenario ${s.label.toLowerCase()}): SOM-omzet tussen ${eur(s.somRevenue.p10)} en ${eur(s.somRevenue.p90)} (80% van de uitkomsten), mediaan ${eur(s.somRevenue.p50)}.` +
        (s.pAboveThreshold != null && s.threshold != null ? ` Kans dat de omzet ${s.thresholdIsBreakEven ? "het break-evenpunt" : "de drempel"} van ${eur(s.threshold)} haalt: ${pct0(s.pAboveThreshold)}.` : "") +
        (s.mainDriver ? ` De grootste onzekerheid zit in de factor "${s.mainDriver}".` : ""),
    });
  }
  if (r.unit) {
    const u = r.unit;
    sizing.push({
      t: "p",
      text:
        `Financieel: marge per klant ${eur(u.marginPerCustomerYear)} per jaar, terugverdientijd ${u.paybackMonths == null ? "onbekend" : `${u.paybackMonths.toFixed(1)} maanden`}, klantwaarde/wervingskosten ${u.ltvToCac == null ? "onbekend" : `${u.ltvToCac.toFixed(1)}×`}, break-even bij ${u.breakEvenCustomers ?? "onbekend"} klanten.` +
        (u.missing.length ? ` Nog onbekend: ${u.missing.join(", ")}.` : ""),
    });
  }
  if (r.businessCase) {
    const b = r.businessCase;
    sizing.push({ t: "p", text: `Businesscase: ${b.verdict.toLowerCase()}. ${b.sentence}` });
    sizing.push({
      t: "table",
      head: ["Scenario", "Omzet jaar 1", `Resultaat jaar ${b.years}`, "Quitte vanaf", "Startgeld nodig"],
      widths: [20, 20, 20, 20, 20],
      rows: b.scenarios.map((s) => [s.label, eur(s.revenueYear1), eur(s.resultLastYear), s.breakEven, eur(s.startCapital)]),
    });
    sizing.push({
      t: "p",
      small: true,
      text:
        `Betrouwbaarheid: ${b.reliability}.` +
        (b.drivers.length ? ` Weegt het zwaarst: ${b.drivers.join("; ")}.` : "") +
        (b.warnings.length ? ` Let op: ${b.warnings.join(" ")}` : "") +
        (b.missing.length ? ` Nog onbekend: ${b.missing.join(", ").toLowerCase()}.` : "") +
        " Een businesscase is een berekening met aannames, geen voorspelling en geen bewijs.",
    });
  }
  chapters.push({ id: "sizing", eyebrow: "05 / MARKTPOTENTIEEL", title: "Van onderaf berekend, met zichtbare aannames", blocks: sizing });

  // 06 Assumptions
  const withProb = r.assumptions.some((a) => a.probability);
  // Rapporten van vóór golf A hebben geen kalibratie: dan de voorzichtige weergave in banden.
  const calibrated = !!(r as { calibration?: { calibrated?: boolean } }).calibration?.calibrated;
  chapters.push({
    id: "assumptions",
    eyebrow: "06 / AANNAMES EN RISICO'S",
    title: "Wat moet waar zijn?",
    blocks: r.assumptions.length
      ? [
          {
            t: "table",
            head: ["Aanname", "Belang", withProb ? probabilityColumnHead(calibrated) : "Bewijs", "Status"],
            widths: [54, 10, 18, 18],
            rows: r.assumptions.map((a) => [
              `${a.statement}${a.premortem ? " (uit de pre-mortem)" : ""}`,
              `${a.importance}/5`,
              withProb && a.probability ? assumptionProbabilityText(a, calibrated) : `${a.evidence}%`,
              ASSUMPTION_STATUS[a.status] ?? a.status,
            ]),
          },
          ...(withProb
            ? [
                {
                  t: "p" as const,
                  small: true,
                  muted: true,
                  text: `${PROBABILITY_EXPLAIN} ${calibrationNote(calibrated)}`.trim(),
                },
              ]
            : []),
        ]
      : [{ t: "p", text: "Er zijn nog geen aannames vastgelegd.", muted: true }],
  });
  // Propositie- en businessmodelcanvas met de bewijsstand per onderdeel (oudere rapporten hebben het niet).
  const canvas = asReportCanvas((r as { canvas?: unknown }).canvas);
  if (canvas) chapters[chapters.length - 1].blocks.push(...canvasPdfBlocks(canvas));

  // 07 Experiments
  const exps: Block[] = [
    { t: "p", small: true, muted: true, text: "Het 95%-interval is de bandbreedte waarbinnen de werkelijke waarde vrijwel zeker ligt; bij kleine aantallen is die breed. Drempels zijn vóór de start vergrendeld." },
  ];
  // Verplichte lijst "Alle tests" (golf A, punt 12). Rapporten van daarvoor hebben hem niet.
  const allTests = (r as { allTests?: { rows: AllTestsRow[]; perAssumption: AllTestsPerAssumption[] } }).allTests;
  exps.push({ t: "h", text: "Alle tests" });
  if (allTests) {
    exps.push({ t: "p", small: true, text: `${allTestsSummary(allTests.rows)} Deze lijst is verplicht: ook afgebroken, mislukte en verkennende tests staan erin.` });
    if (allTests.rows.length) {
      exps.push({
        t: "table",
        head: ["Test", "Aanname", "Rol", "Status", "Resultaat", "Uitkomst"],
        widths: [20, 24, 11, 17, 10, 18],
        rows: allTests.rows.map((t) => [`${t.title} (${t.type})`, t.assumption, t.role, t.status, t.result, t.outcome]),
      });
    }
    if (allTests.perAssumption.length) {
      exps.push({ t: "list", small: true, items: allTests.perAssumption.map((a) => `${a.assumption}: ${a.total} ${a.total === 1 ? "test" : "tests"} (${a.primary} hoofdtest, ${a.exploratory} verkennend)`) });
    }
  } else {
    exps.push({ t: "p", small: true, muted: true, text: 'Dit rapport is gemaakt vóór de lijst "Alle tests" bestond.' });
  }
  if (!r.experiments.length) exps.push({ t: "p", text: "Er zijn nog geen experimenten uitgevoerd.", muted: true });
  for (const e of r.experiments) {
    exps.push({ t: "h", text: `${e.title} (${e.type})` });
    if (e.selfReported) exps.push({ t: "p", small: true, text: "Zelfrapportage, geen waargenomen gedrag: een enquête meet wat mensen over zichzelf zeggen." });
    if (e.manualEntry) exps.push({ t: "p", small: true, text: "Handmatig ingevoerd: het onderzoeksteam voerde deze resultaten zelf in; ProofLab heeft ze niet zelf waargenomen. Ze tellen hooguit als kleine handeling." });
    exps.push({ t: "p", text: `Hypothese: ${e.hypothesis} Meting: ${e.metric}. Vooraf vastgelegd (${e.lockedAt ? nlDate(e.lockedAt) : "niet vergrendeld"}): ${e.threshold}.` });
    exps.push({
      t: "p",
      text:
        `Resultaat: ${e.successes} van ${e.n}${e.interval ? ` (${pct(e.interval.point)}; 95%-interval ${pct(e.interval.low)}–${pct(e.interval.high)})` : ""}. Oordeel: ${outcomeWithLevel("label" in e && e.label ? e.label : e.verdict ? (VERDICT[e.verdict] ?? "onbeslist") : "onbeslist", asEvidenceLevel((e as { level?: unknown }).level))}${"rule" in e ? ` (${ruleLabelText(e.rule)})` : ""}. ${e.verdictReason}` +
        (e.endedEarly ? " De test is vroegtijdig beëindigd." : ""),
    });
    for (const w of e.warnings) exps.push({ t: "p", small: true, muted: true, text: `Let op: ${w}` });
  }
  for (const c of r.learningCards) {
    const cl = c as { level?: unknown; title?: string | null };
    exps.push({
      t: "note",
      title: `Leerkaart${cl.title ? `: ${cl.title}` : ""}${"level" in cl ? ` · ${outcomeWithLevel(VERDICT[c.verdict] ?? "onbeslist", asEvidenceLevel(cl.level))}` : ""}`,
      text: `We dachten: ${c.believed} We zagen: ${c.observed} Daaruit leren we: ${c.learned} Daarom: ${c.therefore} (betrouwbaarheid: ${RELIABILITY[c.reliability] ?? c.reliability})`,
    });
  }
  chapters.push({ id: "experiments", eyebrow: "07 / EXPERIMENTEN EN RESULTATEN", title: "Van mening naar meetbaar gedrag", blocks: exps });

  // 08 Counter-evidence and limitations
  const counter: string[] = [
    // D13: weerlegd (alleen tegensprekende gecontroleerde bronnen) apart van tegengesproken.
    ...r.claims.filter((c) => c.statusKey === "refuted").map((c) => `Weerlegd door gecontroleerde bronnen: ${c.statement} ${notes(c.notes)}`),
    ...r.claims.filter((c) => c.contradicted && c.statusKey !== "refuted").map((c) => `Tegengesproken door een bron: ${c.statement} ${notes(c.notes)}`),
    ...r.experiments.filter((e) => e.verdict === "fail").map((e) => `Experiment niet geslaagd: ${e.title} (${e.successes} van ${e.n}).`),
    ...r.assumptions.filter((a) => a.status === "refuted").map((a) => `Aanname weerlegd: ${a.statement}`),
    ...signals.filter((s) => s.kind === "objection").slice(0, 5).map((s) => `Bezwaar van klanten: ${s.label} (${s.mentions}×)`),
  ];
  const limits: string[] = [
    ...r.labelMissing.map((m) => `Voor een hoger bewijsniveau ontbreekt: ${m}`),
    ...r.claims.filter((c) => c.limitations).map((c) => `${c.statement}: ${c.limitations}`),
    ...r.experiments.filter((e) => e.endedEarly).map((e) => `${e.title} is vroegtijdig beëindigd.`),
    ...r.experiments.filter((e) => e.selfReported).map((e) => `${e.title} is een enquête: zelfrapportage, geen gedrag. Antwoorden via een open link zijn niet te controleren.`),
    ...r.experiments.filter((e) => e.manualEntry).map((e) => `${e.title}: resultaten handmatig ingevoerd door het onderzoeksteam, niet door ProofLab waargenomen.`),
  ];
  const reality: Block[] = [{ t: "p", small: true, muted: true, text: "De realiteitscheck zoekt vóór elk besluit bewust naar tegenbewijs, zwakke data en conclusies die het bewijs niet draagt." }];
  if (r.realityCheck) {
    reality.push({ t: "p", text: `Uitgevoerd ${nlDate(r.realityCheck.at)}${r.realityCheck.aiUsed ? ", aangevuld met kritische vragen van AI" : ""}. Advies: ${r.realityCheck.advice}. ${r.realityCheck.reason}` });
    if (r.realityCheck.findings.length) reality.push({ t: "list", items: r.realityCheck.findings.map((f) => `${f.title}${f.source === "ai" ? " (AI-vraag)" : ""}: ${f.detail}`) });
  } else {
    reality.push({ t: "p", text: "Er is nog geen realiteitscheck uitgevoerd.", muted: true });
  }
  reality.push({ t: "h", text: "Tegenbewijs" });
  reality.push(counter.length ? { t: "list", items: counter } : { t: "p", text: "Geen tegenbewijs vastgelegd. Dat betekent niet dat het er niet is.", muted: true });
  reality.push({ t: "h", text: "Beperkingen" });
  reality.push(limits.length ? { t: "list", items: limits } : { t: "p", text: "Geen aanvullende beperkingen vastgelegd.", muted: true });
  chapters.push({ id: "reality", eyebrow: "08 / TEGENARGUMENTEN EN BEPERKINGEN", title: "Wat dit onderzoek níét bewijst", blocks: reality });

  // 09 Decision with audit information
  const decision: Block[] = [];
  if (r.decision) {
    // Gebruikerstest D1/D2: dezelfde alinea als de rapportpagina; een tussenbesluit is nooit "direct definitief".
    decision.push({ t: "p", text: decisionParagraph(r.decision, todayInNL(new Date(r.generatedAt)), { hasClient: !!r.client }) });
    decision.push({
      t: "table",
      head: ["Audit", ""],
      widths: [34, 66],
      rows: [
        ["Besluit", r.decision.action],
        ["Vastgelegd op", nlDate(r.decision.at)],
        ...(r.decision.extendWeeks
          ? [["Verder testen (verlengde testfase)", `${r.decision.extendWeeks} weken${extendUntilOf(r.decision) ? `, tot ${sheetDate(extendUntilOf(r.decision))}` : ""}`]]
          : []),
        ["Bevestiging opdrachtgever", confirmationAuditLine(r.decision, !!r.client)],
        ...(r.decision.comment ? [["Opmerking opdrachtgever", `“${r.decision.comment}”`]] : []),
        ["Rapportversie", `Versie ${meta.version}, momentopname van ${nlDate(r.generatedAt)}`],
        ["Opgesteld door", `${r.preparedBy}${r.createdBy ? ` (${r.createdBy})` : ""}`],
        ["Status rapport", meta.shared ? "Gedeeld met opdrachtgever" : "Concept, niet gedeeld"],
      ],
    });
    // Golf B, punt 6: toets aan de beslisregel en de motivering bij afwijken.
    if (r.decision.rule) {
      decision.push({ t: "p", text: `Beslisregel: ${r.decision.rule.met ? "gehaald" : "niet gehaald"}. ${endSentence(r.decision.rule.lines.join("; "))}` });
      if (r.decision.rule.deviation) decision.push({ t: "p", text: `Afwijking van de beslisregel: ${r.decision.rule.deviation.label.toLowerCase()}. Motivering: ${r.decision.rule.deviation.reason}` });
    }
  } else {
    decision.push({ t: "p", text: "Er is nog geen besluit vastgelegd. Een besluit wordt altijd door een mens genomen en met datum en auteur bewaard.", muted: true });
  }
  chapters.push({ id: "decision", eyebrow: "09 / BESLUIT", title: r.decision ? `${r.decision.action}.` : "Nog geen besluit.", blocks: decision });

  // 10 Implementation advice
  const advice: string[] = [];
  if (r.decision?.nextStep) advice.push(`Volgende stap: ${endSentence(r.decision.nextStep)}`);
  for (const c of r.learningCards) if (c.therefore) advice.push(c.therefore);
  if (r.realityCheck && !r.decision) advice.push(`Advies uit de realiteitscheck: ${r.realityCheck.advice}. ${r.realityCheck.reason}`);
  if (r.labelMissing.length) advice.push(`Om het bewijs te versterken: ${endSentence(r.labelMissing.join("; "))}`);
  if (r.prediction?.outcome.statement) advice.push(`Toets over zes maanden of het idee slaagde: ${endSentence(r.prediction.outcome.statement)}`);
  chapters.push({
    id: "advice",
    eyebrow: "10 / IMPLEMENTATIEADVIES",
    title: "Wat nu?",
    blocks: advice.length ? [{ t: "list", items: advice }] : [{ t: "p", text: "Nog geen implementatieadvies: eerst een besluit.", muted: true }],
  });

  // 11 Prediction (blind until the outcome is known)
  if (r.prediction) {
    const p = r.prediction;
    const revealed = (p.result != null || !!p.stop?.review) && (p as { revealed?: boolean }).revealed !== false;
    const blocks: Block[] = [];
    blocks.push(
      p.outcome.statement
        ? {
            t: "p",
            text: `Geslaagd betekent: ${endSentence(`${p.outcome.statement.replace(/\.\s*$/, "")}${p.outcome.target != null ? ` (doel: ${p.outcome.target}${p.outcome.metric ? ` ${p.outcome.metric}` : ""})` : ""}`)} Gemeten zes maanden na het besluit${p.outcome.due ? `, op ${nlDate(p.outcome.due)}` : ""}.`,
          }
        : { t: "p", text: "Er is nog niet vastgelegd wanneer dit idee geslaagd is.", muted: true },
    );
    blocks.push({
      t: "p",
      text:
        `Basispercentage: ${p.baseRate.low != null && p.baseRate.high != null ? `${pct0(p.baseRate.low)}–${pct0(p.baseRate.high)}` : "onbekend"}` +
        (p.baseRate.reference ? ` (${p.baseRate.reference.label}; bron: ${p.baseRate.reference.source_title}). ${p.baseRate.reference.caveat}` : "") +
        (p.baseRate.own ? " (eigen afgeronde dossiers)." : "") +
        (p.baseRate.note ? ` ${p.baseRate.note}` : ""),
    });
    if (p.moments.length && revealed) {
      blocks.push({
        t: "table",
        head: ["Moment", "Mensen (gemiddeld, spreiding)", "AI", "Brier per voorspelling"],
        widths: [18, 32, 10, 40],
        rows: p.moments.map((m) => [
          m.moment,
          m.people ? `${pct0(m.people.mean)} (${pct0(m.people.min)}–${pct0(m.people.max)}, n=${m.people.n})` : "—",
          m.ai != null ? pct0(m.ai) : "—",
          p.stop ? "Niet gescoord (gestopt)" : m.forecasts.map((f) => `${f.who} ${f.brier?.toFixed(2) ?? "—"}`).join(" · "),
        ]),
      });
    } else if (p.moments.length) {
      blocks.push({
        t: "p",
        text: `Voorspellingen vastgelegd: ${p.moments.map((m) => `${m.moment.toLowerCase()} (${m.count})`).join(", ")}. De kansen zelf blijven verborgen tot de uitkomst bekend is, zodat niemand op een ander kan afgaan.`,
      });
    }
    blocks.push({ t: "p", small: true, muted: true, text: "Iedereen geeft zijn kans zonder de anderen te zien. De AI telt als één stem (het gemiddelde van de modellen), niet mee in het gemiddelde van de mensen, en is geen bewijs." });
    for (const c of p.checkins) blocks.push({ t: "p", text: `Tussenstand ${nlDate(c.at)}: ${c.onTrack.toLowerCase()}${c.value != null ? ` (stand: ${c.value})` : ""}. ${c.note ?? ""}` });
    // Golf B, punt 1: na een stop of pauze de stopvraag; voorspellingen worden niet gescoord als slagingskans.
    if (p.stop)
      blocks.push({
        t: "p",
        text: `Dit dossier is gestopt of gepauzeerd. De oorspronkelijke uitkomstvraag is daarmee vervallen en de voorspellingen worden niet gescoord als slagingskans. Zes maanden na het besluit volgt de vraag: was stoppen achteraf terecht? ${p.stop.review ? `Vastgelegd op ${nlDate(p.stop.review.at)}: ${p.stop.review.justified.toLowerCase()}. ${p.stop.review.evidence}` : "Nog niet beantwoord."}`,
      });
    if (p.result)
      blocks.push({
        t: "p",
        text: `Vastgelegd op ${nlDate(p.result.at)}: ${p.result.achieved.toLowerCase()}${p.result.value != null ? ` (werkelijk: ${p.result.value})` : ""}. ${p.result.evidence}${p.result.effort ? ` Inzet: ${p.result.effort.toLowerCase()}.` : ""}${p.result.insufficient ? " Onvoldoende uitgevoerd: de uitkomst zegt vooral iets over de uitvoering." : ""}`,
      });
    chapters.push({ id: "prediction", eyebrow: "11 / VOORSPELLING EN UITKOMST", title: p.result ? `Uitkomst: ${p.result.achieved.toLowerCase()}.` : "Wat verwachten we, en hoe toetsen we dat?", blocks });
  }

  // Sources: numbered footnotes with URL, dates and quality label
  chapters.push({
    id: "sources",
    eyebrow: "BRONNEN",
    title: "Bronvermelding",
    breakBefore: true,
    blocks: [
      r.sources.length
        ? {
            t: "list",
            ordered: true,
            small: true,
            items: r.sources.map(
              (s) => `${s.publisher ? `${s.publisher}, ` : ""}${s.title}. Kwaliteit: ${sourceQuality(s)}. Gepubliceerd: ${nlDate(s.published_on)}; opgehaald: ${nlDate(s.retrieved_at)}.${s.url ? ` ${s.url}` : " Geen URL (document of upload)."}`,
            ),
          }
        : { t: "p", text: "Geen bronnen.", muted: true },
      {
        t: "p",
        small: true,
        muted: true,
        text:
          "Methode: elke bevinding steunt op een letterlijk citaat dat automatisch is teruggevonden in de bewaarde bronpassage; de status wordt berekend, niet gekozen. Experimentdrempels zijn vóór de start vergrendeld. " +
          (r.method.aiCalls ? `AI is ${r.method.aiCalls}× gebruikt (${r.method.models.join(", ")}; kosten $${r.method.aiCostUsd}). AI-uitvoer telt nooit als bewijs.` : "Er is geen AI gebruikt."),
      },
      { t: "p", small: true, text: `Rekenwijze: ${methodology.title}.` },
      { t: "list", small: true, items: methodology.lines },
    ],
  });

  // Appendix: raw measurement data
  const raw: Block[] = [];
  if (r.experiments.length) {
    raw.push({
      t: "table",
      head: ["Experiment", "Type", "n", "Successen", "Aandeel", "Per kanaal (successen/n)"],
      widths: [24, 13, 8, 11, 10, 34],
      rows: r.experiments.map((e) => [
        e.title,
        `${e.type}${e.selfReported ? " (zelfrapportage)" : ""}`,
        String(e.n),
        String(e.successes),
        rate(e.successes, e.n),
        e.byChannel.length ? e.byChannel.map((c) => `${channelLabel(c.channel)} ${c.actions}/${c.visitors}`).join(" · ") : "—",
      ]),
    });
    for (const e of r.experiments) {
      if (e.byVariant.length) {
        raw.push({ t: "h", text: `${e.title}: per prijspunt` });
        raw.push({ t: "table", head: ["Variant", "Bezoekers", "Acties", "Aandeel"], rows: e.byVariant.map((v) => [v.label, String(v.visitors), String(v.actions), rate(v.actions, v.visitors)]) });
      }
      if (e.bySource) {
        raw.push({ t: "h", text: `${e.title}: kernvraag per herkomst (zelfrapportage)` });
        raw.push({
          t: "table",
          head: ["Herkomst", "Respondenten", "Succesantwoord", "Aandeel"],
          rows: [
            ["Persoonlijk uitgenodigd", String(e.bySource.invitation.n), String(e.bySource.invitation.successes), rate(e.bySource.invitation.successes, e.bySource.invitation.n)],
            ["Open link (herkomst niet te controleren)", String(e.bySource.openLink.n), String(e.bySource.openLink.successes), rate(e.bySource.openLink.successes, e.bySource.openLink.n)],
          ],
        });
      }
    }
  } else {
    raw.push({ t: "p", text: "Geen meetdata: er zijn nog geen experimenten gestart.", muted: true });
  }
  raw.push({ t: "p", small: true, muted: true, text: "Ruwe aantallen zoals op het moment van deze momentopname. Gegevens van individuele deelnemers staan niet in het rapport." });
  chapters.push({ id: "appendix", eyebrow: "BIJLAGE A", title: "Ruwe meetdata", blocks: raw });

  const status = r.idea.isDemo ? "DEMO · GEEN ECHT ONDERZOEK" : r.label.toUpperCase();
  return {
    title: `ProofLab-rapport: ${r.idea.title} (versie ${meta.version})`,
    sheet: sheetOf(r),
    standing: standingPdf(standingFromSnapshot(r)),
    sheetEyebrow: `BESLISBLAD · VERSIE ${meta.version} · ${nlDate(r.generatedAt).toUpperCase()}`,
    cover: {
      status,
      statusTone: r.idea.isDemo ? "coral" : "blue",
      eyebrow: `BIJLAGE · VOLLEDIG VALIDATIEDOSSIER · VERSIE ${meta.version} · ${nlDate(r.generatedAt).toUpperCase()}`,
      title: r.idea.title,
      preparedLine: r.client ? `Opgesteld door ${r.preparedBy} voor ${r.client}.` : `Opgesteld door ${r.preparedBy}.`,
      decisionQuestion: r.idea.decisionQuestion,
      facts: [
        { label: "Rapportstatus", value: `${meta.shared ? "Gedeeld met opdrachtgever" : "Concept, niet gedeeld"} · bewijsniveau ${r.label}` },
        { label: "Onderzoeksperiode", value: researchPeriod(r) },
        { label: "Momentopname", value: nlDate(r.generatedAt) },
        { label: "Besluit", value: r.decision ? `${r.decision.action} (${nlDate(r.decision.at)})` : "Nog geen besluit" },
      ],
    },
    chapters,
    footer: `ProofLab · ${r.preparedBy} · Versie ${meta.version} · ${nlDate(r.generatedAt)}`,
  };
}
