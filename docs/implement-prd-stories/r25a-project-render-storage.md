# R25a: Project-render storage service and contracts

**Story:** [R25a — Storage service and contracts](../prd-work-items/local-only-simplification.md#order-and-dependencies)
**Initial baseline:** `feature/complete-known-issues` at `8a310fa7ebb9`
**Status:** Complete — 2026-09-15. The original implementation was held by the
Docker vulnerability gate. Current acceptance and full verification now pass.

## Completion review scope

The current repository is `drofnas/studynarrator-ai`, at source commit
`79c0fabf38f96959262e0b2f8e71fe43b81a6fc7` on `feature/complete-known-issues`.
The index and working tree started clean. GitHub discovery returned no open
issues; the accepted local table supplies dependency and completion semantics.
No other repository is authorized. R25a has no dependencies and unlocks R25b.
Complete requires acceptance, required validation, and staged changes. That
evidence now passes; R25b moves from Waiting to Ready.

The service, shared schemas, composition wiring, REST/IPC adapters, and existing
contract tests already implement storage reporting and combined cleanup. This
completion adds coverage for queued/running render bytes, cleanup during and after
speech activity, and unavailable project storage alongside known cache storage.
The General settings callout belongs to R25b. No production operation, dependency,
migration, or performance-sensitive path changes in this completion slice.

## Outcome

- Speech-cache status now reports total managed project-render bytes and the
  reclaimable subset. It reports `null` when persistence is unavailable instead
  of presenting missing storage data as zero.
- Storage reporting and cleanup share the managed render-directory inventory and
  treat only terminal, unpinned render jobs as reclaimable. Active, recoverable,
  and pinned renders remain protected.
- Combined cleanup reports total bytes freed across cache entries and project
  renders, plus removed render-directory count and bytes as a nested breakdown. This
  prevents the settings UI from double-counting the two storage sources.
- Existing maintenance guards, projects, snapshots, and render history remain
  unchanged.

## Current validation

All application tooling ran in Docker, using Node 24.19.0, npm 11.19.0, and Trivy
0.74.0. The documented legacy-builder fallback bootstrapped the tooling image;
the isolated distribution verifier used its bundled Buildx.

```sh
DOCKER_BUILDKIT=0 docker compose -f compose.development.yaml build verify
docker compose -f compose.development.yaml run --rm tools npm run test:api -- packages/application/src/retention.test.ts packages/application/src/cachedSpeech.test.ts apps/server/src/app.test.ts apps/desktop/src/bridge.test.ts
docker compose -f compose.development.yaml run --rm tools npm test -- packages/shared-types/src/preview.test.ts apps/web/src/services/preview/previewClient.test.ts apps/web/src/pages/settings/GeneralSettingsPage.test.tsx
docker compose -f compose.development.yaml run --rm tools npm run check:package-dependencies
docker compose -f compose.development.yaml up --abort-on-container-exit --exit-code-from verify verify
```

- Focused API/IPC suites: 42 tests passed, including 12 retention tests. Focused
  shared-schema and Web suites: 10 tests passed. Package dependency checks passed.
- Storage assertions distinguish total and reclaimable bytes for terminal,
  pinned, queued, and synthesizing renders. Cleanup preserves protected files,
  cache entries, and media metadata. Releasing speech activity permits cleanup;
  the fixture's 7 cache bytes plus 8 render bytes produce 15 total freed bytes.
  Missing project-storage inventory yields `null`, while known cache bytes remain
  available. Existing missing-root coverage preserves an explicit zero result.
- Full verification passed: Knip within its existing three-finding allowance,
  formatting, lint, typecheck, 759 tests across 87 files, builds, Electron native
  rebuild, 34 Web/Electron acceptance tests, three runtime smokes, and the Docker
  gate. Coverage: 86.94% statements, 76.37% branches, 87.16% functions,
  88.77% lines. Existing REST/IPC manifest parity, strict input validation, and
  sentinel-secret error assertions remain green.
- Docker hardening, Chromium/Firefox acceptance, persistence, offline recovery,
  cleanup, and the final leftover-resource audit passed. Fresh amd64 image:
  `sha256:613414cb75c6cfb3c019b73aaf9ef01469cb74e8e31a51fe2052d218ab710e1d`.
  Its raw scan contains 16 highs, zero critical findings, and zero findings with
  a fixed version. All 16 pass the unchanged exact-build code-absence assessment,
  expiring 2026-10-14 UTC. The inventory contains 103 components.
- Ignored evidence is under `.tmp/r25a-completion/`: focused/full logs, image
  summary, coverage/Playwright reports, and Docker run `run-Yhejql`.

This completion changes tests and documentation only, with no application
performance impact. The focused retention suite took 68 ms; the full local run
took 3m27.246s from an already-built tooling image and a fresh nested daemon.
These timings describe one Linux amd64 run, not a performance guarantee.

## Initial implementation validation

- Focused shared-contract and Web tests passed: 35 tests.
- Focused application, REST, and IPC tests passed: 47 tests.
- Package dependency validation, Knip, Prettier, ESLint, TypeScript, coverage,
  application builds, native rebuild, server smoke, Electron smoke, and server
  reopen smoke all passed.
- The full coverage suite passed 705 tests, and the combined Web and Electron
  Playwright run passed 31 tests.
- The full verifier reached the Docker vulnerability policy after all application
  gates passed. The current Debian image produced 205 findings: one unassessed
  critical (`CVE-2026-6653`), 204 highs across 40 unique CVEs, and five fixable
  highs. The verifier removed and audited its disposable Docker resources.

## Initial implementation Ponytail review

- Removed a cleanup-lock probe and transient availability flag from the read-only
  storage status. Cleanup still acquires the lock and rechecks its safety guards
  before deleting files.
- Removed cross-field schema refinements and duplicate malformed-value assertions
  that restated arithmetic already derived from one inventory.
- Kept the nested storage schema private because only its inferred public type is
  consumed outside the shared-types package.

All findings were applied. Net reduction: 87 lines.

## Completion Ponytail review

Consolidated the old recovery-only test into the queued/synthesizing cases. All
cache, file, and media-metadata preservation assertions remain, alongside the
new storage totals. Applied reduction: 14 lines from the reviewed draft. The
follow-up review found no further simplification.

## Tracker state

| Item | Transition             | Evidence                                        |
| ---- | ---------------------- | ----------------------------------------------- |
| R25a | In progress → Complete | Acceptance, current full verifier, staged tests |
| R25b | Waiting → Ready        | Its only dependency, R25a, is Complete          |

The complete accepted dependency table has one R25a successor, R25b, in this
repository. Its General settings acceptance criteria, typed storage contracts,
existing UI patterns, and disposable test fixtures are available; there is no
independent owner decision or environment blocker. Historical dependency links
remain. The parent R25 stays In progress until R25b completes; no second story is
implemented here.

## Readiness and local commit handoff

The full verifier passed against staged implementation tree
`627d9900c24b553cb10ebf411a8df066f35174bc`. Subsequent changes only record completion,
correct the stale canonical storage description, and move R25b to Ready; those
documents receive formatting and diff checks. The final candidate contains
`retention.test.ts`, this report, the canonical task entry, and the dependency
table. No unrelated change or generated artifact is staged.

**CONDITIONALLY READY:** Local pre-submission gates pass, and review found no
P0/P1/P2 issue. The exact PR revision's `CI` workflow (caller job `check`, reusable
job `check`) is normal-submission-created evidence, pending future authorization
to submit. Hand it to `submit-change-request` for monitoring at that point. This
request authorizes a local commit only.
