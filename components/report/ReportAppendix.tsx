"use client";

import { useId, useState } from "react";
import { useViewMode } from "@/components/shell/ViewMode";

// Fase 1 · punt 1: het rapport in Snel. Op het scherm staan de Stand van het bewijs en het beslisblad; het volledige
// dossier (de bijlage) staat ingeklapt achter "Volledig dossier tonen". Het staat wel in de pagina, zodat printen via
// de browser altijd het hele dossier geeft; de server-PDF is sowieso altijd volledig. In Grondig verandert er niets.
export function ReportAppendix({ children }: { children: React.ReactNode }) {
  const { level } = useViewMode();
  const [open, setOpen] = useState(false);
  const id = useId();
  if (level !== "quick") return <>{children}</>;
  return (
    <>
      <div className="report-appendix-toggle no-print">
        <button type="button" className="btn white" aria-expanded={open} aria-controls={id} onClick={() => setOpen((o) => !o)}>
          {open ? "Volledig dossier verbergen" : "Volledig dossier tonen"}
        </button>
        {!open && <p className="tiny mt-8">De PDF bevat altijd het volledige dossier.</p>}
      </div>
      <div id={id} className={`report-appendix${open ? "" : " collapsed"}`}>
        {children}
      </div>
    </>
  );
}
