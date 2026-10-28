"use client";

import { startTransition, useActionState, useEffect, useRef } from "react";

export type FormState = { error: string | null; ok?: string | null };

// Thin wrapper around a server action: shows validation errors and confirmations inline,
// keeps the typed values on error, and resets the form after success when asked to.
export function ActionForm({
  action,
  children,
  submitLabel,
  pendingLabel = "Opslaan…",
  className,
  resetOnSuccess = false,
  submitClass = "btn primary",
  footer,
}: {
  action: (state: FormState, form: FormData) => Promise<FormState>;
  children: React.ReactNode;
  submitLabel: string;
  pendingLabel?: string;
  className?: string;
  resetOnSuccess?: boolean;
  submitClass?: string;
  footer?: React.ReactNode;
}) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(action, { error: null, ok: null });
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (resetOnSuccess && state.ok && !state.error) ref.current?.reset();
  }, [state, resetOnSuccess]);
  return (
    <form ref={ref} action={formAction} className={className} onSubmit={(e) => keepValuesOnSubmit(e, formAction)}>
      {state.error && <div className="form-error" role="alert">{state.error}</div>}
      {state.ok && !state.error && <div className="form-ok" role="status">{state.ok}</div>}
      {children}
      <div className="row mt-12">
        <button className={submitClass} disabled={pending}>{pending ? pendingLabel : submitLabel}</button>
        {footer}
      </div>
    </form>
  );
}

// React resets a form after every action, also when validation fails. Submitting through
// startTransition keeps what the user typed; buttons with their own formAction keep the default path.
export function keepValuesOnSubmit(e: React.FormEvent<HTMLFormElement>, run: (fd: FormData) => void) {
  const submitter = (e.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
  if (submitter?.getAttribute("formaction")) return;
  e.preventDefault();
  const fd = new FormData(e.currentTarget, submitter ?? undefined);
  startTransition(() => run(fd));
}

export function ConfirmButton({ action, label, confirm, className = "btn white sm" }: { action: () => Promise<void>; label: string; confirm: string; className?: string }) {
  return (
    <form
      action={action}
      onSubmit={(e) => {
        if (!window.confirm(confirm)) e.preventDefault();
      }}
    >
      <button className={className}>{label}</button>
    </form>
  );
}
