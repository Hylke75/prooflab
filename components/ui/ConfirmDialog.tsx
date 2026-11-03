"use client";

import { useActionState, useEffect, useId, useRef } from "react";
import type { FormState } from "@/components/ui/ActionForm";
import { SavingOverlay } from "@/components/ui/SavingOverlay";

// Een actie die niet terug te draaien is, met eerst een bevestigingsvenster. Gebruikt het native <dialog>
// (showModal): focus gaat naar het venster en blijft erin, Escape en "Annuleren" sluiten het, en daarna keert de
// focus terug naar de knop die het opende.
export function ConfirmDialogForm({
  action,
  triggerLabel,
  triggerClass = "btn primary sm",
  title,
  children,
  confirmLabel,
  pendingLabel = "Bezig…",
}: {
  action: (state: FormState, form: FormData) => Promise<FormState>;
  triggerLabel: string;
  triggerClass?: string;
  title: string;
  children: React.ReactNode;
  confirmLabel: string;
  pendingLabel?: string;
}) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(action, { error: null, ok: null });
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const bodyId = useId();

  // Na afloop (gelukt of mislukt) sluit het venster; de melding staat dan naast de knop.
  useEffect(() => {
    if (state.ok || state.error) dialog.current?.close();
  }, [state]);

  return (
    <div>
      {state.error && <div className="form-error" role="alert">{state.error}</div>}
      {state.ok && !state.error && <div className="form-ok" role="status">{state.ok}</div>}
      {!state.ok && (
        <button type="button" className={triggerClass} onClick={() => dialog.current?.showModal()} disabled={pending}>
          {triggerLabel}
        </button>
      )}
      <dialog ref={dialog} className="modal confirm-dialog" aria-labelledby={titleId} aria-describedby={bodyId}>
        <h2 className="as-h3" id={titleId}>{title}</h2>
        <div id={bodyId}>{children}</div>
        <form action={formAction} className="row mt-12" style={{ justifyContent: "flex-end", gap: 10, flexWrap: "wrap" }}>
          <button type="button" className="btn white" onClick={() => dialog.current?.close()} disabled={pending} autoFocus>
            Annuleren
          </button>
          <button type="submit" className="btn primary" disabled={pending}>
            {pending ? pendingLabel : confirmLabel}
          </button>
        </form>
        <SavingOverlay active={pending} label={pendingLabel} />
      </dialog>
    </div>
  );
}
