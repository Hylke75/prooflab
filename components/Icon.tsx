// Line icons from the reference mock-up, rendered from one inline SVG sprite.
export type IconName =
  | "home" | "compass" | "layers" | "flask" | "shield" | "file" | "plus" | "arrow" | "check"
  | "spark" | "menu" | "close" | "trend" | "clock" | "info" | "users" | "settings" | "logout";

export function Icon({ name, size, className }: { name: IconName; size?: "sm" | "lg"; className?: string }) {
  return (
    <svg className={["i", size, className].filter(Boolean).join(" ")} aria-hidden="true">
      <use href={`#ic-${name}`} />
    </svg>
  );
}

export function IconSprite() {
  return (
    <svg aria-hidden="true" width="0" height="0" style={{ position: "absolute" }}>
      <defs>
        <symbol id="ic-home" viewBox="0 0 24 24"><path d="m3 10 9-7 9 7v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><path d="M9 21v-8h6v8" /></symbol>
        <symbol id="ic-compass" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" /><path d="m16 8-3 5-5 3 3-5z" /></symbol>
        <symbol id="ic-layers" viewBox="0 0 24 24"><path d="m12 3 9 5-9 5-9-5zM3 12l9 5 9-5M3 16l9 5 9-5" /></symbol>
        <symbol id="ic-flask" viewBox="0 0 24 24"><path d="M9 3h6M10 3v7l-6 9a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2l-6-9V3M7 15h10" /></symbol>
        <symbol id="ic-shield" viewBox="0 0 24 24"><path d="M12 22s9-4 9-11V5l-9-3-9 3v6c0 7 9 11 9 11Z" /><path d="m8 12 3 3 5-5" /></symbol>
        <symbol id="ic-file" viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6M8 13h8M8 17h6" /></symbol>
        <symbol id="ic-plus" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" /></symbol>
        <symbol id="ic-arrow" viewBox="0 0 24 24"><path d="M5 12h14m-7-7 7 7-7 7" /></symbol>
        <symbol id="ic-check" viewBox="0 0 24 24"><path d="m5 12 5 5L20 7" /></symbol>
        <symbol id="ic-spark" viewBox="0 0 24 24"><path d="m12 2 2.2 6.8L21 11l-6.8 2.2L12 20l-2.2-6.8L3 11l6.8-2.2zM19 19l1 3M17 21l3-1" /></symbol>
        <symbol id="ic-menu" viewBox="0 0 24 24"><path d="M4 6h16M4 12h16M4 18h16" /></symbol>
        <symbol id="ic-close" viewBox="0 0 24 24"><path d="M5 5 19 19M19 5 5 19" /></symbol>
        <symbol id="ic-trend" viewBox="0 0 24 24"><path d="m3 17 7-7 4 4 7-7M15 7h6v6" /></symbol>
        <symbol id="ic-clock" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></symbol>
        <symbol id="ic-info" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></symbol>
        <symbol id="ic-users" viewBox="0 0 24 24"><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20c.8-3.4 3.4-5.5 6.5-5.5s5.7 2.1 6.5 5.5M16 4.5a3.5 3.5 0 0 1 0 7M18 14.8c1.9.8 3.1 2.6 3.5 5.2" /></symbol>
        <symbol id="ic-settings" viewBox="0 0 24 24"><circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M4.9 4.9 7 7M17 17l2.1 2.1M2 12h3M19 12h3M4.9 19.1 7 17M17 7l2.1-2.1" /></symbol>
        <symbol id="ic-logout" viewBox="0 0 24 24"><path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 17l-5-5 5-5M5 12h11" /></symbol>
      </defs>
    </svg>
  );
}
