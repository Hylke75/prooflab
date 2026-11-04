import type { Metadata } from "next";
import Link from "next/link";
import { PageFrame } from "@/components/shell/PageFrame";
import { ActionForm } from "@/components/ui/ActionForm";
import { ConfirmDialogForm } from "@/components/ui/ConfirmDialog";
import { getIdea } from "@/lib/data";
import { supabaseServer } from "@/lib/supabase/server";
import { CONFIRMATION_LABELS, decisionConfirmation } from "@/lib/domain/decision-confirmation";
import type { ReportSnapshot } from "@/lib/report";
import { pct } from "@/lib/domain/stats";
import { describeWeights } from "@/lib/domain/calibration";
import { describeMethodology, ruleLabelText } from "@/lib/domain/method/describe";
import { CHANNELS } from "@/lib/domain/tracking";
import { createReportVersion, shareReportVersion } from "./actions";
import { Icon } from "@/components/Icon";
import { Probability } from "@/components/ui/Probability";
import { explainRecruitment } from "@/lib/domain/recruitment";
import { asEvidenceLevel, mergedShort, outcomeWithLevel } from "@/lib/domain/evidence";
import { allTestsSummary } from "@/lib/domain/all-tests";
import { formatGroups } from "@/lib/domain/report-counts";
import { ladderSummary } from "@/lib/domain/dossier-label";
import { CALIBRATION_MIN_RESOLVED } from "@/lib/domain/probability-display";
import { sheetOf, somRevenueCell } from "@/lib/report-pdf-model";
import { reachableRevenue } from "@/lib/report-sheet";
import { isUnknown } from "@/lib/domain/claim-scope";
import { DecisionSheetView } from "./DecisionSheet";

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

// Methodeversie, beslisregels en gebruikte plafonds van dit rapport.
function MethodSection({ m }: { m: Parameters<typeof describeMethodology>[0] }) {
  const d = describeMethodology(m);
  return (
    <div className="mt-12" style={{ breakInside: "avoid" }}>
      <strong style={{ fontSize: 13 }}>Rekenwijze: {d.title}</strong>
      <ul className="tiny" style={{ margin: "6px 0 0 18px", lineHeight: 1.6 }}>
        {d.lines.map((l) => <li key={l}>{l}</li>)}
      </ul>
    </div>
  );
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
  // B1: zonder opdrachtgever wacht het besluit niet op bevestiging.
  const confirmation = lastDecision ? decisionConfirmation(lastDecision.client_confirmed_at, !!idea.client_id) : null;
  // Rapporten van vóór golf A hebben geen kalibratie: dan de voorzichtige weergave (banden).
  const calibrated = !!(r && "calibration" in r && r.calibration?.calibrated);
  // A client opening a shared version marks it as seen (once; the database keeps the first moment).
  if (!canWrite && current?.shared_at && !current.client_viewed_at) {
    await supabase.rpc("mark_report_viewed", { p_report: current.id });
  }
  const newest = all[0];
  const revenue = reachableRevenue(r?.sizing.find((s) => s.label === "Realistisch") ?? r?.sizing[1] ?? null);

  return (
    <PageFrame crumbs={["Werkruimte", idea.title, "Rapport"]} coach="report" ideaId={id} section="/report">
      <div className="section-row report-controls">
        <div>
          <div className="eyebrow">Uitkomst · Onderzoeksdossier</div>
          <h1>Een helder verhaal.<br />Met bewijs.</h1>
          <p className="sub">
            {canWrite
              ? "Elke versie is een vaste momentopname: later bijwerken verandert een eerder gedeeld rapport niet. De opdrachtgever ziet alleen versies die je deelt."
              : "U ziet de versies die het onderzoeksteam met u heeft gedeeld. Elke versie is een vaste momentopname."}
          </p>
        </div>
        <div className="stack" style={{ justifyItems: "end" }}>
          {r && current && (
            <div className="row" style={{ justifyContent: "flex-end" }}>
              {/* Eén knop: de server-PDF van deze versie. Printen kan via de browser; de printstylesheet blijft. */}
              <a className="btn primary" href={`/app/ideas/${id}/report/pdf?v=${current.version}`} download>
                <Icon name="file" /> Download als PDF
              </a>
            </div>
          )}
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
                  <span className={`pill ${confirmation === "awaiting" ? "orange" : "green"}`}>{CONFIRMATION_LABELS[confirmation!]}</span>
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
                    <ConfirmDialogForm
                      action={shareReportVersion.bind(null, id, v.id)}
                      triggerLabel={`Deel versie ${v.version} met opdrachtgever`}
                      title={`Versie ${v.version} delen met de opdrachtgever?`}
                      confirmLabel="Ja, deel definitief"
                      pendingLabel="Delen…"
                    >
                      <p>
                        <strong>Dit kan niet worden teruggedraaid.</strong> Na het delen ziet de opdrachtgever deze versie blijvend, zonder ruwe
                        interviewcitaten of gegevens van testdeelnemers. Wil je iets aanpassen, maak dan eerst een nieuwe versie.
                      </p>
                    </ConfirmDialogForm>
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
              <strong style={{ font: "700 20px var(--font-heading),sans-serif", letterSpacing: "-.06em" }}>◉ ProofLab.</strong>
              <span className={`pill ${r.idea.isDemo ? "orange" : "blue"}`}>{r.idea.isDemo ? "DEMO · GEEN ECHT ONDERZOEK" : r.label.toUpperCase()}</span>
            </div>
            <div className="eyebrow" style={{ marginTop: 35 }}>Validatiedossier · Versie {r.version} · {date(r.generatedAt)}</div>
            <h2 className="report-title">{r.idea.title}</h2>
            <p className="sub">
              {r.client ? `Opgesteld door ${r.preparedBy} voor ${r.client}.` : `Opgesteld door ${r.preparedBy}.`} Beslisvraag: {r.idea.decisionQuestion}
            </p>
          </div>

          {/* Fase B6: pagina 1 is het beslisblad; het volledige dossier volgt als bijlage, in de bestaande opbouw. */}
          <DecisionSheetView sheet={sheetOf(r)} version={r.version} date={date(r.generatedAt)} />

          <div className="report-head" style={{ marginTop: 10 }}>
            <div className="eyebrow">Bijlage · Volledig dossier</div>
          </div>

          <section className="report-section">
            <span className="eyebrow">01 / Managementsamenvatting</span>
            <h3>{r.decision ? `Besluit: ${r.decision.action}.` : r.realityCheck ? `Advies: ${r.realityCheck.advice}.` : "Nog geen besluit."}</h3>
            <p>
              {r.decision?.rationale ?? r.realityCheck?.reason ?? "Het onderzoek loopt nog."} Bewijsniveau: <strong>{r.label}</strong>.
              {r.labelMissing.length ? ` Voor een hoger niveau ontbreekt: ${r.labelMissing.join("; ")}.` : ""}
              {r.observationCounts ? ` ${ladderSummary(r.observationCounts)}` : ""}
            </p>
            <div className="grid-3" style={{ margin: "20px 0" }}>
              <div style={{ background: "var(--color-surface-soft)", padding: 16, borderRadius: "var(--radius-inner)" }}>
                <div className="tiny">Bevindingen met bron</div>
                <div className="report-number">{r.counts.claims}</div>
                <div className="tiny">{r.counts.verified} geverifieerd · {r.counts.insufficient} onvoldoende</div>
              </div>
              <div style={{ background: "var(--color-success-soft)", padding: 16, borderRadius: "var(--radius-inner)" }}>
                <div className="tiny">Experimenten</div>
                <div className="report-number">{String(r.experiments.length).padStart(2, "0")}</div>
                <div className="tiny">{r.learningCards.length} met goedgekeurde Learning Card</div>
              </div>
              <div style={{ background: "var(--color-warning-soft)", padding: 16, borderRadius: "var(--radius-inner)" }}>
                <div className="tiny">Bereikbare jaaromzet (realistisch)</div>
                {/* B6: geen "€ 0" als de marktomvang niet is vastgesteld. */}
                <div className="report-number">{revenue.value}</div>
                <div className="tiny">{revenue.note}</div>
              </div>
            </div>
          </section>

          <section className="report-section">
            <span className="eyebrow">02 / Beslisvraag en aanpak</span>
            <h3>Wat moest dit onderzoek beslissen?</h3>
            <p>{r.idea.decisionQuestion} Het idee: {r.idea.description} Doelgroep: {r.idea.audience}. Regio: {r.idea.region}.{r.idea.budget ? ` Bedrag op het spel: ${eur(r.idea.budget)}.` : ""}</p>
            <table className="table mt-12">
              <thead><tr><th>#</th><th>Onderzoeksvraag</th><th>Status</th></tr></thead>
              <tbody>{r.questions.map((q) => <tr key={q.position}><td>{q.position}</td><td>{q.question}<div className="tiny">Klaar als: {q.doneCriterion}</div></td><td>{q.status === "answered" ? "Beantwoord" : q.status === "open" ? "Open" : "Vraagt klantonderzoek"}</td></tr>)}</tbody>
            </table>
          </section>

          <section className="report-section">
            <span className="eyebrow">03 / Marktbeeld</span>
            <h3>Wat we weten, en op basis waarvan</h3>
            {Object.entries(SECTIONS).map(([key, label]) => {
              const list = r.claims.filter((c) => c.section === key);
              if (!list.length) return null;
              return (
                <div key={key} className="mt-12">
                  <strong style={{ fontSize: 13 }}>{label}</strong>
                  <ul style={{ margin: "6px 0 0 18px", fontSize: 13, lineHeight: 1.7, color: "var(--color-text)" }}>
                    {list.map((c, i) => (
                      <li key={i}>
                        {c.statement} <Notes n={c.notes} /> <em className="tiny">({c.status}{c.contradicted ? ", tegengesproken" : ""})</em>
                        {c.scope && (
                          <div className="tiny">
                            {/* B6: een onbekende regio is geen andere regio; ze staat er als "onbekend". */}
                            Populatie: {isUnknown(c.scope.population) ? "onbekend" : c.scope.population} · regio: {isUnknown(c.scope.region) ? "onbekend" : c.scope.region} · peildatum: {isUnknown(c.scope.referenceDate) ? "onbekend" : c.scope.referenceDate}
                            {c.scope.relevance === "indirect" ? " · indirect (wijkt af van de intake)" : ""}
                          </div>
                        )}
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
            <span className="eyebrow">04 / Concurrentie en alternatieven</span>
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
            <span className="eyebrow">05 / Marktpotentieel</span>
            <h3>Van onderaf berekend, met zichtbare aannames</h3>
            <table className="table">
              <thead><tr><th>Scenario</th><th>TAM</th><th>SAM</th><th>SOM-klanten</th><th>SOM-omzet</th><th>Onderbouwing</th></tr></thead>
              <tbody>{r.sizing.map((s) => <tr key={s.label}><td>{s.label}</td><td className="num">{int(s.tamCount)}</td><td className="num">{int(s.samCount)}</td><td className="num">{int(s.somCount)}</td><td className="num">{somRevenueCell(s)}</td><td>{s.provenance.sourced}/{s.provenance.total} factoren met bron</td></tr>)}</tbody>
            </table>
            {r.sizing[1] && <p className="tiny mt-8 mono">Formule (realistisch): {r.sizing[1].formula}</p>}
            <p>{r.sizing[1]?.status}. Dit is omzetpotentieel onder de getoonde aannames, geen winst en geen voorspelling.</p>
            {/* Golf C, punt 8 (oudere rapporten hebben dit veld niet). */}
            {(r.sizing[1]?.originWarnings ?? []).length > 0 && <p className="tiny mt-8">Let op: {r.sizing[1]!.originWarnings.join(" ")}</p>}
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
            <span className="eyebrow">06 / Aannames en risico&apos;s</span>
            <h3>Wat moet waar zijn?</h3>
            <table className="table">
              <thead><tr><th>Aanname</th><th>Belang</th>{r.assumptions.some((a) => "probability" in a && a.probability) ? <th>Geschatte kans{calibrated ? "" : " (niet gekalibreerd)"}</th> : <th>Bewijs</th>}<th>Status</th></tr></thead>
              <tbody>
                {r.assumptions.map((a, i) => (
                  <tr key={i}>
                    <td>{a.statement}{"premortem" in a && a.premortem ? <span className="tiny"> (uit de pre-mortem)</span> : null}</td>
                    <td className="num">{a.importance}/5</td>
                    {"probability" in a && a.probability ? (
                      <td className="num">
                        <Probability p={a.probability.point} calibrated={calibrated} showLabel={false} />{" "}
                        <span className="tiny">(<Probability p={a.probability.low} high={a.probability.high} calibrated={calibrated} showLabel={false} />)</span>
                        {"capReason" in a && a.capReason ? <span className="tiny" style={{ display: "block" }}>{a.capReason}</span> : null}
                        {"merged" in a && a.merged.length ? <span className="tiny" style={{ display: "block" }}>{a.merged.map((m) => mergedShort(m)).join("; ")}</span> : null}
                        {"recruitment" in a && a.recruitment?.length ? <span className="tiny" style={{ display: "block" }}>{a.recruitment.map((x) => explainRecruitment(x)).join(" ")}</span> : null}
                      </td>
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
                tellen nauwelijks, gedrag en betalingen sterk. Tussen haakjes de bandbreedte als die factoren de helft zwakker of sterker zijn.{" "}
                {"weights" in r && r.weights ? describeWeights(r.weights) : "Gebruikte factoren: de vaste standaardfactoren van ProofLab (rapport gemaakt vóór geleerde factoren bestonden)."}{" "}
                Rekenwijze: {describeMethodology("methodology" in r ? r.methodology : null).title}.
                {calibrated
                  ? ""
                  : ` Niet gekalibreerd: bij dit rapport had de werkruimte minder dan ${CALIBRATION_MIN_RESOLVED} opgeloste dossiers om deze kansen aan te toetsen. Daarom staan ze in banden van 10 procentpunt; de exacte waarde staat in de tooltip.`}
              </p>
            )}
          </section>

          <section className="report-section">
            <span className="eyebrow">07 / Experimenten en resultaten</span>
            <h3>Van mening naar meetbaar gedrag</h3>
            <p className="explain">
              Een Learning Card legt per test vast wat we verwachtten, wat we zagen, wat we daaruit leren en wat we daarom doen. Het 95%-interval is de
              bandbreedte waarbinnen de werkelijke waarde vrijwel zeker ligt; bij kleine aantallen is die breed.
            </p>
            <div className="mt-12" style={{ breakInside: "avoid" }}>
              <strong style={{ fontSize: 13 }}>Alle tests</strong>
              {"allTests" in r && r.allTests ? (
                <>
                  <p className="tiny">
                    {allTestsSummary(r.allTests.rows)} Deze lijst is verplicht: ook afgebroken, mislukte en verkennende tests staan erin, zodat niet achteraf
                    gekozen kan worden welke test telt.
                  </p>
                  {r.allTests.rows.length > 0 && (
                    <div style={{ overflowX: "auto" }}>
                      <table className="table">
                        <caption className="sr-only">Alle vooraf vastgelegde tests met rol, status en uitkomst</caption>
                        <thead><tr><th scope="col">Test</th><th scope="col">Aanname</th><th scope="col">Rol</th><th scope="col">Status</th><th scope="col">Resultaat</th><th scope="col">Uitkomst</th></tr></thead>
                        <tbody>
                          {r.allTests.rows.map((t, i) => (
                            <tr key={i}>
                              <td>{t.title} <span className="tiny">({t.type})</span></td>
                              <td>{t.assumption}</td>
                              <td>{t.role}</td>
                              <td>{t.status}</td>
                              <td className="num">{t.result}</td>
                              <td>{t.outcome}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                  {r.allTests.perAssumption.length > 0 && (
                    <p className="tiny">
                      Tests per aanname: {r.allTests.perAssumption.map((a) => `${a.assumption}: ${a.total} (${a.primary} hoofdtest, ${a.exploratory} verkennend)`).join(" · ")}
                    </p>
                  )}
                </>
              ) : (
                <p className="tiny">Dit rapport is gemaakt vóór de lijst &quot;Alle tests&quot; bestond; maak een nieuwe rapportversie voor de volledige lijst.</p>
              )}
            </div>
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
                  <strong>
                    {outcomeWithLevel(
                      "label" in e && e.label ? e.label : e.verdict === "pass" ? "geslaagd" : e.verdict === "fail" ? "niet geslaagd" : e.verdict === "running" ? "loopt nog" : "onbeslist",
                      "level" in e ? asEvidenceLevel(e.level) : null,
                    )}
                  </strong>
                  {"rule" in e ? ` (${ruleLabelText(e.rule)})` : ""}. {e.verdictReason}
                  {"requiredN" in e && e.requiredN != null ? ` Vooraf berekend: ${e.requiredN} deelnemers nodig.` : ""}
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
                <strong>Learning Card{"title" in c && c.title ? `: ${c.title}` : ""}.</strong>{" "}
                {"level" in c ? <span className="pill gray">{outcomeWithLevel(c.verdict === "pass" ? "geslaagd" : c.verdict === "fail" ? "niet geslaagd" : "onbeslist", asEvidenceLevel(c.level))}</span> : null} We dachten: {c.believed} We zagen: {c.observed} Daaruit leren we: {c.learned} Daarom: {c.therefore} (betrouwbaarheid: {{ low: "laag", medium: "middel", high: "hoog" }[c.reliability as "low"]})
              </div>
            ))}
            {/* Golf C, punt 19: momentopname van de aantallen (rapporten van vóór 7 november 2026 hebben die niet). */}
            {r.tallies && r.tallies.tests.length > 0 && (
              <div className="mt-12" style={{ breakInside: "avoid" }}>
                <strong style={{ fontSize: 13 }}>Momentopname van de aantallen</strong>
                <p className="tiny">{r.tallies.note}</p>
                <div style={{ overflowX: "auto" }}>
                  <table className="table mt-8">
                    <caption className="sr-only">Aantallen per test, bron, kanaal en wervingsgroep</caption>
                    <thead>
                      <tr><th scope="col">Test</th><th scope="col">n</th><th scope="col">Successen</th><th scope="col">Per bron</th><th scope="col">Per kanaal</th><th scope="col">Per wervingsgroep</th></tr>
                    </thead>
                    <tbody>
                      {r.tallies.tests.map((t, i) => (
                        <tr key={i}>
                          <th scope="row" style={{ textAlign: "left", fontWeight: 700 }}>{t.test} <span className="tiny">({t.type})</span></th>
                          <td className="num">{t.n}</td>
                          <td className="num">{t.successes}</td>
                          <td className="tiny">{t.bySource.map((x) => `${x.source} ${x.successes}/${x.n}`).join(" · ") || "—"}</td>
                          <td className="tiny">{t.byChannel.map((x) => `${CHANNELS[x.channel as keyof typeof CHANNELS] ?? x.channel} ${x.successes}/${x.n}`).join(" · ") || "—"}</td>
                          <td className="tiny">{formatGroups(t.byGroup) || "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </section>

          <section className="report-section">
            <span className="eyebrow">08 / Reality check: tegenargumenten en beperkingen</span>
            <h3>Wat dit onderzoek níét bewijst</h3>
            <p className="explain">De Reality Check zoekt vóór elk besluit bewust naar tegenbewijs, zwakke data en conclusies die het bewijs niet draagt.</p>
            {r.realityCheck ? (
              <>
                <p>Uitgevoerd {date(r.realityCheck.at)}{r.realityCheck.aiUsed ? ", aangevuld met kritische vragen van AI" : ""}. Advies: {r.realityCheck.advice}. {r.realityCheck.reason}</p>
                <ul style={{ margin: "6px 0 0 18px", fontSize: 13, lineHeight: 1.7, color: "var(--color-text)" }}>
                  {r.realityCheck.findings.map((f, i) => <li key={i}><strong>{f.title}</strong>{f.source === "ai" ? " (AI-vraag)" : ""}: {f.detail}</li>)}
                </ul>
              </>
            ) : (
              <p>Er is nog geen Reality Check uitgevoerd.</p>
            )}
          </section>

          <section className="report-section">
            <span className="eyebrow">09 / Besluit en volgende stap</span>
            <h3>{r.decision ? `${r.decision.action}.` : "Nog geen besluit."}</h3>
            {r.decision && (
              <p>
                {r.decision.rationale}
                {r.decision.nextStep ? ` Volgende stap: ${r.decision.nextStep}.` : ""} Vastgelegd op {date(r.decision.at)}.{" "}
                {r.decision.confirmedAt
                  ? `Bevestigd door de opdrachtgever op ${date(r.decision.confirmedAt)}${r.decision.comment ? ` (“${r.decision.comment}”)` : ""}.`
                  : r.decision.confirmation === "not_needed"
                    ? "Dit dossier heeft geen opdrachtgever: het besluit is direct definitief."
                    : "Nog niet bevestigd door de opdrachtgever."}
                {r.decision.extendWeeks ? ` Daarna volgde een periode van ${r.decision.extendWeeks} weken verder testen (verlengde testfase); het definitieve besluit en de uitkomstklok kwamen daarna.` : ""}
                {r.decision.confirmedAt && r.decision.reviewedAgainst ? " De opdrachtgever zag daarbij de samenvatting “Wat ging tegen” (mislukte tests, tegenbewijs, begrensde aannames en afwijkingen van de beslisregel)." : ""}
              </p>
            )}
            {r.decision?.rule && (
              <div className="mt-12">
                <p>
                  <strong>Beslisregel: {r.decision.rule.met ? "gehaald" : "niet gehaald"}.</strong> {r.decision.rule.lines.join("; ")}.
                </p>
                {r.decision.rule.deviation && (
                  <p className="mt-8">
                    <strong>Afwijking van de beslisregel:</strong> {r.decision.rule.deviation.label.toLowerCase()}. Motivering: {r.decision.rule.deviation.reason}
                  </p>
                )}
              </div>
            )}
          </section>

          {r.prediction && (
            <section className="report-section">
              <span className="eyebrow">10 / Voorspelling en uitkomst</span>
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
                  <thead><tr><th>Moment</th><th>Mensen (gemiddeld, spreiding)</th><th>AI</th>{r.prediction.result && !r.prediction.stop ? <th>Brier per voorspelling</th> : null}</tr></thead>
                  <tbody>
                    {r.prediction.moments.map((m) => (
                      <tr key={m.moment}>
                        <td>{m.moment}</td>
                        <td className="num">{m.people ? `${pct0(m.people.mean)} (${pct0(m.people.min)}–${pct0(m.people.max)}, n=${m.people.n})` : "—"}</td>
                        <td className="num">{m.ai != null ? pct0(m.ai) : "—"}</td>
                        {r.prediction.result && !r.prediction.stop ? <td className="num">{m.forecasts.map((f) => `${f.who} ${f.brier?.toFixed(2)}`).join(" · ")}</td> : null}
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
                Iedereen geeft zijn kans zonder de anderen te zien. De AI telt als één stem (het gemiddelde van de modellen), niet mee in het gemiddelde van de mensen, en is geen bewijs. De Brier-score
                meet achteraf hoe goed een kans was: 0 is perfect, 0,25 is wat je haalt met steeds 50%.
              </p>
              {r.prediction.stop && (
                <p className="mt-8">
                  Dit dossier is gestopt of gepauzeerd. De oorspronkelijke uitkomstvraag is daarmee vervallen en de voorspellingen worden niet gescoord als
                  slagingskans. Zes maanden na het besluit volgt de vraag: was stoppen achteraf terecht?{" "}
                  {r.prediction.stop.review
                    ? `Vastgelegd op ${date(r.prediction.stop.review.at)}: ${r.prediction.stop.review.justified.toLowerCase()}. ${r.prediction.stop.review.evidence}`
                    : "Nog niet beantwoord."}
                </p>
              )}
              {r.prediction.checkins.map((c, i) => (
                <p className="mt-8" key={i}>Tussenstand {date(c.at)}: {c.onTrack.toLowerCase()}{c.value != null ? ` (stand: ${c.value})` : ""}. {c.note}</p>
              ))}
              {r.prediction.result && (
                <p className="mt-8">
                  Vastgelegd op {date(r.prediction.result.at)}: {r.prediction.result.achieved.toLowerCase()}
                  {r.prediction.result.value != null ? ` (werkelijk: ${r.prediction.result.value})` : ""}. {r.prediction.result.evidence}
                  {r.prediction.result.effort ? ` Inzet: ${r.prediction.result.effort.toLowerCase()}.` : ""}
                  {r.prediction.result.insufficient ? " Onvoldoende uitgevoerd: de uitkomst zegt vooral iets over de uitvoering." : ""}
                </p>
              )}
            </section>
          )}

          <section className="report-section" style={{ breakBefore: "page" }}>
            <span className="eyebrow">Bronnen</span>
            <ol style={{ margin: "6px 0 0 18px", fontSize: 13, lineHeight: 1.7, color: "var(--color-text)" }}>
              {r.sources.map((s) => (
                <li key={s.n}>
                  {s.publisher ? `${s.publisher}, ` : ""}
                  <em>{s.title}</em> ({s.type}{s.primary ? ", primair" : ""}). Gepubliceerd: {date(s.published_on)}; opgehaald: {date(s.retrieved_at)}.{s.url ? ` ${s.url}` : ""}
                </li>
              ))}
            </ol>
            {r.sources.length === 0 && <p>Geen bronnen.</p>}
            <MethodSection m={"methodology" in r ? r.methodology : null} />
            <p className="tiny mt-12">
              Methode: elke bevinding steunt op een letterlijk citaat dat automatisch is teruggevonden in de bewaarde bronpassage; de status
              (geverifieerd, onderbouwde schatting, onvoldoende bewijs, tegenstrijdig, verouderd) wordt berekend, niet gekozen. Experimentdrempels
              zijn vóór de start vergrendeld. {r.method.aiCalls ? `AI is ${r.method.aiCalls}× gebruikt (${r.method.models.join(", ")}; kosten $${r.method.aiCostUsd}). AI-uitvoer telt nooit als bewijs.` : "Er is geen AI gebruikt."}
            </p>
          </section>

          <div style={{ borderTop: "1px solid var(--color-border)", paddingTop: 16, display: "flex", justifyContent: "space-between", color: "var(--color-text-muted)", fontSize: 12 }}>
            <span>ProofLab · {r.preparedBy}</span>
            <span>Versie {r.version} · {date(r.generatedAt)}</span>
          </div>
        </article>
      )}
    </PageFrame>
  );
}
