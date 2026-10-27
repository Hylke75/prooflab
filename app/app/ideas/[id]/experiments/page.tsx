import type { Metadata } from "next";
import Link from "next/link";
import { PageFrame } from "@/components/shell/PageFrame";
import { Stepper } from "@/components/ui/Stepper";
import { ExperimentBuilder } from "@/components/experiments/ExperimentBuilder";
import { getIdea } from "@/lib/data";
import { supabaseServer } from "@/lib/supabase/server";
import { loadAssumptions, loadProgress, rankAssumptions } from "@/lib/progress";
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
  const [assumptions, progress, { data: experiments }, { count: interviewObs }] = await Promise.all([
    loadAssumptions(id).then(rankAssumptions),
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

      {!selected ? (
        <div className="empty-state">
          <h3>Eerst aannames</h3>
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
