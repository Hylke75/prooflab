import type { Metadata } from "next";
import Link from "next/link";
import { PageFrame } from "@/components/shell/PageFrame";
import { ActionForm } from "@/components/ui/ActionForm";
import { LABEL_PILL } from "@/components/experiments/RuleSummary";
import { getIdea } from "@/lib/data";
import { asMethodVersion, CURRENT_METHOD, METHODS } from "@/lib/domain/method";
import { changesBetween, ruleLabelText } from "@/lib/domain/method/describe";
import { pct } from "@/lib/domain/stats";
import { methodPreview } from "@/lib/method-preview";
import { switchMethod } from "./actions";

export const metadata: Metadata = { title: "Methode" };

const pct0 = (x: number) => `${Math.round(x * 100)}%`;
const diff = (a: number, b: number) => {
  const d = Math.round((b - a) * 100);
  return d === 0 ? "gelijk" : `${d > 0 ? "+" : "−"}${Math.abs(d)} punt${Math.abs(d) === 1 ? "" : "en"}`;
};

// Rekenwijze van het dossier, en voor dossiers op een oudere versie de overstap naar de nieuwste met vooraf een
// overzicht van wat er verandert.
export default async function MethodPage({ params }: PageProps<"/app/ideas/[id]/method">) {
  const { id } = await params;
  const { idea, canWrite } = await getIdea(id);
  const version = asMethodVersion(idea.method_version);
  const current = METHODS[version];
  const preview = version !== CURRENT_METHOD ? await methodPreview(id, version, CURRENT_METHOD) : null;

  return (
    <PageFrame crumbs={["Werkruimte", idea.title, "Methode"]} coach="assumptions" ideaId={id}>
      <div className="section-row">
        <div>
          <div className="eyebrow">Rekenwijze</div>
          <h1>Met welke methode rekent dit dossier?</h1>
          <p className="sub">Elk dossier rekent met één vaste methodeversie, zodat elke kans en elk oordeel later precies te reproduceren is.</p>
        </div>
        <span className={`pill ${version === CURRENT_METHOD ? "green" : "orange"}`}>{current.label}</span>
      </div>

      <div className="card">
        <div className="section-title"><h2 className="as-h3">{current.label}</h2></div>
        <ul style={{ margin: "0 0 0 18px", fontSize: 14, lineHeight: 1.7 }}>
          {current.rules.map((r) => <li key={r}>{r}</li>)}
        </ul>
        <p className="tiny mt-8">
          Uitleg van de begrippen staat in de <Link className="text-link" href="/app/help#methode">Help</Link>; de onderbouwing in het methodedocument (hoofdstuk 9).
        </p>
      </div>

      {preview && (
        <>
          <div className="insight-banner mt-18">
            <div>
              <span className="pill blue">Nieuw</span>
              <h2 className="as-h3" style={{ margin: "10px 0 5px" }}>Overstappen naar methode {CURRENT_METHOD}?</h2>
              <p>Wat {METHODS[CURRENT_METHOD].label} verandert ten opzichte van {current.label.toLowerCase()}:</p>
              <ul style={{ margin: "6px 0 0 18px", lineHeight: 1.6 }}>
                {changesBetween(version, CURRENT_METHOD).map((c) => <li key={c}>{c}</li>)}
              </ul>
              <p className="mt-8">Hieronder zie je vooraf wat er in dit dossier verandert. Er wordt niets opgeslagen tot je bevestigt.</p>
            </div>
          </div>

          <div className="card mt-18">
            <div className="section-title"><h2 className="as-h3">Kans per aanname</h2><span className="pill gray">{preview.assumptions.length} aannames</span></div>
            {preview.assumptions.length === 0 ? (
              <p className="sub">Nog geen aannames.</p>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table className="table">
                  <caption className="sr-only">Kans per aanname onder de oude en de nieuwe methode</caption>
                  <thead><tr><th scope="col">Aanname</th><th scope="col">{version}</th><th scope="col">{CURRENT_METHOD}</th><th scope="col">Verschil</th><th scope="col">Waarom</th></tr></thead>
                  <tbody>
                    {preview.assumptions.map((a) => (
                      <tr key={a.id}>
                        <td>{a.statement}</td>
                        <td className="num">{pct0(a.from)}</td>
                        <td className="num">{pct0(a.to)}</td>
                        <td className="num">{diff(a.from, a.to)}</td>
                        <td className="tiny">
                          {[a.capReason, ...a.merged.map((m) => `${m.signals} signalen uit ${m.label} samengevoegd`)].filter(Boolean).join("; ") || "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="card mt-18">
            <div className="section-title"><h2 className="as-h3">Uitkomst per test</h2><span className="pill gray">{preview.tests.length} tests</span></div>
            {preview.tests.length === 0 ? (
              <p className="sub">Nog geen gestarte of afgeronde tests.</p>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table className="table">
                  <caption className="sr-only">Uitkomst per test onder de oude en de nieuwe methode</caption>
                  <thead><tr><th scope="col">Test</th><th scope="col">Resultaat</th><th scope="col">{version}</th><th scope="col">{CURRENT_METHOD}</th><th scope="col">Learning Card</th></tr></thead>
                  <tbody>
                    {preview.tests.map((t) => (
                      <tr key={t.id}>
                        <td>{t.title}</td>
                        <td className="num">{t.successes} van {t.n}</td>
                        <td><span className={`pill ${LABEL_PILL[t.from.label] ?? "gray"}`}>{t.from.label}</span> <span className="tiny">({ruleLabelText(t.from.rule)})</span></td>
                        <td>
                          <span className={`pill ${LABEL_PILL[t.to.label] ?? "gray"}`}>{t.to.label}</span> <span className="tiny">({ruleLabelText(t.to.rule)}{t.to.probability != null ? `, kans ${pct(t.to.probability, 0)}` : ""})</span>
                        </td>
                        <td className="tiny">{t.approvedCard ? "Goedgekeurd: blijft ongewijzigd, nieuwe uitkomst ernaast" : "Nog niet goedgekeurd: volgt de nieuwe methode"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="explain">
              Goedgekeurde Learning Cards worden nooit overschreven: hun oordeel blijft staan en de uitkomst onder {CURRENT_METHOD} verschijnt ernaast. Bestaande
              rapportversies blijven zoals ze zijn; een nieuwe rapportversie vermeldt de nieuwe methode.
            </p>
          </div>

          {canWrite ? (
            <div className="card mt-18">
              <ActionForm action={switchMethod.bind(null, id)} submitLabel={`Overstappen naar methode ${CURRENT_METHOD}`} pendingLabel="Overstappen…">
                <label className="check-row">
                  <input type="checkbox" name="confirm" /> Ik heb het overzicht bekeken. Overstappen kan niet worden teruggedraaid en wordt vastgelegd in het auditspoor.
                </label>
              </ActionForm>
            </div>
          ) : (
            <p className="sub mt-18">Alleen het onderzoeksteam kan de methode van dit dossier wijzigen.</p>
          )}
        </>
      )}
    </PageFrame>
  );
}
