import { Link } from "react-router";
import {
  renderProgressLabel,
  useRenderActivity,
} from "./RenderActivityProvider.js";
import styles from "./RenderActivityList.module.css";

export function RenderActivityList() {
  const { active } = useRenderActivity();
  if (active.length === 0) return null;

  return (
    <section
      className={styles.activity}
      aria-labelledby="render-activity-title"
    >
      <h2 id="render-activity-title">Rendering</h2>
      <ul>
        {active.map(({ job, projectName }) => {
          const label = renderProgressLabel(job);
          return (
            <li key={job.id}>
              <Link
                to={`/projects/${job.projectId}?tab=render`}
                aria-label={`${projectName}: ${label}`}
              >
                <strong>{projectName}</strong>
                <span>{label}</span>
                {job.progress.totalChunks > 0 ? (
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
