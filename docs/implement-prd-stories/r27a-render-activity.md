# R27a: Sidebar render activity

**Story:** [R27a — Render activity](../prd-work-items/local-only-simplification.md#order-and-dependencies)

**Baseline:** `feature/complete-known-issues` at `1c9ea0239415`

**Status:** Complete. Render activity and the required Docker gate passed.
The owner-authorized Docker remediation checkpoint was validated on 2026-09-14.

## Outcome

- A shell-level provider discovers queued and running renders across projects and
  keeps one progress watcher active for each job while the user moves between
  projects and Settings.
- The sidebar lists each active project's name, phase, and chunk progress in a
  scrollable, keyboard-accessible region. Each entry opens the correct project's
  Render tab.
- The provider reuses the existing REST event stream and the Electron client's
  bounded 500 ms polling fallback. Terminal jobs stop their watchers and leave
  the active list.
- A render that finishes starting after the user navigates away stays globally
  tracked without replacing the current project's workspace state.
- Existing project, render-history, and progress clients were sufficient. This
  slice adds no REST, IPC, persistence, or shared-contract surface. R27b retains
  responsibility for persistent unviewed results and opening a specific older
  result.

## Validation

- The focused App, render activity, and project workspace suites passed 62 tests.
- The focused Web acceptance case passed with two projects, queued and running
  sidebar entries, progress while off-route, and navigation to the selected
  project's Render tab.
- Knip remained within its configured allowance. Prettier, ESLint, TypeScript,
  coverage, application builds, native rebuild, server smoke, Electron smoke,
  and server reopen smoke all passed.
- The full coverage suite passed 707 tests, and the combined Web and Electron
  Playwright run passed 32 tests.
- The full verifier reached the Docker vulnerability policy after all application
  gates passed. The current Debian image produced 205 findings: one critical
  (`CVE-2026-6653`) without an available fix, 204 high instances across 40 unique
  high CVEs, and five unique fixable highs. The verifier removed and audited its
  disposable Docker resources.

## Ponytail review

- Kept the activity item type private because it has no external consumer.
- Replaced repeated sorting on every update with a prepend-and-filter upsert.
- Combined the provider's duplicate tracking and watcher update callbacks.
- Removed memoization around small derived arrays and the context value.
- Removed the redundant active-render count and its styles.

All findings were applied. Net reduction: 39 lines.

## Docker remediation and final verification (2026-09-14)

The runtime now uses digest-pinned Debian 13 Distroless Node 24 plus an
application-specific FFmpeg build from authenticated Debian source. Unused
packages carrying the critical finding and five fixable highs are absent.
The raw scan retains 16 FFmpeg high findings; each receives a time-limited,
exact-build `not_affected` assessment for code excluded from this build.
No additional local-use risk acceptance was introduced. See the
[build assessment](../security/docker-audio-build.md) for component mappings,
provenance, expiration, and update requirements.

Final `npm run verify` passed on Node 24.19.0/npm 11.19.0: formatting, lint,
typecheck, Knip (existing allowance), 711 tests with coverage, builds, native
rebuild, server/Electron/reopen smoke checks, 32 Web/Electron acceptance tests,
and two Docker browser acceptance tests. The first attempt found a missing
locked Electron executable after installation; restoring that binary resolved
it, and the complete wrapper passed on the final run.

Final generated evidence is in `.tmp/r27a-verify.log` and
`.tmp/verify-docker/run-YSuTqm/` (CycloneDX SBOM, Trivy JSON/SARIF, and
vulnerability assessment). The exact Linux arm64 runtime has 17 Debian and 85
npm packages, zero critical findings, and 16 individually assessed high
findings. Docker startup, non-root execution, read-only operation, persistent
volume reopen, audio workflows, and disposable-resource cleanup passed.

The reusable `scripts/audio-compatibility.mjs` probe exercises normalization,
concatenation, MP3 encoding, title remuxing, probing, and waveform generation
against the previous Dockerfile and the candidate on the same Docker Desktop
Linux arm64 host. Bundle it with the existing esbuild and run it in each image
with a writable temporary directory. Input is 20 seconds of deterministic
24 kHz mono PCM; concatenate twice for a 40-second result. After one warm-up,
three measured iterations gave medians of 584 ms before and 199 ms after.
All four WAV/MP3 output hashes matched byte for byte. These local measurements
are a repeatable comparison, not a cross-platform performance guarantee.
Generated timings and hashes remain in `.tmp/r27-audio-{baseline,candidate}.json`.

The additional Ponytail review removed the obsolete TIFF evidence collector,
its special policy and tests, a one-use failure closure, and repeated root-path
resolution. The normal readiness review checked fail-closed scope, image/SBOM
binding, source provenance, checksum coverage, sanitized evidence, licensing,
runtime compatibility, and the full validation above. No unresolved findings
remain in the reviewed slice.

## Tracker state

R27a is **Complete** at this validated local checkpoint. R27b is **Ready**;
its dependency is satisfied. R27 remains **in progress** until R27b completes.
