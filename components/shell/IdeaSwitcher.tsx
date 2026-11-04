"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { Icon } from "@/components/Icon";

type IdeaLink = { id: string; title: string };

// Ideekiezer bovenaan het menu: het huidige idee, de andere ideeën en (voor het team) "+ Nieuw idee".
// Escape, een klik of focus buiten de lijst sluit hem.
export function IdeaSwitcher({ ideas, currentId, canCreate, onNavigate }: { ideas: IdeaLink[]; currentId: string | null; canCreate: boolean; onNavigate: () => void }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const listId = useId();
  const current = currentId ? ideas.find((i) => i.id === currentId) : undefined;
  const others = ideas.filter((i) => i.id !== currentId);

  useEffect(() => {
    if (!open) return;
    wrap.current?.querySelector<HTMLElement>(".idea-switch-menu a")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setOpen(false);
        button.current?.focus();
      }
    };
    const outside = (e: Event) => {
      if (wrap.current && e.target instanceof Node && !wrap.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", outside);
    document.addEventListener("focusin", outside);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("focusin", outside);
    };
  }, [open]);

  const pick = () => {
    setOpen(false);
    onNavigate();
  };

  return (
    <div className="idea-switch" ref={wrap}>
      <button
        ref={button}
        type="button"
        className="idea-switch-btn"
        aria-expanded={open}
        aria-controls={listId}
        aria-label={current ? `Huidig idee: ${current.title}. Kies een ander idee` : "Kies een idee"}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="idea-switch-text">
          <small>{current ? "Huidig idee" : "Idee"}</small>
          <span className="idea-switch-title">{current ? current.title : "Kies een idee"}</span>
        </span>
        <Icon name="chevron" size="sm" />
      </button>
      <div className="idea-switch-menu" id={listId} hidden={!open}>
        {others.length > 0 ? (
          <ul aria-label="Andere ideeën">
            {others.map((i) => (
              <li key={i.id}>
                <Link href={`/app/ideas/${i.id}`} prefetch={false} onClick={pick}>
                  {i.title}
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="tiny idea-switch-empty">{current ? "Geen andere ideeën." : "Nog geen ideeën."}</p>
        )}
        {canCreate && (
          <Link className="idea-switch-new" href="/app/ideas/new" onClick={pick}>
            <Icon name="plus" size="sm" /> Nieuw idee
          </Link>
        )}
      </div>
    </div>
  );
}
