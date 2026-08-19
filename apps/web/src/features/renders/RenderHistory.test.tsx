// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  RenderClient,
  RenderHistorySegment,
  RenderJob,
} from "@studynarrator/shared-types";
import { RenderHistory } from "./RenderHistory.js";

const job: RenderJob = {
  contractVersion: 1,
  id: "00000000-0000-4000-8000-000000000003",
  projectId: "00000000-0000-4000-8000-000000000001",
  planId: "00000000-0000-4000-8000-000000000002",
  retryOfRenderId: null,
  state: "complete",
  progress: {
    phase: "complete",
    sectionTitle: null,
    sectionOrdinal: 1,
    sectionCount: 1,
    entryOrdinal: null,
    speechOrdinal: 100,
    speechCount: 100,
    chunkOrdinal: null,
    completedChunks: 100,
    totalChunks: 100,
    cacheHits: 80,
    cacheMisses: 20,
    ttsRequests: 20,
    speakerId: null,
    voiceId: null,
    excerpt: null,
    elapsedMs: 12_500,
  },
  error: null,
  createdAt: "2026-08-12T14:00:00.000Z",
  startedAt: "2026-08-12T14:00:00.000Z",
  finishedAt: "2026-08-12T14:00:12.500Z",
};

function speech(ordinal: number, available = true): RenderHistorySegment {
  return {
    renderId: job.id,
    ordinal,
    type: "speech",
    state: "complete",
    sectionTitle: "Opening",
    sourceRange: {
      start: { line: ordinal, column: 1 },
      end: { line: ordinal, column: 20 },
    },
    audioDurationMs: 1_000,
    cacheStatus: ordinal % 2 ? "hit" : "miss",
    error: null,
    speakerId: "teacher",
    speakerLabel: "Teacher",
    modelId: "frozen-model",
    voiceId: "voice_teacher",
    readableText: `Readable segment ${String(ordinal)}`,
    ttsText: `TTS segment ${String(ordinal)}`,
    audio: available
      ? {
          status: "available",
          mimeType: "audio/wav",
          sizeBytes: 1_024,
          checksum: "b".repeat(64),
        }
      : { status: "unavailable" },
  };
}

const segments = Array.from({ length: 102 }, (_, index) =>
  speech(index + 1, index !== 0),
);

beforeEach(() => {
  vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(
    () => undefined,
  );
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(
    () => undefined,
  );
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("RenderHistory", () => {
  it("loads expanded review data lazily and provides exact playback, copy, export, source, and paging actions", async () => {
    const listArtifacts = vi.fn(async () => [
      {
        contractVersion: 1 as const,
        id: "00000000-0000-4000-8000-000000000004",
        renderId: job.id,
        type: "mp3" as const,
        fileName: "review.mp3",
        sizeBytes: 2_097_152,
        checksum: "a".repeat(64),
        durationMs: 125_000,
        createdAt: job.finishedAt!,
      },
    ]);
    const listSegments = vi.fn(async () => segments);
    const renderAudioSource = vi.fn(() => "/render.mp3");
    const segmentAudioSource = vi.fn(() => "/segment.wav");
    const exportSegment = vi.fn(async () => ({
      disposition: "download" as const,
      fileName: "000002.wav",
    }));
    const client = {
      start: vi.fn(),
      list: vi.fn(),
      get: vi.fn(),
      cancel: vi.fn(),
      retry: vi.fn(),
      listArtifacts,
      exportArtifact: vi.fn(),
      listSegments,
      getWaveform: vi.fn(async () => ({
        status: "available" as const,
        renderId: job.id,
        sourceChecksum: "a".repeat(64),
        durationMs: 125_000,
        sampleRate: 8_000,
        peaks: [10, 200],
      })),
      renderAudioSource,
      segmentAudioSource,
      exportSegment,
    } as unknown as RenderClient;
    const writeText = vi.fn(async (_value: string) => undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    const onSourceLine = vi.fn();
    const onRerender = vi.fn(async () => undefined);
    const onNotice = vi.fn();

    function Harness() {
      const [expanded, setExpanded] = useState<RenderJob>();
      return (
        <RenderHistory
          jobs={[job]}
          expandedJob={expanded}
          client={client}
          onExpand={setExpanded}
          onCancel={vi.fn()}
          onRetry={vi.fn()}
          onRerender={onRerender}
          onSourceLine={onSourceLine}
          onNotice={onNotice}
          onError={vi.fn()}
          voiceCatalog={{
            schemaVersion: 1,
            modelId: "frozen-model",
            entries: [
              {
                voiceId: "voice_teacher",
                label: "Teacher Voice",
                enabled: true,
                favorite: false,
                language: null,
                locale: null,
                accent: null,
                category: null,
                style: null,
                sampleText: null,
              },
            ],
          }}
        />
      );
    }
    render(<Harness />);
    expect(listSegments).not.toHaveBeenCalled();
    const disclosure = screen.getByRole("button", { name: /8\/12\/2026/u });
    expect(disclosure).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(disclosure);
    expect(disclosure).toHaveAttribute("aria-expanded", "true");
    await waitFor(() => expect(listSegments).toHaveBeenCalledWith(job.id));
    expect(await screen.findByText("frozen-model")).toBeInTheDocument();
    expect(
      screen.getAllByText(/Teacher · Teacher Voice/u).length,
    ).toBeGreaterThan(0);
    expect(screen.getByText("2.0 MB")).toBeInTheDocument();
    expect(screen.getByText("2:05")).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: "Play completed render" }),
    );
    expect(renderAudioSource).toHaveBeenCalledWith(job.id);
    expect(
      await screen.findByLabelText(/Audio player for Completed render/u),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Play segment 2" }));
    expect(segmentAudioSource).toHaveBeenCalledWith(job.id, 2);
    fireEvent.click(
      screen.getAllByRole("button", { name: "Copy readable" })[1]!,
    );
    fireEvent.click(screen.getAllByRole("button", { name: "Copy TTS" })[1]!);
    await waitFor(() =>
      expect(writeText.mock.calls.map(([value]) => value)).toEqual([
        "Readable segment 2",
        "TTS segment 2",
      ]),
    );
    fireEvent.click(
      screen.getAllByRole("button", { name: "Download segment" })[0]!,
    );
    expect(exportSegment).toHaveBeenCalledWith(job.id, 2);
    fireEvent.click(screen.getByRole("button", { name: "Source line 2" }));
    expect(onSourceLine).toHaveBeenCalledWith(2);

    expect(
      screen.getByText(/no retained synthesis media/u),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Rerender this frozen plan" }),
    );
    expect(onRerender).toHaveBeenCalledWith(job);
    const rows = screen.getByLabelText("Ordered segment rows");
    expect(
      within(rows).queryByText("Readable segment 102"),
    ).not.toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Load 100 more segments" }),
    );
    expect(within(rows).getByText("Readable segment 102")).toBeInTheDocument();
  });
});
