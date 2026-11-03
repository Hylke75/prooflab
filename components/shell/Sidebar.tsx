"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon } from "@/components/Icon";
import { Drawer } from "@/components/ui/Drawer";
import { menuItems, stepForPath, stepMark, type MenuItem } from "@/lib/steps";
import { IdeaSwitcher } from "./IdeaSwitcher";
import { useShell } from "./ShellProvider";

type IdeaLink = { id: string; title: string };

export function Sidebar({
  workspaceName,
  isConsultant,
  ideas,
  aiConnected,
}: {
  workspaceName: string;
  isConsultant: boolean;
  ideas: IdeaLink[];
  aiConnected: boolean;
}) {
  const pathname = usePathname();
  const { sidebarOpen, close, ideaSteps } = useShell();
  const match = pathname.match(/^\/app\/ideas\/([0-9a-f-]{36})(\/.*)?$/i);
  const currentId = match?.[1] ?? null;
  const sub = match?.[2] ?? "";
  const activeStep = currentId ? stepForPath(sub) : null;
  const states = currentId && ideaSteps?.ideaId === currentId ? ideaSteps.states : null;
  const { idea, workspace } = menuItems({ ideaId: currentId, isConsultant });

  const isActive = (item: MenuItem): boolean => {
    if (item.step) return activeStep === item.step;
    if (item.key === "overview") return sub === "";
    if (item.key === "report") return sub === "/report" || sub.startsWith("/report/");
    if (item.key === "ideas") return pathname === "/app";
    return pathname === item.href || pathname.startsWith(`${item.href}/`);
  };

  const link = (item: MenuItem) => {
    const active = isActive(item);
    const state = item.step ? states?.[item.step] : undefined;
    const mark = stepMark(state);
    return (
      <Link
        key={item.key}
        href={item.href}
        className={`nav-link${active ? " active" : ""}`}
        aria-current={active ? "page" : undefined}
        onClick={close}
        data-step={item.step}
        data-step-state={item.step ? (state ?? "empty") : undefined}
      >
        <Icon name={item.icon} />
        <span className="nav-label">
          {item.number !== undefined && <span className="nav-no">{item.number}</span>}
          {item.label}
        </span>
        {mark && (
          <span className={`nav-mark ${state}`}>
            <span aria-hidden="true">{mark.mark}</span>
            <span className="sr-only">, {mark.spoken}</span>
          </span>
        )}
        <span className="nav-dot" />
      </Link>
    );
  };

  return (
    <Drawer as="aside" open={sidebarOpen} onClose={close} modalQuery="(max-width: 850px)" className={`sidebar${sidebarOpen ? " open" : ""}`} id="sidebar" label="Hoofdnavigatie">
      <button type="button" className="round-btn sidebar-close" onClick={close} aria-label="Sluit navigatie">
        <Icon name="close" />
      </button>
      <div className="brand">
        <span className="mark" aria-hidden="true">◉</span>ProofLab<span style={{ color: "var(--color-accent)" }}>.</span>
      </div>
      <IdeaSwitcher ideas={ideas} currentId={currentId} canCreate={isConsultant} onNavigate={close} />
      {idea.length > 0 && (
        <nav className="side-nav" aria-label="Dit idee">
          {idea.map(link)}
        </nav>
      )}
      <hr className="nav-divider" />
      <nav className="side-nav" aria-label="Werkruimte">
        {workspace.map(link)}
      </nav>
      <div className="sidebar-bottom">
        <div className="workspace-label">Mijn werkruimte</div>
        <div className="work-chip">
          <span className="avatar-mini">{workspaceName.slice(0, 1).toUpperCase()}</span>
          <div>
            {workspaceName}
            <br />
            <span style={{ fontSize: 12, color: "var(--color-text-muted)", fontWeight: 400 }}>{isConsultant ? "Consultancy-werkruimte" : "Meekijken als opdrachtgever"}</span>
          </div>
        </div>
        <div className="site-status">
          <i style={aiConnected ? undefined : { background: "var(--color-warning)" }} /> {aiConnected ? "AI-onderzoek verbonden" : "AI niet verbonden · handmatige modus"}
        </div>
      </div>
    </Drawer>
  );
}
