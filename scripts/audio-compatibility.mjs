// Bundle with esbuild, then run in each compared image (see the R27a report).
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  normalizeSpeechWav,
  concatenateWavs,
  encodeMp3,
  remuxMp3Metadata,
  extractWaveformPeaks,
  probeAudioFile,
} from "../packages/rendering/src/ffmpeg.js";

const directory = await mkdtemp(join(tmpdir(), "studynarrator-audio-"));
const path = (name) => join(directory, name);
try {
  const samples = 24_000 * 20;
  const wav = Buffer.alloc(44 + samples * 2);
  wav.write("RIFF");
  wav.writeUInt32LE(wav.length - 8, 4);
  wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(24_000, 24);
  wav.writeUInt32LE(48_000, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36);
  wav.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++)
    wav.writeInt16LE(
      Math.round(8_000 * Math.sin((2 * Math.PI * 220 * i) / 24_000)),
      44 + i * 2,
    );
  await writeFile(path("input.wav"), wav);
  await writeFile(
    path("list.txt"),
    `file '${path("normal.wav")}'\nfile '${path("normal.wav")}'\n`,
  );
  const metadata = {
    title: "Compatibility sample",
    artist: "StudyNarrator AI",
    year: 2026,
    genre: "Speech",
  };
  const durations = [];
  for (let i = 0; i < 4; i++) {
    const started = performance.now();
    await normalizeSpeechWav({
      inputPath: path("input.wav"),
      outputPath: path("normal.wav"),
      gainDb: -3,
    });
    await concatenateWavs({
      listPath: path("list.txt"),
      outputPath: path("concat.wav"),
    });
    await encodeMp3({
      inputPath: path("concat.wav"),
      outputPath: path("output.mp3"),
      metadata,
    });
    await remuxMp3Metadata({
      inputPath: path("output.mp3"),
      outputPath: path("retagged.mp3"),
      metadata: { ...metadata, title: "Renamed sample" },
    });
    const probe = await probeAudioFile({ inputPath: path("retagged.mp3") });
    assert.equal(probe.title, "Renamed sample");
    assert.equal(probe.artist, metadata.artist);
    assert.ok(
      probe.decodable &&
        probe.durationMs >= 40_000 &&
        probe.durationMs < 40_200,
    );
    const waveform = await extractWaveformPeaks({
      inputPath: path("retagged.mp3"),
      maxPeaks: 256,
    });
    assert.ok(waveform.peaks.length > 0 && waveform.peaks.length <= 256);
    assert.ok(waveform.peaks.some((value) => value > 0));
    durations.push(Math.round(performance.now() - started));
  }
  const hashes = {};
  for (const name of ["normal.wav", "concat.wav", "output.mp3", "retagged.mp3"])
    hashes[name] = createHash("sha256")
      .update(await readFile(path(name)))
      .digest("hex");
  process.stdout.write(
    `${JSON.stringify({ durations, medianMs: durations.slice(1).sort((a, b) => a - b)[1], hashes })}\n`,
  );
} finally {
  await rm(directory, { recursive: true, force: true });
}
