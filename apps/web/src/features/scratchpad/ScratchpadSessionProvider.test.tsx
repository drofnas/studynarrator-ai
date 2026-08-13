// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ScratchpadPreviewResult } from "@studynarrator/shared-types";
import { ScratchpadSessionProvider, useScratchpadSession } from "./ScratchpadSessionProvider.js";

const revokeObjectUrl = vi.fn();

function result(index: number): ScratchpadPreviewResult {
  return {
    schemaVersion: 2,
    id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    createdAt: "2026-08-12T12:00:00.000Z",
    connectionProfileId: "profile",
    connectionProfileName: "Local",
    modelId: "model",
    voiceId: `voice-${String(index)}`,
    voiceLabel: `Voice ${String(index)}`,
    speed: 1,
    originalText: "Speech.",
    readableText: "Speech.",
    transformedText: "Speech.",
    lexiconApplied: false,
    warnings: [],
    cache: {
      key: String(index).padStart(64, "a"), status: "hit", byteLength: 3,
      createdAt: "2026-08-12T12:00:00.000Z", lastUsedAt: "2026-08-12T12:00:00.000Z"
    },
    audio: { mimeType: "audio/wav", base64: "AQID", byteLength: 3 }
  };
}

function Harness() {
  const session = useScratchpadSession();
  return <><button onClick={() => { for (let index = 1; index <= 6; index += 1) session.add(result(index)); }}>Add six</button><button onClick={() => session.clear()}>Clear all</button><span>{session.results.length}</span><span>{session.active?.result.voiceId ?? "none"}</span></>;
}

beforeEach(() => {
  revokeObjectUrl.mockReset();
  vi.stubGlobal("atob", (value: string) => Buffer.from(value, "base64").toString("binary"));
  vi.stubGlobal("URL", { createObjectURL: vi.fn((_: Blob) => `blob:test-${crypto.randomUUID()}`), revokeObjectURL: revokeObjectUrl });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("Scratchpad session history", () => {
  it("keeps five results, selects the newest, and revokes evicted and cleared URLs", async () => {
    const user = userEvent.setup();
    render(<ScratchpadSessionProvider><Harness /></ScratchpadSessionProvider>);
    await user.click(screen.getByRole("button", { name: "Add six" }));
    expect(screen.getByText("5")).toBeInTheDocument();
    expect(screen.getByText("voice-6")).toBeInTheDocument();
    expect(revokeObjectUrl).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole("button", { name: "Clear all" }));
    expect(screen.getByText("0")).toBeInTheDocument();
    expect(screen.getByText("none")).toBeInTheDocument();
    expect(revokeObjectUrl).toHaveBeenCalledTimes(6);
  });
});
