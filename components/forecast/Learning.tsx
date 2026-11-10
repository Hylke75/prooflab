import { BRIER_FEW_OUTCOMES, BRIER_MIN_OUTCOMES, brierWarning } from "@/lib/domain/forecast";
import { ActionForm } from "@/components/ui/ActionForm";
import { setLearnedWeights } from "@/app/app/forecasts/actions";
import type { LearningView } from "@/lib/learning-data";
import { LEARN_MIN_DOSSIERS, type LearnedWeight } from "@/lib/domain/calibration";
import { fmtLr } from "@/lib/domain/evidence";
import { ruleLabel } from "@/lib/coach/rules";
import { pct } from "@/lib/domain/forecast";

const dec = (n: number) => n.toFixed(2).replace(".", ",");
const day = (n: number) => n.toLocaleString("nl-NL", { maximumFractionDigits: 1 });

function learnedText(w: LearnedWeight): string {
  if (w.status !== "learned") return w.note;
  const parts = [w.learnedFor != null ? `voor × ${fmtLr(w.learnedFor)}` : null, w.learnedAgainst != null ? `tegen ÷ ${fmtLr(w.learnedAgainst)}` : null].filter(Boolean);
  return parts.join(", ");
}

// Learned evidence factors next to the defaults, with the switch that puts them to use.
export function LearnedWeights({ view }: { view: LearningView }) {
  const learned = view.weights.filter((w) => w.status === "learned").length;
  return (
    <div className="card mt-24" id="geleerde-factoren">
      <div className="section-title">
        <h3>Geleerde factoren per soort bewijs</h3>
        <span className={`pill ${view.useLearned ? "blue" : "gray"}`}>{view.useLearned ? "In gebruik" : "Niet in gebruik"}</span>
      </div>
      <p className="sub">
        Elke soort bewijs verschuift de kans op een aanname met een vaste factor. Hier staat per soort hoe vaak een dossier mét zo&apos;n uitkomst zijn doel
        haalde, vergeleken met dossiers die het niet haalden ({view.resolvedDossiers} afgeronde dossiers). Vanaf {LEARN_MIN_DOSSIERS} dossiers met zo&apos;n uitkomst
        tonen we een geleerde factor, getrokken naar de standaard zolang er weinig data is.
      </p>
      <div style={{ overflowX: "auto" }}>
        <table className="table mt-12">
          <caption className="sr-only">Standaardfactor, geleerde factor en aantal dossiers per soort bewijs</caption>
          <thead>
            <tr>
              <th scope="col">Soort bewijs</th>
              <th scope="col">Standaard</th>
              <th scope="col">Geleerd</th>
              <th scope="col">n</th>
            </tr>
          </thead>
          <tbody>
            {view.weights.map((w) => (
              <tr key={`${w.dimension}-${w.kind}`}>
                <td>
                  {w.label}
                  {w.dimension === "test" ? <span className="tiny"> (alleen ter informatie)</span> : null}
                </td>
                <td className="num">{w.defaultLr === 1 ? "telt niet mee" : `× ${fmtLr(w.defaultLr)}`}</td>
                <td className={w.status === "learned" ? "num" : "tiny"}>{learnedText(w)}</td>
                <td className="num">{w.n}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="note">
        Wat dit wel en niet zegt: het is samenhang in eigen dossiers, geen bewijs van oorzaak. Kleine aantallen schommelen sterk; daarom trekken we elke
        schatting naar de standaardfactor (alsof er per uitkomstgroep twee dossiers met de standaardverhouding bij zitten). Een geleerde factor in gebruik is
        nooit kleiner dan 1 (bewijs keert niet om) en nooit groter dan 20. Testtypes staan erbij ter informatie; de keuze van de volgende test rekent nog met de
        standaardfactoren.
      </div>
      {view.useLearned && view.changedAt && (
        <p className="tiny mt-8">
          Aangezet op {new Date(view.changedAt).toLocaleDateString("nl-NL", { day: "numeric", month: "long", year: "numeric" })}
          {view.changedBy ? ` door ${view.changedBy}` : ""}.
        </p>
      )}
      <ActionForm
        action={setLearnedWeights.bind(null, !view.useLearned)}
        submitLabel={view.useLearned ? "Terug naar standaardfactoren" : "Geleerde factoren gebruiken"}
        submitClass={view.useLearned ? "btn white" : "btn primary"}
        pendingLabel="Bewaren…"
      >
        <p className="sub mt-12">
          {view.useLearned
            ? "Kansen per aanname gebruiken nu de geleerde factoren waar die er zijn. Zet je ze uit, dan rekent alles weer met de vaste standaardfactoren."
            : `Standaard staat dit uit, zodat elke kans reproduceerbaar is met de vaste factoren uit het methodedocument. Zet je het aan, dan gebruiken alle dossiers van deze werkruimte de geleerde factoren (nu ${learned} ${learned === 1 ? "soort" : "soorten"} bewijs); die veranderen telkens als er een dossier wordt afgerond. Elk nieuw rapport vermeldt welke factoren zijn gebruikt.`}
        </p>
      </ActionForm>
    </div>
  );
}

// Survey key metric versus a later landing or pricing test on the same assumption.
export function SurveyAgreement({ view }: { view: LearningView }) {
  const a = view.agreement;
  return (
    <div className="card">
      <div className="section-title">
        <h3>Enquête tegenover gedrag</h3>
        <span className="pill gray">{a.pairs} {a.pairs === 1 ? "aanname" : "aannames"}</span>
      </div>
      <p className="sub">
        Klopte de kernvraag van een enquête met wat een landingpage- of prijstest op dezelfde aanname liet zien? Alleen goedgekeurde leerkaarten met een
        duidelijk oordeel tellen.
      </p>
      {a.pairs === 0 ? (
        <p className="tiny mt-8">Nog geen aanname met zowel een afgeronde enquête als een afgeronde gedragstest.{a.mixed ? ` ${a.mixed} met tegenstrijdige oordelen.` : ""}</p>
      ) : (
        <>
          <div className="data-row"><span>Zelfde oordeel</span><strong className="num">{a.agree} van {a.pairs}{a.rate != null ? ` (${pct(a.rate)})` : ""}</strong></div>
          <div className="data-row"><span>Enquête positief, gedrag niet</span><strong className="num">{a.surveyTooPositive}</strong></div>
          <div className="data-row"><span>Enquête negatief, gedrag wel</span><strong className="num">{a.surveyTooNegative}</strong></div>
          {a.mixed > 0 && <div className="data-row"><span>Tegenstrijdige oordelen (niet meegeteld)</span><strong className="num">{a.mixed}</strong></div>}
          <div className="note">Zegt een enquête vaak ja waar gedrag nee zegt, dan overschat zelfrapportage bij jullie doelgroepen het gedrag: weeg enquêtes dan lichter.</div>
        </>
      )}
    </div>
  );
}

// Per coach rule: how often it posted, followed or dismissed, how fast, helpful votes, and (descriptive) the
// Brier score of the decision forecast in resolved dossiers.
export function CoachEffect({ view }: { view: LearningView }) {
  const rows = view.coach;
  return (
    <div className="card">
      <div className="section-title">
        <h3>Werken de coachtips?</h3>
        <span className="pill gray">Beschrijvend</span>
      </div>
      {rows.length === 0 ? (
        <p className="sub">De coach heeft in deze werkruimte nog geen notities geplaatst.</p>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table className="table">
            <caption className="sr-only">Per coachregel: geplaatst, gedaan, niet relevant, mediaan dagen, nuttig-stemmen en Brier-score bij het besluit</caption>
            <thead>
              <tr>
                <th scope="col">Tip</th>
                <th scope="col">Geplaatst</th>
                <th scope="col">Gedaan</th>
                <th scope="col">Niet relevant</th>
                <th scope="col">Mediaan dagen</th>
                <th scope="col">Nuttig ja/nee</th>
                <th scope="col">Brier gevolgd</th>
                <th scope="col">Brier genegeerd</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.rule}>
                  <td>{ruleLabel(r.rule)}</td>
                  <td className="num">{r.posted}</td>
                  <td className="num">{r.done}</td>
                  <td className="num">{r.dismissed}</td>
                  <td className="num">{r.medianDays == null ? "—" : day(r.medianDays)}</td>
                  <td className="num">{r.helpfulYes}/{r.helpfulNo}</td>
                  <td className="num">{r.followed ? `${dec(r.followed.brier)} (${r.followed.dossiers})` : "—"}</td>
                  <td className="num">{r.ignored ? `${dec(r.ignored.brier)} (${r.ignored.dossiers})` : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="note">
        Gedaan telt ook notities die de coach zelf sloot omdat het punt was opgelost. De Brier-score (lager is beter) is die van de voorspellingen van mensen bij
        het besluit, alleen in afgeronde dossiers; tussen haakjes het aantal dossiers. Dit is samenhang, geen effect: teams die tips opvolgen kunnen ook om
        andere redenen beter voorspellen. Lees het pas bij tientallen dossiers per regel.
        {brierWarning(view.resolvedDossiers) ? ` Let op: ${BRIER_FEW_OUTCOMES} (${view.resolvedDossiers} van de minimaal ${BRIER_MIN_OUTCOMES} uitkomsten).` : ""}
      </div>
    </div>
  );
}
