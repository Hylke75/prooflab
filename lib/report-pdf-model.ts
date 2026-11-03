// The content of the PDF report as plain blocks (no React, no PDF library), built from an immutable report
// snapshot (lib/report.ts). lib/report-pdf.tsx only draws these blocks, so the report rules are tested here:
// forecasts stay hidden until the outcome is known, survey results are labelled as self-report, every claim
// carries its footnote numbers (or "geen bron"), and the appendix holds the raw counts.

import type { ReportSnapshot } from "@/lib/report";
import { pct } from "@/lib/domain/stats";
import { CHANNELS } from "@/lib/domain/tracking";
import { describeMethodology, ruleLabelText } from "@/lib/domain/method/describe";
import { CALIBRATION_MIN_RESOLVED, formatProbability, formatProbabilityRange } from "@/lib/domain/probability-display";
import { explainRecruitment } from "@/lib/domain/recruitment";
import { asEvidenceLevel, outcomeWithLevel } from "@/lib/domain/evidence";

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

export function buildReportPdfModel(r: ReportSnapshot, meta: PdfMeta): ReportPdfModel {
  const realistic = r.sizing.find((s) => s.label === "Realistisch") ?? r.sizing[1] ?? null;
  const signals = r.signals ?? [];
  const chapters: Chapter[] = [];
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
        text: `${r.decision?.rationale ?? r.realityCheck?.reason ?? "Het onderzoek loopt nog."} Bewijsniveau: ${r.label}.${r.labelMissing.length ? ` Voor een hoger niveau ontbreekt: ${r.labelMissing.join("; ")}.` : ""}`,
      },
      {
        t: "kpis",
        items: [
          { label: "Bevindingen met bron", value: String(r.counts.claims), note: `${r.counts.verified} geverifieerd · ${r.counts.insufficient} onvoldoende`, tone: "blue" },
          { label: "Experimenten", value: String(r.experiments.length).padStart(2, "0"), note: `${r.learningCards.length} met goedgekeurde Learning Card`, tone: "green" },
          { label: "Bereikbare jaaromzet (realistisch)", value: realistic ? eur(realistic.somRevenue) : "?", note: realistic?.status ?? "niet berekend", tone: "coral" },
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
      items: list.map((c) => `${c.statement} ${notes(c.notes)} (${c.status}${c.contradicted ? ", tegengesproken" : ""})${c.doesNotProve ? ` Bewijst niet: ${c.doesNotProve}` : ""}`),
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
      rows: r.sizing.map((s) => [s.label, int(s.tamCount), int(s.samCount), int(s.somCount), eur(s.somRevenue), `${s.provenance.sourced}/${s.provenance.total} factoren met bron`]),
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
            head: ["Aanname", "Belang", withProb ? (calibrated ? "Geschatte kans" : "Geschatte kans (niet gekalibreerd)") : "Bewijs", "Status"],
            widths: [54, 10, 18, 18],
            rows: r.assumptions.map((a) => [
              `${a.statement}${a.premortem ? " (uit de pre-mortem)" : ""}`,
              `${a.importance}/5`,
              withProb && a.probability
                ? `${formatProbability(a.probability.point, calibrated).text} (${formatProbabilityRange(a.probability.low, a.probability.high, calibrated).text})` +
                  ((a as { recruitment?: { group: string; sources: number }[] }).recruitment ?? []).map((x) => ` ${explainRecruitment(x)}`).join("")
                : `${a.evidence}%`,
              ASSUMPTION_STATUS[a.status] ?? a.status,
            ]),
          },
          ...(withProb
            ? [
                {
                  t: "p" as const,
                  small: true,
                  muted: true,
                  text:
                    "Geschatte kans dat de aanname klopt: een beginwaarde (meestal 50%), bijgewerkt met een vaste factor per soort bewijs. Uitspraken tellen nauwelijks, gedrag en betalingen sterk." +
                    (calibrated
                      ? ""
                      : ` Niet gekalibreerd: bij dit rapport had de werkruimte minder dan ${CALIBRATION_MIN_RESOLVED} opgeloste dossiers om deze kansen aan te toetsen. Daarom staan ze in banden van 10 procentpunt.`),
                },
              ]
            : []),
        ]
      : [{ t: "p", text: "Er zijn nog geen aannames vastgelegd.", muted: true }],
  });

  // 07 Experiments
  const exps: Block[] = [
    { t: "p", small: true, muted: true, text: "Het 95%-interval is de bandbreedte waarbinnen de werkelijke waarde vrijwel zeker ligt; bij kleine aantallen is die breed. Drempels zijn vóór de start vergrendeld." },
  ];
  if (!r.experiments.length) exps.push({ t: "p", text: "Er zijn nog geen experimenten uitgevoerd.", muted: true });
  for (const e of r.experiments) {
    exps.push({ t: "h", text: `${e.title} (${e.type})` });
    if (e.selfReported) exps.push({ t: "p", small: true, text: "Zelfrapportage, geen waargenomen gedrag: een enquête meet wat mensen over zichzelf zeggen." });
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
      title: `Learning Card${cl.title ? `: ${cl.title}` : ""}${"level" in cl ? ` · ${outcomeWithLevel(VERDICT[c.verdict] ?? "onbeslist", asEvidenceLevel(cl.level))}` : ""}`,
      text: `We dachten: ${c.believed} We zagen: ${c.observed} Daaruit leren we: ${c.learned} Daarom: ${c.therefore} (betrouwbaarheid: ${RELIABILITY[c.reliability] ?? c.reliability})`,
    });
  }
  chapters.push({ id: "experiments", eyebrow: "07 / EXPERIMENTEN EN RESULTATEN", title: "Van mening naar meetbaar gedrag", blocks: exps });

  // 08 Counter-evidence and limitations
  const counter: string[] = [
    ...r.claims.filter((c) => c.contradicted).map((c) => `Tegengesproken door een bron: ${c.statement} ${notes(c.notes)}`),
    ...r.experiments.filter((e) => e.verdict === "fail").map((e) => `Experiment niet geslaagd: ${e.title} (${e.successes} van ${e.n}).`),
    ...r.assumptions.filter((a) => a.status === "refuted").map((a) => `Aanname weerlegd: ${a.statement}`),
    ...signals.filter((s) => s.kind === "objection").slice(0, 5).map((s) => `Bezwaar van klanten: ${s.label} (${s.mentions}×)`),
  ];
  const limits: string[] = [
    ...r.labelMissing.map((m) => `Voor een hoger bewijsniveau ontbreekt: ${m}`),
    ...r.claims.filter((c) => c.limitations).map((c) => `${c.statement}: ${c.limitations}`),
    ...r.experiments.filter((e) => e.endedEarly).map((e) => `${e.title} is vroegtijdig beëindigd.`),
    ...r.experiments.filter((e) => e.selfReported).map((e) => `${e.title} is een enquête: zelfrapportage, geen gedrag. Antwoorden via een open link zijn niet te controleren.`),
  ];
  const reality: Block[] = [{ t: "p", small: true, muted: true, text: "De Reality Check zoekt vóór elk besluit bewust naar tegenbewijs, zwakke data en conclusies die het bewijs niet draagt." }];
  if (r.realityCheck) {
    reality.push({ t: "p", text: `Uitgevoerd ${nlDate(r.realityCheck.at)}${r.realityCheck.aiUsed ? ", aangevuld met kritische vragen van AI" : ""}. Advies: ${r.realityCheck.advice}. ${r.realityCheck.reason}` });
    if (r.realityCheck.findings.length) reality.push({ t: "list", items: r.realityCheck.findings.map((f) => `${f.title}${f.source === "ai" ? " (AI-vraag)" : ""}: ${f.detail}`) });
  } else {
    reality.push({ t: "p", text: "Er is nog geen Reality Check uitgevoerd.", muted: true });
  }
  reality.push({ t: "h", text: "Tegenbewijs" });
  reality.push(counter.length ? { t: "list", items: counter } : { t: "p", text: "Geen tegenbewijs vastgelegd. Dat betekent niet dat het er niet is.", muted: true });
  reality.push({ t: "h", text: "Beperkingen" });
  reality.push(limits.length ? { t: "list", items: limits } : { t: "p", text: "Geen aanvullende beperkingen vastgelegd.", muted: true });
  chapters.push({ id: "reality", eyebrow: "08 / TEGENARGUMENTEN EN BEPERKINGEN", title: "Wat dit onderzoek níét bewijst", blocks: reality });

  // 09 Decision with audit information
  const decision: Block[] = [];
  if (r.decision) {
    decision.push({ t: "p", text: r.decision.rationale });
    decision.push({
      t: "table",
      head: ["Audit", ""],
      widths: [34, 66],
      rows: [
        ["Besluit", r.decision.action],
        ["Vastgelegd op", nlDate(r.decision.at)],
        ["Bevestiging opdrachtgever", r.decision.confirmedAt ? `Bevestigd op ${nlDate(r.decision.confirmedAt)}` : "Nog niet bevestigd"],
        ...(r.decision.comment ? [["Opmerking opdrachtgever", `“${r.decision.comment}”`]] : []),
        ["Rapportversie", `Versie ${meta.version}, momentopname van ${nlDate(r.generatedAt)}`],
        ["Opgesteld door", `${r.preparedBy}${r.createdBy ? ` (${r.createdBy})` : ""}`],
        ["Status rapport", meta.shared ? "Gedeeld met opdrachtgever" : "Concept, niet gedeeld"],
      ],
    });
  } else {
    decision.push({ t: "p", text: "Er is nog geen besluit vastgelegd. Een besluit wordt altijd door een mens genomen en met datum en auteur bewaard.", muted: true });
  }
  chapters.push({ id: "decision", eyebrow: "09 / BESLUIT", title: r.decision ? `${r.decision.action}.` : "Nog geen besluit.", blocks: decision });

  // 10 Implementation advice
  const advice: string[] = [];
  if (r.decision?.nextStep) advice.push(`Volgende stap: ${r.decision.nextStep}.`);
  for (const c of r.learningCards) if (c.therefore) advice.push(c.therefore);
  if (r.realityCheck && !r.decision) advice.push(`Advies uit de Reality Check: ${r.realityCheck.advice}. ${r.realityCheck.reason}`);
  if (r.labelMissing.length) advice.push(`Om het bewijs te versterken: ${r.labelMissing.join("; ")}.`);
  if (r.prediction?.outcome.statement) advice.push(`Toets over zes maanden of het idee slaagde: ${r.prediction.outcome.statement}.`);
  chapters.push({
    id: "advice",
    eyebrow: "10 / IMPLEMENTATIEADVIES",
    title: "Wat nu?",
    blocks: advice.length ? [{ t: "list", items: advice }] : [{ t: "p", text: "Nog geen implementatieadvies: eerst een besluit.", muted: true }],
  });

  // 11 Prediction (blind until the outcome is known)
  if (r.prediction) {
    const p = r.prediction;
    const revealed = p.result != null && (p as { revealed?: boolean }).revealed !== false;
    const blocks: Block[] = [];
    blocks.push(
      p.outcome.statement
        ? {
            t: "p",
            text: `Geslaagd betekent: ${p.outcome.statement}${p.outcome.target != null ? ` (doel: ${p.outcome.target}${p.outcome.metric ? ` ${p.outcome.metric}` : ""})` : ""}. Gemeten zes maanden na het besluit${p.outcome.due ? `, op ${nlDate(p.outcome.due)}` : ""}.`,
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
          m.forecasts.map((f) => `${f.who} ${f.brier?.toFixed(2) ?? "—"}`).join(" · "),
        ]),
      });
    } else if (p.moments.length) {
      blocks.push({
        t: "p",
        text: `Voorspellingen vastgelegd: ${p.moments.map((m) => `${m.moment.toLowerCase()} (${m.count})`).join(", ")}. De kansen zelf blijven verborgen tot de uitkomst bekend is, zodat niemand op een ander kan afgaan.`,
      });
    }
    blocks.push({ t: "p", small: true, muted: true, text: "Iedereen geeft zijn kans zonder de anderen te zien. Een AI-voorspelling telt niet mee in het gemiddelde en is geen bewijs." });
    for (const c of p.checkins) blocks.push({ t: "p", text: `Tussenstand ${nlDate(c.at)}: ${c.onTrack.toLowerCase()}${c.value != null ? ` (stand: ${c.value})` : ""}. ${c.note ?? ""}` });
    if (p.result) blocks.push({ t: "p", text: `Vastgelegd op ${nlDate(p.result.at)}: ${p.result.achieved.toLowerCase()}${p.result.value != null ? ` (werkelijk: ${p.result.value})` : ""}. ${p.result.evidence}` });
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
    cover: {
      status,
      statusTone: r.idea.isDemo ? "coral" : "blue",
      eyebrow: `VALIDATIEDOSSIER · VERSIE ${meta.version} · ${nlDate(r.generatedAt).toUpperCase()}`,
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
