"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { TAB_EVENT } from "./source-prefill";

// Tabs switch instantly on the client (like the reference design) and keep the URL in sync.
// lazy (gebruikerstest A10): zware tabs worden pas opgebouwd zodra ze voor het eerst open gaan, en blijven daarna staan.
// Wisselen blijft direct; alleen de eerste keer bouwt de browser de inhoud op.
// heads (voorstel "ProofLab eenvoudiger"): per tab een eigen kop (de taakkop van die taak), boven de tabbalk.
export function Tabs({ tabs, initial, lazy = [], heads, children }: { tabs: { key: string; label: string }[]; initial: string; lazy?: string[]; heads?: Record<string, React.ReactNode>; children: React.ReactNode[] }) {
  const [active, setActive] = useState(tabs.some((t) => t.key === initial) ? initial : tabs[0].key);
  const [seen, setSeen] = useState<ReadonlySet<string>>(() => new Set([active]));
  // Een link naar een ander tabblad (bijv. de taakstappen in de kop) geeft een nieuwe initial: volg die. Een verversing
  // na opslaan geeft dezelfde initial en laat de tab (en meldingen in formulieren) staan.
  const lastInitial = useRef(initial);
  useEffect(() => {
    if (initial === lastInitial.current) return;
    lastInitial.current = initial;
    if (tabs.some((t) => t.key === initial)) {
      setActive(initial);
      setSeen((s) => (s.has(initial) ? s : new Set([...s, initial])));
    }
  }, [initial, tabs]);
  const select = useCallback((key: string) => {
    setActive(key);
    setSeen((s) => (s.has(key) ? s : new Set([...s, key])));
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
      {heads &&
        tabs.map((t) => (
          <div key={t.key} hidden={active !== t.key} data-head={t.key}>
            {heads[t.key]}
          </div>
        ))}
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
          {!lazy.includes(t.key) || seen.has(t.key) ? children[i] : null}
        </div>
      ))}
    </>
  );
}
