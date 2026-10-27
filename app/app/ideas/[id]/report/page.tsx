import type { Metadata } from "next";
import Link from "next/link";
import { PageFrame } from "@/components/shell/PageFrame";
import { ActionForm } from "@/components/ui/ActionForm";
import { getIdea } from "@/lib/data";
import { supabaseServer } from "@/lib/supabase/server";
import type { ReportSnapshot } from "@/lib/report";
import { pct } from "@/lib/domain/stats";
import { CHANNELS } from "@/lib/domain/tracking";
import { createReportVersion } from "./actions";
import { PrintButton } from "./PrintButton";

export const metadata: Metadata = { title: "Rapportage" };

const eur = (n: number | null | undefined) => (n == null ? "onbekend" : `€ ${Math.round(n).toLocaleString("nl-NL")}`);
const int = (n: number) => Math.round(n).toLocaleString("nl-NL");
const date = (s: string | null | undefined) => (s ? new Date(s).toLocaleDateString("nl-NL", { day: "numeric", month: "long", year: "numeric" }) : "onbekend");
const SECTIONS: Record<string, string> = { market: "Markt en trends", customers: "Klant en probleem", competition: "Concurrentie", pricing: "Prijs en koopproces", sizing: "Marktomvang", regulation: "Regels en context", other: "Overig" };
const Notes = ({ n }: { n: number[] }) => (n.length ? <sup>[{n.join(", ")}]</sup> : <sup>[geen bron]</sup>);

export default async function ReportPage({ params, searchParams }: PageProps<"/app/ideas/[id]/report">) {
  const { id } = await params;
  const sp = await searchParams;
  const { idea, canWrite } = await getIdea(id);
  const supabase = await supabaseServer();
  const { data: versions } = await supabase.from("reports").select("id, version, created_at").eq("idea_id", id).order("version", { ascending: false });
  const wanted = typeof sp.v === "string" ? Number(sp.v) : versions?.[0]?.version;
  const current = versions?.find((v) => v.version === wanted) ?? versions?.[0];
  const { data: row } = current ? await supabase.from("reports").select("snapshot").eq("id", current.id).single() : { data: null };
  const r = row?.snapshot as ReportSnapshot | undefined;

  return (
    <PageFrame crumbs={["Werkruimte", idea.title, "Rapportage"]} coach="report" ideaId={id}>
      <div className="section-row report-controls">
        <div>
          <div className="eyebrow">UITKOMST · ONDERZOEKSDOSSIER</div>
          <h1>Een helder verhaal.<br />Met bewijs.</h1>
          <p className="sub">Elke versie is een vaste momentopname: later bijwerken verandert een eerder gedeeld rapport niet.</p>
        </div>
        <div className="stack" style={{ justifyItems: "end" }}>
          {r && <PrintButton />}
          {canWrite && (
            <ActionForm action={createReportVersion.bind(null, id)} submitLabel={r ? "Nieuwe versie maken" : "Maak het eerste rapport"} submitClass={r ? "btn white sm" : "btn primary"} pendingLabel="Rapport samenstellen…"><span /></ActionForm>
          )}
        </div>
      </div>
      {versions && versions.length > 1 && (
        <div className="filter-strip report-controls" aria-label="Rapportversies">
          {versions.map((v) => (
            <Link key={v.id} href={`?v=${v.version}`} className={`filter-btn${v.version === current?.version ? " active" : ""}`} style={{ textDecoration: "none" }}>
              Versie {v.version} · {new Date(v.created_at).toLocaleDateString("nl-NL")}
            </Link>
          ))}
          {current && <a className="filter-btn" href={`/api/reports/${current.id}`} style={{ textDecoration: "none" }}>JSON-export (audit)</a>}
        </div>
      )}

      {!r ? (
        <div className="empty-state">
          <h3>Nog geen rapport</h3>
          <p>Een rapport bundelt beslisvraag, bevindingen met bronnen, marktomvang, experimenten, de Reality Check en het besluit in één document voor de opdrachtgever.</p>
        </div>
      ) : (
        <article className="report-paper">
          <div className="report-head">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <strong style={{ font: "700 20px var(--font-space-grotesk),sans-serif", letterSpacing: "-.06em" }}>◉ ProofLab.</strong>
              <span className={`pill ${r.idea.isDemo ? "orange" : "blue"}`}>{r.idea.isDemo ? "DEMO · GEEN ECHT ONDERZOEK" : r.label.toUpperCase()}</span>
            </div>
            <div className="eyebrow" style={{ marginTop: 35 }}>VALIDATIEDOSSIER · VERSIE {r.version} · {date(r.generatedAt).toUpperCase()}</div>
            <h1>{r.idea.title}</h1>
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
              <thead><tr><th>Aanname</th><th>Belang</th><th>Bewijs</th><th>Status</th></tr></thead>
              <tbody>{r.assumptions.map((a, i) => <tr key={i}><td>{a.statement}</td><td className="num">{a.importance}/5</td><td className="num">{a.evidence}%</td><td>{{ untested: "Niet getest", testing: "Wordt getest", supported: "Ondersteund", refuted: "Weerlegd", inconclusive: "Onbeslist" }[a.status as "untested"]}</td></tr>)}</tbody>
            </table>
          </section>

          <section className="report-section">
            <span className="eyebrow">07 / EXPERIMENTEN EN RESULTATEN</span>
            <h3>Van mening naar meetbaar gedrag</h3>
            {r.experiments.length === 0 && <p>Er zijn nog geen experimenten uitgevoerd.</p>}
            {r.experiments.map((e, i) => (
              <div key={i} className="mt-12" style={{ breakInside: "avoid" }}>
                <strong style={{ fontSize: 13 }}>{e.title} ({e.type})</strong>
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
