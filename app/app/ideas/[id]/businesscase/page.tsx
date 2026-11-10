import type { Metadata } from "next";
import { PageFrame } from "@/components/shell/PageFrame";
import { TaskHeader } from "@/components/tasks/TaskHeader";
import { BusinessCaseApp } from "@/components/business-case/BusinessCaseApp";
import { getIdea } from "@/lib/data";
import { supabaseServer } from "@/lib/supabase/server";
import { loadProgress } from "@/lib/progress";
import { ideaTasks } from "@/lib/domain/tasks";
import { aiConfigured } from "@/lib/env";
import { parseStoredInputs } from "@/lib/business-case-schema";
import { initialInputs, STEPS, type MarketContext, type StepKey } from "@/lib/domain/business-case";
import { computeSizing, type SizingModel } from "@/lib/domain/sizing";
import { annualPriceFromOffer } from "@/lib/intake-proposal";
import { priceFromIntake } from "@/lib/research-questions";
import { saveBusinessCase } from "./actions";

export const metadata: Metadata = { title: "Businesscase" };

const MISSING_TABLE = new Set(["42P01", "PGRST205"]);

export default async function BusinessCasePage({ params, searchParams }: PageProps<"/app/ideas/[id]/businesscase">) {
  const { id } = await params;
  const sp = await searchParams;
  const { idea, canWrite } = await getIdea(id);
  const supabase = await supabaseServer();
  const [bcRes, ueRes, scenRes, progress] = await Promise.all([
    supabase.from("business_cases").select("inputs, updated_at").eq("idea_id", id).maybeSingle(),
    supabase.from("unit_economics").select("*").eq("idea_id", id).maybeSingle(),
    supabase.from("sizing_scenarios").select("kind, model, sizing_factors(key, value)").eq("idea_id", id).eq("kind", "realistic"),
    loadProgress(id),
  ]);
  const available = !(bcRes.error && MISSING_TABLE.has(bcRes.error.code ?? ""));
  const stored = bcRes.data ? parseStoredInputs(bcRes.data.inputs) : null;
  const unreadable = !!bcRes.data && !stored;
  const inputs = stored ?? initialInputs({ description: idea.description, question: idea.decision_question, ue: ueRes.data });

  // De haalbare markt uit Marktpotentieel (realistisch) als controle, alleen als die volledig te berekenen is.
  const scen = scenRes.data?.[0];
  let somCount: number | null = null;
  let somRevenue: number | null = null;
  if (scen) {
    const r = computeSizing(scen.model as SizingModel, (scen.sizing_factors ?? []).map((f) => ({ key: f.key, value: Number(f.value) })));
    if (r.countsKnown.som) somCount = r.somCount;
    if (r.countsKnown.som && r.missing.length === 0) somRevenue = r.somRevenue;
  }
  const offer = priceFromIntake(idea);
  const annual = annualPriceFromOffer(offer);
  const market: MarketContext = { somCount, somRevenue, intakePricePerYear: annual?.value ?? null };
  const intakePrice = annual && offer ? { perMonth: annual.value / 12, text: offer } : null;
  const stepParam = typeof sp.stap === "string" && STEPS.some((s) => s.key === sp.stap) ? (sp.stap as StepKey) : null;
  const list = ideaTasks(progress);

  return (
    <PageFrame crumbs={["Werkruimte", idea.title, "Businesscase"]} coach="businesscase" ideaId={id} section="/businesscase">
      <TaskHeader
        ideaId={id}
        list={list}
        taskKey="assumptions-businesscase"
        title="Reken je idee door"
        why="Is het rendabel, hoeveel startgeld heb je nodig en wanneer speel je quitte? Beantwoord een paar vragen in gewone taal; je ziet meteen een eerste uitkomst."
        aiConnected={aiConfigured()}
      />
      {!available && (
        <div className="note" role="status">
          De businesscase kan nog niet worden bewaard: de databasemigratie (20261120090000_business_case.sql) is nog niet toegepast. Je kunt wel rekenen; je
          antwoorden blijven staan tot je de pagina verlaat.
        </div>
      )}
      {unreadable && (
        <div className="note" role="status">
          De opgeslagen businesscase heeft een vorm die deze versie niet kan lezen. Je begint met de gegevens uit de intake; de oude invoer blijft bewaard tot je
          iets wijzigt.
        </div>
      )}
      <BusinessCaseApp
        ideaId={id}
        initial={inputs}
        hasSaved={!!stored}
        canWrite={canWrite}
        save={canWrite && available ? saveBusinessCase.bind(null, id) : null}
        market={market}
        intakePrice={intakePrice}
        initialStep={stepParam}
      />
    </PageFrame>
  );
}
