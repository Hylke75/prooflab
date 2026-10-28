import { CLAIM_STATUS, EVIDENCE_TYPES, SOURCE_TYPES, type ClaimStatus, type EvidenceType, type SourceType } from "@/lib/domain/labels";

export type ClaimView = {
  id: string;
  statement: string;
  status: ClaimStatus;
  status_reason: string | null;
  evidence_type: EvidenceType;
  supports: string | null;
  does_not_prove: string | null;
  region: string | null;
  period: string | null;
  definition: string | null;
  limitations: string | null;
  origin: string;
  evidence: {
    quote: string;
    stance: string;
    quote_check: string;
    source: { title: string; url: string | null; publisher: string | null; published_on: string | null; source_type: SourceType; domain: string | null } | null;
  }[];
};

const CHECK_LABEL: Record<string, string> = {
  exact: "Citaat letterlijk teruggevonden",
  not_found: "Citaat niet teruggevonden",
  numbers_mismatch: "Getallen staan niet in het citaat",
  unchecked: "Nog niet gecontroleerd",
};

// Every conclusion shows what it supports, what it does not prove yet, and its sources.
export function InsightCard({ claim, actions }: { claim: ClaimView; actions?: React.ReactNode }) {
  const st = CLAIM_STATUS[claim.status];
  const first = claim.evidence.find((e) => e.source)?.source;
  const meta = [
    first?.publisher ?? first?.domain ?? first?.title,
    first?.published_on ? new Date(first.published_on).toLocaleDateString("nl-NL", { year: "numeric", month: "short" }) : "datum onbekend",
    claim.region,
    claim.period,
  ].filter(Boolean);
  return (
    <article className="insight">
      <div className="insight-head">
        <h4>{claim.statement}</h4>
        <span className={`pill ${st.pill}`} title={st.explain}>{st.label}</span>
      </div>
      <div className="insight-meta">
        {meta.join(" · ")} · {EVIDENCE_TYPES[claim.evidence_type]}
        {claim.origin === "ai" ? " · gevonden door AI, citaat gecontroleerd" : ""}
      </div>
      <div className="insight-grid">
        <div>
          <strong>Wat ondersteunt dit?</strong>
          <p>{claim.supports ?? "—"}</p>
        </div>
        <div>
          <strong>Wat bewijst dit nog niet?</strong>
          <p>{claim.does_not_prove ?? "Nog niet ingevuld."}</p>
        </div>
      </div>
      <details>
        <summary>Bron, citaat en beperkingen ({claim.evidence.length})</summary>
        {claim.status_reason && <p className="tiny" style={{ marginTop: 8 }}>Status: {claim.status_reason}</p>}
        {claim.evidence.map((e, i) => (
          <div key={i}>
            <blockquote className={`quote${e.quote_check === "exact" ? "" : " bad"}`}>“{e.quote}”</blockquote>
            <div className="tiny">
              {e.stance === "contradicts" ? "Spreekt tegen · " : ""}
              {CHECK_LABEL[e.quote_check] ?? e.quote_check} ·{" "}
              {e.source ? (
                <>
                  {SOURCE_TYPES[e.source.source_type]} ·{" "}
                  {e.source.url ? (
                    <a href={e.source.url} target="_blank" rel="noreferrer noopener">{e.source.title}</a>
                  ) : (
                    e.source.title
                  )}
                </>
              ) : (
                "bron verwijderd"
              )}
            </div>
          </div>
        ))}
        {claim.definition && <p className="tiny mt-8">Definitie: {claim.definition}</p>}
        {claim.limitations && <p className="tiny mt-8">Beperkingen: {claim.limitations}</p>}
        {actions && <div className="row mt-12">{actions}</div>}
      </details>
    </article>
  );
}
