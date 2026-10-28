"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

type Shell = {
  sidebarOpen: boolean;
  coachOpen: boolean;
  openSidebar: () => void;
  openCoach: () => void;
  close: () => void;
  toast: (msg: string) => void;
};

const Ctx = createContext<Shell | null>(null);

export function useShell(): Shell {
  const s = useContext(Ctx);
  if (!s) throw new Error("useShell must be used inside ShellProvider");
  return s;
}

// Drawer, coach slide-over, overlay and toast behave exactly like the reference mock-up:
// one overlay, Escape closes everything.
export function ShellProvider({ children }: { children: React.ReactNode }) {
  const [sidebarOpen, setSidebar] = useState(false);
  const [coachOpen, setCoach] = useState(false);
  const [message, setMessage] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const close = useCallback(() => {
    setSidebar(false);
    setCoach(false);
  }, []);
  const toast = useCallback((msg: string) => {
    setMessage(msg);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setMessage(""), 3100);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [close]);

  const value = useMemo<Shell>(
    () => ({
      sidebarOpen,
      coachOpen,
      openSidebar: () => {
        setCoach(false);
        setSidebar(true);
      },
      openCoach: () => {
        setSidebar(false);
        setCoach(true);
      },
      close,
      toast,
    }),
    [sidebarOpen, coachOpen, close, toast],
  );

  return (
    <Ctx value={value}>
      <div className={`overlay${sidebarOpen || coachOpen ? " show" : ""}`} onClick={close} aria-hidden="true" />
      {children}
      <div className={`toast${message ? " show" : ""}`} role="status" aria-live="polite">
        {message}
      </div>
    </Ctx>
  );
}
