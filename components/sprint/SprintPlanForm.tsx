"use client";

import { useId } from "react";
import { ActionForm, type FormState } from "@/components/ui/ActionForm";
import { SPRINT_LENGTHS } from "@/lib/domain/sprint";

// Start date (default today) and length of the validation sprint.
export function SprintPlanForm({ action, today, weeks = 5, start, compact = false }: { action: (s: FormState, f: FormData) => Promise<FormState>; today: string; weeks?: number; start?: string | null; compact?: boolean }) {
  const uid = useId();
  return (
    <ActionForm action={action} submitLabel={start ? "Planning opslaan" : "Plan de sprint"} submitClass={compact ? "btn white sm" : "btn primary sm"} pendingLabel="Opslaan…" className="sprint-form">
      <div className="double-field">
        <div>
          <label className="field-label" htmlFor={`${uid}-start`}>Startdatum sprint</label>
          <input className="field" type="date" id={`${uid}-start`} name="sprint_start" defaultValue={start ?? today} required />
        </div>
        <div>
          <label className="field-label" htmlFor={`${uid}-weeks`}>Duur</label>
          <select className="field" id={`${uid}-weeks`} name="sprint_weeks" defaultValue={String(SPRINT_LENGTHS.includes(weeks as 4) ? weeks : 5)}>
            {SPRINT_LENGTHS.map((w) => (
              <option key={w} value={w}>{w} weken</option>
            ))}
          </select>
        </div>
      </div>
    </ActionForm>
  );
}
