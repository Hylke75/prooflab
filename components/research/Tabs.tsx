"use client";

import { useCallback, useEffect, useState } from "react";
import { TAB_EVENT } from "./source-prefill";

// Tabs switch instantly on the client (like the reference design) and keep the URL in sync.
export function Tabs({ tabs, initial, children }: { tabs: { key: string; label: string }[]; initial: string; children: React.ReactNode[] }) {
  const [active, setActive] = useState(tabs.some((t) => t.key === initial) ? initial : tabs[0].key);
  const select = useCallback((key: string) => {
    setActive(key);
    const url = new URL(window.location.href);
    url.searchParams.set("tab", key);
    window.history.replaceState(null, "", url);
  }, []);
  // Andere onderdelen (bijv. "Voeg toe als bron") kunnen naar een tab springen zonder paginaverlies.
  useEffect(() => {
    const onTab = (e: Event) => {
      const key = (e as CustomEvent<{ key?: string }>).detail?.key;
      if (key && tabs.some((t) => t.key === key)) select(key);
    };
    window.addEventListener(TAB_EVENT, onTab);
    return () => window.removeEventListener(TAB_EVENT, onTab);
  }, [tabs, select]);
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
