import { Link } from "react-router";
import styles from "./ProjectsPage.module.css";
import {
  formatAudioDuration,
  type ProjectPageController,
} from "./useProjectsPageController.js";

export function ProjectIndex({
  controller,
}: {
  controller: ProjectPageController;
}) {
  const {
    projects,
    errors,
    setErrors,
    busy,
    newProjectOpen,
    setNewProjectOpen,
    newName,
    setNewName,
    newDescription,
    setNewDescription,
    createProject,
  } = controller;
  return (
    <div className={styles.page}>
      <header className={styles.pageHeader}>
        <div>
          <p className={styles.kicker}>Project index</p>
          <h2>Projects</h2>
          <p>Open a narration workspace or start a new study guide.</p>
        </div>
        <button
          type="button"
          aria-expanded={newProjectOpen}
          aria-controls="new-project-form"
          onClick={() => setNewProjectOpen((open) => !open)}
        >
          {newProjectOpen ? "Close form" : "New project"}
        </button>
      </header>
      {errors.length > 0 ? (
        <div className={styles.alert} role="alert">
          <strong>Review these items</strong>
          <ul>
            {errors.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
          <button type="button" onClick={() => setErrors([])}>
            Dismiss
          </button>
        </div>
      ) : null}
      {newProjectOpen ? (
        <form
          id="new-project-form"
          className={styles.newProjectForm}
          onSubmit={(event) => {
            event.preventDefault();
            void createProject();
          }}
        >
          <div>
            <p className={styles.kicker}>New workspace</p>
            <h3>Create project</h3>
          </div>
          <label>
            Project name
            <input
              autoFocus
              value={newName}
              onChange={(event) => setNewName(event.target.value)}
            />
          </label>
          <label>
            Description
            <input
              value={newDescription}
              onChange={(event) => setNewDescription(event.target.value)}
            />
          </label>
          <div className={styles.actionRow}>
            <button type="submit" disabled={busy || !newName.trim()}>
              Create project
            </button>
            <button
              type="button"
              className={styles.secondary}
              onClick={() => {
                setNewProjectOpen(false);
                setNewName("");
                setNewDescription("");
              }}
            >
              Cancel
            </button>
          </div>
        </form>
      ) : null}
      <section
        className={styles.projectIndex}
        aria-labelledby="project-index-heading"
      >
        <div className={styles.sectionHeading}>
          <div>
            <span>Authoring ledger</span>
            <h3 id="project-index-heading">All projects</h3>
          </div>
          <b>{projects.length}</b>
        </div>
        <div className={styles.projectTableScroll} tabIndex={0}>
          <table className={styles.projectTable}>
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">Description</th>
                <th scope="col">Script Lines</th>
                <th scope="col">Audio Length</th>
              </tr>
            </thead>
            <tbody>
              {busy ? (
                <tr>
                  <td colSpan={4}>Loading projects…</td>
                </tr>
              ) : projects.length === 0 ? (
                <tr>
                  <td colSpan={4}>
                    No projects yet. Create the first study guide.
                  </td>
                </tr>
              ) : (
                projects.map((item) => (
                  <tr className={styles.projectRow} key={item.id}>
                    <th scope="row">
                      <Link
                        className={styles.projectLink}
                        to={`/projects/${item.id}`}
                      >
                        {item.name}
                      </Link>
                    </th>
                    <td>{item.description || "-"}</td>
                    <td>{item.scriptLineCount?.toLocaleString() ?? "-"}</td>
                    <td>{formatAudioDuration(item.audioDurationMs)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
