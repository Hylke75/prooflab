"use client";

import { useEffect, useState } from "react";
import { Icon } from "@/components/Icon";

// Ronde "terug naar boven"-knop rechtsonder; verschijnt pas op lange pagina's na een flink stuk scrollen.
// Respecteert prefers-reduced-motion (dan direct naar boven, zonder animatie).
export function BackToTop() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const onScroll = () => setVisible(window.scrollY > 640);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  if (!visible) return null;

  const toTop = () => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.scrollTo({ top: 0, behavior: reduce ? "auto" : "smooth" });
    document.getElementById("main")?.focus({ preventScroll: true });
  };

  return (
    <button type="button" className="back-to-top" onClick={toTop} aria-label="Terug naar boven" title="Terug naar boven">
      <Icon name="arrow" />
    </button>
  );
}
