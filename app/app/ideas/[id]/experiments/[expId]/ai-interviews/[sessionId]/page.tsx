import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageFrame } from "@/components/shell/PageFrame";
import { getIdea } from "@/lib/data";
import { loadAiConversation } from "@/lib/ai-interview-data";
import { formatTimestamp } from "@/lib/domain/transcript-parse";
import { AI_EVIDENCE_NOTE, AI_INTERVIEW_SCHEMA_MISSING, conversationCode, END_REASONS, PURGED_TURN, roleLabel, sessionDisplay, type EndReason } from "@/lib/domain/ai-interview";

export const metadata: Metadata = { title: "AI-gesprek" };

const KIND_LABEL: Record<string, string> = {
  intro: "Introductie",
  guide: "Vraag uit de leidraad",
  probe: "Doorvraag (AI, gecontroleerd)",
  fallback: "Vraag uit de leidraad (doorvraag afgekeurd)",
  refusal: "Instructie geweigerd",
  closing: "Afsluiting",
  answer: "Antwoord",
};

// Het volledige gesprek met tijdstempels en rollen, met per doorvraag de controle (vaste regels en tweede model). Alleen
// voor het onderzoeksteam (RLS). Citaten markeer je in het interview (alleen respondentbeurten).
export default async function AiConversationPage({ params }: PageProps<"/app/ideas/[id]/experiments/[expId]/ai-interviews/[sessionId]">) {
  const { id, expId, sessionId } = await params;
  const { idea, canWrite } = await getIdea(id);
  if (!canWrite) notFound();
  const { schemaMissing, session: s, turns, expTitle, now } = await loadAiConversation(id, expId, sessionId);
  if (schemaMissing) {
    return (
      <PageFrame crumbs={["Werkruimte", idea.title, "Testen", "AI-gesprek"]} coach="experiments" ideaId={id} section={`/experiments/${expId}`}>
        <div className="note">{AI_INTERVIEW_SCHEMA_MISSING}</div>
      </PageFrame>
    );
  }
  if (!s || !expTitle) notFound();
  const d = sessionDisplay(s, now);
  const code = conversationCode(s.id);
  const t0 = Date.parse(s.started_at);

  return (
    <PageFrame crumbs={["Werkruimte", idea.title, "Testen", expTitle, `Gesprek ${code}`]} coach="experiments" ideaId={id} section={`/experiments/${expId}`}>
      <div className="section-row">
        <div>
          <div className="eyebrow">AI-gemodereerd interview · {expTitle}</div>
          <h1>Gesprek {code}</h1>
          <p className="sub">
            {new Date(s.started_at).toLocaleString("nl-NL", { dateStyle: "long", timeStyle: "short" })} · {s.answers} {s.answers === 1 ? "antwoord" : "antwoorden"} · {roleLabel(s.dmu_role)}
            {s.segment ? ` · ${s.segment}` : ""}{s.end_reason ? ` · ${END_REASONS[s.end_reason as EndReason] ?? s.end_reason}` : ""} · bewaard tot {new Date(s.retention_until).toLocaleDateString("nl-NL")}
          </p>
        </div>
        <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
          <span className="pill blue">AI-gemodereerd</span>
          <span className={`pill ${d.pill}`}>{d.label}</span>
          <Link className="btn white sm" href={`/app/ideas/${id}/experiments/${expId}#ai-interviewer`}>← Terug</Link>
        </div>
      </div>

      <div className="note" style={{ marginTop: 0 }}>{AI_EVIDENCE_NOTE}</div>
      {s.exclusion_reason && <div className="note"><strong>Uitgesloten.</strong> Reden: {s.exclusion_reason}</div>}
      {s.interview_id && (
        <p className="mt-12">
          <Link className="btn soft sm" href={`/app/ideas/${id}/experiments/${expId}/interviews/${s.interview_id}`}>Open het interview en markeer citaten →</Link>
        </p>
      )}
      <p className="tiny mt-12">Toestemming gegeven op {new Date(s.consented_at).toLocaleString("nl-NL")}: &ldquo;{s.consent_text}&rdquo;</p>

      <section className="card mt-18" aria-labelledby="beurten">
        <h2 className="as-h3" id="beurten">Beurten</h2>
        {turns.length === 0 ? (
          <p className="sub">Geen beurten (gescreend uit of nog niet begonnen).</p>
        ) : (
          <ol style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 12 }}>
            {turns.map((t) => {
              const checks = (t.checks ?? null) as Record<string, unknown> | null;
              return (
                <li key={t.seq} className="evidence-event" style={{ alignItems: "flex-start" }}>
                  <div className="icon-circle" aria-hidden="true">{t.role === "interviewer" ? "AI" : "R"}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p className="tiny" style={{ margin: 0 }}>
                      [{formatTimestamp(Math.max(0, Date.parse(t.created_at) - t0))}] {t.role === "interviewer" ? "AI-interviewer" : "Respondent"} · {KIND_LABEL[t.kind] ?? t.kind}
                      {t.flags.includes("injection") ? " · bevatte een instructie aan de AI" : ""}
                      {t.flags.includes("sensitive") ? " · noemde mogelijk gevoelige gegevens" : ""}
                      {t.flags.includes("pseudonymized") ? " · namen of contactgegevens vervangen" : ""}
                    </p>
                    <p style={{ margin: "4px 0 0", whiteSpace: "pre-wrap", overflowWrap: "anywhere", color: t.text === PURGED_TURN ? "var(--color-text-muted)" : undefined }}>{t.text}</p>
                    {checks && (
                      <p className="tiny" style={{ margin: "4px 0 0" }}>
                        Controle: vaste regels {Array.isArray(checks.deterministic) ? `afgekeurd (${(checks.deterministic as string[]).join(", ")})` : String(checks.deterministic ?? "—")} · tweede model {String(checks.model ?? checks.probe ?? "—")}
                        {typeof checks.proposed === "string" ? ` · niet verstuurd: "${checks.proposed}"` : ""}
                      </p>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </section>
    </PageFrame>
  );
}
