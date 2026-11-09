import type { ReactNode } from "react";
import type { TestProgress as Progress } from "@/lib/domain/test-progress";

// Voortgangsbalk over het hele testproces (feedback eigenaar): zes stappen met gedaan (vinkje), huidige ("Je bent
// hier") en nog te doen, met direct eronder één zin "Volgende stap: …" en de primaire actie. Op mobiel compact:
// "Stap 2 van 6 · Ter review" en een balk. De stappen komen uit testProgress() (lib/domain/test-progress.ts).
export function TestProgress({ progress, action, id = "testproces" }: { progress: Progress; action?: ReactNode; id?: string }) {
  const p = progress;
  return (
    <section className="tp" aria-labelledby={`${id}-title`} id={id}>
      <div className="tp-head">
        <h2 className="tp-title" id={`${id}-title`}>Waar ben je in het testproces?</h2>
        <strong className="tp-compact" aria-live="polite">{p.compact}</strong>
      </div>
      <div className="tp-bar" aria-hidden="true">
        <span style={{ width: `${Math.round(p.fraction * 100)}%` }} />
      </div>
      <ol className="tp-steps">
        {p.steps.map((s) => (
          <li key={s.key} className={`tp-step ${s.status}`} aria-current={s.status === "current" ? "step" : undefined} data-step={s.key}>
            <span className="tp-dot" aria-hidden="true">{s.status === "done" ? "✓" : s.number}</span>
            <span className="tp-label">
              {s.label}
              <span className="sr-only">{s.status === "done" ? " (gedaan)" : s.status === "current" ? " (huidige stap)" : " (nog te doen)"}</span>
            </span>
            {s.status === "current" && <span className="tp-here" aria-hidden="true">Je bent hier</span>}
          </li>
        ))}
      </ol>
      {p.note && <p className="tp-note">{p.note}</p>}
      <div className="tp-next">
        <p>
          <strong>{p.next.prefix ?? "Volgende stap"}:</strong> {p.next.text}
        </p>
        {action}
      </div>
    </section>
  );
}
