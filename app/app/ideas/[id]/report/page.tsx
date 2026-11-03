import type { Metadata } from "next";
import Link from "next/link";
import { PageFrame } from "@/components/shell/PageFrame";
import { ActionForm } from "@/components/ui/ActionForm";
import { getIdea } from "@/lib/data";
import { supabaseServer } from "@/lib/supabase/server";
import type { ReportSnapshot } from "@/lib/report";
import { pct } from "@/lib/domain/stats";
import { CHANNELS } from "@/lib/domain/tracking";
import { createReportVersion, shareReportVersion } from "./actions";
import { PrintButton } from "./PrintButton";

export const metadata: Metadata = { title: "Rapportage" };

const eur = (n: number | null | undefined) => (n == null ? "onbekend" : `€ ${Math.round(n).toLocaleString("nl-NL")}`);
const int = (n: number) => Math.round(n).toLocaleString("nl-NL");
const pct0 = (n: number) => `${Math.round(n * 100)}%`;
const SIGNAL_KINDS: Record<string, string> = { job: "Taak", pain: "Pijnpunt", gain: "Gewenst resultaat", objection: "Bezwaar" };
const date = (s: string | null | undefined) => (s ? new Date(s).toLocaleDateString("nl-NL", { day: "numeric", month: "long", year: "numeric" }) : "onbekend");
const SECTIONS: Record<string, string> = { market: "Markt en trends", customers: "Klant en probleem", competition: "Concurrentie", pricing: "Prijs en koopproces", sizing: "Marktomvang", regulation: "Regels en context", other: "Overig" };
type Version = { id: string; version: number; created_at: string; shared_at: string | null; client_viewed_at: string | null };

// The sharing columns come with the integrity migration; without them nothing counts as shared.
async function loadVersions(ideaId: string): Promise<Version[]> {
  const supabase = await supabaseServer();
  const full = await supabase.from("reports").select("id, version, created_at, shared_at, client_viewed_at").eq("idea_id", ideaId).order("version", { ascending: false });
  if (!full.error) return full.data ?? [];
  const plain = await supabase.from("reports").select("id, version, created_at").eq("idea_id", ideaId).order("version", { ascending: false });
  return (plain.data ?? []).map((v) => ({ ...v, shared_at: null, client_viewed_at: null }));
}

const Notes = ({ n }: { n: number[] }) => (n.length ? <sup>[{n.join(", ")}]</sup> : <sup>[geen bron]</sup>);

export default async function ReportPage({ params, searchParams }: PageProps<"/app/ideas/[id]/report">) {
  const { id } = await params;
  const sp = await searchParams;
  const { idea, canWrite } = await getIdea(id);
  const supabase = await supabaseServer();
  const all = await loadVersions(id);
  // Clients only see versions the consultant shared (also enforced by row level security).
  const versions = canWrite ? all : all.filter((v) => v.shared_at);
  const wanted = typeof sp.v === "string" ? Number(sp.v) : versions[0]?.version;
  const current = versions.find((v) => v.version === wanted) ?? versions[0];
  const [{ data: row }, { data: lastDecision }] = await Promise.all([
    current ? supabase.from("reports").select("snapshot").eq("id", current.id).single() : Promise.resolve({ data: null }),
    supabase.from("decisions").select("decided_at, client_confirmed_at").eq("idea_id", id).order("decided_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  const r = row?.snapshot as ReportSnapshot | undefined;
  // A client opening a shared version marks it as seen (once; the database keeps the first moment).
  if (!canWrite && current?.shared_at && !current.client_viewed_at) {
    await supabase.rpc("mark_report_viewed", { p_report: current.id });
  }
  const newest = all[0];

  return (
    <PageFrame crumbs={["Werkruimte", idea.title, "Rapportage"]} coach="report" ideaId={id}>
      <div className="section-row report-controls">
        <div>
          <div className="eyebrow">UITKOMST · ONDERZOEKSDOSSIER</div>
          <h1>Een helder verhaal.<br />Met bewijs.</h1>
          <p className="sub">
            {canWrite
              ? "Elke versie is een vaste momentopname: later bijwerken verandert een eerder gedeeld rapport niet. De opdrachtgever ziet alleen versies die je deelt."
              : "U ziet de versies die het onderzoeksteam met u heeft gedeeld. Elke versie is een vaste momentopname."}
          </p>
        </div>
        <div className="stack" style={{ justifyItems: "end" }}>
          {r && <PrintButton />}
          {canWrite && (
            <ActionForm action={createReportVersion.bind(null, id)} submitLabel={newest ? "Nieuwe versie maken" : "Maak het eerste rapport"} submitClass={newest ? "btn white sm" : "btn primary"} pendingLabel="Rapport samenstellen…"><span /></ActionForm>
          )}
        </div>
      </div>

      {versions.length > 0 && (
        <div className="card tight report-controls" style={{ marginBottom: 22 }}>
          <div className="section-title" style={{ marginBottom: 6 }}>
            <h2 className="as-h3">Versies</h2>
            <span className="pill gray">{versions.length} {versions.length === 1 ? "versie" : "versies"}</span>
          </div>
          {versions.map((v) => {
            const isCurrent = v.id === current?.id;
            return (
              <div key={v.id} className={`version-row${isCurrent ? " current" : ""}`}>
                <span className="version-name">
                  Versie {v.version} · {new Date(v.created_at).toLocaleDateString("nl-NL", { day: "numeric", month: "short", year: "numeric" })}
                </span>
                {canWrite && (
                  <span className={`pill ${v.shared_at ? "green" : "gray"}`}>
                    {v.shared_at ? `Gedeeld ${new Date(v.shared_at).toLocaleDateString("nl-NL", { day: "numeric", month: "short" })}` : "Niet gedeeld"}
                  </span>
                )}
                {v.shared_at && (
                  <span className={`pill ${v.client_viewed_at ? "blue" : "gray"}`}>
                    {v.client_viewed_at ? `Bekeken door opdrachtgever ${new Date(v.client_viewed_at).toLocaleDateString("nl-NL", { day: "numeric", month: "short" })}` : "Nog niet bekeken"}
                  </span>
                )}
                {v.id === newest?.id && lastDecision && (
                  <span className={`pill ${lastDecision.client_confirmed_at ? "green" : "orange"}`}>
                    {lastDecision.client_confirmed_at ? "Besluit bevestigd" : "Besluit wacht op bevestiging"}
                  </span>
                )}
                <span className="version-links">
                  {!isCurrent && (
                    <Link className="text-link" href={`?v=${v.version}`}>
                      Bekijk
                    </Link>
                  )}
                  <a className="text-link" href={`/api/reports/${v.id}`} aria-label={`JSON-export van versie ${v.version} (audit)`}>
                    JSON-export
                  </a>
                </span>
                {canWrite && isCurrent && !v.shared_at && (
                  <div style={{ flexBasis: "100%" }}>
                    <ActionForm action={shareReportVersion.bind(null, id, v.id)} submitLabel={`Deel versie ${v.version} met opdrachtgever`} submitClass="btn primary sm" pendingLabel="Delen…">
                      <p className="tiny">Delen is eenmalig en kan niet worden teruggedraaid. De opdrachtgever ziet daarna deze versie, zonder ruwe interviewcitaten of gegevens van testdeelnemers.</p>
                    </ActionForm>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {!r ? (
        <div className="empty-state">
          <h2 className="as-h3">{canWrite ? "Nog geen rapport" : "Nog geen gedeeld rapport"}</h2>
          <p>
            {canWrite
              ? "Een rapport bundelt beslisvraag, bevindingen met bronnen, marktomvang, experimenten, de Reality Check en het besluit in één document voor de opdrachtgever."
              : "Zodra het onderzoeksteam een rapportversie met u deelt, leest u die hier."}
          </p>
        </div>
      ) : (
        <article className="report-paper">
          <div className="report-head">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <strong style={{ font: "700 20px var(--font-space-grotesk),sans-serif", letterSpacing: "-.06em" }}>◉ ProofLab.</strong>
              <span className={`pill ${r.idea.isDemo ? "orange" : "blue"}`}>{r.idea.isDemo ? "DEMO · GEEN ECHT ONDERZOEK" : r.label.toUpperCase()}</span>
            </div>
            <div className="eyebrow" style={{ marginTop: 35 }}>VALIDATIEDOSSIER · VERSIE {r.version} · {date(r.generatedAt).toUpperCase()}</div>
            <h2 className="report-title">{r.idea.title}</h2>
            <p className="sub">
              {r.client ? `Opgesteld door ${r.preparedBy} voor ${r.client}.` : `Opgesteld door ${r.preparedBy}.`} Beslisvraag: {r.idea.decisionQuestion}
            </p>
          </div>

          <section className="report-section">
            <span className="eyebrow">01 / MANAGEMENTSAMENVATTING</span>
            <h3>{r.decision ? `Besluit: ${r.decision.action}.` : r.realityCheck ? `Advies: ${r.realityCheck.advice}.` : "Nog geen besluit."}</h3>
            <p>
              {r.decision?.rationale ?? r.realityCheck?.reason ?? "Het onderzoek loopt nog."} Bewijsniveau: <strong>{r.label}</strong>.
              {r.labelMissing.length ? ` Voor een hoger niveau ontbreekt: ${r.labelMissing.join("; ")}.` : ""}
            </p>
            <div className="grid-3" style={{ margin: "20px 0" }}>
              <div style={{ background: "#e7eaff", padding: 16, borderRadius: 12 }}>
                <div className="tiny">Bevindingen met bron</div>
                <div className="report-number">{r.counts.claims}</div>
                <div className="tiny">{r.counts.verified} geverifieerd · {r.counts.insufficient} onvoldoende</div>
              </div>
              <div style={{ background: "#e3f3e8", padding: 16, borderRadius: 12 }}>
                <div className="tiny">Experimenten</div>
                <div className="report-number">{String(r.experiments.length).padStart(2, "0")}</div>
                <div className="tiny">{r.learningCards.length} met goedgekeurde Learning Card</div>
              </div>
              <div style={{ background: "#fff0e6", padding: 16, borderRadius: 12 }}>
                <div className="tiny">Bereikbare jaaromzet (realistisch)</div>
                <div className="report-number">{r.sizing.find((s) => s.label === "Realistisch") ? eur(r.sizing.find((s) => s.label === "Realistisch")!.somRevenue) : "?"}</div>
                <div className="tiny">{r.sizing.find((s) => s.label === "Realistisch")?.status ?? "niet berekend"}</div>
              </div>
            </div>
          </section>

          <section className="report-section">
            <span className="eyebrow">02 / BESLISVRAAG EN AANPAK</span>
            <h3>Wat moest dit onderzoek beslissen?</h3>
            <p>{r.idea.decisionQuestion} Het idee: {r.idea.description} Doelgroep: {r.idea.audience}. Regio: {r.idea.region}.{r.idea.budget ? ` Bedrag op het spel: ${eur(r.idea.budget)}.` : ""}</p>
            <table className="table mt-12">
              <thead><tr><th>#</th><th>Onderzoeksvraag</th><th>Status</th></tr></thead>
              <tbody>{r.questions.map((q) => <tr key={q.position}><td>{q.position}</td><td>{q.question}<div className="tiny">Klaar als: {q.doneCriterion}</div></td><td>{q.status === "answered" ? "Beantwoord" : q.status === "open" ? "Open" : "Vraagt klantonderzoek"}</td></tr>)}</tbody>
            </table>
          </section>

          <section className="report-section">
            <span className="eyebrow">03 / MARKTBEELD</span>
            <h3>Wat we weten, en op basis waarvan</h3>
            {Object.entries(SECTIONS).map(([key, label]) => {
              const list = r.claims.filter((c) => c.section === key);
              if (!list.length) return null;
              return (
                <div key={key} className="mt-12">
                  <strong style={{ fontSize: 13 }}>{label}</strong>
                  <ul style={{ margin: "6px 0 0 18px", fontSize: 13, lineHeight: 1.7, color: "#3d4657" }}>
                    {list.map((c, i) => (
                      <li key={i}>
                        {c.statement} <Notes n={c.notes} /> <em className="tiny">({c.status}{c.contradicted ? ", tegengesproken" : ""})</em>
                        {c.doesNotProve && <div className="tiny">Bewijst niet: {c.doesNotProve}</div>}
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
            {r.claims.length === 0 && <p>Er zijn nog geen bevindingen met bron vastgelegd.</p>}
          </section>

          <section className="report-section">
            <span className="eyebrow">04 / CONCURRENTIE EN ALTERNATIEVEN</span>
            <h3>Hoe lossen klanten het nu op?</h3>
            <table className="table">
              <thead><tr><th>Aanbieder</th><th>Type</th><th>Positionering</th><th>Prijs</th></tr></thead>
              <tbody>{r.competitors.map((c, i) => <tr key={i}><td>{c.name}</td><td>{c.kind}</td><td>{c.positioning ?? "—"}</td><td>{c.price}</td></tr>)}</tbody>
            </table>
            {r.signals && r.signals.length > 0 && (
              <>
                <p className="mt-12"><strong>Wat klanten zelf zeggen</strong> (kwalitatieve signalen uit reviews, fora en outreach; geen gedrag):</p>
                <ul style={{ margin: "6px 0 0 18px" }}>
                  {r.signals.slice(0, 8).map((sg, i) => <li key={i}>{SIGNAL_KINDS[sg.kind] ?? sg.kind}: {sg.label} ({sg.mentions}× letterlijk teruggevonden)</li>)}
                </ul>
              </>
            )}
          </section>

          <section className="report-section">
            <span className="eyebrow">05 / MARKTPOTENTIEEL</span>
            <h3>Van onderaf berekend, met zichtbare aannames</h3>
            <table className="table">
              <thead><tr><th>Scenario</th><th>TAM</th><th>SAM</th><th>SOM-klanten</th><th>SOM-omzet</th><th>Onderbouwing</th></tr></thead>
              <tbody>{r.sizing.map((s) => <tr key={s.label}><td>{s.label}</td><td className="num">{int(s.tamCount)}</td><td className="num">{int(s.samCount)}</td><td className="num">{int(s.somCount)}</td><td className="num">{eur(s.somRevenue)}</td><td>{s.provenance.sourced}/{s.provenance.total} factoren met bron</td></tr>)}</tbody>
            </table>
            {r.sizing[1] && <p className="tiny mt-8 mono">Formule (realistisch): {r.sizing[1].formula}</p>}
            <p>{r.sizing[1]?.status}. Dit is omzetpotentieel onder de getoonde aannames, geen winst en geen voorspelling.</p>
            {r.simulation && (
              <p className="mt-8">
                Met bandbreedtes per factor ({int(r.simulation.draws)} trekkingen, scenario {r.simulation.label.toLowerCase()}): SOM-omzet tussen {eur(r.simulation.somRevenue.p10)} en {eur(r.simulation.somRevenue.p90)} (80% van de uitkomsten), mediaan {eur(r.simulation.somRevenue.p50)}.
                {r.simulation.pAboveThreshold != null && r.simulation.threshold != null
                  ? ` Kans dat de omzet ${r.simulation.thresholdIsBreakEven ? "het break-evenpunt" : "de drempel"} van ${eur(r.simulation.threshold)} haalt: ${pct0(r.simulation.pAboveThreshold)}.`
                  : ""}
                {r.simulation.mainDriver ? ` De grootste onzekerheid zit in de factor "${r.simulation.mainDriver}".` : ""}
              </p>
            )}
            {r.unit && (
              <p className="mt-8">
                Financieel: marge per klant {eur(r.unit.marginPerCustomerYear)} per jaar, terugverdientijd {r.unit.paybackMonths == null ? "onbekend" : `${r.unit.paybackMonths.toFixed(1)} maanden`}, klantwaarde/wervingskosten {r.unit.ltvToCac == null ? "onbekend" : `${r.unit.ltvToCac.toFixed(1)}×`}, break-even bij {r.unit.breakEvenCustomers ?? "onbekend"} klanten.
                {r.unit.missing.length ? ` Nog onbekend: ${r.unit.missing.join(", ")}.` : ""}
              </p>
            )}
          </section>

          <section className="report-section">
            <span className="eyebrow">06 / AANNAMES EN RISICO&apos;S</span>
            <h3>Wat moet waar zijn?</h3>
            <table className="table">
              <thead><tr><th>Aanname</th><th>Belang</th>{r.assumptions.some((a) => "probability" in a && a.probability) ? <th>Geschatte kans</th> : <th>Bewijs</th>}<th>Status</th></tr></thead>
              <tbody>
                {r.assumptions.map((a, i) => (
                  <tr key={i}>
                    <td>{a.statement}{"premortem" in a && a.premortem ? <span className="tiny"> (uit de pre-mortem)</span> : null}</td>
                    <td className="num">{a.importance}/5</td>
                    {"probability" in a && a.probability ? (
                      <td className="num">{pct0(a.probability.point)} <span className="tiny">({pct0(a.probability.low)}–{pct0(a.probability.high)})</span></td>
                    ) : (
                      <td className="num">{a.evidence}%</td>
                    )}
                    <td>{{ untested: "Niet getest", testing: "Wordt getest", supported: "Ondersteund", refuted: "Weerlegd", inconclusive: "Onbeslist" }[a.status as "untested"]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {r.assumptions.some((a) => "probability" in a && a.probability) && (
              <p className="explain">
                Geschatte kans dat de aanname klopt: een beginwaarde (meestal 50%), bijgewerkt met een vaste factor per soort bewijs. Uitspraken
                tellen nauwelijks, gedrag en betalingen sterk. Tussen haakjes de bandbreedte als die factoren de helft zwakker of sterker zijn.
              </p>
            )}
          </section>

          <section className="report-section">
            <span className="eyebrow">07 / EXPERIMENTEN EN RESULTATEN</span>
            <h3>Van mening naar meetbaar gedrag</h3>
            <p className="explain">
              Een Learning Card legt per test vast wat we verwachtten, wat we zagen, wat we daaruit leren en wat we daarom doen. Het 95%-interval is de
              bandbreedte waarbinnen de werkelijke waarde vrijwel zeker ligt; bij kleine aantallen is die breed.
            </p>
            {r.experiments.length === 0 && <p>Er zijn nog geen experimenten uitgevoerd.</p>}
            {r.experiments.map((e, i) => (
              <div key={i} className="mt-12" style={{ breakInside: "avoid" }}>
                <strong style={{ fontSize: 13 }}>{e.title} ({e.type})</strong>
                {e.selfReported && <p className="tiny">Zelfrapportage, geen waargenomen gedrag: een enquête meet wat mensen over zichzelf zeggen.</p>}
                <p>
                  Hypothese: {e.hypothesis} Meting: {e.metric}. Vooraf vastgelegd ({e.lockedAt ? date(e.lockedAt) : "niet vergrendeld"}): {e.threshold}.
                </p>
                <p>
                  Resultaat: {e.successes} van {e.n}
                  {e.interval ? ` (${pct(e.interval.point)}; 95%-interval ${pct(e.interval.low)}–${pct(e.interval.high)})` : ""}. Oordeel:{" "}
                  <strong>{e.verdict === "pass" ? "geslaagd" : e.verdict === "fail" ? "niet geslaagd" : e.verdict === "running" ? "loopt nog" : "onbeslist"}</strong>. {e.verdictReason}
                  {e.endedEarly ? " De test is vroegtijdig beëindigd." : ""}
                </p>
                {e.byChannel.length > 0 && (
                  <p className="tiny">Ruwe aantallen per kanaal: {e.byChannel.map((c) => `${CHANNELS[c.channel as keyof typeof CHANNELS] ?? c.channel} ${c.actions}/${c.visitors}`).join(" · ")}</p>
                )}
                {e.bySource && (
                  <p className="tiny">
                    Per herkomst: persoonlijk uitgenodigd {e.bySource.invitation.successes}/{e.bySource.invitation.n} · open link (herkomst niet te controleren) {e.bySource.openLink.successes}/{e.bySource.openLink.n}
                  </p>
                )}
                {e.byVariant.length > 0 && <p className="tiny">Per prijspunt: {e.byVariant.map((v) => `${v.label} ${v.actions}/${v.visitors}`).join(" · ")}</p>}
                {e.warnings.map((w) => <p className="tiny" key={w}>Let op: {w}</p>)}
              </div>
            ))}
            {r.learningCards.map((c, i) => (
              <div key={i} className="note">
                <strong>Learning Card.</strong> We dachten: {c.believed} We zagen: {c.observed} Daaruit leren we: {c.learned} Daarom: {c.therefore} (betrouwbaarheid: {{ low: "laag", medium: "middel", high: "hoog" }[c.reliability as "low"]})
              </div>
            ))}
          </section>

          <section className="report-section">
            <span className="eyebrow">08 / REALITY CHECK: TEGENARGUMENTEN EN BEPERKINGEN</span>
            <h3>Wat dit onderzoek níét bewijst</h3>
            <p className="explain">De Reality Check zoekt vóór elk besluit bewust naar tegenbewijs, zwakke data en conclusies die het bewijs niet draagt.</p>
            {r.realityCheck ? (
              <>
                <p>Uitgevoerd {date(r.realityCheck.at)}{r.realityCheck.aiUsed ? ", aangevuld met kritische vragen van AI" : ""}. Advies: {r.realityCheck.advice}. {r.realityCheck.reason}</p>
                <ul style={{ margin: "6px 0 0 18px", fontSize: 13, lineHeight: 1.7, color: "#3d4657" }}>
                  {r.realityCheck.findings.map((f, i) => <li key={i}><strong>{f.title}</strong>{f.source === "ai" ? " (AI-vraag)" : ""}: {f.detail}</li>)}
                </ul>
              </>
            ) : (
              <p>Er is nog geen Reality Check uitgevoerd.</p>
            )}
          </section>

          <section className="report-section">
            <span className="eyebrow">09 / BESLUIT EN VOLGENDE STAP</span>
            <h3>{r.decision ? `${r.decision.action}.` : "Nog geen besluit."}</h3>
            {r.decision && (
              <p>
                {r.decision.rationale}
                {r.decision.nextStep ? ` Volgende stap: ${r.decision.nextStep}.` : ""} Vastgelegd op {date(r.decision.at)}.{" "}
                {r.decision.confirmedAt ? `Bevestigd door de opdrachtgever op ${date(r.decision.confirmedAt)}${r.decision.comment ? ` (“${r.decision.comment}”)` : ""}.` : "Nog niet bevestigd door de opdrachtgever."}
              </p>
            )}
          </section>

          {r.prediction && (
            <section className="report-section">
              <span className="eyebrow">10 / VOORSPELLING EN UITKOMST</span>
              <h3>{r.prediction.result ? `Uitkomst: ${r.prediction.result.achieved.toLowerCase()}.` : "Wat verwachten we, en hoe toetsen we dat?"}</h3>
              {r.prediction.outcome.statement ? (
                <p>
                  Geslaagd betekent: {r.prediction.outcome.statement}
                  {r.prediction.outcome.target != null ? ` (doel: ${r.prediction.outcome.target}${r.prediction.outcome.metric ? ` ${r.prediction.outcome.metric}` : ""})` : ""}. Gemeten zes maanden na het
                  besluit{r.prediction.outcome.due ? `, op ${date(r.prediction.outcome.due)}` : ""}.
                </p>
              ) : (
                <p>Er is nog niet vastgelegd wanneer dit idee geslaagd is.</p>
              )}
              <p className="mt-8">
                Basispercentage:{" "}
                {r.prediction.baseRate.low != null && r.prediction.baseRate.high != null
                  ? `${pct0(r.prediction.baseRate.low)}–${pct0(r.prediction.baseRate.high)}`
                  : "onbekend"}
                {r.prediction.baseRate.reference ? ` (${r.prediction.baseRate.reference.label}; bron: ${r.prediction.baseRate.reference.source_title}). ${r.prediction.baseRate.reference.caveat}` : ""}
                {r.prediction.baseRate.own ? " (eigen afgeronde dossiers)." : ""}
                {r.prediction.baseRate.note ? ` ${r.prediction.baseRate.note}` : ""}
              </p>
              {r.prediction.moments.length > 0 && !("revealed" in r.prediction && r.prediction.revealed === false) && (
                <table className="table mt-12">
                  <thead><tr><th>Moment</th><th>Mensen (gemiddeld, spreiding)</th><th>AI</th>{r.prediction.result ? <th>Brier per voorspelling</th> : null}</tr></thead>
                  <tbody>
                    {r.prediction.moments.map((m) => (
                      <tr key={m.moment}>
                        <td>{m.moment}</td>
                        <td className="num">{m.people ? `${pct0(m.people.mean)} (${pct0(m.people.min)}–${pct0(m.people.max)}, n=${m.people.n})` : "—"}</td>
                        <td className="num">{m.ai != null ? pct0(m.ai) : "—"}</td>
                        {r.prediction.result ? <td className="num">{m.forecasts.map((f) => `${f.who} ${f.brier?.toFixed(2)}`).join(" · ")}</td> : null}
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {"revealed" in r.prediction && r.prediction.revealed === false && r.prediction.moments.length > 0 && (
                <p className="mt-8">
                  Voorspellingen vastgelegd: {r.prediction.moments.map((m) => `${m.moment.toLowerCase()} (${m.count})`).join(", ")}. De kansen zelf blijven
                  verborgen tot de uitkomst bekend is, zodat niemand op een ander kan afgaan.
                </p>
              )}
              <p className="explain">
                Iedereen geeft zijn kans zonder de anderen te zien. Een AI-voorspelling telt niet mee in het gemiddelde en is geen bewijs. De Brier-score
                meet achteraf hoe goed een kans was: 0 is perfect, 0,25 is wat je haalt met steeds 50%.
              </p>
              {r.prediction.checkins.map((c, i) => (
                <p className="mt-8" key={i}>Tussenstand {date(c.at)}: {c.onTrack.toLowerCase()}{c.value != null ? ` (stand: ${c.value})` : ""}. {c.note}</p>
              ))}
              {r.prediction.result && (
                <p className="mt-8">
                  Vastgelegd op {date(r.prediction.result.at)}: {r.prediction.result.achieved.toLowerCase()}
                  {r.prediction.result.value != null ? ` (werkelijk: ${r.prediction.result.value})` : ""}. {r.prediction.result.evidence}
                </p>
              )}
            </section>
          )}

          <section className="report-section" style={{ breakBefore: "page" }}>
            <span className="eyebrow">BRONNEN</span>
            <ol style={{ margin: "6px 0 0 18px", fontSize: 11, lineHeight: 1.7, color: "#3d4657" }}>
              {r.sources.map((s) => (
                <li key={s.n}>
                  {s.publisher ? `${s.publisher}, ` : ""}
                  <em>{s.title}</em> ({s.type}{s.primary ? ", primair" : ""}). Gepubliceerd: {date(s.published_on)}; opgehaald: {date(s.retrieved_at)}.{s.url ? ` ${s.url}` : ""}
                </li>
              ))}
            </ol>
            {r.sources.length === 0 && <p>Geen bronnen.</p>}
            <p className="tiny mt-12">
              Methode: elke bevinding steunt op een letterlijk citaat dat automatisch is teruggevonden in de bewaarde bronpassage; de status
              (geverifieerd, onderbouwde schatting, onvoldoende bewijs, tegenstrijdig, verouderd) wordt berekend, niet gekozen. Experimentdrempels
              zijn vóór de start vergrendeld. {r.method.aiCalls ? `AI is ${r.method.aiCalls}× gebruikt (${r.method.models.join(", ")}; kosten $${r.method.aiCostUsd}). AI-uitvoer telt nooit als bewijs.` : "Er is geen AI gebruikt."}
            </p>
          </section>

          <div style={{ borderTop: "1px solid #e1e4e5", paddingTop: 16, display: "flex", justifyContent: "space-between", color: "#5f6879", fontSize: 10 }}>
            <span>ProofLab · {r.preparedBy}</span>
            <span>Versie {r.version} · {date(r.generatedAt)}</span>
          </div>
        </article>
      )}
    </PageFrame>
  );
}
