"use client";

import { Icon } from "@/components/Icon";
import { useShell } from "./ShellProvider";

export function Topbar({ crumbs, initials, badge }: { crumbs: string[]; initials: string; badge?: string }) {
  const { openSidebar } = useShell();
  return (
    <header className="topbar">
      <div style={{ display: "flex", alignItems: "center", gap: 13 }}>
        <button className="round-btn mobile-menu" onClick={openSidebar} aria-label="Open navigatie">
          <Icon name="menu" />
        </button>
        <div className="crumb">
          {crumbs.slice(0, -1).map((c, i) => (
            <span key={i} style={{ display: "contents" }}>
              <span>{c}</span>
              <span>/</span>
            </span>
          ))}
          <strong>{crumbs[crumbs.length - 1]}</strong>
        </div>
      </div>
      <div className="top-actions">
        {badge && <span className="demo-ribbon">{badge}</span>}
        <a className="round-btn" href="/app/help" aria-label="Uitleg over ProofLab">
          <Icon name="info" />
        </a>
        <form action="/auth/signout" method="post">
          <button className="top-avatar" style={{ border: 0 }} aria-label="Uitloggen" title="Uitloggen">
            {initials}
          </button>
        </form>
      </div>
    </header>
  );
}
