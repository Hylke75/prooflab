"use client";

import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])';

function focusables(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => !el.closest("[inert]") && el.getClientRects().length > 0);
}

// Makes everything outside `panel` inert (not focusable, not clickable, hidden from assistive tech),
// except elements marked data-drawer-keep (the overlay that closes the drawer, the toast region).
function inertOutside(panel: HTMLElement): () => void {
  const changed: HTMLElement[] = [];
  let node: HTMLElement = panel;
  while (node.parentElement && node !== document.body) {
    const parent: HTMLElement = node.parentElement;
    for (const sib of Array.from(parent.children)) {
      if (sib === node || !(sib instanceof HTMLElement)) continue;
      if (sib.inert || sib.hasAttribute("data-drawer-keep") || ["SCRIPT", "STYLE", "LINK", "TEMPLATE"].includes(sib.tagName)) continue;
      sib.inert = true;
      changed.push(sib);
    }
    node = parent;
  }
  return () => changed.forEach((el) => (el.inert = false));
}

function subscribe(query: string) {
  return (cb: () => void) => {
    const mq = window.matchMedia(query);
    mq.addEventListener("change", cb);
    return () => mq.removeEventListener("change", cb);
  };
}

// True while `query` matches; always true without a query. Server render assumes desktop.
export function useMediaQuery(query?: string): boolean {
  const sub = useMemo(() => (query ? subscribe(query) : () => () => {}), [query]);
  return useSyncExternalStore(
    sub,
    () => (query ? window.matchMedia(query).matches : true),
    () => !query,
  );
}

type DrawerProps = {
  open: boolean;
  onClose: () => void;
  // Media query in which the panel behaves as a modal drawer (e.g. the sidebar below 850px).
  // Outside it the panel is an ordinary part of the layout. Omit for an always-modal dialog.
  modalQuery?: string;
  as?: "div" | "aside";
  id?: string;
  className?: string;
  label?: string;
  labelledBy?: string;
  // Render into document.body with its own backdrop (dialogs opened from page content).
  portal?: boolean;
  backdropClassName?: string;
  children: React.ReactNode;
};

/**
 * One accessible drawer/dialog for the whole app (mobile sidebar, coach slide-over, detail panels):
 * focus moves into the panel on open and is trapped there, Escape closes, focus returns to the
 * element that opened it, the background is inert while it is open, and a closed panel is inert
 * so nothing hidden can receive focus.
 */
export function Drawer({ open, onClose, modalQuery, as = "div", id, className, label, labelledBy, portal, backdropClassName = "drawer-backdrop", children }: DrawerProps) {
  const ref = useRef<HTMLElement | null>(null);
  const modal = useMediaQuery(modalQuery);
  const active = modal && open;
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const panel = ref.current;
    if (!active || !panel) return;
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const restore = inertOutside(panel);
    const frame = requestAnimationFrame(() => {
      if (panel.contains(document.activeElement)) return;
      (focusables(panel)[0] ?? panel).focus({ preventScroll: true });
    });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onCloseRef.current();
        return;
      }
      if (e.key !== "Tab") return;
      const list = focusables(panel);
      if (list.length === 0) {
        e.preventDefault();
        panel.focus();
        return;
      }
      const first = list[0];
      const last = list[list.length - 1];
      const inside = panel.contains(document.activeElement);
      if (e.shiftKey && (document.activeElement === first || !inside)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (document.activeElement === last || !inside)) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("keydown", onKey);
      restore();
      if (trigger?.isConnected) trigger.focus({ preventScroll: true });
    };
  }, [active]);

  const Tag = as;
  const panel = (
    <Tag
      ref={(el: HTMLElement | null) => {
        ref.current = el;
      }}
      id={id}
      className={className}
      role={modal ? "dialog" : undefined}
      aria-modal={active ? true : undefined}
      aria-label={label}
      aria-labelledby={labelledBy}
      inert={modal && !open}
      tabIndex={-1}
    >
      {children}
    </Tag>
  );

  if (portal) {
    if (!open || typeof document === "undefined") return null;
    return createPortal(
      <>
        <div className={backdropClassName} onClick={() => onCloseRef.current()} aria-hidden="true" data-drawer-keep="" />
        {panel}
      </>,
      document.body,
    );
  }
  return panel;
}
