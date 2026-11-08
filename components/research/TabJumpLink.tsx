"use client";

import { TAB_EVENT } from "./source-prefill";

// Een link die op Marktverkenning naar een tab en een anker springt zonder de pagina te herladen (de tabs luisteren
// naar TAB_EVENT). Zonder JavaScript werkt de gewone href (?tab=…#anker).
export function TabJumpLink({ tab, anchor, href, className, children }: { tab: string; anchor: string; href: string; className?: string; children: React.ReactNode }) {
  return (
    <a
      className={className}
      href={href}
      onClick={(e) => {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent(TAB_EVENT, { detail: { key: tab } }));
        window.requestAnimationFrame(() => {
          const el = document.getElementById(anchor);
          if (!el) return;
          el.scrollIntoView({ block: "start" });
          el.querySelector<HTMLElement>("input, textarea, select")?.focus({ preventScroll: true });
        });
      }}
    >
      {children}
    </a>
  );
}
