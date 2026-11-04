"use client";

import { useEffect } from "react";

// Een link naar een anker (bijv. #claim-… uit "Zoeken in dossier") kan in een ingeklapt <details> vallen. Dit opent de
// omliggende uitklappers en scrolt ernaartoe, bij laden en bij elke wijziging van het anker.
export function OpenOnHash() {
  useEffect(() => {
    const open = () => {
      const id = decodeURIComponent(window.location.hash.slice(1));
      if (!id) return;
      const el = document.getElementById(id);
      if (!el) return;
      let parent = el.parentElement?.closest("details");
      let opened = false;
      while (parent) {
        if (!parent.open) {
          parent.open = true;
          opened = true;
        }
        parent = parent.parentElement?.closest("details") ?? null;
      }
      if (opened) el.scrollIntoView({ block: "start" });
    };
    open();
    window.addEventListener("hashchange", open);
    return () => window.removeEventListener("hashchange", open);
  }, []);
  return null;
}
