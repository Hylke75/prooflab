import Link from "next/link";
import { registerLine, registerTally, type RegisterItem } from "@/lib/domain/evidence";

// Fase 1, punt 2: het bewijsregister van één aanname. Eén regel ("3 voor (2 tellen mee) · 1 tegen") en uitklapbaar per
// item of het meetelt in de kans en waarom niet, in gewone taal. Alles komt uit de rekenmodule (AssumptionProbability.items),
// zodat dit scherm nooit iets anders zegt dan de berekening doet.
// Geen citaten: een waarneming staat er met haar soort en bron ("Demo aangevraagd · Interview 3"), nooit met de letterlijke
// uitspraak; een bevinding met haar tekst (claimText), die ook opdrachtgevers mogen lezen.
export function EvidenceRegister({
  items,
  ideaId,
  claimText = {},
  compact = false,
}: {
  items: RegisterItem[];
  ideaId: string;
  // Tekst per bevinding (claim-id → tekst); zonder tekst het label van de status.
  claimText?: Record<string, string>;
  // Zonder uitleg-zin eronder (voor krappe plekken).
  compact?: boolean;
}) {
  const t = registerTally(items);
  if (items.length === 0) return <p className="tiny" data-testid="bewijsregister">Nog niets gekoppeld: geen bewijs voor of tegen.</p>;
  const order = (i: RegisterItem) => (i.fate === "counted" ? 0 : 1);
  const sorted = [...items].sort((a, b) => order(a) - order(b) || (a.direction === b.direction ? 0 : a.direction === "supports" ? -1 : 1));
  const name = (i: RegisterItem) => {
    if (i.itemType === "claim") {
      const text = i.id ? claimText[i.id] : undefined;
      return i.id && text ? (
        <Link className="text-link" href={`/app/ideas/${ideaId}/research?tab=overview#claim-${i.id}`}>{truncate(text, 90)}</Link>
      ) : (
        i.label
      );
    }
    return `${i.label}${i.sourceLabel ? ` · ${i.sourceLabel}` : ""}`;
  };
  return (
    <div className="tiny" data-testid="bewijsregister">
      <p style={{ margin: 0 }}>
        <strong className="num">{registerLine(t)}</strong>
        {t.notCounted > 0 ? ` · ${t.notCounted} ${t.notCounted === 1 ? "telt" : "tellen"} niet mee` : ""}
      </p>
      <details className="mt-8">
        <summary className="text-link">{t.notCounted > 0 ? "Waarom telt niet alles mee?" : "Wat telt mee?"}</summary>
        <ul style={{ margin: "6px 0 0 18px", lineHeight: 1.6 }} aria-label="Bewijsregister: wat meetelt in de kans en waarom niet">
          {sorted.map((i, k) => (
            <li key={`${i.itemType}-${i.id ?? k}-${k}`}>
              <span aria-hidden="true" style={{ color: i.direction === "supports" ? "var(--color-success)" : "var(--color-risk-text)", fontWeight: 700 }}>
                {i.direction === "supports" ? "↑" : "↓"}
              </span>{" "}
              <span className="sr-only">{i.direction === "supports" ? "Voor: " : "Tegen: "}</span>
              {name(i)}:{" "}
              {i.fate === "counted" ? (
                <>telt mee{i.reason ? ` (${i.reason.replace(/^telt mee, maar /, "maar ")})` : ""}.</>
              ) : (
                <>telt niet mee: {i.reason}.</>
              )}
            </li>
          ))}
        </ul>
        {!compact && (
          <p className="explain" style={{ marginTop: 6 }}>
            Dezelfde regels als de berekening van de kans: oefengesprekken en afgekeurde AI-codering tellen nooit, per bron telt alleen het sterkste signaal, en
            uitkomsten van tests die onbeslist zijn of onder de steekproef bleven tellen niet mee.
          </p>
        )}
      </details>
    </div>
  );
}

const truncate = (text: string, max: number) => (text.length <= max ? text : `${text.slice(0, max - 1).replace(/\s+\S*$/, "")}…`);
