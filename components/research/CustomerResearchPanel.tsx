import Link from "next/link";
import { NewStudyForm } from "@/components/research/NewStudyForm";
import type { FormState } from "@/components/ui/ActionForm";
import type { StudyRow } from "@/lib/customer-research-data";
import { EXPLORATORY_NOTE, STUDY_FORMATS, STUDY_SCHEMA_MISSING } from "@/lib/domain/customer-research";
import { EXPERIMENT_STATES } from "@/lib/domain/labels";
import { TEST_ROLES } from "@/lib/domain/primary-test";

type Question = { id: string; position: number; question: string };

// Het tabblad Klantonderzoek op Markt: enquêtes en online interviews bij de onderzoeksvragen, plus de weg naar
// een live interview (de bestaande interviewflow in stap 3). Alles hier is verkennend: het geeft richting, maar
// beslist niet over een aanname of het besluit.
export function CustomerResearchPanel({
  ideaId,
  canWrite,
  schemaReady,
  rows,
  questions,
  audience,
  aiConnected,
  createAction,
}: {
  ideaId: string;
  canWrite: boolean;
  schemaReady: boolean;
  rows: StudyRow[];
  questions: Question[];
  audience: string;
  aiConnected: boolean;
  createAction: (state: FormState, form: FormData) => Promise<FormState>;
}) {
  const surveys = rows.filter((r) => r.kind === "survey");
  const online = rows.filter((r) => r.kind === "interview");
  const live = rows.filter((r) => r.kind === "live");
  const runningLive = live.find((r) => r.state === "live" || r.state === "paused");
  const canCreate = canWrite && schemaReady && questions.length > 0;
  const questionLabel = (qid: string | null) => {
    const q = questions.find((x) => x.id === qid);
    return q ? `Vraag ${q.position}: ${q.question}` : null;
  };

  return (
    <div>
      <div className="section-title">
        <div>
          <h2>Vraag het je doelgroep zelf.</h2>
          <p className="sub">Enquêtes en online interviews bij je onderzoeksvragen. Verkennend: ze geven richting, maar beslissen niets.</p>
        </div>
      </div>
      <div className="note" style={{ marginTop: 0 }}>{EXPLORATORY_NOTE} Wil je een aanname echt toetsen, maak dan een test in stap 3 met vooraf vastgelegde drempels.</div>
      {canWrite && !schemaReady && <div className="form-error" role="status">{STUDY_SCHEMA_MISSING}</div>}
      {canWrite && schemaReady && questions.length === 0 && (
        <div className="empty-state">
          <h3>Eerst een onderzoeksvraag</h3>
          <p>Elk klantonderzoek hangt aan een onderzoeksvraag. Voeg er een toe op de onderzoekskaart onder Marktbeeld.</p>
          <Link className="text-link" href={`/app/ideas/${ideaId}/research?tab=overview`}>Naar de onderzoekskaart →</Link>
        </div>
      )}

      <div className="grid-2 mt-18">
        <section className="card" aria-labelledby="kr-surveys">
          <div className="section-title">
            <h3 id="kr-surveys">Enquêtes</h3>
            <span className="pill gray">{surveys.length}</span>
          </div>
          <StudyList ideaId={ideaId} rows={surveys} questionLabel={questionLabel} empty="Nog geen enquêtes. Een enquête laat zien hoe vaak iets voorkomt en hoe mensen het nu aanpakken." unit={["antwoord", "antwoorden"]} />
          {canCreate && (
            <NewStudyForm format="survey" action={createAction} questions={questions} audience={audience} aiConnected={aiConnected} openLabel="Nieuwe enquête" />
          )}
        </section>

        <section className="card" aria-labelledby="kr-interviews">
          <div className="section-title">
            <h3 id="kr-interviews">Online interviews</h3>
            <span className="pill gray">{online.length + live.length}</span>
          </div>
          <p className="tiny" style={{ marginTop: -6 }}>
            <strong>{STUDY_FORMATS.interview.label}:</strong> {STUDY_FORMATS.interview.explain}
          </p>
          <StudyList ideaId={ideaId} rows={online} questionLabel={questionLabel} empty="Nog geen online interviews." unit={["interview", "interviews"]} />
          {canCreate && (
            <NewStudyForm format="interview" action={createAction} questions={questions} audience={audience} aiConnected={aiConnected} openLabel="Nieuw online interview" />
          )}
          <div className="divider" />
          <h4 style={{ fontSize: 15, margin: "0 0 6px" }}>Live interview vastleggen</h4>
          <p className="tiny">
            Een gesprek (videobel, telefoon of op locatie) leg je vast in een interviewronde in stap 3: transcript of notities, toestemming, en per gesprek
            of het echt was of een oefening. Oefengesprekken tellen niet.
          </p>
          {live.length > 0 && <StudyList ideaId={ideaId} rows={live} questionLabel={questionLabel} empty="" unit={["gesprek", "gesprekken"]} />}
          {canWrite && (
            <Link className="btn soft sm mt-8" href={runningLive ? `/app/ideas/${ideaId}/experiments/${runningLive.id}` : `/app/ideas/${ideaId}/experiments?type=interview`}>
              {runningLive ? "Live interview vastleggen →" : "Live interview vastleggen: plan een interviewronde →"}
            </Link>
          )}
        </section>
      </div>
      <p className="tiny mt-12">Antwoorden zijn zelfrapportage, geen waargenomen gedrag. Open antwoorden kun je opnemen als klantsignalen onder Doelgroepen.</p>
    </div>
  );
}

function StudyList({
  ideaId,
  rows,
  questionLabel,
  empty,
  unit,
}: {
  ideaId: string;
  rows: StudyRow[];
  questionLabel: (id: string | null) => string | null;
  empty: string;
  unit: [string, string];
}) {
  if (rows.length === 0) return empty ? <p className="sub">{empty}</p> : null;
  return (
    <ul className="study-list">
      {rows.map((r) => {
        const q = questionLabel(r.researchQuestionId);
        const n = r.responses;
        return (
          <li key={r.id}>
            <Link href={`/app/ideas/${ideaId}/experiments/${r.id}`} className="study-link">
              <strong>{r.title}</strong>
              <span className="study-meta">
                <span className={`pill ${EXPERIMENT_STATES[r.state]?.pill ?? "gray"}`}>{EXPERIMENT_STATES[r.state]?.label ?? r.state}</span>
                <span className={`pill ${r.exploratory ? "gray" : r.role === "primary" ? "blue" : "gray"}`}>
                  {r.exploratory ? "Verkennend" : `${TEST_ROLES[r.role].label} · stap 3`}
                </span>
                <span>
                  {n == null
                    ? "aantal onbekend"
                    : r.kind === "live"
                      ? `${n} ${n === 1 ? unit[0] : unit[1]} · ${r.usable ?? 0} tellen mee`
                      : `${n} ${n === 1 ? unit[0] : unit[1]} · ${r.usable ?? 0} bruikbaar`}
                </span>
              </span>
              {q ? <span className="tiny">{q}</span> : r.assumption ? <span className="tiny">Toetst: {r.assumption}</span> : null}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
