import type { Metadata } from "next";
import { asMethodVersion } from "@/lib/domain/method";
import Link from "next/link";
import { PageFrame } from "@/components/shell/PageFrame";
import { ExperimentBuilder } from "@/components/experiments/ExperimentBuilder";
import { getIdea, getViewMode, getWorkspace } from "@/lib/data";
import { MoreInThorough } from "@/components/shell/ViewMode";
import { supabaseServer } from "@/lib/supabase/server";
import { loadInformationValue } from "@/lib/progress";
import { priorsByType } from "@/lib/experiment-metrics";
import { recommend } from "@/lib/domain/recommend";
import { EXPERIMENT_STATES, EXPERIMENT_TYPES, type AssumptionCategory, type ExperimentState, type ExperimentType } from "@/lib/domain/labels";
import { createExperiment, draftSurveyWithCoach, proposeCopyVariants } from "./actions";
import { aiConfigured } from "@/lib/env";
import { TEST_ROLES, testRole } from "@/lib/domain/primary-test";
import { assumptionKind } from "@/lib/domain/assumption-kind";
import { countRealInterviewObservations } from "@/lib/practice-data";
import { loadDecisionRule } from "@/lib/decision-rule-data";
import { proposeGoRule } from "@/lib/domain/decision-rule-proposal";
import { describeRule } from "@/lib/domain/decision-rule";
import { GoRuleProposalCard } from "@/components/experiments/GoRuleProposal";
import { depositAvailability } from "@/lib/integrations/mollie-server";

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
  // Fase 1 · punt 1: in Snel één test per aanname op het bord (de hoofdtest, anders de nieuwste); de rest in Grondig.
  const quick = (await getViewMode(id)) === "quick";
  const ws = await getWorkspace();
  // Fase 2 · punt 4: kan de Test Card een betaalstap krijgen (Mollie ingesteld voor deze werkruimte)?
  const deposit = canWrite ? await depositAvailability(idea.org_id) : { available: false, reason: null, mode: null };
  const supabase = await supabaseServer();
  // Ordered by information value (research 3.9): the default suggestion is the test that can change the decision most per euro and week.
  // B0: alleen waarnemingen uit echte gesprekken tellen als ontdekkingsbewijs.
  const [assumptions, { data: experiments }, interviewObs] = await Promise.all([
    loadInformationValue(id),
    supabase.from("experiments").select("id, title, type, state, ends_at, hypotheses(assumption_id, assumptions(statement))").eq("idea_id", id).order("created_at", { ascending: false }),
    countRealInterviewObservations(id),
  ]);
  const wanted = typeof sp.assumption === "string" ? sp.assumption : null;
  // Na opslaan (B1a) komt de gebruiker hier terug met ?opgeslagen=<id>: bevestiging en het concept gemarkeerd op het bord.
  const savedId = typeof sp.opgeslagen === "string" ? sp.opgeslagen : null;
  const saved = savedId ? (experiments ?? []).find((e) => e.id === savedId) : undefined;
  // B1b: het benodigde aantal deelnemers volgt uit eerdere tests van hetzelfde type in de organisatie.
  const priors = canWrite ? await priorsByType(id, Object.keys(EXPERIMENT_TYPES)) : {};
  // ?type=survey (from the coach's survey suggestion) preselects that test type.
  const wantedType = typeof sp.type === "string" && sp.type in EXPERIMENT_TYPES ? (sp.type as ExperimentType) : undefined;
  const selected = assumptions.find((a) => a.id === wanted) ?? assumptions[0];
  // Hoofdtest per aanname (golf A, punt 11): de rest is verkennend.
  const primaries = assumptions.map((a) => ({ id: a.id, primary_experiment_id: a.primaryExperimentId }));
  const stateOf = (expId: string | null) => (experiments ?? []).find((e) => e.id === expId)?.state ?? null;
  const onBoard = (() => {
    const all = experiments ?? [];
    if (!quick) return all;
    const seen = new Set<string>();
    const primaryIds = new Set(primaries.map((p) => p.primary_experiment_id).filter(Boolean));
    // Eerst de hoofdtests, daarna de nieuwste per aanname; het zojuist opgeslagen concept blijft altijd zichtbaar.
    const ordered = [...all.filter((e) => primaryIds.has(e.id)), ...all.filter((e) => !primaryIds.has(e.id))];
    const keep = new Set<string>();
    for (const e of ordered) {
      const key = e.hypotheses?.assumption_id ?? e.id;
      if (seen.has(key) && e.id !== savedId) continue;
      seen.add(key);
      keep.add(e.id);
    }
    return all.filter((e) => keep.has(e.id));
  })();
  const hiddenTests = (experiments ?? []).length - onBoard.length;
  const rec = selected
    ? recommend({ category: selected.category as AssumptionCategory, evidence: selected.evidence, hasDiscoveryEvidence: interviewObs > 0 })
    : null;
  // B5: de go-regel van het dossier. Zonder regel (null) stelt ProofLab hem voor bij de eerste hoofdtest;
  // undefined = de database kent de tabel nog niet.
  const rule = await loadDecisionRule(id);
  const savedAssumption = saved ? assumptions.find((a) => a.id === saved.hypotheses?.assumption_id) : undefined;
  const goProposal =
    saved && savedAssumption && canWrite
      ? proposeGoRule({ rule, assumption: savedAssumption, experiment: saved, isPrimary: savedAssumption.primaryExperimentId === saved.id, assumptions })
      : null;
  // B5: wat de intake al weet, om de Test Card vooraf in te vullen (prijs, beschrijving). Een expliciet prijsveld
  // (price_eur/price_period) telt als het dossier dat heeft; anders zoekt ProofLab de prijs in de intaketeksten.
  const ideaRow = idea as unknown as Record<string, unknown>;
  const intake = {
    description: idea.description ?? "",
    texts: [idea.description, idea.outcome_statement, idea.decision_question, idea.decision_stakes, idea.key_uncertainty],
    price_eur: typeof ideaRow.price_eur === "number" ? ideaRow.price_eur : null,
    price_period: typeof ideaRow.price_period === "string" ? ideaRow.price_period : null,
  };

  return (
    <PageFrame crumbs={["Werkruimte", idea.title, "Testen"]} coach="experiments" ideaId={id} section="/experiments">
      <div className="section-row">
        <div>
          <div className="eyebrow">Stap 3 van 4 · Testen</div>
          <h1>Niet raden. Testen.</h1>
          <p className="sub">Kies een kleine proef waarmee je snel echt gedrag kunt observeren.</p>
        </div>
      </div>

      {saved && (
        <div className="form-ok" role="status" style={{ marginBottom: 16 }}>
          <strong>Test Card opgeslagen als concept.</strong> &quot;{saved.title}&quot; staat op het bord onder Voorbereiden.{" "}
          <Link className="text-link" href={`/app/ideas/${id}/experiments/${saved.id}`}>Open het concept →</Link>
        </div>
      )}
      {goProposal && <GoRuleProposalCard ideaId={id} proposal={goProposal} compact={quick} />}
      {saved && rule && rule.primaryExperimentId === saved.id && (
        <p className="form-ok" role="status" id="go-regel-vast">
          <strong>Go-regel vastgelegd.</strong> {describeRule(rule, saved.title)}
        </p>
      )}
      {(experiments ?? []).length > 0 && (
        <div className="kpi-row" id="bord" style={{ marginBottom: 20 }}>
          {COLUMNS.map((col) => (
            <div key={col.label} className="card tight">
              <div className="tiny" style={{ fontWeight: 600 }}>{col.label}</div>
              {onBoard.filter((e) => col.states.includes(e.state as ExperimentState)).map((e) => (
                <Link
                  key={e.id}
                  href={`/app/ideas/${id}/experiments/${e.id}`}
                  className={`assumption-item${e.id === savedId ? " active just-saved" : ""}`}
                  style={{ textDecoration: "none", marginTop: 10 }}
                  aria-current={e.id === savedId ? "true" : undefined}
                >
                  <span className="count">{EXPERIMENT_TYPES[e.type as ExperimentType].icon}</span>
                  <span>{e.title}</span>
                  <small>
                    {EXPERIMENT_STATES[e.state as ExperimentState].label} · {TEST_ROLES[testRole(e.id, e.hypotheses?.assumption_id, primaries)].label.toLowerCase()}
                  </small>
                </Link>
              ))}
            </div>
          ))}
        </div>
      )}
      {hiddenTests > 0 && (
        <p className="tiny" style={{ marginTop: -12, marginBottom: 20 }}>
          {hiddenTests === 1 ? "1 andere test staat" : `${hiddenTests} andere tests staan`} niet op het bord (één test per aanname in Snel).
          <MoreInThorough />
        </p>
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
              <small>score {a.voi.index}</small>
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
          assumptions={assumptions.map((a) => {
            const state = stateOf(a.primaryExperimentId);
            return { id: a.id, statement: a.statement, kind: assumptionKind(a), primary: a.primaryExperimentId ? { locked: !!state && !["draft", "ready_for_review"].includes(state) } : null };
          })}
          initialAssumption={selected.id}
          options={rec.options}
          warning={rec.warning}
          audience={[idea.target_audience, idea.audience_detail, idea.region].filter(Boolean).join(", ")}
          action={createExperiment.bind(null, id)}
          ideaTitle={idea.title}
          method={asMethodVersion(idea.method_version)}
          aiConnected={aiConfigured()}
          variantsAction={proposeCopyVariants.bind(null, id)}
          initialType={wantedType}
          researcher={ws.org?.name ?? ""}
          privacyContact={ws.user.email ?? ""}
          surveyDraftAction={draftSurveyWithCoach.bind(null, id)}
          priors={priors}
          intake={intake}
          goRuleMissing={rule === null}
          deposit={deposit}
          key={`${selected.id}|${wantedType ?? ""}`}
        />
      ) : (
        <p className="sub">Je kijkt mee als opdrachtgever. Experimenten worden opgezet door het onderzoeksteam.</p>
      )}
    </PageFrame>
  );
}
