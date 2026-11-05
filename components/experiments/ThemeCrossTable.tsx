import Link from "next/link";
import { Detail } from "@/components/shell/ViewMode";
import { DMU_ROLES } from "@/lib/domain/labels";
import { recruitmentLabel } from "@/lib/domain/recruitment";
import { THEMES_NEVER_COUNT } from "@/lib/domain/themes";
import { xOfN, type Bucket, type CountItem, type ThemeCounts } from "@/lib/domain/theme-counts";
import type { QuoteRef } from "@/lib/theme-counts-data";
import "./interviews.css";

// Fase 1 · punt 3: "X van N geïnterviewden" per thema en per aanname, met de uitsplitsing per rol en wervingsgroep
// (in Grondig) en, alleen voor het onderzoeksteam, de citaten erachter. Opdrachtgevers krijgen dezelfde aantallen
// via interview_theme_counts, zonder citaten.

const roleLabel = (k: string) => DMU_ROLES[k as keyof typeof DMU_ROLES] ?? k;

function Split({ buckets, label }: { buckets: Bucket[]; label: (k: string) => string }) {
  if (!buckets.length) return null;
  return (
    <span className="theme-split">
      {buckets.map((b) => (
        <span key={b.key}>
          {label(b.key)} {b.mentioned}/{b.total}
        </span>
      ))}
    </span>
  );
}

function Row({ it, ideaId, quotes }: { it: CountItem; ideaId: string; quotes?: QuoteRef[] }) {
  const share = it.total ? Math.round((it.mentioned / it.total) * 100) : 0;
  const mine = (quotes ?? []).filter((q) => q.codeId === it.id);
  return (
    <tr>
      <td className="theme-detail">
        <strong>{it.label}</strong>
        {quotes && mine.length > 0 && (
          <details>
            <summary className="text-link">Citaten ({mine.length})</summary>
            <ul style={{ margin: "6px 0 0 18px", padding: 0, fontSize: 13, lineHeight: 1.6 }}>
              {mine.map((q, i) => (
                <li key={`${q.interviewId}-${i}`}>
                  {q.quote ? `“${q.quote}”` : "(citaat verwijderd na de bewaartermijn)"}{" "}
                  <Link className="text-link" href={q.experimentId ? `/app/ideas/${ideaId}/experiments/${q.experimentId}/interviews/${q.interviewId}` : `/app/ideas/${ideaId}/interviews/${q.interviewId}`}>
                    {q.participant}
                  </Link>
                  {!q.counts && <span className="tiny"> · telt niet mee</span>}
                </li>
              ))}
            </ul>
          </details>
        )}
        <Detail>
          <Split buckets={it.byRole} label={roleLabel} />
          <Split buckets={it.byRecruitment} label={(k) => recruitmentLabel(k)} />
        </Detail>
      </td>
      <td className="num">
        {xOfN(it)}
        <span className="theme-bar" aria-hidden="true"><span style={{ width: `${share}%` }} /></span>
      </td>
    </tr>
  );
}

export function ThemeCrossTable({
  counts,
  ideaId,
  quotes,
  title = "Thema's over alle interviews",
  scope = "dossier",
}: {
  counts: ThemeCounts;
  ideaId: string;
  quotes?: QuoteRef[];
  title?: string;
  scope?: "dossier" | "test";
}) {
  const themes = counts.items.filter((i) => i.type === "theme");
  const assumptions = counts.items.filter((i) => i.type === "assumption" && i.mentioned > 0);
  const headId = `tct-${scope}`;
  return (
    <section className="card mt-18" aria-labelledby={headId}>
      <div className="section-title">
        <h2 className="as-h3" id={headId}>{title}</h2>
        <span className="pill gray">N = {counts.total} {counts.total === 1 ? "echt gesprek" : "echte gesprekken"} met toestemming</span>
      </div>
      <p className="tiny" style={{ marginTop: -6 }}>
        X = verschillende geïnterviewden met minstens één handmatige of geaccepteerde toewijzing. Oefeningen en gesprekken zonder toestemming tellen niet
        mee. {THEMES_NEVER_COUNT}
      </p>
      {counts.total === 0 ? (
        <p className="sub">Nog geen echte gesprekken met toestemming{scope === "test" ? " in deze test" : ""}.</p>
      ) : themes.length === 0 ? (
        <p className="sub">Nog geen geaccepteerde thema&apos;s. Maak ze op de transcriptpagina van een gesprek, of laat de AI ze voorstellen.</p>
      ) : (
        <table className="theme-table mt-12">
          <thead>
            <tr>
              <th scope="col">Thema</th>
              <th scope="col" className="num">Genoemd door</th>
            </tr>
          </thead>
          <tbody>
            {themes.map((it) => <Row key={it.id} it={it} ideaId={ideaId} quotes={quotes} />)}
          </tbody>
        </table>
      )}
      {assumptions.length > 0 && (
        <>
          <h3 style={{ fontSize: 15, margin: "18px 0 4px" }}>Per aanname (gekoppelde citaten)</h3>
          <p className="tiny" style={{ marginTop: 0 }}>Beschrijvend. De kans van een aanname rekent zelf met de gekoppelde observaties, per persoon ontdubbeld.</p>
          <table className="theme-table">
            <thead>
              <tr>
                <th scope="col">Aanname</th>
                <th scope="col" className="num">Genoemd door</th>
              </tr>
            </thead>
            <tbody>
              {assumptions.map((it) => <Row key={it.id} it={it} ideaId={ideaId} />)}
            </tbody>
          </table>
        </>
      )}
    </section>
  );
}
