"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { StepStates } from "@/lib/steps";

// De stapstatus van het idee dat nu open is. De pagina (PageFrame) kent de voortgang en geeft hem door; het menu
// in de layout leest hem hier.
export type IdeaSteps = { ideaId: string; states: StepStates };

type Shell = {
  sidebarOpen: boolean;
  coachOpen: boolean;
  openSidebar: () => void;
  openCoach: () => void;
  close: () => void;
  toast: (msg: string) => void;
  ideaSteps: IdeaSteps | null;
  setIdeaSteps: (s: IdeaSteps) => void;
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
  const [ideaSteps, setIdeaSteps] = useState<IdeaSteps | null>(null);
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
      ideaSteps,
      setIdeaSteps,
    }),
    [sidebarOpen, coachOpen, close, toast, ideaSteps],
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

// Geeft de stapstatus van de open pagina door aan het menu. Rendert niets.
export function SyncIdeaSteps({ ideaId, states }: IdeaSteps) {
  const { setIdeaSteps } = useShell();
  const { market, assumptions, test, decide } = states;
  useEffect(() => {
    setIdeaSteps({ ideaId, states: { market, assumptions, test, decide } });
  }, [ideaId, market, assumptions, test, decide, setIdeaSteps]);
  return null;
}
