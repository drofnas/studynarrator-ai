import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import { createFfmpegProbe } from "./index.js";

function fakeChild() {
  const child = new EventEmitter() as EventEmitter & {
    stdout: PassThrough;
    stderr: PassThrough;
    stdin: PassThrough;
    kill: ReturnType<typeof vi.fn>;
  };
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.stdin = new PassThrough();
  child.kill = vi.fn();
  return child;
}

describe("createFfmpegProbe", () => {
  it("spawns FFmpeg with an argument array and shell disabled", async () => {
    const child = fakeChild();
    const spawnProcess = vi.fn(() => child);
    const pending = createFfmpegProbe({
      executable: "/opt/ffmpeg",
      spawnProcess: spawnProcess as never,
    }).run();
    child.stdout.write("ffmpeg version 8.1.2\nlong configuration output");
    child.emit("close", 0);

    await expect(pending).resolves.toEqual({
      status: "pass",
      executable: "/opt/ffmpeg",
      version: "ffmpeg version 8.1.2",
    });
    expect(spawnProcess).toHaveBeenCalledWith(
      "/opt/ffmpeg",
      ["-version"],
      expect.objectContaining({ shell: false }),
    );
  });

  it("maps a missing executable without leaking the raw error", async () => {
    const child = fakeChild();
    const pending = createFfmpegProbe({
      spawnProcess: (() => child) as never,
    }).run();
    const error = Object.assign(new Error("private path detail"), {
      code: "ENOENT",
    });
    child.emit("error", error);

    const result = await pending;
    expect(result).toMatchObject({ status: "fail", code: "FFMPEG_NOT_FOUND" });
    expect(JSON.stringify(result)).not.toContain("private path detail");
  });

  it("kills a probe that exceeds its timeout", async () => {
    vi.useFakeTimers();
    const child = fakeChild();
    const pending = createFfmpegProbe({
      timeoutMs: 50,
      spawnProcess: (() => child) as never,
    }).run();
    await vi.advanceTimersByTimeAsync(51);
    await expect(pending).resolves.toMatchObject({
      status: "fail",
      code: "FFMPEG_TIMEOUT",
    });
    expect(child.kill).toHaveBeenCalledWith("SIGKILL");
    vi.useRealTimers();
  });

  it("maps synchronous start and nonzero exit failures", async () => {
    await expect(
      createFfmpegProbe({
        spawnProcess: (() => {
          throw new Error("private spawn detail");
        }) as never,
      }).run(),
    ).resolves.toMatchObject({ status: "fail", code: "FFMPEG_START_FAILED" });

    const child = fakeChild();
    const pending = createFfmpegProbe({
      spawnProcess: (() => child) as never,
    }).run();
    child.stderr.write("private command output");
    child.emit("close", 2);
    const result = await pending;
    expect(result).toMatchObject({
      status: "fail",
      code: "FFMPEG_EXIT_FAILED",
    });
    expect(JSON.stringify(result)).not.toContain("private command output");
  });

  it("bounds captured output and rejects empty successful output", async () => {
    const child = fakeChild();
    const pending = createFfmpegProbe({
      maxOutputBytes: 8,
      spawnProcess: (() => child) as never,
    }).run();
    child.stdout.write("                ");
    child.emit("close", 0);
    await expect(pending).resolves.toMatchObject({
      status: "fail",
      code: "FFMPEG_INVALID_OUTPUT",
    });
  });
});
