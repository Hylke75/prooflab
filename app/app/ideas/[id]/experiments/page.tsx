import type { Metadata } from "next";
import Link from "next/link";
import { PageFrame } from "@/components/shell/PageFrame";
import { Stepper } from "@/components/ui/Stepper";
import { ExperimentBuilder } from "@/components/experiments/ExperimentBuilder";
import { getIdea } from "@/lib/data";
import { supabaseServer } from "@/lib/supabase/server";
import { loadInformationValue, loadProgress } from "@/lib/progress";
import { stepsDone } from "@/lib/steps";
import { recommend } from "@/lib/domain/recommend";
import { EXPERIMENT_STATES, EXPERIMENT_TYPES, type AssumptionCategory, type ExperimentState, type ExperimentType } from "@/lib/domain/labels";
import { createExperiment } from "./actions";

export const metadata: Metadata = { title: "Experimenten" };

const COLUMNS: { label: string; states: ExperimentState[] }[] = [
  { label: "Voorbereiden", states: ["draft", "ready_for_review", "approved"] },
  { label: "Loopt", states: ["live", "paused"] },
  { label: "Leren", states: ["ended", "analyzed"] },
  { label: "Besloten", states: ["decided"] },
];

export default async function ExperimentsPage({ params, searchParams }: PageProps<"/app/ideas/[id]/experiments">) {
  const { id } = await params;
  const sp = await searchParams;
  const { idea, canWrite } = await getIdea(id);
  const supabase = await supabaseServer();
  // Ordered by information value (research 3.9): the default suggestion is the test that can change the decision most per euro and week.
  const [assumptions, progress, { data: experiments }, { count: interviewObs }] = await Promise.all([
    loadInformationValue(id),
    loadProgress(id),
    supabase.from("experiments").select("id, title, type, state, ends_at, hypotheses(assumptions(statement))").eq("idea_id", id).order("created_at", { ascending: false }),
    supabase.from("observations").select("id", { count: "exact", head: true }).eq("idea_id", id).not("interview_id", "is", null),
  ]);
  const wanted = typeof sp.assumption === "string" ? sp.assumption : null;
  const selected = assumptions.find((a) => a.id === wanted) ?? assumptions[0];
  const rec = selected
    ? recommend({ category: selected.category as AssumptionCategory, evidence: selected.evidence, hasDiscoveryEvidence: (interviewObs ?? 0) > 0 })
    : null;

  return (
    <PageFrame crumbs={["Werkruimte", idea.title, "Experimenten"]} coach="experiments" ideaId={id}>
      <div className="section-row">
        <div>
          <div className="eyebrow">STAP 4 VAN 5 · TESTEN</div>
          <h1>Niet raden. Testen.</h1>
          <p className="sub">Kies een kleine proef waarmee je snel echt gedrag kunt observeren.</p>
        </div>
      </div>
      <Stepper current="test" ideaId={id} done={stepsDone(progress)} />

      {(experiments ?? []).length > 0 && (
        <div className="kpi-row" style={{ marginBottom: 20 }}>
          {COLUMNS.map((col) => (
            <div key={col.label} className="card tight">
              <div className="tiny" style={{ fontWeight: 800, textTransform: "uppercase", letterSpacing: ".08em" }}>{col.label}</div>
              {(experiments ?? []).filter((e) => col.states.includes(e.state as ExperimentState)).map((e) => (
                <Link key={e.id} href={`/app/ideas/${id}/experiments/${e.id}`} className="assumption-item" style={{ textDecoration: "none", marginTop: 10 }}>
                  <span className="count">{EXPERIMENT_TYPES[e.type as ExperimentType].icon}</span>
                  <span>{e.title}</span>
                  <small>{EXPERIMENT_STATES[e.state as ExperimentState].label}</small>
                </Link>
              ))}
            </div>
          ))}
        </div>
      )}

      {assumptions.length > 0 && (
        <div className="card" style={{ marginBottom: 20 }}>
          <div className="section-title">
            <h2 className="as-h3">Wat test je eerst?</h2>
            <span className="pill gray">Op informatiewaarde</span>
          </div>
          <p className="tiny" style={{ marginTop: -8 }}>
            Belang × onzekerheid × hoeveel de goedkoopste geschikte test het besluit kan veranderen, gedeeld door kosten en duur. Score 100 = de hoogste in dit dossier; de kansen zijn schattingen.
          </p>
          {assumptions.slice(0, 3).map((a, i) => (
            <Link
              key={a.id}
              href={`/app/ideas/${id}/experiments?assumption=${a.id}`}
              className={`assumption-item${a.id === selected?.id ? " active" : ""}`}
              style={{ textDecoration: "none", marginTop: 10 }}
              aria-current={a.id === selected?.id ? "true" : undefined}
            >
              <span className="count">{i + 1}</span>
              <span>
                {a.statement}
                <small style={{ display: "block", fontWeight: 500, marginTop: 3 }}>{a.voi.why}</small>
              </span>
              <small>IW {a.voi.index}</small>
            </Link>
          ))}
        </div>
      )}

      {!selected ? (
        <div className="empty-state">
          <h2 className="as-h3">Eerst aannames</h2>
          <p>Een experiment toetst één aanname. Maak je aannames zichtbaar en kies de belangrijkste met het minste bewijs.</p>
          <Link className="btn primary" href={`/app/ideas/${id}/assumptions`}>Naar aannames →</Link>
        </div>
      ) : canWrite && rec ? (
        <ExperimentBuilder
          assumptions={assumptions.map((a) => ({ id: a.id, statement: a.statement }))}
          initialAssumption={selected.id}
          options={rec.options}
          warning={rec.warning}
          audience={[idea.target_audience, idea.audience_detail, idea.region].filter(Boolean).join(", ")}
          action={createExperiment.bind(null, id)}
        />
      ) : (
        <p className="sub">Je kijkt mee als opdrachtgever. Experimenten worden opgezet door het onderzoeksteam.</p>
      )}
    </PageFrame>
  );
}
