import { STANDING_GROUPS, type ReportCanvas } from "@/lib/domain/canvas";

const date = (s: string) => new Date(s).toLocaleDateString("nl-NL", { day: "numeric", month: "long", year: "numeric" });

// Rapport: compacte weergave van het propositie- en businessmodelcanvas, met de bewijsstand per onderdeel zoals die
// was bij het maken van de rapportversie. Open AI-voorstellen staan er niet in (alleen hun aantal).
export function ReportCanvasSection({ canvas }: { canvas: ReportCanvas }) {
  return (
    <section className="report-section" data-testid="rapport-canvas">
      <span className="eyebrow">06b / Businessmodel en propositie</span>
      <h3>Hoe moet het model werken, en wat is daarvan getoetst?</h3>
      <p>{canvas.summary}</p>
      {canvas.canvases.map((c) => (
        <table className="table mt-12" key={c.canvas}>
          <caption style={{ textAlign: "left", fontWeight: 700, padding: "4px 0" }}>{c.label}</caption>
          <thead>
            <tr>
              <th scope="col" style={{ width: "26%" }}>Bouwsteen</th>
              <th scope="col">Onderdeel</th>
              <th scope="col" style={{ width: "28%" }}>Bewijsstand</th>
            </tr>
          </thead>
          <tbody>
            {c.blocks.flatMap((b) =>
              b.items.map((i, n) => (
                <tr key={`${b.label}-${n}`}>
                  <td>{n === 0 ? b.label : ""}</td>
                  <td>
                    {i.body}
                    {i.origin !== "Eigen invoer" && <span className="tiny" style={{ display: "block" }}>{i.origin}</span>}
                  </td>
                  <td>{i.standing}</td>
                </tr>
              )),
            )}
          </tbody>
        </table>
      ))}
      <p className="explain">
        {STANDING_GROUPS.tested.label}: {STANDING_GROUPS.tested.explain.toLowerCase()} {STANDING_GROUPS.sourced.label}: {STANDING_GROUPS.sourced.explain.toLowerCase()}{" "}
        {STANDING_GROUPS.belief.label}: {STANDING_GROUPS.belief.explain.toLowerCase()} Een leeg vak betekent onbekend.
        {canvas.openProposals ? ` ${canvas.openProposals} AI-voorstel${canvas.openProposals === 1 ? "" : "len"} nog niet beoordeeld en daarom niet opgenomen.` : ""}
        {canvas.latestVersion ? ` Laatst opgeslagen canvasversie: versie ${canvas.latestVersion.number} van ${date(canvas.latestVersion.at)} (${canvas.latestVersion.author}).` : " Er is nog geen canvasversie opgeslagen."}
      </p>
    </section>
  );
}
