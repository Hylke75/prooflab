"use client";

import { useState } from "react";

// Copies a text to the clipboard and says so (also to screen readers).
export function CopyButton({ text, label = "Kopieer", className = "btn white sm", describedBy }: { text: string; label?: string; className?: string; describedBy?: string }) {
  const [state, setState] = useState<"idle" | "ok" | "fail">("idle");
  return (
    <>
      <button
        type="button"
        className={className}
        aria-describedby={describedBy}
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(text);
            setState("ok");
          } catch {
            setState("fail");
          }
          setTimeout(() => setState("idle"), 2500);
        }}
      >
        {state === "ok" ? "Gekopieerd ✓" : label}
      </button>
      <span className="sr-only" role="status">{state === "ok" ? "Gekopieerd naar het klembord." : state === "fail" ? "Kopiëren lukte niet; selecteer de tekst en kopieer handmatig." : ""}</span>
    </>
  );
}
