import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { useQuery } from "@tanstack/react-query";
import type { PersistenceClient, RenderJob } from "@studynarrator/shared-types";
import { queryKeys } from "@/app/queryKeys.js";
import type { RenderProgressClient } from "@/services/renders/renderClient.js";

type RenderActivityClient = Pick<
  RenderProgressClient,
  "get" | "list" | "subscribe"
>;
type RenderActivityPersistence = {
  projects: Pick<PersistenceClient["projects"], "list">;
};

export const terminalRenderStates = new Set<RenderJob["state"]>([
  "complete",
  "failed",
  "canceled",
]);

const renderPhaseLabels: Record<RenderJob["state"], string> = {
  queued: "Queued…",
  validating: "Validating render…",
  synthesizing: "Synthesizing audio…",
  assembling: "Assembling audio…",
  normalizing: "Normalizing audio…",
  encoding: "Encoding MP3…",
  writing_artifacts: "Writing render files…",
  complete: "Render complete",
  failed: "Render failed",
  canceled: "Render canceled",
};

export function renderProgressLabel(job: RenderJob): string {
  if (job.state !== "synthesizing" || job.progress.totalChunks === 0)
    return renderPhaseLabels[job.state];
  const current = Math.min(
    job.progress.totalChunks,
    job.progress.completedChunks + 1,
  );
  return `Processing chunk ${String(current)} of ${String(job.progress.totalChunks)}`;
}

interface ProjectRenderActivity {
  projectName: string;
  jobs: RenderJob[];
}

interface ActiveProjectRender {
  projectName: string;
  job: RenderJob;
}

interface RenderActivityContextValue {
  active: ActiveProjectRender[];
  projects: Record<string, ProjectRenderActivity>;
  track: (job: RenderJob, projectName?: string) => void;
}

const Context = createContext<RenderActivityContextValue | null>(null);

function upsertJob(jobs: RenderJob[], job: RenderJob): RenderJob[] {
  return [job, ...jobs.filter(({ id }) => id !== job.id)];
}

function RenderWatcher({
  renderClient,
  renderId,
  updateJob,
}: {
  renderClient: RenderActivityClient;
  renderId: string;
  updateJob: (job: RenderJob) => void;
}) {
  useEffect(() => {
    if (renderClient.subscribe) {
      let reconciled = false;
      let streamedRevision = 0;
      return renderClient.subscribe(
        renderId,
        (job) => {
          streamedRevision += 1;
          updateJob(job);
        },
        () => {
          if (reconciled) return;
          reconciled = true;
          const reconciliationRevision = streamedRevision;
          void renderClient
            .get(renderId)
            .then((job) => {
              if (streamedRevision === reconciliationRevision) updateJob(job);
            })
            .catch(() => undefined);
        },
      );
    }

    const timer = window.setInterval(
      () =>
        void renderClient
          .get(renderId)
          .then(updateJob)
          .catch(() => undefined),
      500,
    );
    return () => window.clearInterval(timer);
  }, [renderClient, renderId, updateJob]);

  return null;
}

export function RenderActivityProvider({
  children,
  persistence,
  renderClient,
}: {
  children: ReactNode;
  persistence: RenderActivityPersistence;
  renderClient?: RenderActivityClient;
}) {
  const projectsQuery = useQuery({
    queryKey: queryKeys.persistence.projects(),
    queryFn: () => persistence.projects.list(),
    enabled: Boolean(renderClient),
    retry: false,
  });
  const [projects, setProjects] = useState<
    Record<string, ProjectRenderActivity>
  >({});

  const track = useCallback((job: RenderJob, projectName?: string) => {
    setProjects((current) => {
      const project = current[job.projectId];
      if (!project && !projectName) return current;
      return {
        ...current,
        [job.projectId]: {
          projectName: projectName ?? project!.projectName,
          jobs: upsertJob(project?.jobs ?? [], job),
        },
      };
    });
  }, []);

  useEffect(() => {
    if (!renderClient || !projectsQuery.data) return;
    let active = true;
    void Promise.all(
      projectsQuery.data.map(async (project) => ({
        project,
        jobs: await renderClient.list(project.id),
      })),
    )
      .then((loaded) => {
        if (!active) return;
        setProjects((current) =>
          Object.fromEntries(
            loaded.map(({ project, jobs }) => [
              project.id,
              {
                projectName: project.name,
                jobs: (current[project.id]?.jobs ?? []).reduce(
                  (merged, job) => upsertJob(merged, job),
                  jobs,
                ),
              },
            ]),
          ),
        );
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [projectsQuery.data, renderClient]);

  const active = Object.values(projects)
    .flatMap(({ projectName, jobs }) =>
      jobs
        .filter(({ state }) => !terminalRenderStates.has(state))
        .map((job) => ({ projectName, job })),
    )
    .sort((left, right) =>
      left.job.createdAt.localeCompare(right.job.createdAt),
    );
  return (
    <Context value={{ active, projects, track }}>
      {children}
      {renderClient
        ? active.map(({ job }) => (
            <RenderWatcher
              key={job.id}
              renderClient={renderClient}
              renderId={job.id}
              updateJob={track}
            />
          ))
        : null}
    </Context>
  );
}

export function useRenderActivity(): RenderActivityContextValue {
  const value = useContext(Context);
  if (!value)
    throw new Error(
      "useRenderActivity must be used within RenderActivityProvider",
    );
  return value;
}
