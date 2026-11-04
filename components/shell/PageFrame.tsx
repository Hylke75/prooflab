import { Coach } from "./Coach";
import { Topbar } from "./Topbar";
import { SprintStrip } from "@/components/sprint/SprintCard";
import { Stepper } from "@/components/ui/Stepper";
import { coachFor, type CoachPage } from "@/lib/domain/coach";
import { todayInNL } from "@/lib/domain/sprint";
import { getIdea, getWorkspace } from "@/lib/data";
import { loadProgress } from "@/lib/progress";
import { aiConfigured } from "@/lib/env";
import { DossierSearch } from "@/components/search/DossierSearch";
import { supabaseServer } from "@/lib/supabase/server";
import { loadOpenNotes } from "@/lib/coach/review";
import { CoachWatch } from "@/components/coach/CoachWatch";
import { SyncIdeaSteps } from "./ShellProvider";
import { STEPS, stepForPath, stepStates } from "@/lib/steps";
import Link from "next/link";
import { StepNotes } from "@/components/steps/StepNotes";
import { AskAiButton } from "@/components/shell/AskAiButton";
import { noteStepForSection } from "@/lib/domain/step-files";
import { ViewModeProvider } from "@/components/shell/ViewMode";
import { asDetailLevel } from "@/lib/view-mode";

// Main column + coach column of the three-column grid from the reference design.
export async function PageFrame({
  crumbs,
  coach,
  ideaId,
  section,
  badge,
  coachCollapsed = false,
  children,
}: {
  crumbs: string[];
  coach: CoachPage;
  ideaId?: string;
  // Het deel van het adres na /app/ideas/[id] ("/research", "/outcome", "" voor het overzicht). Bepaalt de stap
  // en het tabblad in de kop van een ideepagina.
  section?: string;
  badge?: string;
  // Klapt het coachpaneel rechts in (opent via de coachknop), voor pagina's met een eigen coachblok.
  coachCollapsed?: boolean;
  children: React.ReactNode;
}) {
  const ws = await getWorkspace();
  const supabase = await supabaseServer();
  const [progress, access, profile] = await Promise.all([
    ideaId ? loadProgress(ideaId) : Promise.resolve(null),
    ideaId ? getIdea(ideaId) : Promise.resolve(null),
    supabase.from("profiles").select("full_name").eq("user_id", ws.user.id).maybeSingle(),
  ]);
  const name = profile.data?.full_name?.trim() || null;
  const initials = (name ? name.split(/\s+/).map((w) => w[0]).join("").slice(0, 2) : ws.user.email.slice(0, 2)).toUpperCase();
  const audience = access ? (access.canWrite ? "consultant" : "client") : ws.org ? "consultant" : "client";
  // The trajectory coach's open notes for this dossier; consultants also trigger a (throttled) review.
  const notes = ideaId && access ? await loadOpenNotes(ideaId, audience) : undefined;
  // Op werkruimtepagina's verwijst de coach naar het lopende idee (het laatst bijgewerkte van de werkruimte).
  const currentIdea =
    !ideaId && ws.org ? ((await supabase.from("ideas").select("id, title").eq("org_id", ws.org.id).order("updated_at", { ascending: false }).limit(1).maybeSingle()).data ?? null) : null;
  // Tabbladen onder een stap (Markt: Marktverkenning | Bronnen & koppelingen; Besluit: Bewijs & besluit |
  // Voorspelling & uitkomst). Het zijn gewone links tussen de bestaande adressen.
  const stepKey = ideaId && section !== undefined ? stepForPath(section) : null;
  const step = stepKey ? STEPS.find((x) => x.key === stepKey) : undefined;
  const tabs = (step?.tabs ?? []).filter((t) => !t.consultantOnly || access?.canWrite);
  // Eigen notities en documenten onderaan het overzicht en de hoofdpagina's van elke stap (zelfstandig blok).
  const noteStep = ideaId && access ? noteStepForSection(section) : null;
  // Fase 1 · punt 1: de stand van het dossier (Snel of Grondig); buiten een dossier geldt Grondig (alles zichtbaar).
  // Eén provider per pagina (key), zodat "één keer per pagina" bij elke pagina opnieuw begint.
  const level = access ? asDetailLevel((access.idea as { detail_level?: unknown }).detail_level) : "thorough";
  return (
    <ViewModeProvider key={`${ideaId ?? "werkruimte"}${section ?? ""}`} level={level} canWrite={!!access?.canWrite}>
      <main className="main" id="main" tabIndex={-1}>
        <Topbar crumbs={crumbs} initials={initials} email={ws.user.email} name={name} badge={badge} isConsultant={!!ws.org} isOwner={ws.org?.role === "owner"} />
        <div className="workspace">
          {/* Eén kop voor alle pagina's van een idee (ook /outcome): sprintbalk, stappenbalk en eventuele tabbladen. */}
          {access && progress && section !== undefined && (
            <>
              <SprintStrip idea={access.idea} progress={progress} canWrite={access.canWrite} today={todayInNL()} />
              <Stepper current={stepKey} ideaId={ideaId} states={stepStates(progress)} />
              {/* Zoeken binnen dit dossier: knop of sneltoets "/" (alleen wat de gebruiker mag zien, via RLS). */}
              <div className="dossier-search-bar no-print">
                <DossierSearch ideaId={access.idea.id} />
                {access.canWrite && aiConfigured() && <AskAiButton />}
              </div>
            </>
          )}
          {ideaId && step && tabs.length > 1 && (
            <nav className="step-tabs no-print" aria-label={`Tabbladen van ${step.label}`}>
              {tabs.map((t) => {
                const active = section === t.path || !!section?.startsWith(`${t.path}/`);
                return (
                  <Link key={t.path} href={`/app/ideas/${ideaId}${t.path}`} prefetch={false} className={active ? "active" : undefined} aria-current={active ? "page" : undefined}>
                    {t.label}
                  </Link>
                );
              })}
            </nav>
          )}
          <section className="screen active">
            {children}
            {ideaId && noteStep && <StepNotes ideaId={ideaId} step={noteStep} />}
          </section>
        </div>
      </main>
      <Coach data={coachFor(coach, progress, { audience, isClientDecider: access?.isClientDecider, currentIdea })} aiConnected={aiConfigured()} notes={notes} collapsed={coachCollapsed} step={noteStep} />
      {ideaId && access?.canWrite && <CoachWatch ideaId={ideaId} />}
      {ideaId && progress && <SyncIdeaSteps ideaId={ideaId} states={stepStates(progress)} />}
    </ViewModeProvider>
  );
}
