import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { PageFrame } from "@/components/shell/PageFrame";
import { Stepper } from "@/components/ui/Stepper";
import { getWorkspace } from "@/lib/data";
import { supabaseServer } from "@/lib/supabase/server";
import { IntakeWizard } from "./IntakeWizard";
import { todayInNL } from "@/lib/domain/sprint";

export const metadata: Metadata = { title: "Nieuw idee" };

export default async function NewIdeaPage() {
  const ws = await getWorkspace();
  if (!ws.org) redirect("/app");
  const supabase = await supabaseServer();
  const { data: clients } = await supabase.from("clients").select("id, name").order("name");
  return (
    <PageFrame crumbs={["Werkruimte", "Nieuw idee"]} coach="intake">
      <div className="section-row">
        <div>
          <div className="eyebrow">STAP 1 VAN 5 · BESLISSING EN IDEE</div>
          <h1>
            Elk sterk idee begint
            <br />
            met een goede vraag.
          </h1>
          <p className="sub">Je hoeft nog geen businessplan te hebben. We onderzoeken het samen.</p>
        </div>
      </div>
      <Stepper current="idea" />
      <div className="intake-layout">
        <IntakeWizard clients={clients ?? []} today={todayInNL()} />
        <aside className="card tip-card">
          <div className="tip-label">PROOFLAB DENKT MEE</div>
          <h3>Je hoeft het nog niet zeker te weten.</h3>
          <p>
            Dat is juist het hele idee. We maken je aannames zichtbaar, onderzoeken de markt en zoeken de goedkoopste manier
            om het echte antwoord te vinden.
          </p>
          <div style={{ position: "absolute", bottom: 26, left: 24, zIndex: 1, background: "#38445d", borderRadius: 12, padding: "11px 14px", fontSize: 12 }}>
            ✳ Eerst begrijpen. Dan bouwen.
          </div>
        </aside>
      </div>
    </PageFrame>
  );
}
