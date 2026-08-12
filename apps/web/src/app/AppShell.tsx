import { NavLink, Outlet } from "react-router";
import { APP_PATHS } from "./routes.js";

export function AppShell() {
  return (
    <main className="shell">
      <header className="masthead">
        <div><p className="eyebrow">Gate G02 · Grammar before audio</p><h1>See exactly what the script means.</h1></div>
        <p className="lede">Parse speakers, pauses, sections, and pronunciation annotations without persistence or synthesis.</p>
      </header>
      <nav className="view-nav" aria-label="StudyNarrator tools">
        <NavLink to={APP_PATHS.scriptLab}>Script Lab</NavLink>
        <NavLink to={APP_PATHS.diagnostics}>Runtime diagnostics</NavLink>
      </nav>
      <Outlet />
      <footer><span>StudyNarrator 0.1.0</span><span>Parser output is local, deterministic, and never sent to Speaches.</span></footer>
    </main>
  );
}
