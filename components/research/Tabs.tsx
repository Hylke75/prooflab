"use client";

import { useState } from "react";

// Tabs switch instantly on the client (like the reference design) and keep the URL in sync.
export function Tabs({ tabs, initial, children }: { tabs: { key: string; label: string }[]; initial: string; children: React.ReactNode[] }) {
  const [active, setActive] = useState(tabs.some((t) => t.key === initial) ? initial : tabs[0].key);
  const select = (key: string) => {
    setActive(key);
    const url = new URL(window.location.href);
    url.searchParams.set("tab", key);
    window.history.replaceState(null, "", url);
  };
  return (
    <>
      <div className="tabs" role="tablist" aria-label="Onderzoeksonderdelen">
        {tabs.map((t) => (
          <button
            key={t.key}
            role="tab"
            id={`tab-${t.key}`}
            aria-selected={active === t.key}
            aria-controls={`panel-${t.key}`}
            className={`tab${active === t.key ? " active" : ""}`}
            onClick={() => select(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tabs.map((t, i) => (
        <div key={t.key} role="tabpanel" id={`panel-${t.key}`} aria-labelledby={`tab-${t.key}`} className={`tab-panel${active === t.key ? " active" : ""}`}>
          {children[i]}
        </div>
      ))}
    </>
  );
}
