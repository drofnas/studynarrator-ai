# R24: Final MP3 tags through FFmpeg

**Story:** [R24](../TASKS.md#r24-write-the-requested-final-mp3-tags-with-ffmpeg).
**Status:** Complete — 2026-09-15. Acceptance, required validation, and staged evidence satisfy the local completion contract.
**Baseline:** `feature/complete-known-issues` at `2f601b3cffd6c1c2e66185e91523ff3ba10f3c21`, clean worktree and index.
**Repository:** `/home/mini-boss/Projects/Personal/studynarrator-ai` (`drofnas/studynarrator-ai`).

## Decision and implementation plan

The owner resolved D1 by selecting the existing FFmpeg writer and removal of the
unused `node-id3` wrapper/dependency. R24 is unblocked; this supersedes the earlier
package requirement, while retaining the exact title, artist `Study Narrator AI`,
creation year, and genre `Audio Book`. Local Complete requires validated behavior
and staged evidence. The only successor, R12b, remains deferred and also needs
R12a. GitHub discovery found no open issues.

- Verify all four tags before publication and after rename. Preserve a valid
  existing year on rename, falling back to the artifact's recorded creation year
  for older files without a valid year tag. Keep atomic replacement and recovery.
- Remove the unused wrapper, its tests/export, and npm dependency through the
  Docker tooling; update the root lockfile without unrelated version changes.
- Test real FFprobe tags, Unicode, year boundaries, unchanged audio/snapshot,
  read-only downloads, rejected metadata, temporary cleanup, and sanitized errors.
  Extend applicable Web/Electron/Docker acceptance without changing transports.
- Measure a representative long MP3's stream-copy time and memory, run focused
  tests, dependency/Knip checks and the full Docker verifier, then Ponytail review,
  readiness review, and the authorized local commit. No other repository changes.

## Outcome

FFmpeg writes the exact requested tags and FFprobe verifies all four before
publication. Renaming preserves the existing valid year and MPEG audio packets;
missing, invalid, or zero legacy years fall back to recorded artifact creation.
Read/download paths stay read-only. Failed writes or verification preserve the
previous file, attempt temporary cleanup, and return sanitized errors. Existing
post-rename database reconciliation remains retryable.

Removed `id3.ts`, its obsolete tests/export, `node-id3`, and its private
`iconv-lite`/`safer-buffer` instances. No other dependency versions changed.
REST, IPC, schema, layout, and service manifests are unchanged; Web, Electron,
and Docker acceptance inspect the resulting downloaded MP3 with FFprobe.

## Ponytail review

`packages/application/src/artifacts.ts:L120: shrink: three repeated MP3 validation conditions. Use one isFinalMp3 predicate.`

Applied. **net: -7 lines possible**, all seven removed before final validation.
The final review found no further useful simplification.

## Performance baseline

Linux amd64 Docker tooling, Node 24.19.0/npm 11.19.0, a 30-minute mono 44.1-kHz
sine fixture encoded at 192 kbit/s (43,201,767 bytes). Alternate old and corrected
tag values through the existing stream-copy writer, followed by FFprobe; discard
the first pair as warmup and retain three measured pairs. This measures retagging
and validation, excluding fixture encoding, application disk-space checks, and
atomic publication. No repository timing budget exists for this path.

| Metadata values | Measured times (ms)       | Median (ms) |
| --------------- | ------------------------- | ----------- |
| Previous        | 375.090, 368.547, 342.395 | 368.547     |
| R24             | 367.012, 370.451, 279.566 | 367.012     |

No observed regression in this local sample. This is a comparison baseline,
not a speedup claim. Node RSS rose from 108.8 to 109.6 MiB across all eight
operations, with 109.6 MiB maximum RSS; the process did not allocate a whole-file
audio buffer. FFmpeg process RSS was not sampled. An earlier run overlapped the
image rebuild and showed greater I/O variation; the table uses the subsequent
run without that rebuild. Logs and the temporary measurement script remain
ignored under `.tmp/r24/`.

Reproduce the measurement in the tooling image with this disposable script:

```sh
docker compose -f compose.development.yaml run --rm -T tools node --import tsx --input-type=module <<'NODE'
import { execFile } from 'node:child_process';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { remuxMp3Metadata, probeAudioFile } from '@studynarrator/rendering';
const run = promisify(execFile);
const dir = await mkdtemp(join(tmpdir(), 'mp3-metadata-bench-'));
try {
  const inputPath = join(dir, 'source.mp3');
  await run('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=44100', '-t', '1800', '-c:a', 'libmp3lame', '-b:a', '192k', inputPath]);
  console.log({ bytes: (await stat(inputPath)).size });
  for (let iteration = 0; iteration < 4; iteration++) {
    for (const candidate of [false, true]) {
      const outputPath = join(dir, candidate ? 'candidate.mp3' : 'baseline.mp3');
      const metadata = { title: 'Long study – 音声', artist: candidate ? 'Study Narrator AI' : 'StudyNarrator AI', year: 2026, genre: candidate ? 'Audio Book' : 'Speech' };
      const before = process.memoryUsage().rss;
      const start = performance.now();
      await remuxMp3Metadata({ inputPath, outputPath, metadata });
      const probe = await probeAudioFile({ inputPath: outputPath });
      if (Object.entries(metadata).some(([key, value]) => probe[key] !== value)) throw new Error('Tag verification failed');
      console.log({ iteration, candidate, elapsedMs: performance.now() - start, rssBefore: before, rssAfter: process.memoryUsage().rss });
    }
  }
  console.log({ parentMaxRssKiB: process.resourceUsage().maxRSS });
} finally {
  await rm(dir, { recursive: true, force: true });
}
NODE
```

## Validation

- Focused final tests: two FFmpeg tests and 37 application render tests pass,
  including Unicode, year rollover, missing/invalid legacy years, audio packet
  identity, unchanged snapshots, idempotent reads, tag failures, cleanup,
  sentinel-secret redaction, and retry after artifact-row persistence failure.
- Typecheck, workspace dependency checks, and Knip pass within the unchanged
  three-finding allowance. The rebuilt tooling image ran `npm ci` against the
  reduced lockfile using the existing pinned versions.
- The complete `npm run verify` passed through the Docker Compose verifier:
  formatting, lint, typecheck, Knip, 769 tests across 86 files, builds, native
  Electron rebuild, all 35 Web/Electron acceptance tests, three runtime smokes,
  and Docker distribution/security/acceptance/resource-cleanup checks.
  Coverage: 87% statements, 76.68% branches, 87.21% functions, 88.85% lines.
- Docker Chromium and Firefox both pass the new downloaded-tag assertions.
  Image `sha256:e2adac7cb060219b6656431f0f2a4003eced7ff97e99ed1520e8f56322ebbb26`
  has zero critical and zero fixable findings. All 16 high findings pass the
  unchanged exact-build code-absence assessment expiring 2026-10-14 UTC; the
  CycloneDX inventory contains 103 components. Evidence is ignored under
  `.tmp/r24/docker/run-XdHrs0/`; coverage, browser reports, and logs are also
  under `.tmp/r24/`.
- Verified implementation tree: `eb1cf1943dd5dcf587be1c5180edb51d612b3fa0`.
  Only completion/report documentation changes follow that run; application
  source, tests, configuration, and the lockfile remain identical.

The final source snapshot used the documented legacy-builder fallback:

```sh
DOCKER_BUILDKIT=0 docker compose -f compose.development.yaml build verify
docker compose -f compose.development.yaml run --rm tools npm test -- packages/rendering/src/ffmpeg.test.ts
docker compose -f compose.development.yaml run --rm tools npm run test:api -- packages/application/src/render.test.ts
docker compose -f compose.development.yaml run --rm tools npm run check:package-dependencies
docker compose -f compose.development.yaml up --abort-on-container-exit --exit-code-from verify verify
```

## Tracker and readiness handoff

R24 is Complete in both local task records after validation and staging. The
dependency sweep finds only R12b as a successor; it still requires R12a and
remains explicitly deferred, so no Ready transition is warranted. All active
items are now complete; all seven deferred slices retain their existing scope.
No hosted tracker or other repository changed.

The entire staged candidate was reviewed, including source, tests, dependency
removal, operational guidance, and completion records. Formatting, local
links/anchors, referenced commands, and diff hygiene pass. Generated evidence
stays ignored. No P0/P1/P2 issue or performance regression remains.

**CONDITIONALLY READY:** All local gates pass for the verified implementation.
The exact revision's hosted `CI` workflow (caller and reusable jobs named `check`)
remains normal-submission-created evidence for `submit-change-request` to monitor
if a future submission is authorized. This request authorizes a local commit;
native installer qualification remains deferred.
