"use client";

import { useEffect, useState } from "react";
import { createPortal, useFormStatus } from "react-dom";

// Full-screen "bezig met opslaan" overlay with a spinner and a running bar. It only appears when saving takes
// longer than a moment (DELAY_MS), so quick saves don't flash. It blocks clicks while the server works, so
// nobody submits twice or leaves halfway, and it announces itself to screen readers.
// Rendered in a portal on <body>: inside a card with transform, filter or containment, `position: fixed` would be
// relative to that card instead of the screen, so the window would sit off-centre with only part of the page dimmed.
const DELAY_MS = 350;

export function SavingOverlay({ active, label = "Bezig met opslaan…" }: { active: boolean; label?: string }) {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (!active) return;
    const t = window.setTimeout(() => setShown(true), DELAY_MS);
    return () => {
      window.clearTimeout(t);
      setShown(false);
    };
  }, [active]);
  if (!active || !shown || typeof document === "undefined") return null;
  return createPortal(
    <div className="saving-overlay" role="status" aria-live="polite" aria-busy="true">
      <div className="saving-card">
        <span className="saving-spinner" aria-hidden="true" />
        <p className="saving-label">{label}</p>
        <div className="saving-bar" aria-hidden="true"><span /></div>
        <p className="tiny">Een moment geduld, sluit deze pagina niet.</p>
      </div>
    </div>,
    document.body,
  );
}

// For plain <form action={serverAction}> forms: place inside the form.
export function FormPendingOverlay({ label }: { label?: string }) {
  const { pending } = useFormStatus();
  return <SavingOverlay active={pending} label={label} />;
}
