import { ISSUE_LABEL, type QuestionAudit, type TurnAudit } from "@/lib/domain/interview-audit";

// Warnings per question of the interview guide, with a past-behaviour rewrite pattern.
export function GuideAuditList({ audit }: { audit: QuestionAudit[] }) {
  const flagged = audit.filter((a) => a.issues.length > 0);
  if (!flagged.length) return null;
  return (
    <ul style={{ margin: "8px 0 0 0", padding: 0, listStyle: "none" }}>
      {flagged.map((a) => (
        <li key={a.index} style={{ marginTop: 8 }}>
          <strong>Vraag {a.index + 1}:</strong> “{a.text}”
          <ul style={{ margin: "4px 0 0 16px", padding: 0 }}>
            {a.issues.map((i) => (
              <li key={i.kind}>
                <strong>{ISSUE_LABEL[i.kind]}.</strong> {i.message} {i.suggestion}
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ul>
  );
}

// Interviewer turns that steered, asked hypothetically or pitched; answers to them weigh less.
export function TranscriptAuditList({ turns }: { turns: TurnAudit[] }) {
  if (!turns.length) {
    return <p className="tiny mt-8">Transcriptcontrole: geen sturende, hypothetische of verkopende vragen van de interviewer gevonden (regels die beginnen met &quot;I:&quot;, &quot;Interviewer:&quot;, &quot;Q:&quot; of je naam).</p>;
  }
  return (
    <div className="note">
      <strong>Transcriptcontrole: {turns.length} vraag{turns.length === 1 ? "" : "en"} van de interviewer stuurde{turns.length === 1 ? "" : "n"} of verkocht het idee.</strong> Antwoorden op
      deze vragen wegen minder zwaar: wat iemand zegt na een sturende of hypothetische vraag voorspelt gedrag slecht.
      <ul style={{ margin: "6px 0 0 16px", padding: 0 }}>
        {turns.map((t) => (
          <li key={t.line}>
            Regel {t.line}: “{t.text.slice(0, 200)}” · {t.issues.map((i) => ISSUE_LABEL[i.kind].toLowerCase()).join(", ")}
          </li>
        ))}
      </ul>
    </div>
  );
}
