import { NavLink, Outlet } from "react-router";
import { APP_PATHS } from "./routes.js";
import { useConnections, type ShellConnectionState } from "@/features/connections/ConnectionProvider.js";
import styles from "./AppShell.module.css";

export function AppShell() {
  const connections = useConnections();
  const labels: Record<ShellConnectionState, string> = {
    connected: "Connected",
    testing: "Testing",
    modelUnavailable: "Model unavailable",
    voiceUnavailable: "Voice unavailable",
    authenticationRequired: "Authentication required",
    disconnected: "Disconnected",
    configurationError: "Configuration error",
    invalidAudio: "Configuration error"
  };
  return (
    <main className={styles.shell}>
      <header className={styles.masthead}>
        <div><p className={styles.eyebrow}>StudyNarrator</p><h1 className={styles.title}>Write the source. Inspect the score.</h1></div>
        <p className={styles.lede}>A deterministic authoring room for turning study guides into configured narration—before a single audio request is made.</p>
      </header>
      <nav className={styles.navigation} aria-label="StudyNarrator tools">
        <div className={styles.primaryLinks}><NavLink to={APP_PATHS.projects}>Projects</NavLink><NavLink to={APP_PATHS.settings}>Settings</NavLink><NavLink to={APP_PATHS.diagnostics}>System diagnostics</NavLink><NavLink className={styles.connection ?? ""} data-state={connections.shellState} to={APP_PATHS.onboarding}><span aria-hidden="true" />{labels[connections.shellState]}</NavLink></div>
      </nav>
      <Outlet />
      <footer className={styles.footer}><span>StudyNarrator 0.1.0</span><span>Connection diagnostics may request one discarded WAV. Project dry runs remain synthesis-free.</span></footer>
    </main>
  );
}
