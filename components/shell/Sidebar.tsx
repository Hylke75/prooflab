"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon, type IconName } from "@/components/Icon";
import { Drawer } from "@/components/ui/Drawer";
import { useShell } from "./ShellProvider";

type IdeaLink = { id: string; title: string };

const IDEA_NAV: { suffix: string; label: string; icon: IconName }[] = [
  { suffix: "/research", label: "Marktverkenning", icon: "compass" },
  { suffix: "/assumptions", label: "Aannames", icon: "layers" },
  { suffix: "/experiments", label: "Experimenten", icon: "flask" },
  { suffix: "/evidence", label: "Bewijs & besluit", icon: "shield" },
  { suffix: "/report", label: "Rapportage", icon: "file" },
];

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
  const { sidebarOpen, close } = useShell();
  const match = pathname.match(/^\/app\/ideas\/([0-9a-f-]{36})(\/[a-z-]+)?/i);
  const currentId = match?.[1] ?? null;
  const current = currentId ? ideas.find((i) => i.id === currentId) : null;
  const sub = match?.[2] ?? "";

  const link = (href: string, label: string, icon: IconName, active: boolean) => (
    <Link key={href} href={href} className={`nav-link${active ? " active" : ""}`} aria-current={active ? "page" : undefined} onClick={close}>
      <Icon name={icon} /> {label} <span className="nav-dot" />
    </Link>
  );

  return (
    <Drawer as="aside" open={sidebarOpen} onClose={close} modalQuery="(max-width: 850px)" className={`sidebar${sidebarOpen ? " open" : ""}`} id="sidebar" label="Hoofdnavigatie">
      <button type="button" className="round-btn sidebar-close" onClick={close} aria-label="Sluit navigatie">
        <Icon name="close" />
      </button>
      <div className="brand">
        <span className="mark" aria-hidden="true">◉</span>ProofLab<span style={{ color: "var(--lime)" }}>.</span>
      </div>
      <div className="nav-heading">Werkruimte</div>
      <nav className="side-nav" aria-label="Werkruimte">
        {link("/app", "Overzicht", "home", pathname === "/app")}
        {isConsultant && link("/app/clients", "Klanten", "users", pathname.startsWith("/app/clients"))}
      </nav>
      {currentId && (
        <>
          <div className="nav-heading">Huidig idee</div>
          {current && (
            <div className="idea-switch">
              <small>Idee</small>
              {current.title}
            </div>
          )}
          <nav className="side-nav" aria-label="Huidig idee">
            {IDEA_NAV.map((n) => link(`/app/ideas/${currentId}${n.suffix}`, n.label, n.icon, sub === n.suffix || (sub.startsWith(n.suffix) && n.suffix !== "")))}
          </nav>
        </>
      )}
      {isConsultant && (
        <>
          <div className="nav-heading">Aan de slag</div>
          <nav className="side-nav" aria-label="Aan de slag">{link("/app/ideas/new", "Nieuw idee", "plus", pathname === "/app/ideas/new")}</nav>
        </>
      )}
      <div className="sidebar-bottom">
        <div className="workspace-label">Mijn werkruimte</div>
        <div className="work-chip">
          <span className="avatar-mini">{workspaceName.slice(0, 1).toUpperCase()}</span>
          <div>
            {workspaceName}
            <br />
            <span style={{ fontSize: 10, color: "#8791a5", fontWeight: 400 }}>{isConsultant ? "Consultancy-werkruimte" : "Meekijken als opdrachtgever"}</span>
          </div>
        </div>
        <div className="site-status">
          <i style={aiConnected ? undefined : { background: "#e5b25d" }} /> {aiConnected ? "AI-onderzoek verbonden" : "AI niet verbonden · handmatige modus"}
        </div>
      </div>
    </Drawer>
  );
}
