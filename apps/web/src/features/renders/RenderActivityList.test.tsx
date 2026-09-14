// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProjectSummary, RenderJob } from "@studynarrator/shared-types";
import type { RenderProgressClient } from "@/services/renders/renderClient.js";
import {
  readViewedRenders,
  storeViewedRenders,
} from "@/services/renders/renderActivityStore.js";
import { queryKeys } from "@/app/queryKeys.js";
import { RenderActivityProvider } from "./RenderActivityProvider.js";
import { RenderActivityList } from "./RenderActivityList.js";

const projects: ProjectSummary[] = [
  {
    id: "00000000-0000-4000-8000-000000000001",
    name: "Database notes",
    description: "",
    scriptHash: "a".repeat(64),
    scriptLineCount: 1,
    audioDurationMs: null,
    createdAt: "2026-09-14T12:00:00.000Z",
    updatedAt: "2026-09-14T12:00:00.000Z",
  },
  {
    id: "00000000-0000-4000-8000-000000000002",
    name: "Network notes",
    description: "",
    scriptHash: "b".repeat(64),
    scriptLineCount: 1,
    audioDurationMs: null,
    createdAt: "2026-09-14T12:01:00.000Z",
    updatedAt: "2026-09-14T12:01:00.000Z",
  },
];

function job(
  projectId: string,
  id: string,
  state: RenderJob["state"],
): RenderJob {
  const terminal = ["complete", "failed", "canceled"].includes(state);
  return {
    contractVersion: 1,
    id,
    projectId,
    planId: "00000000-0000-4000-8000-000000000090",
    retryOfRenderId: null,
    pinned: false,
    state,
    progress: {
      phase: state,
      sectionTitle: null,
      sectionOrdinal: 1,
      sectionCount: 1,
      entryOrdinal: terminal ? null : 1,
      speechOrdinal: 1,
      speechCount: 1,
      chunkOrdinal: terminal ? null : 2,
      completedChunks: state === "queued" ? 0 : 1,
      totalChunks: 4,
      cacheHits: 0,
      cacheMisses: 4,
      ttsRequests: 1,
      speakerId: terminal ? null : "teacher",
      voiceId: terminal ? null : "voice",
      excerpt: null,
      elapsedMs: 500,
    },
    error: null,
    createdAt: "2026-09-14T12:02:00.000Z",
    startedAt: state === "queued" ? null : "2026-09-14T12:02:00.100Z",
    finishedAt: terminal ? "2026-09-14T12:02:01.000Z" : null,
  };
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  localStorage.clear();
});

describe("RenderActivityList", () => {
  it("shows multiple active projects and keeps progress live outside project routes", async () => {
    const databaseJob = job(
      projects[0]!.id,
      "00000000-0000-4000-8000-000000000091",
      "synthesizing",
    );
    const networkJob = job(
      projects[1]!.id,
      "00000000-0000-4000-8000-000000000092",
      "queued",
    );
    const publish = new Map<string, (job: RenderJob) => void>();
    const unsubscribe = vi.fn();
    const renderClient = {
      list: vi.fn(async (projectId: string) =>
        projectId === databaseJob.projectId ? [databaseJob] : [networkJob],
      ),
      get: vi.fn(),
      listArtifacts: vi.fn(async () => []),
      subscribe: vi.fn(
        (
          renderId: string,
          onJob: (next: RenderJob) => void,
          _onDropped: () => void,
        ) => {
          publish.set(renderId, onJob);
          return unsubscribe;
        },
      ),
    } satisfies Pick<
      RenderProgressClient,
      "get" | "list" | "listArtifacts" | "subscribe"
    >;
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    render(
      <QueryClientProvider client={queryClient}>
        <RenderActivityProvider
          persistence={{ projects: { list: vi.fn(async () => projects) } }}
          renderClient={renderClient}
        >
          <MemoryRouter initialEntries={["/settings/general"]}>
            <RenderActivityList />
          </MemoryRouter>
        </RenderActivityProvider>
      </QueryClientProvider>,
    );

    const activity = await screen.findByRole("region", {
      name: "Render activity",
    });
    expect(within(activity).getAllByRole("listitem")).toHaveLength(2);
    expect(
      within(activity).getByRole("link", {
        name: "Database notes: Processing chunk 2 of 4",
      }),
    ).toHaveAttribute(
      "href",
      `/projects/${databaseJob.projectId}?tab=render&render=${databaseJob.id}`,
    );
    expect(
      within(activity).getByRole("link", { name: "Network notes: Queued…" }),
    ).toBeVisible();
    expect(
      within(activity).getByRole("progressbar", {
        name: "Database notes render progress",
      }),
    ).toHaveValue(1);

    await waitFor(() =>
      expect(renderClient.subscribe).toHaveBeenCalledTimes(2),
    );
    act(() => {
      publish.get(databaseJob.id)!({
        ...databaseJob,
        progress: { ...databaseJob.progress, completedChunks: 2 },
      });
    });
    expect(
      within(activity).getByRole("link", {
        name: "Database notes: Processing chunk 3 of 4",
      }),
    ).toBeVisible();

    act(() => {
      publish.get(networkJob.id)!({ ...networkJob, state: "canceled" });
    });
    expect(
      within(activity).queryByRole("link", { name: /Network notes/u }),
    ).toHaveTextContent("Render canceled");
    expect(
      within(activity).queryByRole("progressbar", {
        name: "Network notes render progress",
      }),
    ).not.toBeInTheDocument();
  });
});

function activityFixture(initialJobs: RenderJob[]) {
  let jobs = initialJobs;
  const publish = new Map<string, (job: RenderJob) => void>();
  const dropped = new Map<string, () => void>();
  const unsubscribe = vi.fn();
  const client = {
    list: vi.fn(async (projectId: string) =>
      jobs.filter((job) => job.projectId === projectId),
    ),
    get: vi.fn(async (id: string) => jobs.find((job) => job.id === id)!),
    listArtifacts: vi.fn(async (renderId: string) => [
      {
        contractVersion: 1 as const,
        id: "00000000-0000-4000-8000-000000000080",
        renderId,
        type: "mp3" as const,
        fileName: "render.mp3",
        sizeBytes: 100,
        durationMs: 1000,
        createdAt: "2026-09-14T12:02:01.000Z",
      },
    ]),
    subscribe: vi.fn(
      (id: string, onJob: (job: RenderJob) => void, onDropped: () => void) => {
        publish.set(id, onJob);
        dropped.set(id, onDropped);
        return unsubscribe;
      },
    ),
  };
  const mount = () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const view = render(
      <QueryClientProvider client={queryClient}>
        <RenderActivityProvider
          persistence={{ projects: { list: async () => projects } }}
          renderClient={client}
        >
          <MemoryRouter>
            <RenderActivityList />
          </MemoryRouter>
        </RenderActivityProvider>
      </QueryClientProvider>,
    );
    return { ...view, queryClient };
  };
  return {
    client,
    publish,
    dropped,
    unsubscribe,
    mount,
    setJobs: (next: RenderJob[]) => {
      jobs = next;
    },
  };
}
const firstId = "00000000-0000-4000-8000-000000000091";
const secondId = "00000000-0000-4000-8000-000000000092";

describe("persistent render results", () => {
  it("keeps a completion unviewed after an active click, restores it after reload, and persists viewing only its exact ID", async () => {
    const active = job(projects[0]!.id, firstId, "queued");
    const other = job(projects[0]!.id, secondId, "complete");
    const fixture = activityFixture([active, other]);
    let mounted = fixture.mount();
    fireEvent.click(
      await screen.findByRole("link", { name: "Database notes: Queued…" }),
    );
    expect(readViewedRenders()).toEqual(new Set());
    const complete = job(active.projectId, active.id, "complete");
    fixture.setJobs([complete, other]);
    act(() => fixture.publish.get(active.id)!(complete));
    expect(
      screen.getAllByRole("link", { name: /Render complete/u }),
    ).toHaveLength(2);
    mounted.unmount();
    mounted = fixture.mount();
    await waitFor(() =>
      expect(
        screen.getAllByRole("link", { name: /Render complete/u }),
      ).toHaveLength(2),
    );
    const selected = screen
      .getAllByRole("link")
      .find((link) =>
        link.getAttribute("href")?.endsWith(`render=${firstId}`),
      )!;
    fireEvent.click(selected);
    expect(readViewedRenders()).toEqual(new Set([firstId]));
    expect(screen.getAllByRole("link")).toHaveLength(1);
    expect(screen.getByRole("link")).toHaveAttribute(
      "href",
      `/projects/${other.projectId}?tab=render&render=${secondId}`,
    );
    mounted.unmount();
    fixture.mount();
    await waitFor(() => expect(screen.getAllByRole("link")).toHaveLength(1));
    expect(screen.getByRole("link")).toHaveAttribute(
      "href",
      `/projects/${other.projectId}?tab=render&render=${secondId}`,
    );
  });

  it("distinguishes failed and canceled results and retains them through temporary service errors", async () => {
    const fixture = activityFixture([
      job(projects[0]!.id, firstId, "failed"),
      job(projects[1]!.id, secondId, "canceled"),
    ]);
    fixture.mount();
    expect(
      await screen.findByRole("link", { name: /Render failed/u }),
    ).toBeVisible();
    expect(
      screen.getByRole("link", { name: /Render canceled/u }),
    ).toBeVisible();
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
    fixture.client.list.mockRejectedValue(
      new Error("sentinel-private-endpoint"),
    );
    fireEvent.focus(window);
    await waitFor(() => expect(fixture.client.list).toHaveBeenCalledTimes(4));
    expect(screen.getAllByRole("link")).toHaveLength(2);
    expect(document.body.textContent).not.toContain(
      "sentinel-private-endpoint",
    );
  });

  it("prunes deleted projects, removed audio, and obsolete viewed IDs without persisting content", async () => {
    storeViewedRenders(new Set(["00000000-0000-4000-8000-000000000099"]));
    const fixture = activityFixture([
      job(projects[0]!.id, firstId, "complete"),
      job(projects[1]!.id, secondId, "complete"),
    ]);
    const { queryClient } = fixture.mount();
    await waitFor(() => expect(screen.getAllByRole("link")).toHaveLength(2));
    expect(readViewedRenders()).toEqual(new Set());
    fixture.client.listArtifacts.mockResolvedValue([]);
    act(() => {
      queryClient.setQueryData(queryKeys.persistence.projects(), [projects[0]]);
    });
    await waitFor(() =>
      expect(screen.queryByRole("region")).not.toBeInTheDocument(),
    );
    expect(localStorage.getItem("studynarrator.viewed-renders.v1")).toBe("[]");
  });

  it("reconciles a dropped stream with non-overlapping polls, ignores stale responses, and stops after completion", async () => {
    vi.useFakeTimers();
    const active = job(projects[0]!.id, firstId, "queued");
    const fixture = activityFixture([active]);
    fixture.mount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    let resolve: (job: RenderJob) => void = () => undefined;
    fixture.client.get.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    act(() => fixture.dropped.get(firstId)!());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });
    expect(fixture.client.get).toHaveBeenCalledTimes(1);
    const progress = job(active.projectId, firstId, "synthesizing");
    act(() => fixture.publish.get(firstId)!(progress));
    await act(async () => {
      resolve(active);
    });
    expect(
      screen.getByRole("link", { name: /Processing chunk 2/u }),
    ).toBeVisible();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(fixture.client.get).toHaveBeenCalledTimes(1);
    fixture.setJobs([job(active.projectId, firstId, "complete")]);
    act(() => fixture.dropped.get(firstId)!());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(
      screen.getByRole("link", { name: /Render complete/u }),
    ).toBeVisible();
    expect(fixture.unsubscribe).toHaveBeenCalledOnce();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });
    expect(fixture.client.get).toHaveBeenCalledTimes(2);
    expect(fixture.client.list).toHaveBeenCalledTimes(2);
  });

  it("refreshes history at a bounded cadence and skips artifact checks for viewed results", async () => {
    vi.useFakeTimers();
    const fixture = activityFixture([
      job(projects[0]!.id, firstId, "complete"),
      job(projects[1]!.id, secondId, "complete"),
    ]);
    fixture.mount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(fixture.client.list).toHaveBeenCalledTimes(2);
    expect(fixture.client.listArtifacts).toHaveBeenCalledTimes(2);
    fireEvent.click(
      screen.getByRole("link", { name: /Database notes: Render complete/u }),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(9000);
    });
    expect(fixture.client.list).toHaveBeenCalledTimes(2);
    fixture.client.listArtifacts.mockResolvedValue([]);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(fixture.client.list).toHaveBeenCalledTimes(4);
    expect(fixture.client.listArtifacts).toHaveBeenCalledTimes(3);
    expect(screen.queryByRole("region")).not.toBeInTheDocument();
    expect(readViewedRenders()).toEqual(new Set([firstId]));
    expect(fixture.client.get).not.toHaveBeenCalled();
  });

  it("does not let an in-flight history response undo streamed completion", async () => {
    const active = job(projects[0]!.id, firstId, "queued");
    const fixture = activityFixture([active]);
    fixture.mount();
    await screen.findByRole("link", { name: /Queued/u });
    let resolve: (jobs: RenderJob[]) => void = () => undefined;
    fixture.client.list.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    fireEvent.focus(window);
    await waitFor(() => expect(fixture.client.list).toHaveBeenCalledTimes(4));
    act(() =>
      fixture.publish.get(firstId)!(job(active.projectId, firstId, "complete")),
    );
    await act(async () => {
      resolve([active]);
    });
    expect(
      screen.getByRole("link", { name: /Render complete/u }),
    ).toBeVisible();
    expect(fixture.client.subscribe).toHaveBeenCalledOnce();
  });
});
