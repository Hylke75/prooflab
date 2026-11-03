import type { Metadata } from "next";
import Link from "next/link";
import { PageFrame } from "@/components/shell/PageFrame";
import { ForecastPanel } from "@/components/forecast/ForecastPanel";
import { OutcomeDefinition } from "@/components/forecast/OutcomeDefinition";
import { OutcomeFollowUp } from "@/components/forecast/OutcomeFollowUp";
import { BaseRateSummary } from "@/components/forecast/BaseRate";
import { BaseRatePicker } from "@/components/forecast/BaseRatePicker";
import { CalibrationGuide } from "@/components/forecast/CalibrationGuide";
import { getIdea } from "@/lib/data";
import { loadProgress } from "@/lib/progress";
import { loadForecastView } from "@/lib/forecast-data";
import { saveBaseRate } from "./actions";

export const metadata: Metadata = { title: "Voorspelling & uitkomst" };

export default async function OutcomePage({ params }: PageProps<"/app/ideas/[id]/outcome">) {
  const { id } = await params;
  const access = await getIdea(id);
  const progress = await loadProgress(id);
  const view = await loadForecastView(access, progress);
  const { idea, canWrite } = access;

  return (
    <PageFrame crumbs={["Werkruimte", idea.title, "Voorspelling & uitkomst"]} coach="outcome" ideaId={id}>
      <div className="section-row">
        <div>
          <div className="eyebrow">Voorspellen · Meten · Leren</div>
          <h1>Klopte onze verwachting?</h1>
          <p className="sub">
            Leg vooraf vast wanneer het idee geslaagd is, voorspel op vaste momenten de kans daarop, en kijk zes maanden na het besluit wat er echt gebeurde.
          </p>
        </div>
        <Link className="btn white" href={`/app/ideas/${id}/evidence`}>Bewijs & besluit →</Link>
      </div>

      {!view ? (
        <div className="empty-state">
          <h2 className="as-h3">Voorspellen is hier nog niet beschikbaar</h2>
          <p>De database van deze omgeving heeft de voorspelkern nog niet. Werk het databaseschema bij om uitkomsten en voorspellingen vast te leggen.</p>
        </div>
      ) : (
        <>
          <div className="grid-2">
            <div className="stack">
              <OutcomeDefinition view={view} />
              <div className="card" id="basispercentage" style={{ scrollMarginTop: 100 }}>
                <div className="section-title">
                  <h3>Basispercentage</h3>
                  <span className={`pill ${view.baseRate ? "green" : "orange"}`}>{view.baseRate ? "Gekozen" : "Nog niet gekozen"}</span>
                </div>
                <p className="sub">
                  Hoe vaak slagen vergelijkbare ideeën? Dat buitenperspectief is het vertrekpunt van elke voorspelling. Een basispercentage staat nooit zonder bron.
                </p>
                {/* The picker folds shut after saving; this live region confirms the choice instead. */}
                <div role="status" aria-live="polite">{view.baseRate && <BaseRateSummary baseRate={view.baseRate} />}</div>
                {canWrite && !view.definitionLocked && !view.resolved && (
                  <details open={!view.baseRate} className="mt-12">
                    <summary className="text-link">{view.baseRate ? "Andere referentie kiezen" : "Kies een referentieklasse"}</summary>
                    <BaseRatePicker classes={view.referenceClasses} own={view.ownBaseRate} current={idea.reference_class?.startsWith("own:") ? "own" : idea.reference_class} action={saveBaseRate.bind(null, id)} />
                  </details>
                )}
                {!view.baseRate && !canWrite && <p className="tiny mt-8">Het onderzoeksteam kiest het basispercentage.</p>}
                {view.definitionLocked && view.baseRate && <p className="tiny mt-8">Ligt vast: er zijn al voorspellingen vanaf dit vertrekpunt gegeven.</p>}
              </div>
            </div>
            <div className="stack">
              <ForecastPanel view={view} />
              <CalibrationGuide view={view} />
            </div>
          </div>

          <div className="section-title mt-24"><h2>Uitkomst meten</h2></div>
          <div className="grid-2">
            <OutcomeFollowUp view={view} />
          </div>
        </>
      )}
    </PageFrame>
  );
}
