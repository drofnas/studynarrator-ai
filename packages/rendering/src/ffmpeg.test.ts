import { execFile } from "node:child_process";
import { mkdtemp, open, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { encodeMp3 } from "./ffmpeg.js";

const runFile = promisify(execFile);
const directories: string[] = [];

function pcmWav() {
  const sampleRate = 8_000;
  const samples = sampleRate / 10;
  const dataLength = samples * 2;
  const wav = Buffer.alloc(44 + dataLength);
  wav.write("RIFF", 0);
  wav.writeUInt32LE(36 + dataLength, 4);
  wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(sampleRate, 24);
  wav.writeUInt32LE(sampleRate * 2, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36);
  wav.writeUInt32LE(dataLength, 40);
  return wav;
}

afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map(async (path) => await rm(path, { recursive: true, force: true })),
  );
});

describe("encodeMp3", () => {
  it("persists Unicode metadata passed as separate FFmpeg arguments", async () => {
    // Arrange
    const directory = await mkdtemp(join(tmpdir(), "studynarrator-ffmpeg-"));
    directories.push(directory);
    const inputPath = join(directory, "input.wav");
    const outputPath = join(directory, "output.mp3");
    const metadata = {
      title: "Café: ‘indexes’ & $HOME; [part 1]",
      artist: "Ada Lovelace, Ph.D.",
      year: 2026,
      genre: "Audio Book",
    };
    await writeFile(inputPath, pcmWav());

    // Act
    await encodeMp3({ inputPath, outputPath, metadata });
    const output = await open(outputPath, "r");
    const header = Buffer.alloc(4);
    try {
      await output.read(header);
    } finally {
      await output.close();
    }
    const { stdout } = await runFile("ffprobe", [
      "-v",
      "error",
      "-show_entries",
      "format_tags=title,artist,date,genre",
      "-of",
      "json",
      outputPath,
    ]);
    const result = JSON.parse(stdout) as {
      format?: { tags?: Record<string, string> };
    };

    // Assert
    expect([...header]).toEqual([0x49, 0x44, 0x33, 0x03]);
    expect(result.format?.tags).toMatchObject({
      title: metadata.title,
      artist: metadata.artist,
      date: String(metadata.year),
      genre: metadata.genre,
    });
  });
});
