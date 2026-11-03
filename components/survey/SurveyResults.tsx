import { ActionForm } from "@/components/ui/ActionForm";
import { loadSurveyResponses, surveyConfigOf, type ExperimentMetrics } from "@/lib/experiment-metrics";
import { summarise, type KeyMetric, type QuestionSummary, type SurveyConfig } from "@/lib/domain/survey";
import { openAnswers, redactContact } from "@/lib/domain/survey-results";
import { pct } from "@/lib/domain/stats";
import { importSurveyOpenAnswers } from "@/app/app/ideas/[id]/experiments/actions";

type Exp = { id: string; config: unknown; state: string };
type Hyp = { min_sample: number; success_threshold_pct: number };

const nl = (x: number | null, digits = 1) => (x == null ? "—" : x.toLocaleString("nl-NL", { maximumFractionDigits: digits }));
const MAX_OPEN_SHOWN = 100;

// Results of a survey for the research team: the pre-registered key metric with its 95% interval and the split
// per source, a summary per question, CSV export and open answers as customer signals. Self-reported answers,
// never observed behaviour. Responses are only readable for the research team (row level security).
export async function SurveyResults({ ideaId, exp, h, m, canWrite }: { ideaId: string; exp: Exp; h: Hyp; m: ExperimentMetrics; canWrite: boolean }) {
  const config = surveyConfigOf(exp.config);
  if (!config) {
    return <div className="note mt-18">De opzet van deze enquête is ongeldig; er kunnen geen resultaten worden getoond.</div>;
  }
  if (!canWrite) {
    return (
      <div className="card mt-18">
        <h2 className="as-h3">Enquête</h2>
        <p className="sub mt-8">De losse antwoorden zijn alleen zichtbaar voor het onderzoeksteam. De uitkomst volgt via de Learning Card en het rapport.</p>
        <p className="tiny mt-8">Zelfrapportage, geen waargenomen gedrag.</p>
      </div>
    );
  }
  const { rows, error } = await loadSurveyResponses(exp.id);
  const s = m.survey;
  const summaries = summarise(config, rows);
  const open = openAnswers(config, rows);
  const key = config.questions.find((q) => q.id === config.key_question);
  const successLabels = (key?.options ?? []).filter((o) => config.success_options.includes(o.id)).map((o) => o.label);
  const running = !m.endConditionReached;

  return (
    <>
      <div className="section-title mt-24">
        <h2>Resultaten van de enquête</h2>
        <span className="pill orange">Zelfrapportage, geen gedrag</span>
      </div>
      {error && <div className="form-error" role="alert">De antwoorden konden niet volledig worden opgehaald. Ververs de pagina.</div>}

      <div className="grid-2">
        <div className="card">
          <div className="eyebrow">KERNVRAAG (VOORAF VASTGELEGD)</div>
          <h3 style={{ fontSize: 16 }}>{key?.text}</h3>
          <p className="tiny mt-8">Telt als succes: {successLabels.map((l) => `“${l}”`).join(", ")}</p>
          {s && (
            <>
              <div className="data-row"><span>Alle geloofwaardige antwoorden (telt voor het oordeel)</span><strong className="num">{s.all.successes} / {s.all.n}</strong></div>
              <div className="data-row">
                <span>Percentage en 95%-interval</span>
                <strong className="num">{s.all.n ? `${pct(s.all.interval.point)} (${pct(s.all.interval.low)}–${pct(s.all.interval.high)})` : "—"}</strong>
              </div>
              <div className="data-row"><span>Drempel · minimale steekproef</span><strong className="num">≥ {h.success_threshold_pct}% · {h.min_sample}</strong></div>
              <p className="tiny">
                {running
                  ? "De test loopt: tussentijds kijken mag, een uitspraak volgt pas na de afgesproken eindconditie."
                  : "Het oordeel hierboven gebruikt alle geloofwaardige antwoorden, zoals vooraf vastgelegd."}
              </p>
            </>
          )}
        </div>
        <div className="card">
          <div className="eyebrow">HERKOMST VAN DE ANTWOORDEN</div>
          {s ? (
            <>
              <table className="table">
                <thead><tr><th>Bron</th><th>Antwoorden</th><th>Succes</th><th>95%-interval</th></tr></thead>
                <tbody>
                  <SplitRow label="Persoonlijk uitgenodigd (bekend)" k={s.invitation} />
                  <SplitRow label="Open link (herkomst niet te controleren)" k={s.openLink} />
                  <SplitRow label="Totaal" k={s.all} strong />
                </tbody>
              </table>
              <p className="tiny mt-8">
                {s.responses} {s.responses === 1 ? "antwoord" : "antwoorden"} ontvangen · {s.all.tooFast} te snel ingevuld en niet meegeteld. Uitgenodigde respondenten zijn bekende mensen; via een open
                link kunnen ook bots of mensen buiten de doelgroep meedoen.
              </p>
            </>
          ) : (
            <p className="sub">Nog geen gegevens.</p>
          )}
        </div>
      </div>

      <div className="card mt-18">
        <div className="section-title">
          <h2 className="as-h3">Per vraag</h2>
          {rows.length > 0 && (
            <a className="btn white sm" href={`/app/ideas/${ideaId}/experiments/${exp.id}/survey.csv`} download>
              Download antwoorden (CSV)
            </a>
          )}
        </div>
        {rows.length === 0 ? (
          <p className="sub">{exp.state === "draft" || exp.state === "ready_for_review" || exp.state === "approved" ? "Na de start verschijnen hier de antwoorden per vraag." : "Er zijn nog geen antwoorden binnen."}</p>
        ) : (
          <>
            <p className="tiny" style={{ marginTop: -8 }}>Alle geloofwaardige antwoorden (uitnodiging en open link samen). De CSV bevat geen e-mailadressen; contactgegevens in open antwoorden zijn verwijderd.</p>
            {summaries.map((q, i) => (
              <QuestionBlock key={q.id} q={q} index={i} config={config} />
            ))}
          </>
        )}
      </div>

      {open.length > 0 && (
        <div className="card mt-18">
          <h2 className="as-h3">Open antwoorden als klantsignalen</h2>
          <p className="sub mt-8">
            {open.length} open {open.length === 1 ? "antwoord" : "antwoorden"}. Neem ze op als bron van het type enquête (één fragment per antwoord, dubbele overgeslagen); daarna groepeert de analyse van
            klantsignalen ze in pijnpunten, wensen en bezwaren. Het blijven uitspraken, geen gedrag.
          </p>
          <ActionForm action={importSurveyOpenAnswers.bind(null, ideaId, exp.id)} submitLabel="Neem open antwoorden op als klantsignalen" submitClass="btn soft sm" pendingLabel="Opnemen…">
            <span />
          </ActionForm>
        </div>
      )}
    </>
  );
}

function SplitRow({ label, k, strong }: { label: string; k: KeyMetric; strong?: boolean }) {
  const cell = (x: React.ReactNode) => (strong ? <strong>{x}</strong> : x);
  return (
    <tr>
      <td>{cell(label)}</td>
      <td className="num">{cell(k.n)}</td>
      <td className="num">{cell(`${k.successes}${k.n ? ` (${pct(k.successes / k.n)})` : ""}`)}</td>
      <td className="num">{k.n ? `${pct(k.interval.low)}–${pct(k.interval.high)}` : "—"}</td>
    </tr>
  );
}

function Bar({ label, count, share, success }: { label: string; count: number; share: number; success?: boolean }) {
  return (
    <div className="survey-bar">
      <span>{label}{success ? <span className="sr-only"> (telt als succes)</span> : null}</span>
      <span className="track" aria-hidden="true"><div className={success ? "success" : undefined} style={{ width: `${Math.round(share * 100)}%` }} /></span>
      <span className="num">{count} · {pct(share, 0)}</span>
    </div>
  );
}

function QuestionBlock({ q, index, config }: { q: QuestionSummary; index: number; config: SurveyConfig }) {
  const def = config.questions.find((x) => x.id === q.id);
  const isKey = q.id === config.key_question;
  return (
    <section className="mt-18" style={{ borderTop: "1px solid var(--line)", paddingTop: 14 }} aria-labelledby={`sr-${q.id}`}>
      <div className="tiny" style={{ fontWeight: 800, textTransform: "uppercase", letterSpacing: ".08em" }}>
        Vraag {index + 1}{isKey ? " · kernvraag" : ""} · {q.n} {q.n === 1 ? "antwoord" : "antwoorden"}
      </div>
      <h3 id={`sr-${q.id}`} style={{ fontSize: 14, margin: "4px 0 8px" }}>{q.text}</h3>
      {(q.type === "single" || q.type === "multi") && (
        <>
          {q.options.map((o) => (
            <Bar key={o.id} label={o.label} count={o.count} share={o.share} success={isKey && config.success_options.includes(o.id)} />
          ))}
          {q.type === "multi" && <p className="tiny">Meerdere antwoorden mogelijk: percentages tellen op tot meer dan 100%.</p>}
          {isKey && <p className="tiny">Groen = telt als succes volgens de Test Card.</p>}
        </>
      )}
      {(q.type === "scale" || q.type === "number") && (
        <>
          <p className="sub" style={{ fontSize: 13 }}>
            Gemiddelde <strong className="num">{nl(q.mean)}</strong> · mediaan <strong className="num">{nl(q.median)}</strong>
            {q.type === "number" && q.distribution.length > 0 && (
              <> · laagste <strong className="num">{nl(q.distribution[0].value)}</strong> · hoogste <strong className="num">{nl(q.distribution[q.distribution.length - 1].value)}</strong></>
            )}
          </p>
          {q.type === "scale" && def?.scale && (
            <>
              {Array.from({ length: def.scale.max - def.scale.min + 1 }, (_, k) => def.scale!.min + k).map((v) => {
                const count = q.distribution.find((d) => d.value === v)?.count ?? 0;
                const label = v === def.scale!.min ? `${v} · ${def.scale!.minLabel}` : v === def.scale!.max ? `${v} · ${def.scale!.maxLabel}` : String(v);
                return <Bar key={v} label={label} count={count} share={q.n ? count / q.n : 0} />;
              })}
            </>
          )}
          {q.type === "number" && q.distribution.length > 0 && q.distribution.length <= 12 &&
            q.distribution.map((d) => <Bar key={d.value} label={nl(d.value)} count={d.count} share={q.n ? d.count / q.n : 0} />)}
          {q.type === "number" && q.distribution.length > 12 && <p className="tiny">{q.distribution.length} verschillende waarden; zie de CSV voor alle antwoorden.</p>}
        </>
      )}
      {q.type === "text" && (
        q.answers.filter((a) => a.trim()).length === 0 ? (
          <p className="tiny">Geen open antwoorden.</p>
        ) : (
          <>
            <ul className="open-answers" tabIndex={0} aria-label={`Open antwoorden bij vraag ${index + 1}`}>
              {q.answers.filter((a) => a.trim()).slice(0, MAX_OPEN_SHOWN).map((a, k) => <li key={k}>{redactContact(a)}</li>)}
            </ul>
            {q.answers.length > MAX_OPEN_SHOWN && <p className="tiny">De eerste {MAX_OPEN_SHOWN} van {q.answers.length}; zie de CSV voor alle antwoorden.</p>}
          </>
        )
      )}
    </section>
  );
}
