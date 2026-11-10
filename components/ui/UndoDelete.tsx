"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import "./undo.css";

// Ongedaan maken in plaats van een bevestigingsvraag (NN/g: bevestigen bij routineacties wordt weggeklikt; ongedaan
// maken is veiliger). Na een klik wordt het item (het dichtstbijzijnde [data-undo-item]) grijs en doorgestreept en
// telt een korte teller af; pas daarna gaat het verwijderen naar de server. Wie de pagina verlaat terwijl de teller
// loopt, verwijdert direct. Gebruik dit alleen voor acties die het team zelf kan herstellen, niet voor publiceren,
// delen of geld.
export function UndoDeleteButton({
  action,
  label = "Verwijderen",
  what,
  seconds = 6,
}: {
  // Een (gebonden) server action; wordt aangeroepen met een lege FormData.
  action: (form: FormData) => unknown;
  label?: string;
  // Wat er verwijderd wordt, voor de melding: "Bron", "Bevinding", "Aanname".
  what: string;
  seconds?: number;
}) {
  const [left, setLeft] = useState<number | null>(null);
  const [, start] = useTransition();
  const ref = useRef<HTMLSpanElement>(null);
  const fired = useRef(false);

  const item = () => ref.current?.closest<HTMLElement>("[data-undo-item]") ?? null;
  const fire = useCallback(() => {
    if (fired.current) return;
    fired.current = true;
    start(() => {
      void action(new FormData());
    });
  }, [action]);

  useEffect(() => {
    if (left === null) return;
    if (left <= 0) {
      fire();
      return;
    }
    const t = window.setTimeout(() => setLeft((l) => (l === null ? l : l - 1)), 1000);
    return () => window.clearTimeout(t);
  }, [left, fire]);

  // Pagina verlaten tijdens het aftellen: dan toch verwijderen (de gebruiker koos ervoor).
  useEffect(() => {
    if (left === null) return;
    const flush = () => fire();
    window.addEventListener("pagehide", flush);
    return () => window.removeEventListener("pagehide", flush);
  }, [left, fire]);

  const begin = () => {
    item()?.classList.add("is-deleting");
    setLeft(seconds);
  };
  const undo = () => {
    item()?.classList.remove("is-deleting");
    setLeft(null);
  };

  if (left === null)
    return (
      <span ref={ref}>
        <button type="button" className="text-link undo-delete" onClick={begin}>
          {label}
        </button>
      </span>
    );
  return (
    <span ref={ref} className="undo-bar" role="status">
      {left > 0 ? `${what} wordt verwijderd over ${left} s.` : `${what} verwijderd.`}{" "}
      {left > 0 && (
        <button type="button" className="text-link" onClick={undo} autoFocus>
          Ongedaan maken
        </button>
      )}
    </span>
  );
}
