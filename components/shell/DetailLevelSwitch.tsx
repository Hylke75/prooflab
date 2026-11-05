"use client";

import { useId, useRef } from "react";
import { useViewMode } from "@/components/shell/ViewMode";
import { DETAIL_LEVEL_KEYS, DETAIL_LEVELS, type DetailLevel } from "@/lib/view-mode";

// Fase 1 · punt 1: "Snel | Grondig" in de balk boven elke dossierpagina, naast Zoeken en Vraag de AI.
// Een radiogroep (pijltjestoetsen wisselen, één tabstop), knoppen van minstens 44 px. Alleen wie mag schrijven
// wisselt; opdrachtgevers zien de stand van het dossier als label. De stand is alleen weergave.
export function DetailLevelSwitch() {
  const { level, canWrite, setLevel, pending, error } = useViewMode();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const labelId = useId();
  const keys: readonly DetailLevel[] = DETAIL_LEVEL_KEYS;
  if (!canWrite) {
    return (
      <span className="pill gray detail-level-readonly" title={DETAIL_LEVELS[level].explain} data-testid="weergave-stand">
        Weergave: {DETAIL_LEVELS[level].label}
      </span>
    );
  }
  const onKey = (e: React.KeyboardEvent, i: number) => {
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(e.key)) return;
    e.preventDefault();
    const back = e.key === "ArrowLeft" || e.key === "ArrowUp";
    const next = e.key === "Home" ? 0 : e.key === "End" ? keys.length - 1 : (i + (back ? -1 : 1) + keys.length) % keys.length;
    refs.current[next]?.focus();
    setLevel(keys[next]);
  };
  return (
    <div className="detail-level">
      <span id={labelId} className="sr-only">Weergave van dit dossier</span>
      <div className="detail-level-switch" role="radiogroup" aria-labelledby={labelId} aria-busy={pending || undefined}>
        {keys.map((k, i) => (
          <button
            key={k}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={level === k}
            tabIndex={level === k ? 0 : -1}
            className={level === k ? "active" : undefined}
            title={DETAIL_LEVELS[k].explain}
            onClick={() => setLevel(k)}
            onKeyDown={(e) => onKey(e, i)}
          >
            {DETAIL_LEVELS[k].label}
          </button>
        ))}
      </div>
      {error && (
        <p className="field-error detail-level-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
