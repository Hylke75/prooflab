"use client";
import "./undo.css";

import { useId, useState } from "react";

// "Waarom vragen we dit?" bij een veld (TurboTax, GOV.UK): korte uitleg op de plek zelf, pas zichtbaar als je erom
// vraagt. Een knop met aria-expanded; geen tooltip, zodat het ook op een telefoon en met een schermlezer werkt.
export function Why({ children, label = "Waarom vragen we dit?" }: { children: React.ReactNode; label?: string }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <span className="why">
      <button type="button" className="why-toggle" aria-expanded={open} aria-controls={id} onClick={() => setOpen((v) => !v)}>
        {label}
      </button>
      <span id={id} className="why-text" hidden={!open}>
        {children}
      </span>
    </span>
  );
}
