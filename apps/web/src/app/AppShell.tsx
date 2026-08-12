import { NavLink, Outlet } from "react-router";
import { APP_PATHS } from "./routes.js";
import styles from "./AppShell.module.css";

export function AppShell() {
  return (
    <main className={styles.shell}>
      <header className={styles.masthead}>
        <div><p className={styles.eyebrow}>Gate G03 · Pronunciation without guessing</p><h1 className={styles.title}>See what readers see. Control what TTS says.</h1></div>
        <p className={styles.lede}>Compare source, readable text, and deterministic speech transformations without persistence or synthesis.</p>
      </header>
      <nav className={styles.navigation} aria-label="StudyNarrator tools">
        <NavLink to={APP_PATHS.scriptLab}>Script Lab</NavLink>
        <NavLink to={APP_PATHS.diagnostics}>Runtime diagnostics</NavLink>
      </nav>
      <Outlet />
      <footer className={styles.footer}><span>StudyNarrator 0.1.0</span><span>Parser and lexicon output stay local, deterministic, and offline.</span></footer>
    </main>
  );
}
