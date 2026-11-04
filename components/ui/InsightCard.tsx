import { SUPPORT_LABEL, isSupportCheck } from "@/lib/domain/support";
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
  // Golf C, punt 7: populatie, regio en peildatum, en de vergelijking met de intake (lib/domain/claim-scope.ts).
  scope?: { population: string; region: string; referenceDate: string; relevance: "direct" | "indirect"; warnings: string[] };
  evidence: {
    id?: string;
    source_id?: string;
    support_check?: string;
    support_checked_by?: string | null;
    support_note?: string | null;
    live_found?: boolean | null;
    live_checked_at?: string | null;
    quote: string;
    stance: string;
    quote_check: string;
    source: { title: string; url: string | null; publisher: string | null; published_on: string | null; source_type: SourceType; domain: string | null; access_note?: string | null } | null;
  }[];
};

const CHECK_LABEL: Record<string, string> = {
  exact: "Citaat letterlijk teruggevonden",
  not_found: "Citaat niet teruggevonden",
  numbers_mismatch: "Getallen staan niet in het citaat",
  unchecked: "Nog niet gecontroleerd",
};

// Every conclusion shows what it supports, what it does not prove yet, and its sources.
export function InsightCard({
  claim,
  actions,
  evidenceActions,
}: {
  claim: ClaimView;
  actions?: React.ReactNode;
  evidenceActions?: (evidenceId: string) => React.ReactNode;
}) {
  const st = CLAIM_STATUS[claim.status];
  const first = claim.evidence.find((e) => e.source)?.source;
  const meta = [
    first?.publisher ?? first?.domain ?? first?.title,
    first?.published_on ? new Date(first.published_on).toLocaleDateString("nl-NL", { year: "numeric", month: "short" }) : "datum onbekend",
    claim.scope ? null : claim.region,
    claim.period,
  ].filter(Boolean);
  return (
    // Anker voor het zoeken binnen een dossier (/research?tab=overview#claim-…).
    <article className="insight" id={`claim-${claim.id}`}>
      <div className="insight-head">
        <h3 className="insight-title">{claim.statement}</h3>
        <span className={`pill ${st.pill}`} title={st.explain}>{st.label}</span>
      </div>
      <div className="insight-meta">
        {meta.join(" · ")} · {EVIDENCE_TYPES[claim.evidence_type]}
        {claim.origin === "ai" ? " · gevonden door AI, citaat gecontroleerd" : ""}
      </div>
      {claim.scope && (
        <div className="insight-meta" style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
          <span>Populatie: {claim.scope.population}</span>
          <span aria-hidden="true">·</span>
          <span>Regio: {claim.scope.region}</span>
          <span aria-hidden="true">·</span>
          <span>Peildatum: {claim.scope.referenceDate}</span>
          {claim.scope.relevance === "indirect" && (
            <span className="pill orange" title="Wijkt af van de intake; telt in een nieuwe methodeversie met halve sterkte">Indirect</span>
          )}
        </div>
      )}
      {claim.scope && claim.scope.warnings.length > 0 && (
        <div className="note" role="note">
          <strong>Past niet helemaal bij de intake.</strong> {claim.scope.warnings.join(" ")}
        </div>
      )}
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
            <SupportLine e={e} />
            {e.id && evidenceActions?.(e.id)}
          </div>
        ))}
        {claim.definition && <p className="tiny mt-8">Definitie: {claim.definition}</p>}
        {claim.limitations && <p className="tiny mt-8">Beperkingen: {claim.limitations}</p>}
        {actions && <div className="row mt-12">{actions}</div>}
      </details>
    </article>
  );
}

// Second check: does the literal quote carry the claim? AI verdicts are labelled as proposals.
export function SupportLine({ e }: { e: ClaimView["evidence"][number] }) {
  const rechecked = e.live_checked_at != null && e.live_found != null;
  if (!e.support_check && !rechecked) return null;
  const sc = isSupportCheck(e.support_check) ? e.support_check : "unchecked";
  const s = SUPPORT_LABEL[sc];
  const note = e.support_note;
  return (
    <div className="tiny" style={{ marginTop: 4, display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
      <span className={`pill ${s.pill}`} title={s.explain}>{s.label}</span>
      {e.support_checked_by === "ai" && <span>AI-voorstel, nog niet door een consultant bevestigd</span>}
      {e.support_checked_by === "consultant" && <span>Beoordeeld door consultant</span>}
      {note && <span>· {note}</span>}
      {rechecked && (
        <span>
          · Hercontrole {new Date(e.live_checked_at!).toLocaleDateString("nl-NL")}:{" "}
          {e.live_found ? "citaat teruggevonden op de live pagina" : <strong>citaat niet meer gevonden op de pagina</strong>}
        </span>
      )}
    </div>
  );
}
