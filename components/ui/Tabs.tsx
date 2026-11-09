"use client";

import { useRef, type KeyboardEvent, type ReactNode } from "react";

// Gecontroleerde, toegankelijke tabs (WAI-ARIA tabs-patroon): pijltjes links/rechts, Home en End verplaatsen de focus
// en kiezen de tab; alleen de actieve tab staat in de tabvolgorde. Zelfde vormgeving als de onderzoekstabs (.tabs/.tab).
// Panelen worden verborgen met `hidden` en blijven gemount, zodat ingevulde formuliervelden behouden blijven.
// Een tab kan een kleine aanduiding dragen (fouten of iets om te controleren), met een uitgesproken tekst.

export type TabBadge = { text: string; tone: "error" | "check"; spoken: string };
export type TabItem = { key: string; label: string; badge?: TabBadge | null };

export function TabList({ tabs, active, onSelect, idPrefix, label, className = "" }: { tabs: TabItem[]; active: string; onSelect: (key: string) => void; idPrefix: string; label: string; className?: string }) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    const last = tabs.length - 1;
    const to = e.key === "ArrowRight" ? (i === last ? 0 : i + 1) : e.key === "ArrowLeft" ? (i === 0 ? last : i - 1) : e.key === "Home" ? 0 : e.key === "End" ? last : null;
    if (to === null) return;
    e.preventDefault();
    onSelect(tabs[to].key);
    refs.current[to]?.focus();
  };
  return (
    <div className={`tabs ${className}`.trim()} role="tablist" aria-label={label}>
      {tabs.map((t, i) => {
        const selected = t.key === active;
        return (
          <button
            key={t.key}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="tab"
            id={`${idPrefix}-tab-${t.key}`}
            aria-selected={selected}
            aria-controls={`${idPrefix}-panel-${t.key}`}
            tabIndex={selected ? 0 : -1}
            className={`tab${selected ? " active" : ""}`}
            data-tab={t.key}
            onClick={() => onSelect(t.key)}
            onKeyDown={(e) => onKeyDown(e, i)}
          >
            {t.label}
            {t.badge && (
              <>
                <span className={`tab-badge ${t.badge.tone}`} aria-hidden="true">{t.badge.text}</span>
                <span className="sr-only">, {t.badge.spoken}</span>
              </>
            )}
          </button>
        );
      })}
    </div>
  );
}

export function TabPanel({ idPrefix, tabKey, active, children }: { idPrefix: string; tabKey: string; active: boolean; children: ReactNode }) {
  return (
    <div role="tabpanel" id={`${idPrefix}-panel-${tabKey}`} aria-labelledby={`${idPrefix}-tab-${tabKey}`} hidden={!active} tabIndex={0} className="tc-panel" data-panel={tabKey}>
      {children}
    </div>
  );
}
