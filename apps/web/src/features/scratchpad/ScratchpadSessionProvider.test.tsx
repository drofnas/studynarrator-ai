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
    schemaVersion: 3,
    id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    createdAt: "2026-08-12T12:00:00.000Z",
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
  return <><button onClick={() => session.replace(result(1))}>Add first</button><button onClick={() => session.replace(result(2))}>Add second</button><span>{session.active?.result.voiceId ?? "none"}</span></>;
}

beforeEach(() => {
  revokeObjectUrl.mockReset();
  vi.stubGlobal("atob", (value: string) => Buffer.from(value, "base64").toString("binary"));
  vi.stubGlobal("URL", { createObjectURL: vi.fn((_: Blob) => `blob:test-${crypto.randomUUID()}`), revokeObjectURL: revokeObjectUrl });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("Scratchpad session result", () => {
  it("keeps only the latest result and revokes replaced and unmounted URLs", async () => {
    const user = userEvent.setup();
    const rendered = render(<ScratchpadSessionProvider><Harness /></ScratchpadSessionProvider>);
    await user.click(screen.getByRole("button", { name: "Add first" }));
    expect(screen.getByText("voice-1")).toBeInTheDocument();
    expect(revokeObjectUrl).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Add second" }));
    expect(screen.getByText("voice-2")).toBeInTheDocument();
    expect(revokeObjectUrl).toHaveBeenCalledTimes(1);
    rendered.unmount();
    expect(revokeObjectUrl).toHaveBeenCalledTimes(2);
  });
});
