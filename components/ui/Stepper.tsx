import Link from "next/link";
import { STEPS, stepMark, type StepStates } from "@/lib/steps";
import type { StepKey } from "@/lib/domain/dossier-status";

// De stappenbalk: dezelfde vier stappen, namen en status als het menu (lib/steps.ts). `current` is de stap van de
// pagina; de status (✓ klaar, • loopt) komt uit getDossierStatus().
// Geen prefetch op de stappen (B1): vier zware ideepagina's tegelijk bij elk paginabezoek, zie Sidebar.
export function Stepper({ current, ideaId, states }: { current?: StepKey | null; ideaId?: string; states?: Partial<StepStates> }) {
  return (
    <nav className="stepper" aria-label="Voortgang van het stappenplan">
      {STEPS.map((s, i) => {
        const state = states?.[s.key];
        const done = state === "done";
        const mark = stepMark(state);
        const isCurrent = s.key === current;
        const cls = isCurrent ? "current" : done ? "complete" : "";
        const inner = (
          <>
            <span className="step-no" aria-hidden="true">{done && !isCurrent ? "✓" : s.number}</span>
            <span className="step-name">{s.label}</span>
            {mark && (
              <span className={`step-mark ${state}`}>
                <span aria-hidden="true">{mark.mark}</span>
                <span className="sr-only">, {mark.spoken}</span>
              </span>
            )}
          </>
        );
        return (
          <span key={s.key} style={{ display: "contents" }}>
            {i > 0 && <span className="connector" />}
            {ideaId ? (
              <Link href={`/app/ideas/${ideaId}${s.path}`} prefetch={false} className={cls} aria-current={isCurrent ? "step" : undefined} data-step={s.key} data-step-state={state ?? "empty"}>
                {inner}
              </Link>
            ) : (
              <button type="button" className={cls} disabled aria-current={isCurrent ? "step" : undefined} data-step={s.key} data-step-state={state ?? "empty"}>
                {inner}
              </button>
            )}
          </span>
        );
      })}
    </nav>
  );
}
