import { useState } from "react";
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
  const [search, setSearch] = useState("");
  const query = search.trim().toLocaleLowerCase();
  const visibleProjects = projects.filter((project) =>
    `${project.name} ${project.description}`
      .toLocaleLowerCase()
      .includes(query),
  );
  return (
    <div className={styles.page}>
      <header className={styles.pageHeader}>
        <div>
          <h2>Projects</h2>
          <p>
            Your study material, ready to become something you can listen to.
          </p>
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
          <div className={styles.libraryHeading}>
            <h3 id="project-index-heading">All projects</h3>
            <span className={styles.projectCount}>{projects.length}</span>
          </div>
          <label className={styles.projectSearch}>
            <span>Search projects</span>
            <input
              type="search"
              placeholder="Search by name or description…"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
        </div>
        <p className={styles.searchStatus} role="status">
          {query
            ? `${visibleProjects.length} matching ${visibleProjects.length === 1 ? "project" : "projects"}`
            : ""}
        </p>
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
                    <div className={styles.libraryEmpty}>
                      <h3>Make room for your first study guide</h3>
                      <p>
                        Create a project to write a script, choose voices, and
                        turn your notes into audio.
                      </p>
                      <button
                        type="button"
                        onClick={() => setNewProjectOpen(true)}
                      >
                        Create your first project
                      </button>
                    </div>
                  </td>
                </tr>
              ) : visibleProjects.length === 0 ? (
                <tr>
                  <td colSpan={4}>
                    <div className={styles.libraryEmpty}>
                      <h3>No matching projects</h3>
                      <p>Try another name or a word from the description.</p>
                      <button
                        type="button"
                        className={styles.secondary}
                        onClick={() => setSearch("")}
                      >
                        Clear search
                      </button>
                    </div>
                  </td>
                </tr>
              ) : (
                visibleProjects.map((item) => (
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
                    <td data-label="Script lines">
                      {item.scriptLineCount?.toLocaleString() ?? "-"}
                    </td>
                    <td data-label="Audio length">
                      {formatAudioDuration(item.audioDurationMs)}
                    </td>
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
