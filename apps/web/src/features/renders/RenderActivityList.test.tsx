// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProjectSummary, RenderJob } from "@studynarrator/shared-types";
import type { RenderProgressClient } from "@/services/renders/renderClient.js";
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

afterEach(cleanup);

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
    } satisfies Pick<RenderProgressClient, "get" | "list" | "subscribe">;
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

    const activity = await screen.findByRole("region", { name: "Rendering" });
    expect(within(activity).getAllByRole("listitem")).toHaveLength(2);
    expect(
      within(activity).getByRole("link", {
        name: "Database notes: Processing chunk 2 of 4",
      }),
    ).toHaveAttribute("href", `/projects/${databaseJob.projectId}?tab=render`);
    expect(
      within(activity).getByRole("link", { name: "Network notes: Queued…" }),
    ).toBeVisible();
    expect(
      within(activity).getByRole("progressbar", {
        name: "Database notes render progress",
      }),
    ).toHaveValue(1);

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
    ).not.toBeInTheDocument();
  });
});
