"use client";

import { useCallback, useEffect, useId, useRef, useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { searchDossier, type DossierSearchState } from "@/app/app/ideas/[id]/search-actions";
import { highlightSegments, SEARCH_MIN_LENGTH, type SearchHit } from "@/lib/domain/dossier-search";
import { TAB_EVENT } from "@/components/research/source-prefill";
import { Icon } from "@/components/Icon";
import "./search.css";

// Zoeken binnen een dossier (bevindingen, aannames, bronnen en eigen notities). Een knop in de kop van elke
// ideepagina, of de sneltoets "/", opent een venster (native <dialog>: focus blijft erin, Escape sluit). Het
// zoekveld is een combobox: pijltjes kiezen een resultaat, Enter opent het, Home/End springen naar begin/eind.
// Het zoeken zelf gebeurt op de server met de sessie van de gebruiker (app/app/ideas/[id]/search-actions.ts).

const DEBOUNCE_MS = 250;

function Highlighted({ text, words }: { text: string; words: string[] }) {
  return (
    <>
      {highlightSegments(text, words).map((s, i) => (s.match ? <mark key={i}>{s.text}</mark> : <span key={i}>{s.text}</span>))}
    </>
  );
}

// Toetsen die we niet als sneltoets opvangen: tijdens typen in een veld of met een modifier.
function typingTarget(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  return t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName) || !!t.closest("[contenteditable=true]");
}

export function DossierSearch({ ideaId }: { ideaId: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const opener = useRef<HTMLButtonElement>(null);
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<DossierSearchState | null>(null);
  const [active, setActive] = useState(0);
  const [pending, startTransition] = useTransition();
  const [waiting, setWaiting] = useState(false);
  const request = useRef(0);
  const ids = useId();
  const listId = `${ids}-list`;
  const statusId = `${ids}-status`;
  const optionId = (i: number) => `${ids}-opt-${i}`;

  const hits: SearchHit[] = result?.groups.flatMap((g) => g.hits) ?? [];
  const loading = waiting || pending;

  const open = useCallback(() => {
    const d = dialog.current;
    if (!d || d.open) return;
    d.showModal();
    input.current?.focus();
    input.current?.select();
  }, []);
  const close = useCallback(() => dialog.current?.close(), []);

  // Sneltoets "/" (zoals in veel apps), niet tijdens typen en niet als er al een venster open is.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "/" || e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented || typingTarget(e.target)) return;
      if (document.querySelector("dialog[open]")) return;
      e.preventDefault();
      open();
    };
    // Ook te openen vanuit het commandomenu ("Zoek in dit dossier").
    const onEvent = () => open();
    document.addEventListener("keydown", onKey);
    window.addEventListener("prooflab:dossier-search", onEvent);
    return () => {
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("prooflab:dossier-search", onEvent);
    };
  }, [open]);

  // Zoeken met een korte vertraging na het typen; een antwoord op een oudere zoekterm wordt genegeerd.
  const timer = useRef<number | null>(null);
  const changeQuery = (value: string) => {
    setQuery(value);
    if (timer.current != null) window.clearTimeout(timer.current);
    const q = value.trim();
    const nr = ++request.current;
    if (q.length < SEARCH_MIN_LENGTH) {
      setWaiting(false);
      setResult(null);
      return;
    }
    setWaiting(true);
    timer.current = window.setTimeout(() => {
      startTransition(async () => {
        try {
          const r = await searchDossier(ideaId, q);
          if (nr !== request.current) return;
          setResult(r);
          setActive(0);
        } catch {
          if (nr !== request.current) return;
          setResult({ query: q, words: [], groups: [], total: 0, truncated: false, notesAvailable: true, error: "Zoeken lukt nu niet. Controleer je verbinding en probeer het opnieuw." });
        } finally {
          if (nr === request.current) setWaiting(false);
        }
      });
    }, DEBOUNCE_MS);
  };
  useEffect(
    () => () => {
      if (timer.current != null) window.clearTimeout(timer.current);
    },
    [],
  );

  // Het actieve resultaat in beeld houden bij pijltjes.
  useEffect(() => {
    document.getElementById(`${ids}-opt-${active}`)?.scrollIntoView({ block: "nearest" });
  }, [active, ids]);

  const go = (hit: SearchHit) => {
    close();
    const url = new URL(hit.href, window.location.origin);
    if (url.pathname === pathname) {
      // Zelfde pagina: tab wisselen zonder herladen en naar het anker scrollen; een aanname opnieuw selecteren
      // gaat via het adres (de risicokaart leest ?select=).
      const tab = url.searchParams.get("tab");
      if (tab) window.dispatchEvent(new CustomEvent(TAB_EVENT, { detail: { key: tab } }));
      if (url.hash) {
        window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
        window.requestAnimationFrame(() => {
          const el = document.getElementById(decodeURIComponent(url.hash.slice(1)));
          if (!el) return;
          el.scrollIntoView({ block: "start" });
          el.classList.add("search-flash");
          window.setTimeout(() => el.classList.remove("search-flash"), 2000);
        });
        return;
      }
    }
    router.push(hit.href);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    // Escape sluit het venster in één keer. Zonder dit wist Chromium bij een gevuld zoekveld (type="search") eerst
    // alleen de tekst en blijft het venster open; Firefox sluit wel meteen.
    if (e.key === "Escape") {
      e.preventDefault();
      close();
      return;
    }
    if (hits.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => (a + 1) % hits.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => (a - 1 + hits.length) % hits.length);
    } else if (e.key === "Home" && e.ctrlKey) {
      e.preventDefault();
      setActive(0);
    } else if (e.key === "End" && e.ctrlKey) {
      e.preventDefault();
      setActive(hits.length - 1);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const h = hits[active];
      if (h) go(h);
    }
  };

  const q = query.trim();
  const status = q.length < SEARCH_MIN_LENGTH
    ? `Typ minstens ${SEARCH_MIN_LENGTH} tekens.`
    : loading
      ? "Zoeken…"
      : result?.error
        ? result.error
        : result && result.total === 0
          ? `Geen resultaten voor “${q}”.`
          : result
            ? `${result.total} ${result.total === 1 ? "resultaat" : "resultaten"}${result.truncated ? " (de eerste 30; maak je zoekterm specifieker)" : ""}. Kies met de pijltjes en open met Enter.`
            : "";

  let index = -1;
  return (
    <>
      <button ref={opener} type="button" className="btn white sm dossier-search-open no-print" onClick={open} aria-keyshortcuts="/" aria-haspopup="dialog">
        <Icon name="search" size="sm" /> <span>Zoeken in dossier</span> <kbd aria-hidden="true">/</kbd>
      </button>
      <dialog
        ref={dialog}
        className="modal dossier-search"
        aria-labelledby={`${ids}-title`}
        onClose={() => opener.current?.focus()}
        onClick={(e) => {
          // Klik op de achtergrond (buiten het venster) sluit; de inhoud zit in een eigen blok, dus een klik in het
          // venster zelf heeft nooit de dialog als doel.
          if (e.target === dialog.current) close();
        }}
      >
        <div className="dossier-search-inner">
        <div className="dossier-search-head">
          <h2 className="as-h3" id={`${ids}-title`}>Zoeken in dit dossier</h2>
          <button type="button" className="dossier-search-close" onClick={close} aria-label="Zoeken sluiten">
            <Icon name="close" size="sm" />
          </button>
        </div>
        <div className="dossier-search-field">
          <Icon name="search" />
          <input
            ref={input}
            type="search"
            className="field"
            value={query}
            onChange={(e) => changeQuery(e.target.value)}
            onKeyDown={onKeyDown}
            maxLength={100}
            autoComplete="off"
            spellCheck={false}
            placeholder="Bevindingen, aannames, bronnen, notities…"
            role="combobox"
            aria-label="Zoekterm"
            aria-expanded={hits.length > 0}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={hits.length > 0 ? optionId(active) : undefined}
            aria-describedby={statusId}
          />
        </div>
        <p className="dossier-search-status" id={statusId} role="status" aria-live="polite">
          {loading && <span className="dossier-search-spinner" aria-hidden="true" />}
          {status}
        </p>
        <div className="dossier-search-results" id={listId} role="listbox" aria-label="Zoekresultaten">
          {result?.groups.map((g) => (
            <div key={g.kind} role="group" aria-labelledby={`${ids}-g-${g.kind}`} className="dossier-search-group">
              <div className="eyebrow" id={`${ids}-g-${g.kind}`} role="presentation">
                {g.label} · {g.hits.length}
              </div>
              {g.hits.map((h) => {
                index++;
                const i = index;
                return (
                  <div
                    key={`${h.kind}-${h.id}`}
                    id={optionId(i)}
                    role="option"
                    aria-selected={i === active}
                    className={`dossier-search-hit${i === active ? " active" : ""}`}
                    onMouseMove={() => setActive(i)}
                    onClick={() => go(h)}
                  >
                    <strong>
                      <Highlighted text={h.title} words={result.words} />
                    </strong>
                    {(h.detail || h.badge) && (
                      <small>
                        {h.badge && <span className="pill gray">{h.badge}</span>}
                        {h.detail && <Highlighted text={h.detail} words={result.words} />}
                      </small>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
        {result && !result.notesAvailable && <p className="tiny">Eigen notities zijn in deze omgeving nog niet beschikbaar; daarin is niet gezocht.</p>}
        <p className="tiny dossier-search-foot">Zoekt alleen in wat jij in dit dossier mag zien. Letterlijke citaten uit gesprekken en persoonlijke bronfragmenten worden niet doorzocht.</p>
        </div>
      </dialog>
    </>
  );
}
