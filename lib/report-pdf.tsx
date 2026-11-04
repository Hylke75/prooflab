// Server-side PDF of a report snapshot with @react-pdf/renderer (pure JavaScript, no headless browser, so it runs
// in a Vercel function). Draws the blocks of lib/report-pdf-model.ts in the ProofLab style.
// Fonts: Space Grotesk and DM Sans are not available as local files (the app loads them through next/font at build
// time), so the PDF uses the built-in Helvetica; see DESIGN_DIFF_LOG.md.

import type { Style } from "@react-pdf/types";
import { Document, Font, Page, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";
import type { ReportSnapshot } from "@/lib/report";
import { buildReportPdfModel, nextStepDate, type Block, type PdfMeta, type ReportPdfModel, type Tone } from "@/lib/report-pdf-model";
import type { SheetVerdict } from "@/lib/report-sheet";

// Design tokens from CLAUDE.md.
const C = {
  ink: "#151b28",
  blue: "#4557f4",
  coral: "#ff7962",
  lime: "#e0f49d",
  mint: "#d5f2e6",
  cream: "#f7f7f3",
  white: "#ffffff",
  line: "#e6e8e5",
  muted: "#747d8e",
  soft: "#f2f3ef",
  green: "#177f60",
  body: "#3d4657",
};
const TONE_BG: Record<Tone, string> = { blue: "#e7eaff", green: "#e3f3e8", coral: "#fff0e6", lime: C.lime, gray: C.soft };
const TONE_FG: Record<Tone, string> = { blue: C.blue, green: C.green, coral: "#b4472f", lime: C.ink, gray: C.muted };

// Dutch words must not be hyphenated with the English default rules.
Font.registerHyphenationCallback((word) => [word]);

// The standard PDF fonts only cover WinAnsi (Latin-1 plus a few typographic signs). Replace what falls outside.
const WIN_ANSI_EXTRA = new Set("€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ");
const REPLACE: Record<string, string> = { "≥": ">=", "≤": "<=", "→": "->", "←": "<-", "−": "-", "≈": "~", "✓": "v", "◉": "", " ": " ", " ": " ", " ": " ", "​": "" };
export function pdfText(s: string): string {
  let out = "";
  for (const ch of s.normalize("NFC")) {
    const code = ch.codePointAt(0)!;
    if (REPLACE[ch] !== undefined) out += REPLACE[ch];
    else if (code === 10 || (code >= 0x20 && code <= 0x7e) || (code >= 0xa0 && code <= 0xff) || WIN_ANSI_EXTRA.has(ch)) out += ch;
    else out += "?";
  }
  return out;
}

const s = StyleSheet.create({
  page: { backgroundColor: C.white, color: C.ink, fontFamily: "Helvetica", fontSize: 9.5, paddingTop: 46, paddingBottom: 56, paddingHorizontal: 50 },
  cover: { backgroundColor: C.white, color: C.ink, fontFamily: "Helvetica", padding: 50, display: "flex", flexDirection: "column" },
  brandRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  brand: { flexDirection: "row", alignItems: "center", gap: 6 },
  brandDot: { width: 14, height: 14, borderRadius: 7, borderWidth: 3, borderColor: C.ink },
  brandText: { fontFamily: "Helvetica-Bold", fontSize: 18, letterSpacing: -0.6 },
  pill: { fontFamily: "Helvetica-Bold", fontSize: 7.5, letterSpacing: 0.8, paddingVertical: 4, paddingHorizontal: 9, borderRadius: 10 },
  eyebrow: { fontFamily: "Helvetica-Bold", fontSize: 7.5, letterSpacing: 1.3, color: C.muted, textTransform: "uppercase" },
  coverTitle: { fontFamily: "Helvetica-Bold", fontSize: 34, lineHeight: 1.08, letterSpacing: -1.2, marginTop: 10 },
  coverSub: { fontSize: 11, color: C.body, marginTop: 14, lineHeight: 1.5 },
  coverBand: { marginTop: 34, backgroundColor: C.cream, borderRadius: 14, padding: 18 },
  factRow: { flexDirection: "row", paddingVertical: 6, borderBottomWidth: 0.6, borderBottomColor: C.line },
  factLabel: { width: "34%", fontFamily: "Helvetica-Bold", fontSize: 8.5, color: C.muted },
  factValue: { width: "66%", fontSize: 9.5 },
  shape: { position: "absolute", right: 50, bottom: 110, width: 120, height: 120 },
  section: { marginTop: 22, paddingTop: 16, borderTopWidth: 0.8, borderTopColor: C.line },
  h2: { fontFamily: "Helvetica-Bold", fontSize: 16, letterSpacing: -0.4, marginTop: 5, marginBottom: 8, lineHeight: 1.2 },
  h3: { fontFamily: "Helvetica-Bold", fontSize: 10.5, marginTop: 10, marginBottom: 3 },
  // lineHeight on the text styles, not on the page: a render-prop Text (page numbers) that inherits a page
  // lineHeight is not drawn (react-pdf 4.9).
  p: { marginBottom: 6, color: C.body, fontSize: 9.5, lineHeight: 1.5 },
  small: { fontSize: 8, lineHeight: 1.45 },
  muted: { color: C.muted },
  mono: { fontFamily: "Courier", fontSize: 7.5 },
  li: { flexDirection: "row", marginBottom: 3 },
  bullet: { width: 14, color: C.muted },
  liText: { flex: 1, color: C.body, fontSize: 9.5, lineHeight: 1.5 },
  kpis: { flexDirection: "row", gap: 10, marginVertical: 10 },
  kpi: { flex: 1, borderRadius: 12, padding: 12 },
  kpiLabel: { fontSize: 7.5, color: C.body },
  kpiValue: { fontFamily: "Helvetica-Bold", fontSize: 22, lineHeight: 1.2, letterSpacing: -0.6, marginTop: 4, marginBottom: 2 },
  kpiNote: { fontSize: 7.5, color: C.body },
  table: { marginVertical: 6, borderTopWidth: 0.8, borderTopColor: C.ink },
  tr: { flexDirection: "row", borderBottomWidth: 0.6, borderBottomColor: C.line },
  th: { fontFamily: "Helvetica-Bold", fontSize: 7.5, color: C.muted, paddingVertical: 5, paddingRight: 6 },
  td: { fontSize: 8.5, lineHeight: 1.4, paddingVertical: 5, paddingRight: 6, color: C.body },
  note: { borderRadius: 10, padding: 10, marginVertical: 6 },
  noteTitle: { fontFamily: "Helvetica-Bold", fontSize: 8.5, marginBottom: 2 },
  footerLine: { position: "absolute", bottom: 38, left: 50, right: 50, height: 0.6, backgroundColor: C.line },
  footerLeft: { position: "absolute", bottom: 24, left: 50, fontSize: 7.5, color: C.muted },
  footerRight: { position: "absolute", bottom: 24, right: 50, width: 120, textAlign: "right", fontSize: 7.5, color: C.muted },
  footer: { position: "absolute", bottom: 26, left: 50, right: 50, flexDirection: "row", justifyContent: "space-between", fontSize: 7.5, color: C.muted, borderTopWidth: 0.6, borderTopColor: C.line, paddingTop: 8 },
});

// Beslisblad (B6): de kleur van het besluit. Doorgaan groen, stoppen koraal, nog niet beslisbaar limoen.
const VERDICT_TONE: Record<SheetVerdict, Tone> = { continue: "green", stop: "coral", undecidable: "lime" };

const T = ({ children, style }: { children: string; style?: Style | Style[] }) => <Text style={style}>{pdfText(children)}</Text>;

function BlockView({ b }: { b: Block }) {
  switch (b.t) {
    case "h":
      return <T style={s.h3}>{b.text}</T>;
    case "p":
      return <T style={[s.p, b.small ? s.small : {}, b.muted ? s.muted : {}, b.mono ? s.mono : {}]}>{b.text}</T>;
    case "list":
      return (
        <View style={{ marginBottom: 6 }}>
          {b.items.map((item, i) => (
            <View key={i} style={s.li} wrap={false}>
              <T style={[s.bullet, b.small ? s.small : {}]}>{b.ordered ? `${i + 1}.` : "•"}</T>
              <T style={[s.liText, b.small ? s.small : {}]}>{item}</T>
            </View>
          ))}
        </View>
      );
    case "kpis":
      return (
        <View style={s.kpis} wrap={false}>
          {b.items.map((k, i) => (
            <View key={i} style={[s.kpi, { backgroundColor: TONE_BG[k.tone] }]}>
              <T style={s.kpiLabel}>{k.label}</T>
              <T style={s.kpiValue}>{k.value}</T>
              <T style={s.kpiNote}>{k.note}</T>
            </View>
          ))}
        </View>
      );
    case "table": {
      const widths = b.widths ?? b.head.map(() => 100 / b.head.length);
      return (
        <View style={s.table}>
          <View style={s.tr} fixed={false}>
            {b.head.map((h, i) => (
              <T key={i} style={[s.th, { width: `${widths[i]}%` }]}>{h.toUpperCase()}</T>
            ))}
          </View>
          {b.rows.map((row, r) => (
            <View key={r} style={s.tr} wrap={false}>
              {row.map((cell, i) => (
                <T key={i} style={[s.td, { width: `${widths[i]}%` }]}>{cell}</T>
              ))}
            </View>
          ))}
        </View>
      );
    }
    case "note":
      return (
        <View style={[s.note, { backgroundColor: TONE_BG[b.tone ?? "lime"] }]} wrap={false}>
          <T style={s.noteTitle}>{b.title}</T>
          <T style={[s.small, { color: C.ink }]}>{b.text}</T>
        </View>
      );
  }
}

// Pagina 1: het beslisblad. Eén pagina; het volledige dossier volgt als bijlage.
function SheetPage({ model }: { model: ReportPdfModel }) {
  const sh = model.sheet;
  const c = model.cover;
  const tone = VERDICT_TONE[sh.verdict];
  return (
    <Page size="A4" style={s.page}>
      <View style={s.brandRow}>
        <View style={s.brand}>
          <View style={s.brandDot} />
          <Text style={s.brandText}>ProofLab.</Text>
        </View>
        <T style={[s.pill, { backgroundColor: TONE_BG[c.statusTone], color: TONE_FG[c.statusTone] }]}>{c.status}</T>
      </View>
      <View style={{ marginTop: 22 }}>
        <T style={s.eyebrow}>{model.sheetEyebrow}</T>
        <T style={[s.h2, { fontSize: 20, marginTop: 6 }]}>{c.title}</T>
        <T style={[s.p, s.small]}>{`Beslisvraag: ${c.decisionQuestion}`}</T>
      </View>
      <View style={[s.note, { backgroundColor: TONE_BG[tone], padding: 14, marginTop: 8 }]} wrap={false}>
        <T style={s.eyebrow}>Besluit</T>
        <T style={[s.kpiValue, { color: TONE_FG[tone] }]}>{sh.verdictLabel}</T>
        <T style={[s.p, { marginBottom: 2, color: C.ink }]}>{`Bewijsniveau: ${sh.evidenceLevel}.${sh.ladder ? ` ${sh.ladder}` : ""}`}</T>
        {sh.decisionLine && <T style={[s.small, { color: C.ink }]}>{`Vastgelegd besluit: ${sh.decisionLine}.`}</T>}
        {sh.reasons.map((x, i) => (
          <View key={i} style={s.li}>
            <T style={[s.bullet, s.small]}>•</T>
            <T style={[s.liText, s.small, { color: C.ink }]}>{x}</T>
          </View>
        ))}
      </View>
      <T style={s.h3}>De 3 sterkste bewijsstukken</T>
      {sh.strongest.length === 0 && <T style={[s.p, s.muted]}>Nog geen geverifieerde bron en geen echte waarneming.</T>}
      {sh.strongest.map((e, i) => (
        <View key={i} wrap={false} style={{ marginBottom: 5 }}>
          <View style={s.li}>
            <T style={s.bullet}>{`${i + 1}.`}</T>
            <T style={s.liText}>{`${e.against ? "Tegenbewijs: " : ""}${e.text}`}</T>
          </View>
          <View style={s.li}>
            <T style={s.bullet}> </T>
            <T style={[s.liText, s.small, s.muted]}>{`Bron: ${e.source}${e.note ? ` [${e.note}]` : ""}${e.url ? ` · ${e.url}` : ""} · niveau: ${e.level}`}</T>
          </View>
        </View>
      ))}
      <T style={s.h3}>Wat níét bewezen is</T>
      {sh.notProven.length === 0 && <T style={[s.p, s.muted]}>Geen open punten vastgesteld. Dat betekent niet dat alles bewezen is; zie de bijlage.</T>}
      {sh.notProven.map((x, i) => (
        <View key={i} style={s.li} wrap={false}>
          <T style={s.bullet}>•</T>
          <T style={s.liText}>{x}</T>
        </View>
      ))}
      {sh.notProvenMore > 0 && <T style={[s.small, s.muted]}>{`En ${sh.notProvenMore} ${sh.notProvenMore === 1 ? "punt" : "punten"} meer in de bijlage.`}</T>}
      <T style={s.h3}>Volgende stap</T>
      <T style={s.p}>{sh.nextStep.text}</T>
      <T style={[s.small, s.muted]}>{`Datum: ${nextStepDate(sh)}`}</T>
      <T style={[s.small, s.muted, { marginTop: 14 }]}>
        {`Het volledige dossier volgt als bijlage: beslisvraag, marktbeeld, concurrentie, marktpotentieel, aannames, experimenten, tegenargumenten, besluit en bronnen.${sh.derived ? " Dit beslisblad is afgeleid uit een rapportversie van vóór het beslisblad." : ""}`}
      </T>
      <View style={s.footerLine} fixed />
      <Text style={s.footerLeft} fixed>
        {pdfText(model.footer)}
      </Text>
    </Page>
  );
}

export function ReportPdfDocument({ model }: { model: ReportPdfModel }) {
  const c = model.cover;
  return (
    <Document title={pdfText(model.title)} author="ProofLab" creator="ProofLab" producer="ProofLab" language="nl-NL">
      <SheetPage model={model} />
      <Page size="A4" style={s.cover}>
        <View style={s.brandRow}>
          <View style={s.brand}>
            <View style={s.brandDot} />
            <Text style={s.brandText}>ProofLab.</Text>
          </View>
          <T style={[s.pill, { backgroundColor: TONE_BG[c.statusTone], color: TONE_FG[c.statusTone] }]}>{c.status}</T>
        </View>
        <View style={{ marginTop: 150 }}>
          <T style={s.eyebrow}>{c.eyebrow}</T>
          <T style={s.coverTitle}>{c.title}</T>
          <T style={s.coverSub}>{c.preparedLine}</T>
          <T style={[s.coverSub, { marginTop: 6 }]}>{`Beslisvraag: ${c.decisionQuestion}`}</T>
        </View>
        <View style={s.coverBand}>
          {c.facts.map((f) => (
            <View key={f.label} style={s.factRow}>
              <T style={s.factLabel}>{f.label}</T>
              <T style={s.factValue}>{f.value}</T>
            </View>
          ))}
        </View>
        {/* The geometric mark of the hero: a tilted blue block with a coral circle and a thin outline. */}
        <View style={s.shape}>
          <View style={{ position: "absolute", left: 18, top: 18, width: 74, height: 74, borderRadius: 14, backgroundColor: C.blue, transform: "rotate(-12deg)" }} />
          <View style={{ position: "absolute", right: 0, bottom: 0, width: 38, height: 38, borderRadius: 19, backgroundColor: C.coral }} />
          <View style={{ position: "absolute", left: 0, top: 0, width: 52, height: 52, borderRadius: 26, borderWidth: 0.8, borderColor: C.ink }} />
        </View>
        <View style={[s.footer, { left: 50, right: 50 }]} fixed>
          <T>{model.footer}</T>
        </View>
      </Page>
      <Page size="A4" style={s.page}>
        <View style={s.footerLine} fixed />
        <Text style={s.footerLeft} fixed>
          {pdfText(model.footer)}
        </Text>
        <Text style={s.footerRight} fixed render={({ pageNumber, totalPages }) => `Pagina ${pageNumber} van ${totalPages}`} />
        {model.chapters.map((ch, i) => (
          <View key={ch.id} style={i === 0 ? {} : s.section} break={!!ch.breakBefore}>
            <View wrap={false}>
              <T style={s.eyebrow}>{ch.eyebrow}</T>
              <T style={s.h2}>{ch.title}</T>
            </View>
            {ch.blocks.map((b, j) => (
              <BlockView key={j} b={b} />
            ))}
          </View>
        ))}
      </Page>
    </Document>
  );
}

export async function renderReportPdf(snapshot: ReportSnapshot, meta: PdfMeta): Promise<Buffer> {
  return renderToBuffer(<ReportPdfDocument model={buildReportPdfModel(snapshot, meta)} />);
}
