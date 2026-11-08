import Link from "next/link";
import { CERTAINTY_LABEL, type Certainty, type EvidenceStanding as Standing } from "@/lib/domain/evidence-standing";
import { EvidenceScale } from "@/components/evidence/EvidenceScale";
import { Probability } from "@/components/ui/Probability";
import { Explain } from "@/components/ui/Explain";

const CERTAINTY_PILL: Record<Certainty, string> = { low: "coral", medium: "orange", high: "green" };

// Fase 1, punt 2: Stand van het bewijs, bovenaan Overzicht en Besluit. Eén samenvattende regel, de bewijsschaal en per
// aanname die gekozen is om te testen (belang 4–5 én "nu testen") de details (inklapbaar). "Kritiek" alleen betekent
// in de app belang 4–5; dat woord staat hier dus niet voor de gekozen aannames. Kansen staan als één waarde; de bandbreedte staat in de tooltip en
// "niet gekalibreerd" één keer onderaan. Geen citaten: bewijs staat er met soort en bron, ook voor opdrachtgevers.
// className: "card" op een pagina; in het rapport een rustige sectie zonder kaartschaduw.
// showNext: op Overzicht staat de volgende stap al in een eigen kaart; het blok herhaalt hem daar niet (één advies per pagina).
export function EvidenceStanding({ standing, ideaId, links = true, showNext = true, className = "card" }: { standing: Standing; ideaId: string; links?: boolean; showNext?: boolean; className?: string }) {
  const s = standing;
  return (
    <section className={className} aria-labelledby="stand-van-het-bewijs" data-testid="stand-van-het-bewijs" style={{ marginBottom: 24 }}>
      <div className="section-title" style={{ flexWrap: "wrap" }}>
        <h2 className="as-h3" id="stand-van-het-bewijs">Stand van het bewijs</h2>
        <span className={`pill ${CERTAINTY_PILL[s.certainty]}`}>Zekerheid: {CERTAINTY_LABEL[s.certainty]}</span>
      </div>
      <p style={{ margin: 0, fontWeight: 700, fontSize: 16, lineHeight: 1.5 }} data-testid="stand-samenvatting">{s.summary}</p>
      <p className="tiny mt-8">Zekerheid {CERTAINTY_LABEL[s.certainty]}: {s.certaintyReason}. Midden vraagt minstens 50% en gedrag bij elke aanname die je nu test, hoog minstens 70%.</p>
      <div className="mt-12">
        <div className="eyebrow" style={{ fontSize: 13, marginBottom: 6 }}>Sterkste bewijs op de schaal</div>
        <EvidenceScale step={s.strongest.step} label="Sterkste bewijs op de bewijsschaal" />
      </div>
      {showNext && s.next && (
        <p className="sub mt-12" style={{ fontSize: 15, lineHeight: 1.5 }}>
          <strong>Volgende stap:</strong>{" "}
          {links ? <Link className="text-link" href={s.next.href} prefetch={false} style={{ fontSize: 15 }}>{s.next.title}</Link> : s.next.title}. {s.next.detail}
        </p>
      )}
      <details className="mt-12">
        <summary className="text-link">
          {s.assumptions.length === 0
            ? s.derived
              ? "Nog geen kritieke aannames"
              : "Nog geen aannames gekozen om te testen"
            : `Per ${s.derived ? "kritieke" : "gekozen"} aanname (${s.critical.tested} van ${s.critical.total} getest)`}
        </summary>
        {s.assumptions.length === 0 ? (
          <p className="tiny mt-8">
            Kies op de {links ? <Link className="text-link" href={`/app/ideas/${ideaId}/assumptions`} prefetch={false}>aannamepagina</Link> : "aannamepagina"} maximaal drie aannames met belangrijkheid 4 of 5 om nu te testen.
          </p>
        ) : (
          <ol style={{ listStyle: "none", padding: 0, margin: "8px 0 0" }} aria-label={s.derived ? "Kritieke aannames" : "Aannames gekozen om te testen"}>
            {s.assumptions.map((a) => (
              <li key={a.id} style={{ borderTop: "1px solid var(--color-border)", padding: "10px 0" }}>
                <div className="row between" style={{ gap: 8, alignItems: "flex-start", flexWrap: "wrap" }}>
                  <strong style={{ fontSize: 14, flex: "1 1 220px", minWidth: 0 }}>
                    Aanname {a.number}: {a.statement}
                  </strong>
                  <span className="pill gray">
                    Kans <Probability p={a.probability} band={a.band} calibrated={s.calibrated} showLabel={false} />
                  </span>
                </div>
                <p className="tiny" style={{ margin: "4px 0 0" }}>
                  <span className="num">{a.tallyLine}</span>
                  {a.tally.notCounted > 0 ? ` · ${a.tally.notCounted} ${a.tally.notCounted === 1 ? "telt" : "tellen"} niet mee` : ""} · {s.derived ? "Status" : "Hoofdtest"}:{" "}
                  {s.derived && a.primary ? (
                    a.primary.status
                  ) : a.primary ? (
                    <>
                      {links ? <Link className="text-link" href={a.primary.href} prefetch={false}>{a.primary.title}</Link> : a.primary.title}, {a.primary.status}
                    </>
                  ) : (
                    "nog niet aangewezen"
                  )}
                </p>
                {a.reasons.length > 0 && (
                  <details className="mt-8">
                    <summary className="text-link" style={{ fontSize: 13 }}>Wat telt mee en waarom niet</summary>
                    <ul className="tiny" style={{ margin: "4px 0 0 18px", lineHeight: 1.6 }}>
                      {a.reasons.map((r, k) => (
                        <li key={k}>
                          <span aria-hidden="true">{r.direction === "supports" ? "↑ " : "↓ "}</span>
                          <span className="sr-only">{r.direction === "supports" ? "Voor: " : "Tegen: "}</span>
                          {r.label}: {r.fate === "counted" ? `telt mee${r.reason ? ` (${r.reason.replace(/^telt mee, maar /, "maar ")})` : ""}` : `telt niet mee: ${r.reason}`}.
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </li>
            ))}
          </ol>
        )}
      </details>
      {s.derived && (
        <p className="explain mt-8">
          Afgeleid uit een rapportversie van vóór dit blok: zonder bewijsregister, zonder de keuze &quot;nu testen&quot; en zonder hoofdtest; getest betekent hier dat de
          aanname de status ondersteund of weerlegd had.
        </p>
      )}
      {!s.calibrated && (
        // Fase 1 · punt 1: in Snel één keer per pagina de uitleg, daarna alleen de term met tooltip.
        <Explain k="kalibratie" term="Niet gekalibreerd" as="p" className="explain mt-8">
          Kansen zijn niet gekalibreerd: de werkruimte heeft nog te weinig afgeronde dossiers om ze te toetsen. Ze staan als band van 10 procentpunt
          {links ? "; de exacte waarde en de bandbreedte staan in de uitleg bij de kans." : "."}
        </Explain>
      )}
    </section>
  );
}
