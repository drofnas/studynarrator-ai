# R27b: Persistent unviewed render results

**Source:** [R27](../TASKS.md#r27-track-active-and-unviewed-project-renders-in-the-sidebar)
and the [local work-item table](../prd-work-items/local-only-simplification.md).

**Baseline:** `feature/complete-known-issues` at `ea9d2e4`. R27a is Complete,
with all required Docker gates passed. R27b moved from Waiting to Ready and then
In progress under the owner's 2026-09-14 implementation authorization.

**Status:** Complete at the validated local checkpoint on 2026-09-14.

## Result

- The shell retains completed, failed, and canceled results until opened from
  its activity widget. Active clicks do not mark a future result viewed.
- A service-owned localStorage record contains only viewed render UUIDs. Active
  jobs and unviewed results are reconstructed from current project/render history
  on reload. The record is per browser origin or desktop renderer profile;
  clearing browser storage makes retained history unviewed again. Unavailable
  browser storage falls back to the current in-memory session.
- Each widget link opens `?tab=render&render=<job ID>` in the correct project.
  The workspace selects that exact result for playback, waveform, downloads,
  and details, including older results. Invalid, missing, or removed results
  cannot silently select the latest audio. Canceled and failed jobs keep their
  own outcome. A newer active render remains independently visible and prevents
  duplicate starts while an older result is selected.
- History and artifact availability reconcile on focus and every ten seconds
  after the preceding reconciliation completes. Deleted projects, removed audio,
  and stale viewed IDs are pruned; temporary service failures preserve last known
  state. A response that began before streamed progress cannot overwrite that
  progress. Matching render IDs keep audio/waveform effects stable through refresh.
- Event streams remain the Web default. A dropped stream enables non-overlapping
  500 ms fallback polls; recovery stops polling, subsequent drops restart it,
  and completion/unmount stops watchers. Electron uses the same bounded polling
  path through its existing typed client.
- The scrollable list distinguishes terminal outcomes and timestamps, supports
  keyboard activation, and closes the mobile drawer on same-project query-only
  navigation. Existing queue, prior-audio behavior, REST/IPC contracts, retention,
  and database formats remain intact.

## Verification and performance evidence

The focused suites cover multiple projects, active/terminal transitions,
reload/viewed persistence, unavailable storage, corrupted records, removed
projects/artifacts, stale history/progress responses, repeated stream recovery,
exact older-result playback/downloads, cancellation, and invalid/private input
redaction. Browser acceptance exercises two real fake-service renders, mobile
keyboard selection, exact audio URLs, and reload persistence. Electron acceptance
relaunches the application with both unviewed and viewed results.

The deterministic provider cadence test uses two projects and two completed
results. Initial discovery makes two history and two artifact calls; no repeat
history call occurs during the next nine seconds. After viewing one result, the
next reconciliation makes two history calls and only one artifact call. Terminal
jobs make no progress requests. The recovery test proves one in-flight poll at a
time, no polls after stream recovery, and immediate stop on completion. These
fixtures are the repeatable resource-use baseline (`npm test --
apps/web/src/features/renders/RenderActivityList.test.tsx`). Background history
work scales with project count and unviewed completed results in retained history.

The prior provider chunk was 2.30 kB / 1.15 kB gzip; the final R27b build was
4.20 kB / 1.86 kB gzip on the same local Node 24.19.0 toolchain. No dependency was
added. This small bundle increase supports persistence and reconciliation; the
request-count baseline above guards against unnecessary ongoing network work.

## Reviews

The normal review covers stream/history races, polling cleanup, exact-result
selection, stale media, transient failures, storage scope, per-project isolation,
and mobile keyboard navigation. Ponytail findings applied:

- `ProjectWorkspace.tsx`: delete redundant terminal-state checks for the already
  filtered active job; use that job directly and remove the unused exposed
  `renderStarting` field/import.
- `useProjectsPageController.ts`: shrink repeated project lookups and unavailable
  checks to one project activity value and one candidate availability flag.
- `RenderActivityProvider.tsx`: avoid rewriting the local record when pruning
  leaves the same IDs; preserve the existing set.

Final Ponytail pass: **Lean already. Ship.** All recommendations were applied.
The exact source candidate passed normal correctness/readiness review with no
unresolved P0/P1/P2 finding.

## Final validation and tracker state

`npm run verify` passed on Node 24.19.0/npm 11.19.0. This includes Knip (the
existing three-item allowance), formatting, lint/import boundaries, typecheck,
84 test files / 724 tests with coverage, all application builds, native rebuild,
33 Web/Electron acceptance tests, server/Electron/reopen smoke checks, and
Docker verification with two browser acceptance tests. The Electron case proved
unviewed restoration and viewed-state persistence across real relaunches. The
Web case proved mobile keyboard access and same-project exact-result navigation.

Evidence: `.tmp/r27b-verify.log` and `.tmp/verify-docker/run-ktHVGX/` contain the
wrapper results and final image's CycloneDX SBOM, raw Trivy JSON/SARIF, and
applicability assessment. Docker retains zero critical findings and 16 high
source-package findings individually assessed as excluded code, with the R27a
assessment scope and 2026-10-14 expiry unchanged. Verification cleanup was
audited, and the three separately labeled audio-comparison images were removed.

R27a and R27b are **Complete**, and canonical R27 is **complete**. The local
dependency table gives R27b no dependent stories; no further readiness transition
is required. This checkpoint changes no backend transport contract or database
schema and adds no dependency. Only local commits were requested.
