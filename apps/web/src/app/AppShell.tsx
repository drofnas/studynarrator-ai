import { NavLink, Outlet } from "react-router";
import { APP_PATHS } from "./routes.js";
import styles from "./AppShell.module.css";

export function AppShell() {
  return (
    <main className={styles.shell}>
      <header className={styles.masthead}>
        <div><p className={styles.eyebrow}>Gate G04 · Durable by inspection</p><h1 className={styles.title}>Keep the source exact. Make every migration visible.</h1></div>
        <p className={styles.lede}>Review deterministic script analysis alongside transactional project storage, restart evidence, and recoverable schema upgrades.</p>
      </header>
      <nav className={styles.navigation} aria-label="StudyNarrator tools">
        <NavLink to={APP_PATHS.scriptLab}>Script Lab</NavLink>
        <NavLink to={APP_PATHS.persistenceLab}>Persistence Lab</NavLink>
        <NavLink to={APP_PATHS.diagnostics}>Runtime diagnostics</NavLink>
      </nav>
      <Outlet />
      <footer className={styles.footer}><span>StudyNarrator 0.1.0</span><span>Local SQLite persistence. No credentials, synthesis, or external traffic.</span></footer>
    </main>
  );
}
