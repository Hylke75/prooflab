import { ActionForm } from "@/components/ui/ActionForm";
import { saveDecisionRule } from "@/app/app/ideas/[id]/assumptions/rule-actions";
import { describeRule, RULE_MAX, RULE_MIN, type DecisionRule, type RuleEvaluation } from "@/lib/domain/decision-rule";
import { pct } from "@/lib/domain/forecast";

const day = (iso: string) => new Date(iso).toLocaleDateString("nl-NL", { day: "numeric", month: "long", year: "numeric" });

function LockPill({ rule }: { rule: DecisionRule | null }) {
  if (!rule) return <span className="pill orange">Nog niet vastgelegd</span>;
  if (rule.lockedAt) return <span className={`pill ${rule.recordedLate ? "orange" : "green"}`}>{rule.recordedLate ? "Achteraf vastgelegd" : "Vergrendeld"}</span>;
  return <span className="pill blue">Nog aan te passen</span>;
}

// Golf B, punt 6: de beslisregel vastleggen op de aannamepagina, vóór de eerste goedgekeurde test. Bewust zonder de
// huidige kansen erbij: de drempel hoort bij de beslissing, niet bij wat het bewijs nu toevallig zegt.
export function DecisionRuleCard({
  ideaId,
  rule,
  assumptions,
  experiments,
  canWrite,
}: {
  ideaId: string;
  rule: DecisionRule | null;
  assumptions: { id: string; statement: string; importance: number }[];
  experiments: { id: string; title: string }[];
  canWrite: boolean;
}) {
  const primaryTitle = rule?.primaryExperimentId ? (experiments.find((e) => e.id === rule.primaryExperimentId)?.title ?? null) : null;
  const min = (id: string) => rule?.conditions.find((c) => c.assumptionId === id)?.minProbability ?? null;
  return (
    <div className="card mt-18" id="beslisregel" style={{ scrollMarginTop: 100 }}>
      <div className="section-title">
        <h2 className="as-h3">Beslisregel</h2>
        <LockPill rule={rule} />
      </div>
      <p className="sub">
        Leg vóór de eerste test vast wanneer je doorgaat: welke aannames boven welke kans moeten uitkomen en welke hoofdtest moet slagen. Bij het besluit toont
        ProofLab per voorwaarde of die is gehaald. Wie daarvan afwijkt, motiveert dat; de motivering staat in het auditspoor en in het rapport.
      </p>
      {rule && (
        <>
          <p className="mt-12"><strong>{describeRule(rule, primaryTitle)}</strong></p>
          <ul style={{ margin: "8px 0 0 18px", fontSize: 14, lineHeight: 1.7 }}>
            {rule.conditions.map((c) => (
              <li key={c.assumptionId}>
                {assumptions.find((a) => a.id === c.assumptionId)?.statement ?? "Verwijderde aanname"} · minstens {pct(c.minProbability)}
              </li>
            ))}
            {rule.primaryExperimentId && <li>Hoofdtest: {primaryTitle ?? "verwijderde test"} · moet slagen</li>}
          </ul>
          {rule.note && <p className="tiny mt-8">Toelichting: {rule.note}</p>}
          {rule.lockedAt && (
            <p className="tiny mt-8">
              {rule.recordedLate
                ? `Vastgelegd nadat er al een test was goedgekeurd; vergrendeld op ${day(rule.lockedAt)}. Het rapport vermeldt dat.`
                : `Vergrendeld op ${day(rule.lockedAt)}, bij de eerste goedgekeurde test.`}
            </p>
          )}
        </>
      )}
      {canWrite && !rule?.lockedAt && (
        <details className="mt-12" open={!rule}>
          <summary className="text-link">{rule ? "Regel aanpassen" : "Leg de beslisregel vast"}</summary>
          <ActionForm action={saveDecisionRule.bind(null, ideaId)} submitLabel="Beslisregel vastleggen">
            <fieldset style={{ border: 0, padding: 0, margin: "12px 0 0" }}>
              <legend className="field-label">Welke aannames moeten boven welke kans uitkomen?</legend>
              {assumptions.length === 0 && <p className="tiny">Nog geen aannames. Voeg ze eerst toe.</p>}
              {assumptions.map((a) => (
                <div key={a.id} className="double-field" style={{ alignItems: "center", gridTemplateColumns: "minmax(0, 1fr) 130px" }}>
                  <label className="check-row" style={{ margin: "6px 0" }}>
                    <input type="checkbox" name={`cond_${a.id}`} defaultChecked={min(a.id) != null} /> {a.statement} <span className="tiny">(belang {a.importance}/5)</span>
                  </label>
                  <input
                    className="field"
                    name={`min_${a.id}`}
                    inputMode="decimal"
                    aria-label={`Minimale kans voor: ${a.statement}`}
                    placeholder="Bijv. 70%"
                    defaultValue={min(a.id) != null ? String(Math.round(min(a.id)! * 100)) : ""}
                  />
                </div>
              ))}
            </fieldset>
            <label className="field-label" htmlFor="dr-primary">Hoofdtest die moet slagen</label>
            <select className="field" id="dr-primary" name="primary_experiment_id" defaultValue={rule?.primaryExperimentId ?? ""}>
              <option value="">Geen hoofdtest</option>
              {experiments.map((e) => <option key={e.id} value={e.id}>{e.title}</option>)}
            </select>
            <label className="field-label" htmlFor="dr-note">Toelichting (optioneel)</label>
            <input className="field" id="dr-note" name="note" maxLength={600} placeholder="Bijv. bij minder dan 70% kans op betaalbereidheid investeren we niet." />
            <p className="field-hint">
              Kansen tussen {Math.round(RULE_MIN * 100)}% en {Math.round(RULE_MAX * 100)}%. De regel ligt vast zodra de eerste test is goedgekeurd; daarna kan hij niet meer
              worden aangepast.
            </p>
          </ActionForm>
        </details>
      )}
      {!canWrite && !rule && <p className="tiny mt-8">Het onderzoeksteam legt de beslisregel vast.</p>}
    </div>
  );
}

// Golf B, punt 6: de toets bij het besluit, per voorwaarde gehaald of niet.
export function RuleCheckCard({ rule, evaluation }: { rule: DecisionRule; evaluation: RuleEvaluation }) {
  return (
    <div className="card" id="beslisregel-toets" style={{ scrollMarginTop: 100 }}>
      <div className="section-title">
        <h3>Toets aan de beslisregel</h3>
        <span className={`pill ${evaluation.met ? "green" : "coral"}`}>{evaluation.met ? "Gehaald" : "Niet gehaald"}</span>
      </div>
      <p className="sub">{describeRule(rule, evaluation.primary?.title)}{rule.recordedLate ? " Let op: deze regel is pas vastgelegd nadat er al een test was goedgekeurd." : ""}</p>
      {evaluation.conditions.map((c) => (
        <div className="data-row" key={c.assumptionId}>
          <span>{c.statement}</span>
          <strong className="num" style={{ textAlign: "right" }}>
            <span className={`pill ${c.met ? "green" : "coral"}`}>{c.met ? "✓ gehaald" : "✗ niet gehaald"}</span> {c.probability != null ? pct(c.probability) : "onbekend"} / minstens {pct(c.minProbability)}
          </strong>
        </div>
      ))}
      {evaluation.primary && (
        <div className="data-row">
          <span>Hoofdtest: {evaluation.primary.title}</span>
          <strong style={{ textAlign: "right" }}>
            <span className={`pill ${evaluation.primary.met ? "green" : "coral"}`}>{evaluation.primary.met ? "✓ geslaagd" : "✗ niet geslaagd"}</span>{" "}
            {evaluation.primary.verdict == null ? "nog geen goedgekeurde Learning Card" : evaluation.primary.verdict === "fail" ? "niet geslaagd" : evaluation.primary.verdict === "inconclusive" ? "onbeslist" : ""}
          </strong>
        </div>
      )}
      <div className="note">
        {evaluation.met
          ? "De regel is gehaald. Stoppen of pauzeren wijkt af van de regel en vraagt een motivering."
          : "De regel is niet gehaald. Doorgaan wijkt af van de regel en vraagt een motivering; die komt in het auditspoor en in het rapport."}
      </div>
    </div>
  );
}
