"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { buildCommands, filterCommands, type Command } from "@/lib/domain/commands";
import "./command-menu.css";

export const COMMAND_MENU_EVENT = "prooflab:command-menu";
export const DOSSIER_SEARCH_EVENT = "prooflab:dossier-search";

// Commandomenu (Linear-patroon, docs/ONDERZOEK_GEBRUIKSVRIENDELIJKHEID.md principe 15): Ctrl+K of ⌘K, of de knop
// "Snel naar…" bovenaan. Een native <dialog> (focus blijft binnen, Escape sluit) met een combobox: typen filtert,
// pijltjes kiezen, Enter opent. Voor wie liever klikt verandert er niets: alles staat ook gewoon in het menu.
export function CommandMenu({ ideas, isConsultant, isOwner }: { ideas: { id: string; title: string }[]; isConsultant: boolean; isOwner: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const ids = useId();
  const listId = `${ids}-list`;
  const optionId = (i: number) => `${ids}-opt-${i}`;

  const ideaId = pathname.match(/^\/app\/ideas\/([0-9a-f-]{36})/i)?.[1] ?? null;
  const all = useMemo(() => buildCommands({ ideaId, ideas, isConsultant, isOwner }), [ideaId, ideas, isConsultant, isOwner]);
  const hits = useMemo(() => filterCommands(all, query).slice(0, 30), [all, query]);

  const open = useCallback(() => {
    const d = dialog.current;
    if (!d || d.open) return;
    setQuery("");
    setActive(0);
    d.showModal();
    input.current?.focus();
  }, []);
  const close = useCallback(() => dialog.current?.close(), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== "k" || !(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return;
      e.preventDefault();
      if (dialog.current?.open) close();
      else if (!document.querySelector("dialog[open]")) open();
    };
    const onOpen = () => open();
    document.addEventListener("keydown", onKey);
    window.addEventListener(COMMAND_MENU_EVENT, onOpen);
    return () => {
      document.removeEventListener("keydown", onKey);
      window.removeEventListener(COMMAND_MENU_EVENT, onOpen);
    };
  }, [open, close]);

  const run = (c: Command | undefined) => {
    if (!c) return;
    close();
    if (c.action === "dossier-search") window.setTimeout(() => window.dispatchEvent(new Event(DOSSIER_SEARCH_EVENT)), 0);
    else if (c.href) router.push(c.href);
  };

  const onInputKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => (hits.length ? (a + 1) % hits.length : 0));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => (hits.length ? (a - 1 + hits.length) % hits.length : 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      run(hits[active]);
    }
  };

  return (
    <dialog ref={dialog} className="command-menu" aria-label="Snel naar" onClick={(e) => e.target === dialog.current && close()}>
      <div className="command-box">
        <input
          ref={input}
          className="field command-input"
          type="text"
          role="combobox"
          aria-expanded="true"
          aria-controls={listId}
          aria-activedescendant={hits[active] ? optionId(active) : undefined}
          aria-autocomplete="list"
          aria-label="Waar wil je heen? Typ om te zoeken"
          placeholder="Waar wil je heen? Bijv. testkaart, bronnen, rapport…"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
          }}
          onKeyDown={onInputKey}
        />
        <ul id={listId} role="listbox" className="command-list" aria-label="Resultaten">
          {hits.length === 0 && <li className="command-empty">Niets gevonden. Probeer een ander woord, of zoek met &ldquo;Zoek in dit dossier&rdquo; in de inhoud.</li>}
          {hits.map((c, i) => {
            // Groepkopje alleen waar de groep wisselt.
            const head = i === 0 || hits[i - 1].group !== c.group ? c.group : null;
            return (
              <li key={c.id} role="presentation">
                {head && <div className="command-group" aria-hidden="true">{head}</div>}
                <div
                  id={optionId(i)}
                  role="option"
                  aria-selected={i === active}
                  className={`command-item${i === active ? " active" : ""}`}
                  onMouseMove={() => setActive(i)}
                  onClick={() => run(c)}
                >
                  {c.label}
                </div>
              </li>
            );
          })}
        </ul>
        <p className="command-help tiny">
          <kbd>↑</kbd> <kbd>↓</kbd> kiezen · <kbd>Enter</kbd> openen · <kbd>Esc</kbd> sluiten · overal te openen met <kbd>Ctrl</kbd>+<kbd>K</kbd> (Mac: <kbd>⌘</kbd>+<kbd>K</kbd>)
        </p>
      </div>
    </dialog>
  );
}

// Knop in de bovenbalk: opent het commandomenu (voor wie de sneltoets niet kent, en op een telefoon).
export function CommandMenuButton() {
  return (
    <button type="button" className="command-open" onClick={() => window.dispatchEvent(new Event(COMMAND_MENU_EVENT))} aria-label="Snel naar… (Ctrl+K)" title="Snel naar… (Ctrl+K)">
      <span className="command-open-label">Snel naar…</span>
      <kbd aria-hidden="true">Ctrl K</kbd>
    </button>
  );
}
