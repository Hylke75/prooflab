"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { Icon } from "@/components/Icon";
import { useShell } from "./ShellProvider";

export function Topbar({ crumbs, initials, email, name, badge }: { crumbs: string[]; initials: string; email: string; name: string | null; badge?: string }) {
  const { openSidebar, sidebarOpen } = useShell();
  return (
    <header className="topbar">
      <div style={{ display: "flex", alignItems: "center", gap: 13 }}>
        <button type="button" className="round-btn mobile-menu" onClick={openSidebar} aria-label="Open navigatie" aria-expanded={sidebarOpen} aria-controls="sidebar">
          <Icon name="menu" />
        </button>
        <nav className="crumb" aria-label="Kruimelpad">
          {crumbs.slice(0, -1).map((c, i) => (
            <span key={i} style={{ display: "contents" }}>
              <span>{c}</span>
              <span aria-hidden="true">/</span>
            </span>
          ))}
          <strong aria-current="page">{crumbs[crumbs.length - 1]}</strong>
        </nav>
      </div>
      <div className="top-actions">
        {badge && <span className="demo-ribbon">{badge}</span>}
        <Link className="round-btn help-link" href="/app/help" aria-label="Uitleg over ProofLab" title="Uitleg">
          <Icon name="info" />
        </Link>
        <AccountMenu initials={initials} email={email} name={name} />
      </div>
    </header>
  );
}

// Small disclosure menu: who is signed in, and the account actions. Escape and a click outside close it.
function AccountMenu({ initials, email, name }: { initials: string; email: string; name: string | null }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    const first = wrap.current?.querySelector<HTMLElement>(".account-menu a, .account-menu button");
    first?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setOpen(false);
        button.current?.focus();
      }
    };
    const onPointer = (e: PointerEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
    };
    const onFocus = (e: FocusEvent) => {
      if (wrap.current && e.target instanceof Node && !wrap.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("focusin", onFocus);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("focusin", onFocus);
    };
  }, [open]);

  return (
    <div className="account" ref={wrap}>
      <button
        ref={button}
        type="button"
        className="top-avatar"
        style={{ border: 0 }}
        aria-label={`Account: ${name ?? email}`}
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen((v) => !v)}
      >
        {initials}
      </button>
      <div className="account-menu" id={menuId} hidden={!open}>
        <div className="account-who">
          <strong>{name ?? email.split("@")[0]}</strong>
          <span>{email}</span>
        </div>
        <Link href="/app" onClick={() => setOpen(false)}>
          <Icon name="home" size="sm" /> Werkruimte
        </Link>
        <Link href="/app/help" onClick={() => setOpen(false)}>
          <Icon name="info" size="sm" /> Uitleg
        </Link>
        <form action="/auth/signout" method="post">
          <button type="submit">
            <Icon name="logout" size="sm" /> Uitloggen
          </button>
        </form>
      </div>
    </div>
  );
}
