import { Link } from "react-router";
import {
  renderProgressLabel,
  useRenderActivity,
  terminalRenderStates,
} from "./RenderActivityProvider.js";
import styles from "./RenderActivityList.module.css";

export function RenderActivityList() {
  const { active, unviewed, markViewed } = useRenderActivity();
  if (active.length + unviewed.length === 0) return null;

  return (
    <section
      className={styles.activity}
      aria-labelledby="render-activity-title"
    >
      <h2 id="render-activity-title">Render activity</h2>
      <ul>
        {[...active, ...unviewed].map(({ job, projectName }) => {
          const terminal = terminalRenderStates.has(job.state);
          const completedAt = terminal
            ? new Date(job.finishedAt ?? job.createdAt).toLocaleString()
            : undefined;
          const label = renderProgressLabel(job);
          return (
            <li key={job.id}>
              <Link
                to={`/projects/${job.projectId}?tab=render&render=${job.id}`}
                aria-label={`${projectName}: ${label}${completedAt ? `, ${completedAt}` : ""}`}
                onClick={() => markViewed(job)}
              >
                <strong>{projectName}</strong>
                <span>{label}</span>
                {completedAt ? (
                  <time dateTime={job.finishedAt ?? job.createdAt}>
                    {completedAt}
                  </time>
                ) : null}
                {!terminal && job.progress.totalChunks > 0 ? (
                  <progress
                    aria-label={`${projectName} render progress`}
                    max={job.progress.totalChunks}
                    value={job.progress.completedChunks}
                  />
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
