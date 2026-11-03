"use client";

import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";

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

// Drawer, coach slide-over, overlay and toast behave like the reference mock-up: one overlay that
// closes everything. Focus handling, Escape and inertness live in the shared Drawer primitive.
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
      <div className={`overlay${sidebarOpen || coachOpen ? " show" : ""}`} onClick={close} aria-hidden="true" data-drawer-keep="" />
      {children}
      <div className={`toast${message ? " show" : ""}`} role="status" aria-live="polite" data-drawer-keep="">
        {message}
      </div>
    </Ctx>
  );
}
