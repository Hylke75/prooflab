"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { GLOSSARY, type GlossaryKey } from "@/lib/glossary";
import "./term.css";

// Uitlegtooltip bij een vakterm: <Term k="hoofdtest">hoofdtest</Term>. De tekst komt uit lib/glossary.ts.
//
// - Gestippelde onderstreping; de term zelf is focusbaar (Tab) en heeft de uitleg als aria-describedby.
// - Opent bij hover (muis), bij focus (toetsenbord) en bij een tik (touch: tik opent, nog een tik sluit).
// - Escape, een tik of klik erbuiten en het verlaten van de focus sluiten hem. De muis kan over de tooltip zelf
//   bewegen zonder dat hij verdwijnt (WCAG 1.4.13).
// - De zichtbare tooltip staat in een portal met position: fixed: geen layoutverschuiving, niet afgeknipt door
//   kaarten met overflow, en hij past binnen 390 px (breedte begrensd op het scherm, links/rechts 12 px marge).
// - De beschrijving voor schermlezers (aria-describedby) is een verborgen element in een portal: zo telt ze niet mee
//   in de naam of tekst van het label, de kop of de alinea waar de term in staat (labels als "Het klopt als ≥ (%)"
//   blijven gelijk, en ook kopiëren of printen geeft alleen de term).
// - Een klik op de term binnen een <label> of <summary> zet geen vinkje en klapt niets open (preventDefault).
const noopSubscribe = () => () => {};

export function Term({ k, children }: { k: GlossaryKey; children?: React.ReactNode }) {
  const entry = GLOSSARY[k];
  const descId = useId();
  const tipId = useId();
  const [open, setOpen] = useState(false);
  // Pas na het laden in de browser bestaat document.body voor de portals.
  const mounted = useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );
  const [pos, setPos] = useState<{ left: number; top: number; above: boolean } | null>(null);
  const trigger = useRef<HTMLSpanElement>(null);
  const tip = useRef<HTMLDivElement>(null);
  const closeTimer = useRef<number | null>(null);
  // Bij een tik volgt op pointerdown eerst focus en dan click: de focus mag de tooltip dan niet al openen,
  // anders sluit de click hem meteen weer.
  const touching = useRef(false);

  const cancelClose = useCallback(() => {
    if (closeTimer.current != null) window.clearTimeout(closeTimer.current);
    closeTimer.current = null;
  }, []);
  const show = useCallback(() => {
    cancelClose();
    setOpen(true);
  }, [cancelClose]);
  const hide = useCallback(() => {
    cancelClose();
    setOpen(false);
    setPos(null);
  }, [cancelClose]);
  const hideSoon = useCallback(() => {
    cancelClose();
    closeTimer.current = window.setTimeout(() => {
      setOpen(false);
      setPos(null);
    }, 120);
  }, [cancelClose]);

  // Plaats onder de term, of erboven als er onder te weinig ruimte is; horizontaal binnen het scherm.
  const place = useCallback(() => {
    const t = trigger.current;
    const b = tip.current;
    if (!t || !b) return;
    const r = t.getBoundingClientRect();
    const vw = document.documentElement.clientWidth;
    const vh = window.innerHeight;
    const w = b.offsetWidth;
    const h = b.offsetHeight;
    const gap = 8;
    const margin = 12;
    const left = Math.max(margin, Math.min(r.left + r.width / 2 - w / 2, vw - w - margin));
    const above = r.bottom + gap + h > vh - margin && r.top - gap - h >= margin;
    setPos({ left, top: above ? r.top - gap - h : r.bottom + gap, above });
  }, []);

  useLayoutEffect(() => {
    if (open) place();
  }, [open, place]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        // Alleen de tooltip sluiten, niet ook een venster of lade waarin de term staat.
        e.preventDefault();
        e.stopPropagation();
        hide();
      }
    };
    const onDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (trigger.current?.contains(target) || tip.current?.contains(target)) return;
      hide();
    };
    const onMove = () => place();
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("pointerdown", onDown, true);
    window.addEventListener("scroll", onMove, true);
    window.addEventListener("resize", onMove);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("scroll", onMove, true);
      window.removeEventListener("resize", onMove);
    };
  }, [open, hide, place]);

  useEffect(() => cancelClose, [cancelClose]);

  const text = `${entry.uitleg}${"meer" in entry && entry.meer ? ` ${entry.meer}` : ""}`;
  return (
    <span className="term-wrap">
      <span
        ref={trigger}
        className="term"
        role="button"
        tabIndex={0}
        aria-describedby={descId}
        onPointerDown={(e) => {
          touching.current = e.pointerType !== "mouse";
        }}
        onPointerEnter={(e) => {
          if (e.pointerType === "mouse") show();
        }}
        onPointerLeave={(e) => {
          if (e.pointerType === "mouse") hideSoon();
        }}
        onFocus={() => {
          if (!touching.current) show();
        }}
        onBlur={() => {
          touching.current = false;
          hideSoon();
        }}
        onClick={(e) => {
          // Geen labelactivatie, geen <summary>-toggle en geen link die de term omsluit.
          e.preventDefault();
          e.stopPropagation();
          if (touching.current) {
            touching.current = false;
            if (open) hide();
            else show();
          } else show();
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            e.stopPropagation();
            if (open) hide();
            else show();
          }
        }}
      >
        {children ?? entry.term}
      </span>
      {mounted &&
        createPortal(
          <span id={descId} hidden>
            {entry.term}: {text}
          </span>,
          document.body,
        )}
      {open &&
        createPortal(
          <div
            ref={tip}
            id={tipId}
            role="tooltip"
            className={`term-tip${pos?.above ? " above" : ""}`}
            style={pos ? { left: pos.left, top: pos.top } : { left: 0, top: 0, visibility: "hidden" }}
            onPointerEnter={(e) => {
              if (e.pointerType === "mouse") cancelClose();
            }}
            onPointerLeave={(e) => {
              if (e.pointerType === "mouse") hideSoon();
            }}
          >
            <strong>{entry.term}</strong>
            <span>{text}</span>
          </div>,
          document.body,
        )}
    </span>
  );
}
