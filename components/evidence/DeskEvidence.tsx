import Link from "next/link";
import type { RegisterItem } from "@/lib/domain/evidence";
import { CLAIM_STATUS, type ClaimStatus } from "@/lib/domain/labels";

export type DeskLinkRow = { assumptionId: string; claimId: string; relation: "supports" | "contradicts"; statement: string; status: ClaimStatus };

// Gebruikerstest A2: bureauonderzoek per aanname op de pagina Bewijs & besluit. Per aanname de gekoppelde bevindingen
// die meetellen als steun of als tegenbewijs, en apart de bevindingen die (nog) niet meetellen, met de reden en een
// link naar de bevinding. Fase 1, punt 2: of een bevinding meetelt, komt uit het bewijsregister van de kansberekening
// (register op de aanname), dezelfde bron als de risicokaart; zo zeggen beide schermen altijd hetzelfde.
type Row = DeskLinkRow & { reasonText: string };

export function deskRows(links: DeskLinkRow[], register: RegisterItem[]): { supporting: DeskLinkRow[]; contradicting: DeskLinkRow[]; notCounted: Row[] } {
  const supporting: DeskLinkRow[] = [];
  const contradicting: DeskLinkRow[] = [];
  const notCounted: Row[] = [];
  for (const l of links) {
    const r = register.find((i) => i.itemType === "claim" && i.id === l.claimId);
    if (!r) continue;
    if (r.fate === "not_counted") notCounted.push({ ...l, reasonText: r.reason ?? "telt niet mee" });
    else if (r.direction === "supports") supporting.push(l);
    else contradicting.push(l);
  }
  return { supporting, contradicting, notCounted };
}

export function DeskEvidence({
  ideaId,
  assumptions,
  links,
}: {
  ideaId: string;
  assumptions: { id: string; statement: string; importance: number; register: RegisterItem[] }[];
  links: DeskLinkRow[];
}) {
  const rows = assumptions
    .map((a) => ({ a, tally: deskRows(links.filter((l) => l.assumptionId === a.id), a.register) }))
    .filter((r) => r.tally.supporting.length + r.tally.contradicting.length + r.tally.notCounted.length > 0);
  const href = (claimId: string) => `/app/ideas/${ideaId}/research?tab=overview#claim-${claimId}`;
  const item = (l: DeskLinkRow, extra?: string) => (
    <li key={l.claimId}>
      <Link className="text-link" href={href(l.claimId)}>{l.statement}</Link>{" "}
      <span className={`pill ${CLAIM_STATUS[l.status].pill}`}>{CLAIM_STATUS[l.status].label}</span>
      {extra ? <span className="tiny"> · {extra}</span> : null}
    </li>
  );
  return (
    <div className="card mt-18" role="region" aria-labelledby="bureau-per-aanname">
      <div className="section-title">
        <h3 id="bureau-per-aanname">Bureauonderzoek per aanname</h3>
        <span className="pill gray">Gekoppelde bevindingen</span>
      </div>
      <p className="sub">
        Welke bevindingen uit Markt aan een aanname hangen, en of ze meetellen als steun of als tegenbewijs. Bureauonderzoek is nooit klantgedrag; het telt
        alleen mee met een gecontroleerd citaat.
      </p>
      {rows.length === 0 ? (
        <p className="tiny mt-8">
          Nog geen bevindingen aan een aanname gekoppeld. Koppel ze op de <Link className="text-link" href={`/app/ideas/${ideaId}/assumptions`}>aannamepagina</Link>.
        </p>
      ) : (
        rows.map(({ a, tally }) => (
          <div key={a.id} className="mt-12" style={{ borderTop: "1px solid var(--color-border)", paddingTop: 10 }}>
            <strong style={{ fontSize: 14 }}>{a.statement}</strong>
            <p className="tiny" style={{ margin: "2px 0 0" }}>
              {tally.supporting.length} pro · {tally.contradicting.length} contra{tally.notCounted.length ? ` · ${tally.notCounted.length} telt nog niet mee` : ""}
            </p>
            {tally.supporting.length > 0 && (
              <ul className="tiny" style={{ margin: "6px 0 0 18px", lineHeight: 1.6 }} aria-label={`Steun voor: ${a.statement}`}>
                {tally.supporting.map((l) => item(l, "steunt de aanname"))}
              </ul>
            )}
            {tally.contradicting.length > 0 && (
              <ul className="tiny" style={{ margin: "6px 0 0 18px", lineHeight: 1.6 }} aria-label={`Tegenbewijs voor: ${a.statement}`}>
                {tally.contradicting.map((l) => item(l, l.status === "refuted" ? "weerlegd, telt als tegenbewijs" : "spreekt de aanname tegen"))}
              </ul>
            )}
            {tally.notCounted.length > 0 && (
              <ul className="tiny" style={{ margin: "6px 0 0 18px", lineHeight: 1.6 }} aria-label={`Telt nog niet mee bij: ${a.statement}`}>
                {tally.notCounted.map((l) => item(l, `telt nog niet mee: ${l.reasonText}`))}
              </ul>
            )}
          </div>
        ))
      )}
    </div>
  );
}
