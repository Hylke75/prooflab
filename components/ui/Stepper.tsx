import Link from "next/link";
import { STEPS } from "@/lib/domain/labels";

type StepKey = (typeof STEPS)[number]["key"];

export function Stepper({ current, ideaId, done }: { current: StepKey; ideaId?: string; done?: Partial<Record<StepKey, boolean>> }) {
  return (
    <nav className="stepper" aria-label="Voortgang van het stappenplan">
      {STEPS.map((s, i) => {
        const cls = s.key === current ? "current" : done?.[s.key] ? "complete" : "";
        const inner = (
          <>
            <span className="step-no">{done?.[s.key] && s.key !== current ? "✓" : i + 1}</span> {s.label}
          </>
        );
        return (
          <span key={s.key} style={{ display: "contents" }}>
            {i > 0 && <span className="connector" />}
            {ideaId ? (
              <Link href={`/app/ideas/${ideaId}${s.path}`} className={cls} aria-current={s.key === current ? "step" : undefined} style={{ textDecoration: "none", display: "flex", alignItems: "center", gap: 8, fontSize: 11, fontWeight: 800, padding: "8px 4px", color: s.key === current ? "var(--blue)" : "#5f6879" }}>
                {inner}
              </Link>
            ) : (
              <button type="button" className={cls} disabled={s.key !== current} aria-current={s.key === current ? "step" : undefined}>
                {inner}
              </button>
            )}
          </span>
        );
      })}
    </nav>
  );
}
