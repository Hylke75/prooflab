"use client";

import { createContext, useContext, useId, useLayoutEffect, useOptimistic, useRef, useState, useTransition } from "react";
import { isShown, type DetailLevel } from "@/lib/view-mode";
import "./view-mode.css";

// Fase 1 · punt 1: de stand van het dossier (Snel of Grondig) voor clientcomponenten.
//
// - <ViewModeProvider> staat in PageFrame en krijgt de opgeslagen stand van de server (getViewMode).
// - useViewMode() geeft de stand, of de gebruiker hem mag wisselen, en de wisselfunctie (optimistisch: de pagina
//   klapt meteen in of uit; de server bewaart de stand en ververst de pagina).
// - <Detail only="thorough"> toont iets alleen in Grondig; in Snel staat op de eerste verborgen plek van de pagina
//   één hint "Meer tonen in Grondig".
// - useFirstOnPage(sleutel) bepaalt het eerste exemplaar op de pagina (voor de hint en voor <Explain>).
//
// Zonder provider (bijv. buiten een dossier of in een test) geldt Grondig: alles blijft zichtbaar.

export type SetLevelResult = { error: string | null };
type SetLevelAction = (level: DetailLevel) => Promise<SetLevelResult>;

type OnceStore = {
  claims: Map<string, string>;
  elements: Map<string, Map<string, HTMLElement>>;
  listeners: Map<string, Set<() => void>>;
};

type Ctx = {
  level: DetailLevel;
  canWrite: boolean;
  pending: boolean;
  error: string | null;
  setLevel: (level: DetailLevel) => void;
  once: OnceStore;
};

const ViewModeContext = createContext<Ctx | null>(null);

export function ViewModeProvider({
  level,
  canWrite,
  action,
  children,
}: {
  level: DetailLevel;
  canWrite: boolean;
  action?: SetLevelAction;
  children: React.ReactNode;
}) {
  const [shown, setShown] = useOptimistic(level);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  // Eén register per pagina (PageFrame geeft de provider per pagina een eigen key).
  const [once] = useState<OnceStore>(() => ({ claims: new Map(), elements: new Map(), listeners: new Map() }));
  const setLevel = (next: DetailLevel) => {
    if (!canWrite || !action || next === shown) return;
    setError(null);
    start(async () => {
      setShown(next);
      const res = await action(next);
      if (res.error) setError(res.error);
    });
  };
  return <ViewModeContext.Provider value={{ level: shown, canWrite, pending, error, setLevel, once }}>{children}</ViewModeContext.Provider>;
}

export function useViewMode(): { level: DetailLevel; canWrite: boolean; pending: boolean; error: string | null; setLevel: (level: DetailLevel) => void } {
  const ctx = useContext(ViewModeContext);
  if (!ctx) return { level: "thorough", canWrite: false, pending: false, error: null, setLevel: () => undefined };
  return ctx;
}

// "Eén keer per pagina": het eerste exemplaar met deze sleutel (in de volgorde van de pagina) krijgt true.
// Tijdens het renderen (ook op de server) telt de volgorde van renderen; na het laden de volgorde in het document,
// zodat een onderdeel dat later verschijnt of verdwijnt (bijv. een andere aanname kiezen) de juiste uitkomst geeft.
export function useFirstOnPage(key: string): { first: boolean; ref: React.RefObject<HTMLSpanElement | null> } {
  const ctx = useContext(ViewModeContext);
  const id = useId();
  const ref = useRef<HTMLSpanElement>(null);
  const [domFirst, setDomFirst] = useState<boolean | null>(null);
  const store = ctx?.once;
  if (store && !store.claims.has(key)) store.claims.set(key, id);
  const renderFirst = store ? store.claims.get(key) === id : true;
  useLayoutEffect(() => {
    const el = ref.current;
    if (!store || !el) return;
    const els = store.elements.get(key) ?? new Map<string, HTMLElement>();
    els.set(id, el);
    store.elements.set(key, els);
    const listeners = store.listeners.get(key) ?? new Set<() => void>();
    const update = () => {
      let earliest: [string, HTMLElement] | null = null;
      for (const entry of store.elements.get(key) ?? []) {
        if (!earliest || entry[1].compareDocumentPosition(earliest[1]) & Node.DOCUMENT_POSITION_FOLLOWING) earliest = entry;
      }
      setDomFirst(earliest?.[0] === id);
    };
    listeners.add(update);
    store.listeners.set(key, listeners);
    store.listeners.get(key)?.forEach((fn) => fn());
    return () => {
      listeners.delete(update);
      store.elements.get(key)?.delete(id);
      if (store.claims.get(key) === id) store.claims.delete(key);
      store.listeners.get(key)?.forEach((fn) => fn());
    };
  }, [store, key, id]);
  return { first: domFirst ?? renderFirst, ref };
}

// Eén hint per pagina op de eerste plek waar Snel iets verbergt. Schrijvers kunnen meteen naar Grondig;
// opdrachtgevers zien alleen dat het dossier op Snel staat (zij wisselen niet).
export function MoreInThorough() {
  const { level, canWrite, setLevel, pending } = useViewMode();
  const { first, ref } = useFirstOnPage("meer-in-grondig");
  if (level !== "quick") return null;
  return (
    <span ref={ref} className="more-in-thorough-anchor">
      {first && (
        <span className="more-in-thorough no-print" role="note">
          {canWrite ? (
            <>
              Snel toont de kern; berekeningen en details staan in Grondig.{" "}
              <button type="button" className="text-link" onClick={() => setLevel("thorough")} disabled={pending}>
                Meer tonen in Grondig
              </button>
            </>
          ) : (
            <>Dit dossier staat op Snel: berekeningen en details zijn ingeklapt. De uitkomsten zijn dezelfde als in Grondig.</>
          )}
        </span>
      )}
    </span>
  );
}

// Alleen in de gekozen stand zichtbaar (standaard: alleen in Grondig). In Snel komt er op de eerste verborgen plek
// van de pagina één hint, tenzij hint={false}.
export function Detail({ only = "thorough", hint = true, children }: { only?: DetailLevel; hint?: boolean; children: React.ReactNode }) {
  const { level } = useViewMode();
  if (isShown(level, only)) return <>{children}</>;
  return hint && level === "quick" ? <MoreInThorough /> : null;
}
