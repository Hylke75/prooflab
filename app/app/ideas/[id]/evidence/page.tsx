import type { Metadata } from "next";
import Link from "next/link";
import { PageFrame } from "@/components/shell/PageFrame";
import { Stepper } from "@/components/ui/Stepper";
import { ActionForm } from "@/components/ui/ActionForm";
import { DecisionSelector } from "@/components/evidence/DecisionSelector";
import { LABEL_PILL, RuleSummary, outcomeFromCard, ruleLine } from "@/components/experiments/RuleSummary";
import { asMethodVersion, METHODS } from "@/lib/domain/method";
import { verdictInput } from "@/lib/method-preview";
import { DecisionForecast } from "@/components/forecast/DecisionForecast";
import { decisionBlocker, forecastFirstLock } from "@/lib/domain/forecast";
import { ForecastFirstLock } from "@/components/forecast/ForecastFirstLock";
import { getIdea } from "@/lib/data";
import { loadDossier } from "@/lib/dossier";
import { loadProgress } from "@/lib/progress";
import { loadCalibration } from "@/lib/method-data";
import { Probability } from "@/components/ui/Probability";
import { stepsDone } from "@/lib/steps";
import { asEvidenceLevel, explainStrength, outcomeWithLevel, strength, strengthLabel, testEvidenceLevel, type EvidenceLevel } from "@/lib/domain/evidence";
import { ASSUMPTION_CATEGORIES, DECISIONS, OBSERVATION_KINDS, type DecisionAction, type ObservationKind } from "@/lib/domain/labels";
import type { Finding } from "@/lib/domain/reality-check";
import { addPremortem, approveLearningCard, confirmDecision, runCheck, saveDecision, updateLearningCard } from "./actions";
import { RuleCheckCard } from "@/components/decision/DecisionRule";
import { loadRuleCheck } from "@/lib/decision-rule-data";
import { deviationLabel } from "@/lib/domain/decision-rule";
import { ConfirmDecision } from "@/components/evidence/ConfirmDecision";
import { againstFor } from "@/lib/against-data";
import { extendedPhase, extensionBlocker } from "@/lib/domain/extension";
import { todayInNL } from "@/lib/domain/sprint";

export const metadata: Metadata = { title: "Bewijs & besluit" };

// Het bewijsniveau op een Learning Card: zoals vastgelegd, of (oudere kaarten) afgeleid uit het testtype.
function cardLevel(metrics: unknown, exp: { type: string; hypotheses: { decision_rule?: string | null } | null } | undefined): EvidenceLevel | null {
  const stored = asEvidenceLevel((metrics as { evidence_level?: unknown } | null)?.evidence_level);
  return stored ?? (exp ? testEvidenceLevel(exp.type, { decisionRule: exp.hypotheses?.decision_rule }) : null);
}

const LADDER: { kinds: ObservationKind[]; label: string }[] = [
  { kinds: ["opinion"], label: "Uitgesproken belangstelling" },
  { kinds: ["problem_confirmed", "current_behaviour", "current_spend"], label: "Probleem in eigen gedrag" },
  { kinds: ["waitlist_signup"], label: "Kleine handeling (aanmelding)" },
  { kinds: ["demo_request", "quote_request"], label: "Concrete aanvraag of keuze bij prijs" },
  { kinds: ["deposit"], label: "Aanbetaling" },
  { kinds: ["repeat_purchase"], label: "Herhaalde aankoop" },
];
const SEV = { blocker: ["Blokkerend", "coral"], warning: ["Let op", "orange"], info: ["Ter info", "gray"] } as const;

export default async function EvidencePage({ params }: PageProps<"/app/ideas/[id]/evidence">) {
  const { id } = await params;
  const { idea, canWrite, isClientDecider } = await getIdea(id);
  const progress = await loadProgress(id);
  // Golf B, punt 15: zolang het open voorspelmoment niet door deze gebruiker is voorspeld, blijven de berekende kansen,
  // de sterkte van het bewijs en andermans voorspellingen vergrendeld.
  const lock = forecastFirstLock(progress);
  if (lock) {
    return (
      <PageFrame crumbs={["Werkruimte", idea.title, "Bewijs & besluit"]} coach="evidence" ideaId={id}>
        <div className="section-row">
          <div>
            <div className="eyebrow">Stap 5 van 5 · Leren en beslissen</div>
            <h1>Wat weten we nu echt?</h1>
            <p className="sub">Eerst je eigen voorspelling; daarna alle signalen op één plek, inclusief tegenbewijs.</p>
          </div>
        </div>
        <Stepper current="decide" ideaId={id} done={stepsDone(progress)} />
        <div className="grid-2">
          <ForecastFirstLock ideaId={id} moment={lock} what="de bewijspagina met de sterkte van het bewijs, de kansen per aanname en de Reality Check" client={!canWrite} />
          {lock === "decision" && <DecisionForecast ideaId={id} />}
        </div>
      </PageFrame>
    );
  }
  const [d, ruleCheck, calibration] = await Promise.all([loadDossier(idea), loadRuleCheck(id), loadCalibration(id)]);
  const obs = d.observations.filter((o) => !o.is_synthetic).sort((a, b) => strength({ isFact: b.is_fact, isBehaviour: b.is_behaviour, isRealContext: b.is_real_context, isCostly: b.is_costly, isSynthetic: false }) - strength({ isFact: a.is_fact, isBehaviour: a.is_behaviour, isRealContext: a.is_real_context, isCostly: a.is_costly, isSynthetic: false }));
  const reached = LADDER.map((r) => ({ ...r, count: obs.filter((o) => r.kinds.includes(o.kind as ObservationKind)).length }));
  const highest = [...reached].reverse().find((r) => r.count > 0);
  const missingPayment = !reached.slice(4).some((r) => r.count > 0);
  const check = d.realityCheck;
  const checkFindings = ((check?.findings as { findings?: (Finding & { source?: string })[] } | null)?.findings ?? []);
  const investorQuestions = ((check?.findings as { investorQuestions?: string[] } | null)?.investorQuestions ?? []);
  const lastApproved = d.learningCards.filter((c) => c.status === "approved").map((c) => c.approved_at ?? "").sort().pop();
  const stale = !!(check && lastApproved && lastApproved > check.created_at);
  const drafts = d.learningCards.filter((c) => c.status === "draft");
  const approved = d.learningCards.filter((c) => c.status === "approved");
  const premortem = d.assumptions.filter((a) => a.origin === "premortem");
  const method = asMethodVersion(idea.method_version);
  // Golf B, punt 20: de verlengde testfase en welke besluiten nu niet kunnen.
  const today = todayInNL();
  const decisionLites = d.decisions.map((x) => ({ action: x.action, decidedOn: todayInNL(new Date(x.decided_at)), extendWeeks: x.extend_weeks ?? null }));
  const phase = extendedPhase(decisionLites, today);
  const blocked = Object.fromEntries(
    (Object.keys(DECISIONS) as DecisionAction[]).flatMap((a) => {
      const why = extensionBlocker(a, decisionLites, today, !!idea.outcome_clock_start);
      return why ? [[a, why]] : [];
    }),
  ) as Partial<Record<DecisionAction, string>>;

  return (
    <PageFrame crumbs={["Werkruimte", idea.title, "Bewijs & besluit"]} coach="evidence" ideaId={id}>
      <div className="section-row">
        <div>
          <div className="eyebrow">Stap 5 van 5 · Leren en beslissen</div>
          <h1>Wat weten we nu echt?</h1>
          <p className="sub">Alle signalen op één plek. Inclusief tegenbewijs en de beperkingen van je tests.</p>
        </div>
        <Link className="btn white" href={`/app/ideas/${id}/report`}>Bekijk rapport →</Link>
      </div>
      <Stepper current="decide" ideaId={id} done={stepsDone(progress)} />

      {phase && (
        <div className="note" role="status">
          <strong>Verlengde testfase{phase.active ? "" : " afgelopen"}:</strong> {phase.weeks} weken, van {phase.start} tot {phase.end}.{" "}
          {phase.active
            ? "Verzamel nu het extra gedragsbewijs. Het definitieve besluit en de uitkomstklok volgen na deze fase."
            : "Neem nu het definitieve besluit: doorgaan, stoppen of pauzeren. Daarmee start de uitkomstklok."}
        </div>
      )}

      <div className="insight-banner" style={{ background: "var(--color-success-soft)" }}>
        <div>
          <span className="pill green">{d.label.label}</span>
          <h2 className="as-h3" style={{ margin: "10px 0 5px" }}>
            {highest ? `Sterkste bewijs tot nu toe: ${highest.label.toLowerCase()} (${highest.count}×).` : "Nog geen waargenomen klantgedrag."}
            {missingPayment ? " Betaling nog niet aangetoond." : ""}
          </h2>
          <p>
            {d.label.missing.length ? `Voor het volgende niveau ontbreekt: ${d.label.missing.join("; ")}.` : "Het dossier voldoet aan het hoogste bewijsniveau."}
          </p>
        </div>
      </div>

      <div className="grid-2">
        <div className="card">
          <div className="section-title"><h3>Bewijs op een rij</h3><span className="pill gray">{obs.length} observaties</span></div>
          <div className="row" style={{ gap: 6, marginBottom: 6 }}>
            {reached.map((r) => <span key={r.label} className={`pill ${r.count ? "green" : "gray"}`}>{r.label}{r.count ? ` · ${r.count}` : ""}</span>)}
          </div>
          {obs.length === 0 && <p className="sub mt-12">Nog geen observaties. Die ontstaan uit interviews en afgeronde experimenten.</p>}
          {obs.slice(0, 12).map((o) => {
            const dims = { isFact: o.is_fact, isBehaviour: o.is_behaviour, isRealContext: o.is_real_context, isCostly: o.is_costly, isSynthetic: o.is_synthetic };
            const s = strengthLabel(strength(dims));
            return (
              <div className="evidence-event" key={o.id}>
                <div className="icon-circle">{o.is_behaviour ? "✓" : "?"}</div>
                <div>
                  <strong>{OBSERVATION_KINDS[o.kind as ObservationKind]}: {o.summary}</strong>
                  {o.quote && <blockquote className="quote">“{o.quote}”</blockquote>}
                  <p><span className={`pill ${s.pill}`}>{s.label}</span> {explainStrength(dims)}</p>
                </div>
              </div>
            );
          })}
          <div className="note">Een goed bewijsdossier laat ook helder zien wat een test níét aantoont. Synthetische of AI-gegenereerde data telt nooit mee.</div>
        </div>

        <div className="stack">
          <div className="card">
            <div className="section-title"><h3>Reality Check</h3><span className="pill coral">Verplicht vóór elk besluit</span></div>
            {!check ? (
              <p className="sub">Nog niet uitgevoerd. De check zoekt naar valkuilen, zwakke data en conclusies die het bewijs niet draagt.</p>
            ) : (
              <>
                <p className="tiny">Uitgevoerd {new Date(check.created_at).toLocaleString("nl-NL")}{check.ai_used ? " · met kritische vragen van AI" : " · op basis van vaste regels"}</p>
                {stale && <div className="form-error mt-8">Er is nieuw bewijs sinds deze check. Voer hem opnieuw uit.</div>}
                <div className="verdict inconclusive mt-12">
                  <strong>Advies: {DECISIONS[check.advice as DecisionAction].label}</strong>
                  <p className="sub" style={{ marginTop: 4 }}>{check.advice_reason}</p>
                </div>
                {checkFindings.map((f, i) => (
                  <div className="evidence-event" key={i}>
                    <div className="icon-circle">{f.severity === "blocker" ? "!" : f.source === "ai" ? "✳" : "•"}</div>
                    <div><strong>{f.title}</strong> <span className={`pill ${SEV[f.severity][1]}`}>{SEV[f.severity][0]}</span>{f.source === "ai" && <span className="pill blue" style={{ marginLeft: 4 }}>AI-vraag</span>}<p>{f.detail}</p></div>
                  </div>
                ))}
                {investorQuestions.length > 0 && (
                  <details className="mt-12">
                    <summary className="text-link">Wat zou een kritische investeerder vragen?</summary>
                    <ul style={{ margin: "8px 0 0 18px", fontSize: 14, lineHeight: 1.8 }}>{investorQuestions.map((q) => <li key={q}>{q}</li>)}</ul>
                  </details>
                )}
              </>
            )}
            <div className="divider" />
            <h4 id="premortem" style={{ fontSize: 13 }}>Pre-mortem</h4>
            <p className="sub" style={{ fontSize: 13 }}>
              Het is zes maanden na het besluit en dit is mislukt. Wat is de meest waarschijnlijke reden?
            </p>
            {premortem.length > 0 ? (
              <ul style={{ margin: "8px 0 0 18px", fontSize: 14, lineHeight: 1.7 }}>
                {premortem.map((a) => (
                  <li key={a.id}>
                    {a.statement}{" "}
                    <span className="tiny">
                      · belang {a.importance}/5 · geschatte kans dat dit klopt <Probability p={a.probability.probability} calibrated={calibration.calibrated} />{a.probability.counted === 0 ? " (nog geen bewijs)" : ""}{a.probability.cap?.active ? ` (${a.probability.cap.reason})` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="tiny mt-8">Nog niet gedaan. De Reality Check waarschuwt tot er minstens één reden is vastgelegd.</p>
            )}
            {canWrite && (
              <details className="mt-8" open={premortem.length === 0}>
                <summary className="text-link">{premortem.length ? "Nog een reden toevoegen" : "Doe de pre-mortem (1 tot 3 redenen)"}</summary>
                <ActionForm action={addPremortem.bind(null, id)} submitLabel="Zet op de risicokaart" submitClass="btn white sm" resetOnSuccess>
                  <p className="explain">
                    Schrijf elke reden op als wat waar moet zijn om die mislukking te voorkomen. Reden &quot;overstappen was te veel gedoe&quot; wordt bijvoorbeeld: &quot;Eventmanagers stappen zonder veel moeite over van hun vaste bureau.&quot;
                  </p>
                  {[1, 2, 3].map((i) => (
                    <div key={i} className="mt-12">
                      <label className="field-label" htmlFor={`pm-r-${i}`} style={{ marginTop: 0 }}>Reden {i}{i > 1 ? " (optioneel)" : ""}</label>
                      <input className="field" id={`pm-r-${i}`} name={`reason_${i}`} maxLength={400} placeholder={i === 1 ? "Bijv. Eventmanagers stappen zonder veel moeite over van hun vaste bureau." : ""} />
                      <div className="double-field mt-8">
                        <select className="field" name={`category_${i}`} defaultValue="desirability" aria-label={`Soort risico bij reden ${i}`}>
                          {Object.entries(ASSUMPTION_CATEGORIES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                        </select>
                        <select className="field" name={`importance_${i}`} defaultValue="4" aria-label={`Belangrijkheid van reden ${i} (5 = idee valt om)`}>
                          {[5, 4, 3, 2, 1].map((n) => <option key={n} value={n}>Belang {n}{n === 5 ? " (kritiek)" : ""}</option>)}
                        </select>
                      </div>
                    </div>
                  ))}
                  <p className="explain">Elke reden wordt een aanname op de risicokaart. Kritieke redenen zonder bewijs tellen mee als ongeteste kritieke aannames.</p>
                </ActionForm>
              </details>
            )}
            {canWrite && (
              <ActionForm action={runCheck.bind(null, id)} submitLabel={check ? "Voer de check opnieuw uit" : "Voer de Reality Check uit"} submitClass="btn white sm" pendingLabel="Controleren…"><span /></ActionForm>
            )}
          </div>

          <DecisionForecast ideaId={id} />

          {ruleCheck && <RuleCheckCard rule={ruleCheck.rule} evaluation={ruleCheck.evaluation} />}
          {!ruleCheck && canWrite && (
            <p className="tiny">
              Dit dossier heeft geen beslisregel. <Link className="text-link" href={`/app/ideas/${id}/assumptions#beslisregel`}>Leg vast wanneer je doorgaat →</Link>
            </p>
          )}

          {canWrite && (
            <div className="card">
              <div className="section-title"><h3>Wat wil je nu doen?</h3><span className="pill blue">Jij beslist</span></div>
              <p className="sub">ProofLab doet een onderbouwd voorstel, maar neemt de strategische beslissing niet over.</p>
              <DecisionSelector
                advised={(check?.advice as DecisionAction) ?? null}
                action={saveDecision.bind(null, id)}
                disabledReason={!check ? "Voer eerst de Reality Check uit." : stale ? "Voer de Reality Check opnieuw uit; er is nieuw bewijs." : decisionBlocker(progress)}
                ruleMet={ruleCheck ? ruleCheck.evaluation.met : null}
                blocked={blocked}
              />
            </div>
          )}
        </div>
      </div>

      {(drafts.length > 0 || approved.length > 0) && <div className="section-title mt-24"><h2>Learning Cards</h2></div>}
      <div className="grid-2">
        {drafts.map((c) => {
          const exp = d.experiments.find((e) => e.id === c.experiment_id);
          return (
            <div className="card" key={c.id}>
              <div className="section-title"><h3>{exp?.title ?? "Experiment"}</h3><span className="pill orange">Concept · {outcomeWithLevel(c.verdict === "pass" ? "geslaagd" : c.verdict === "fail" ? "niet geslaagd" : "onbeslist", cardLevel(c.metrics, exp)).toLowerCase()}</span></div>
              <div className="data-row"><span>We dachten</span><strong style={{ textAlign: "right" }}>{c.we_believed}</strong></div>
              <div className="data-row"><span>We zagen</span><strong style={{ textAlign: "right" }}>{c.we_observed}</strong></div>
              <RuleSummary o={outcomeFromCard(c.metrics, c.verdict, exp?.hypotheses ?? null)} />
              {canWrite ? (
                <>
                  <ActionForm action={updateLearningCard.bind(null, id, c.id)} submitLabel="Opslaan" submitClass="btn white sm">
                    <label className="field-label" htmlFor={`lc-l-${c.id}`}>Daaruit leren we</label>
                    <textarea className="field" id={`lc-l-${c.id}`} name="we_learned" rows={3} defaultValue={c.we_learned} />
                    <label className="field-label" htmlFor={`lc-t-${c.id}`}>Daarom gaan we</label>
                    <textarea className="field" id={`lc-t-${c.id}`} name="therefore" rows={2} defaultValue={c.therefore} />
                    <label className="field-label" htmlFor={`lc-r-${c.id}`}>Betrouwbaarheid van de data</label>
                    <select className="field" id={`lc-r-${c.id}`} name="data_reliability" defaultValue={c.data_reliability}>
                      <option value="low">Laag</option><option value="medium">Middel</option><option value="high">Hoog</option>
                    </select>
                  </ActionForm>
                  <ActionForm action={approveLearningCard.bind(null, id, c.id)} submitLabel="Keur goed: werk de aanname bij" submitClass="btn primary sm"><span /></ActionForm>
                </>
              ) : (
                <p className="sub mt-12">Wordt nog beoordeeld door het onderzoeksteam.</p>
              )}
            </div>
          );
        })}
        {approved.map((c) => {
          const exp = d.experiments.find((e) => e.id === c.experiment_id);
          return (
            <div className="card" key={c.id}>
              <div className="section-title"><h3>{exp?.title ?? "Experiment"}</h3><span className={`pill ${c.verdict === "pass" ? "green" : c.verdict === "fail" ? "coral" : "orange"}`}>{outcomeWithLevel(c.verdict === "pass" ? "geslaagd" : c.verdict === "fail" ? "niet geslaagd" : "onbeslist", cardLevel(c.metrics, exp))}</span></div>
              <div className="data-row"><span>We dachten</span><strong style={{ textAlign: "right" }}>{c.we_believed}</strong></div>
              <div className="data-row"><span>We zagen</span><strong style={{ textAlign: "right" }}>{c.we_observed}</strong></div>
              <RuleSummary o={outcomeFromCard(c.metrics, c.verdict, exp?.hypotheses ?? null)} />
              {(() => {
                // Een goedgekeurde kaart verandert nooit. Rekende hij met een andere methode dan het dossier nu,
                // dan staat de uitkomst onder de huidige methode ernaast.
                const cardMethod = asMethodVersion((c.metrics as { method_version?: unknown } | null)?.method_version);
                if (cardMethod === method || !exp?.hypotheses) return null;
                const o = outcomeFromCard(c.metrics, c.verdict, exp.hypotheses);
                const now = METHODS[method].verdict(exp.hypotheses, verdictInput(exp.hypotheses, o.n, o.successes, true));
                return (
                  <div className="data-row">
                    <span>Onder {METHODS[method].label.toLowerCase()}</span>
                    <strong style={{ textAlign: "right" }}>
                      <span className={`pill ${LABEL_PILL[now.label] ?? "gray"}`}>{now.label}</span>{" "}
                      <span className="tiny">{ruleLine({ ...o, rule: now.rule, label: now.label, probability: now.probability, probabilityFail: now.probabilityFail, successCount: now.successCount })} Ter informatie; deze kaart blijft ongewijzigd.</span>
                    </strong>
                  </div>
                );
              })()}
              <div className="data-row"><span>Daaruit leren we</span><strong style={{ textAlign: "right" }}>{c.we_learned}</strong></div>
              <div className="data-row"><span>Daarom gaan we</span><strong style={{ textAlign: "right" }}>{c.therefore}</strong></div>
              <div className="data-row"><span>Betrouwbaarheid</span><strong>{{ low: "Laag", medium: "Middel", high: "Hoog" }[c.data_reliability]}</strong></div>
            </div>
          );
        })}
      </div>

      {d.decisions.length > 0 && (
        <>
          <div className="section-title mt-24"><h2>Besluiten</h2></div>
          <div className="card">
            {d.decisions.slice().reverse().map((dec) => (
              <div className="evidence-event" key={dec.id}>
                <div className="icon-circle">✓</div>
                <div style={{ flex: 1 }}>
                  <strong>{DECISIONS[dec.action as DecisionAction].label} · {new Date(dec.decided_at).toLocaleDateString("nl-NL")}</strong>
                  <p>{dec.rationale}</p>
                  {dec.next_step && <p>Volgende stap: {dec.next_step}</p>}
                  {dec.action === "extend" && dec.extend_weeks != null && <p>Verlengde testfase van {dec.extend_weeks} weken; het definitieve besluit volgt daarna.</p>}
                  {dec.rule_met != null && (
                    <p>
                      Beslisregel: {dec.rule_met ? "gehaald" : "niet gehaald"}.
                      {dec.rule_deviation_reason ? ` ${deviationLabel(dec.action, dec.rule_met)}. Motivering: ${dec.rule_deviation_reason}` : ""}
                    </p>
                  )}
                  <p>
                    {dec.client_confirmed_at
                      ? `Bevestigd door de opdrachtgever op ${new Date(dec.client_confirmed_at).toLocaleDateString("nl-NL")}${dec.client_comment ? `: “${dec.client_comment}”` : ""}`
                      : "Nog niet bevestigd door de opdrachtgever."}
                  </p>
                  {isClientDecider && !dec.client_confirmed_at && <ConfirmDecision summary={againstFor(d, dec)} action={confirmDecision.bind(null, id, dec.id)} />}
                  {dec.reviewed_against_summary && <p className="tiny">De opdrachtgever zag bij het bevestigen de samenvatting &ldquo;Wat ging tegen&rdquo;.</p>}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </PageFrame>
  );
}
