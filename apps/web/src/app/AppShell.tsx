import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Link, Outlet, useLocation } from "react-router";
import { APP_PATHS } from "./routes.js";
import { useConnections, type ShellConnectionState } from "@/features/connections/ConnectionProvider.js";
import styles from "./AppShell.module.css";

type NavigationIcon = "diagnostics" | "menu" | "projects" | "prompt" | "scratchpad" | "settings" | "x";

function Icon({ name }: { name: NavigationIcon }) {
  const paths: Record<NavigationIcon, ReactNode> = {
    diagnostics: <><path d="M4 19V9"/><path d="M10 19V5"/><path d="M16 19v-7"/><path d="M22 19V3"/></>,
    menu: <><path d="M4 7h16"/><path d="M4 12h16"/><path d="M4 17h16"/></>,
    projects: <><path d="M3 7.5h7l2 2h9v10H3z"/><path d="M3 7.5v-3h7l2 3"/></>,
    prompt: <><path d="M5 4h14v16H5z"/><path d="M8 8h8"/><path d="M8 12h5"/><path d="m14 15 1 2 2-1"/></>,
    scratchpad: <><path d="M7 3v4"/><path d="M17 3v4"/><path d="M5 5h14v16H5z"/><path d="M8 11h8"/><path d="M8 15h5"/></>,
    settings: <><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6 1.7 1.7 0 0 0-.4 1.1V21H9.6v-.09A1.7 1.7 0 0 0 8 19.4a1.7 1.7 0 0 0-1.88.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 3.6 15a1.7 1.7 0 0 0-.6-1 1.7 1.7 0 0 0-1.1-.4H2V9.6h.09A1.7 1.7 0 0 0 3.6 8a1.7 1.7 0 0 0-.34-1.88l-.06-.06 2.83-2.83.06.06A1.7 1.7 0 0 0 8 3.6a1.7 1.7 0 0 0 1-.6 1.7 1.7 0 0 0 .4-1.1V2h4v.09A1.7 1.7 0 0 0 15 3.6a1.7 1.7 0 0 0 1.88-.34l.06-.06 2.83 2.83-.06.06A1.7 1.7 0 0 0 19.4 8c.12.4.34.75.66 1 .3.25.68.39 1.07.4H21v4h-.09A1.7 1.7 0 0 0 19.4 15Z"/></>,
    x: <><path d="m6 6 12 12"/><path d="M18 6 6 18"/></>
  };
  return <svg className={styles.icon} aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>;
}

const connectionLabels: Record<ShellConnectionState, string> = {
  connected: "Connected",
  testing: "Testing connection",
  modelUnavailable: "Model unavailable",
  voiceUnavailable: "Voice unavailable",
  authenticationRequired: "Authentication required",
  disconnected: "Disconnected",
  configurationError: "Configuration error",
  invalidAudio: "Configuration error"
};

export function AppShell() {
  const connections = useConnections();
  const location = useLocation();
  const sidebarRef = useRef<HTMLElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [mobile, setMobile] = useState(() => window.matchMedia?.("(max-width: 960px)").matches ?? false);
  const promptActive = location.pathname === APP_PATHS.scriptPrompts || /\/projects\/[^/]+\/script-generation$/u.test(location.pathname);
  const projectsActive = location.pathname.startsWith(APP_PATHS.projects) && !promptActive;
  const onboardingComplete = connections.setup?.onboardingCompletedAt != null;
  const connectionPath = onboardingComplete ? APP_PATHS.settingsGeneral : APP_PATHS.onboarding;
  const connectionLabel = connections.loading ? "Checking connection" : connectionLabels[connections.shellState];
  const connectionState = connections.loading ? "loading" : connections.shellState;

  useEffect(() => {
    const query = window.matchMedia?.("(max-width: 960px)");
    if (!query) return;
    const update = () => {
      setMobile(query.matches);
      if (!query.matches) setDrawerOpen(false);
    };
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  useEffect(() => { setDrawerOpen(false); }, [location.pathname]);

  useEffect(() => {
    if (!mobile || !drawerOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const frame = window.requestAnimationFrame(() => closeButtonRef.current?.focus());
    return () => {
      window.cancelAnimationFrame(frame);
      document.body.style.overflow = previousOverflow;
    };
  }, [drawerOpen, mobile]);

  const closeDrawer = (restoreFocus: boolean) => {
    setDrawerOpen(false);
    if (restoreFocus) window.requestAnimationFrame(() => menuButtonRef.current?.focus());
  };

  const trapDrawerFocus = (event: KeyboardEvent<HTMLElement>) => {
    if (!mobile || !drawerOpen) return;
    if (event.key === "Escape") {
      event.preventDefault();
      closeDrawer(true);
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = [...(sidebarRef.current?.querySelectorAll<HTMLElement>("a[href], button:not([disabled])") ?? [])];
    if (focusable.length === 0) return;
    const first = focusable[0]!;
    const last = focusable.at(-1)!;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const navigationLink = (to: string, label: string, icon: NavigationIcon, active: boolean) => (
    <Link className={styles.navItem} data-active={active} aria-current={active ? "page" : undefined} to={to}>
      <Icon name={icon} /><span>{label}</span>
    </Link>
  );

  const settingsNavigationLink = (to: string, label: string) => {
    const active = location.pathname === to;
    return <Link className={styles.settingsNavItem} data-active={active} aria-current={active ? "page" : undefined} to={to}>{label}</Link>;
  };

  return (
    <div className={styles.shell}>
      <header className={styles.mobileBar}>
        <span className={styles.mobileBrand}>StudyNarrator</span>
        <button ref={menuButtonRef} className={styles.menuButton} type="button" aria-controls="application-sidebar" aria-expanded={drawerOpen} aria-label="Open navigation" onClick={() => setDrawerOpen(true)}><Icon name="menu" /></button>
      </header>
      <div className={styles.backdrop} data-navigation-backdrop data-open={drawerOpen} aria-hidden="true" onClick={() => closeDrawer(true)} />
      <aside
        ref={sidebarRef}
        id="application-sidebar"
        className={styles.sidebar}
        data-open={drawerOpen}
        aria-label={mobile ? "Application navigation" : undefined}
        aria-modal={mobile && drawerOpen ? "true" : undefined}
        role={mobile ? "dialog" : undefined}
        inert={mobile && !drawerOpen ? true : undefined}
        onKeyDown={trapDrawerFocus}
      >
        <div className={styles.sidebarHeader}>
          <Link className={styles.brand} to={APP_PATHS.projects} aria-label="StudyNarrator home">
            <span className={styles.brandMark} aria-hidden="true"><i /><i /><i /><i /></span>
            <span><strong>StudyNarrator</strong><small>Authoring room</small></span>
          </Link>
          <button ref={closeButtonRef} className={styles.closeButton} type="button" aria-label="Close navigation" onClick={() => closeDrawer(true)}><Icon name="x" /></button>
        </div>

        <nav className={styles.navigation} aria-label="StudyNarrator tools">
          <Link className={styles.promptAction} data-active={promptActive} aria-current={promptActive ? "page" : undefined} to={APP_PATHS.scriptPrompts}><Icon name="prompt" /><span>Prompt Kit</span></Link>
          <div className={styles.navLinks}>
            {navigationLink(APP_PATHS.projects, "Projects", "projects", projectsActive)}
            {navigationLink(APP_PATHS.scratchpad, "Quick Scratchpad", "scratchpad", location.pathname === APP_PATHS.scratchpad)}
            <div className={styles.settingsGroup}>
              <Link className={styles.navItem} to={APP_PATHS.settingsGeneral}><Icon name="settings" /><span>Settings</span></Link>
              <div className={styles.settingsSubnav} aria-label="Settings pages">
                {settingsNavigationLink(APP_PATHS.settingsGeneral, "General")}
                {settingsNavigationLink(APP_PATHS.settingsVoices, "Voices")}
                {settingsNavigationLink(APP_PATHS.settingsLexicon, "Lexicon")}
                {settingsNavigationLink(APP_PATHS.settingsTimings, "Timings")}
              </div>
            </div>
            {navigationLink(APP_PATHS.diagnostics, "System diagnostics", "diagnostics", location.pathname === APP_PATHS.diagnostics)}
          </div>
        </nav>

        <div className={styles.sidebarFooter}>
          <Link className={styles.connectionMonitor} data-state={connectionState} aria-label={`${connectionLabel}. ${connections.connection?.baseUrl ? new URL(connections.connection.baseUrl).host : "Not configured"}. ${onboardingComplete ? "Manage connection" : "Finish setup"}.`} to={connectionPath}>
            <span className={styles.connectionHeading}><i aria-hidden="true" /><strong>{connectionLabel}</strong></span>
            <span className={styles.connectionProfile}>{connections.connection?.baseUrl ? new URL(connections.connection.baseUrl).host : "Not configured"}</span>
            <span className={styles.connectionAction}>{onboardingComplete ? "Manage connection" : "Finish setup"}<span aria-hidden="true">→</span></span>
          </Link>
          <span className={styles.version}>Version 0.1.0</span>
        </div>
      </aside>
      <div className={styles.content}><Outlet /></div>
    </div>
  );
}
