import type { Metadata } from "next";
import Link from "next/link";
import { PageFrame } from "@/components/shell/PageFrame";
import { CatalogBrowser } from "@/components/experiments/CatalogBrowser";
import { getIdea } from "@/lib/data";
import { supabaseServer } from "@/lib/supabase/server";
import { CATALOG, filterFromParams, KIND_LENS } from "@/lib/domain/experiment-catalog";
import { assumptionKind } from "@/lib/domain/assumption-kind";
import { manualSchemaAvailable } from "@/lib/manual-results-data";
import { MANUAL_SCHEMA_MISSING } from "@/lib/domain/manual-results";

export const metadata: Metadata = { title: "Experimentencatalogus" };

// Experimentencatalogus onder stap 3 Testen: alle methodes met zoeken, filters en een detailpaneel. "Gebruik voor deze
// aanname" opent de Test Card met het sjabloon van de methode (ingebouwd testtype of handmatig sjabloon).
export default async function CatalogPage({ params, searchParams }: PageProps<"/app/ideas/[id]/experiments/catalogus">) {
  const { id } = await params;
  const sp = await searchParams;
  const { idea, canWrite } = await getIdea(id);
  const supabase = await supabaseServer();
  const [{ data: rows, error }, manualAvailable] = await Promise.all([
    supabase.from("assumptions").select("id, statement, category, kind, importance").eq("idea_id", id).order("importance", { ascending: false }).order("created_at"),
    canWrite ? manualSchemaAvailable() : Promise.resolve(true),
  ]);
  const assumptions = (rows ?? []).map((a) => ({ id: a.id, statement: a.statement, kind: assumptionKind(a) }));
  const wanted = typeof sp.aanname === "string" ? sp.aanname : null;
  const initialAssumption = assumptions.find((a) => a.id === wanted)?.id ?? assumptions[0]?.id ?? null;
  const filter = filterFromParams(sp);
  // Vanuit een aanname zonder eigen filter: begin bij de lens die bij de soort aanname past.
  const fromAssumption = wanted ? assumptions.find((a) => a.id === wanted) : undefined;
  const initialFilter = fromAssumption && !filter.lens && !filter.query && typeof sp.open !== "string" ? { ...filter, lens: KIND_LENS[fromAssumption.kind] } : filter;

  return (
    <PageFrame crumbs={["Werkruimte", idea.title, "Testen", "Catalogus"]} coach="experiments" ideaId={id} section="/experiments">
      <div className="section-row">
        <div>
          <div className="eyebrow">Stap 3 van 4 · Testen</div>
          <h1>Experimentencatalogus</h1>
          <p className="sub">
            {CATALOG.length} methodes om een aanname te toetsen, van gesprek tot aanbetaling. Per methode: wat ze wel en niet bewijst, wat ze kost en hoe je
            haar in ProofLab uitvoert.
          </p>
          <Link className="text-link mt-12" href={`/app/ideas/${id}/experiments${initialAssumption ? `?assumption=${initialAssumption}` : ""}`}>
            ← Terug naar Testen
          </Link>
        </div>
      </div>
      {error && <div className="form-error" role="alert">De aannames konden niet worden geladen. Je kunt de catalogus bekijken; vernieuw de pagina om een methode te gebruiken.</div>}
      {canWrite && !manualAvailable && <div className="note" role="status">{MANUAL_SCHEMA_MISSING}</div>}
      <CatalogBrowser
        ideaId={id}
        methods={CATALOG}
        assumptions={assumptions}
        initialAssumption={initialAssumption}
        initialFilter={initialFilter}
        initialOpen={typeof sp.open === "string" ? sp.open : null}
        canWrite={canWrite}
        manualAvailable={manualAvailable}
      />
    </PageFrame>
  );
}
