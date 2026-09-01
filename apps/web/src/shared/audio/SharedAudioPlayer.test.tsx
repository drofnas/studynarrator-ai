// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RenderWaveform } from "@studynarrator/shared-types";
import { SharedAudioPlayer } from "./SharedAudioPlayer.js";

const waveform: RenderWaveform = {
  status: "available",
  renderId: "00000000-0000-4000-8000-000000000003",
  durationMs: 20_000,
  sampleRate: 8_000,
  peaks: [0, 64, 255, 128],
};

const pauseAudio = vi.fn((_audio: HTMLMediaElement) => undefined);

beforeEach(() => {
  pauseAudio.mockReset();
  vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(
    () => undefined,
  );
  vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(function (
    this: HTMLMediaElement,
  ) {
    fireEvent.play(this);
    return Promise.resolve();
  });
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(function (
    this: HTMLMediaElement,
  ) {
    pauseAudio(this);
    fireEvent.pause(this);
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function loadAudio(container: HTMLElement, duration = 20): HTMLAudioElement {
  const audio = container.querySelector("audio");
  if (!audio) throw new Error("Expected the player audio element.");
  Object.defineProperty(audio, "duration", {
    configurable: true,
    value: duration,
  });
  fireEvent.loadedMetadata(audio);
  return audio;
}

describe("SharedAudioPlayer", () => {
  it("provides full transport, volume, mute, and stop controls", async () => {
    const { container } = render(
      <SharedAudioPlayer
        label="Chapter one"
        src="/chapter.mp3"
        waveform={waveform}
      />,
    );
    const audio = loadAudio(container);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Play" }));
      await Promise.resolve();
    });
    expect(screen.getByRole("status")).toHaveTextContent("Playing");
    fireEvent.change(screen.getByLabelText("Volume"), {
      target: { value: "0.35" },
    });
    expect(audio.volume).toBe(0.35);
    fireEvent.click(screen.getByRole("button", { name: "Mute" }));
    expect(audio.muted).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    expect(audio.currentTime).toBe(0);
    expect(screen.getByRole("status")).toHaveTextContent("Ready");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Replay" }));
      await Promise.resolve();
    });
    expect(screen.getByRole("status")).toHaveTextContent("Playing");
  });

  it("seeks through keyboard and waveform pointer input", () => {
    const { container } = render(
      <SharedAudioPlayer
        label="Chapter one"
        src="/chapter.mp3"
        waveform={waveform}
      />,
    );
    const audio = loadAudio(container);
    const seek = screen.getByLabelText("Seek playback");
    fireEvent.keyDown(seek, { key: "ArrowRight" });
    expect(audio.currentTime).toBe(5);
    fireEvent.keyDown(seek, { key: "End" });
    expect(audio.currentTime).toBe(20);
    const signal = screen.getByRole("group", { name: "Playback waveform" });
    vi.spyOn(signal, "getBoundingClientRect").mockReturnValue({
      x: 10,
      y: 0,
      left: 10,
      top: 0,
      width: 200,
      height: 54,
      right: 210,
      bottom: 54,
      toJSON: () => ({}),
    });
    fireEvent.pointerDown(signal, { clientX: 60 });
    expect(audio.currentTime).toBe(5);
  });

  it("uses fallback progress, resets on a source change, and reports media failure", () => {
    const { container, rerender } = render(
      <SharedAudioPlayer
        label="Preview"
        src="/one.wav"
        waveform={{
          status: "unavailable",
          renderId: waveform.renderId,
          reason: "extractionFailed",
        }}
      />,
    );
    const audio = loadAudio(container, 12);
    expect(
      screen.getByRole("group", { name: "Playback progress" }),
    ).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Seek playback"), {
      target: { value: "7" },
    });
    expect(audio.currentTime).toBe(7);
    rerender(<SharedAudioPlayer label="Preview two" src="/two.wav" />);
    expect(screen.getByLabelText("Seek playback")).toHaveValue("0");
    fireEvent.error(container.querySelector("audio")!);
    expect(screen.getByRole("status")).toHaveTextContent(
      "Playback unavailable",
    );
    expect(screen.getByRole("button", { name: "Play" })).toBeDisabled();
  });

  it("pauses and disables every interaction while playback is unavailable during regeneration", () => {
    const { container, rerender } = render(
      <SharedAudioPlayer label="Prior render" src="/prior.mp3" />,
    );
    const audio = loadAudio(container, 12);
    rerender(
      <SharedAudioPlayer label="Prior render" src="/prior.mp3" disabled />,
    );
    expect(pauseAudio).toHaveBeenCalled();
    expect(
      screen.getByLabelText("Audio player for Prior render"),
    ).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByRole("button", { name: "Play" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Stop" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Replay" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Mute" })).toBeDisabled();
    expect(screen.getByLabelText("Seek playback")).toBeDisabled();
    expect(screen.getByLabelText("Volume")).toBeDisabled();
    expect(audio.currentTime).toBe(0);
  });
});
