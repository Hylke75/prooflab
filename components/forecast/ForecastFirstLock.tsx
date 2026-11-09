import Link from "next/link";
import { Icon } from "@/components/Icon";
import { MOMENT_LABELS, type ForecastMoment } from "@/lib/domain/forecast";

// Golf B, punt 15: eerst de eigen voorspelling, daarna de berekende kansen en andermans voorspellingen. Zo ankert
// niemand op wat ProofLab of een collega al denkt. De knop gaat naar het voorspelformulier van het open moment: bij het
// besluit staat dat op deze bewijspagina, bij de andere momenten op de pagina Voorspelling & uitkomst.
// formHere: het voorspelformulier staat op dezelfde pagina (Besluit). Dan geen tweede primaire knop ernaast, alleen een
// verwijzing; het formulier staat direct onder deze kaart (één kolom).
export function ForecastFirstLock({ ideaId, moment, what, client = false, formHere = false }: { ideaId: string; moment: ForecastMoment; what: string; client?: boolean; formHere?: boolean }) {
  const href = moment === "decision" ? `/app/ideas/${ideaId}/evidence?stap=besluit#voorspelling` : `/app/ideas/${ideaId}/outcome#voorspelling`;
  return (
    <div className="card" role="region" aria-labelledby="eerst-voorspellen">
      <div className="section-title">
        <h2 className="as-h3" id="eerst-voorspellen">Eerst je eigen voorspelling</h2>
        <span className="pill orange">Vergrendeld</span>
      </div>
      <p className="sub">
        {MOMENT_LABELS[moment].label}: {client ? "geeft u" : "geef je"} eerst {client ? "uw" : "je"} eigen kans dat het doel wordt gehaald. Daarna {client ? "ziet u" : "zie je"}{" "}
        {what} en de voorspellingen van anderen. Zo blijft elke voorspelling onafhankelijk: niemand ankert op een berekende kans of op een collega.
      </p>
      {formHere ? (
        <p className="tiny mt-12">
          <a className="text-link" href="#voorspelling">{client ? "Vul uw voorspelling in bij het formulier hieronder" : "Vul je voorspelling in bij het formulier hieronder"}</a>.
        </p>
      ) : (
        <Link className="btn primary mt-12" href={href}>
          {client ? "Geef eerst uw voorspelling" : "Geef eerst je voorspelling"} <Icon name="arrow" size="sm" />
        </Link>
      )}
    </div>
  );
}
