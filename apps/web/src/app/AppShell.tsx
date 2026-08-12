import { NavLink, Outlet } from "react-router";
import { APP_PATHS } from "./routes.js";
import styles from "./AppShell.module.css";

export function AppShell() {
  return (
    <main className={styles.shell}>
      <header className={styles.masthead}>
        <div><p className={styles.eyebrow}>StudyNarrator</p><h1 className={styles.title}>Write the source. Inspect the score.</h1></div>
        <p className={styles.lede}>A deterministic authoring room for turning study guides into configured narration—before a single audio request is made.</p>
      </header>
      <nav className={styles.navigation} aria-label="StudyNarrator tools">
        <div className={styles.primaryLinks}><NavLink to={APP_PATHS.projects}>Projects</NavLink><NavLink to={APP_PATHS.settings}>Settings</NavLink></div>
        <details className={styles.reviewTools}><summary>Review tools</summary><div><NavLink to={APP_PATHS.scriptLab}>Script Lab</NavLink><NavLink to={APP_PATHS.persistenceLab}>Persistence Lab</NavLink><NavLink to={APP_PATHS.diagnostics}>Runtime diagnostics</NavLink></div></details>
      </nav>
      <Outlet />
      <footer className={styles.footer}><span>StudyNarrator 0.1.0 · Gate G05</span><span>Local authoring and dry run. No credentials, synthesis, or external traffic.</span></footer>
    </main>
  );
}
