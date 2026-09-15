# R25b: Render storage in General settings

**Status:** Complete — 2026-09-15. Acceptance, full verification, and local staging
satisfy the accepted completion contract.
**Source:** [R25](../TASKS.md#r25-show-project-render-storage-in-general-settings)
and the [accepted dependency table](../prd-work-items/local-only-simplification.md#order-and-dependencies).

## Implementation plan

- Repository: `/home/mini-boss/Projects/Personal/studynarrator-ai`
  (`drofnas/studynarrator-ai`), branch `feature/complete-known-issues`, source
  `341c6f9019af9e55682495f6fdf759fc49115c1f`. The working tree and index start clean.
  No additional repository is authorized. GitHub discovery found no open issues.
- R25b is approved and ready because its only dependency, R25a, is Complete.
  Local Complete means accepted behavior, required validation, and staged changes;
  it does not claim a hosted submission or release. No successor depends on R25b.
- Add Product Renders to the existing General settings cards, using the current
  typed storage status. Show total and reclaimable bytes, loading, zero, and
  unavailable states. Refresh while the page is open, on entry, on demand, and
  after cleanup. Keep the existing theme and responsive settings layout.
- Explain cache and eligible render storage in confirmation and show the returned
  cleanup total once, with the render breakdown. Checkbox selection alone makes
  no deletion request. Keep maintenance guards, pinned files, projects, and history.
- Scope: General settings component, styles, focused tests, Web acceptance, and
  user/task documentation. No backend contract, dependency, migration, or native
  packaging changes are planned.
- Validate with Docker-only formatting, lint, typecheck, dependency checks,
  component tests, Web acceptance and three viewport inspections, then the full
  repository verifier. Run Ponytail review and apply useful simplifications.
- Stage only this slice, inspect the entire candidate, run the readiness handoff,
  and create the explicitly requested local commit. No push or PR is authorized.

## Ponytail review

`GeneralSettingsPage.test.tsx:L215: delete: assertion of exact wrapper children.
The checkbox, cancellation, API-call, and byte-result assertions already test the
user-visible contract.`

`net: -6 lines possible.` Applied; no acceptance assertion was removed.
Follow-up review of the final implementation: **Lean already. Ship.**

## Acceptance and visual evidence

- Component checks cover loading, explicit zero, unavailable inventory, failed
  refresh with stale values hidden, Refresh recovery, and a sentinel error that
  must not appear in the page. Unknown sizes remain unavailable in confirmation.
- Checkbox selection and canceled confirmation make no cleanup request. Combined
  cleanup reports 512 cache bytes plus 1,024 render bytes as 1.5 KiB total; it
  preserves the protected 3 KiB. Cache-only cleanup leaves render totals intact.
- The disposable Web fixture creates two real renders while General stays open.
  Automatic refresh shows them. Cache-only cleanup keeps both directories;
  combined cleanup removes one eligible directory and preserves the pinned
  directory, its files, playable audio, and the other render's history. A later
  deletion by another client returns the display to zero without navigation.
- Active-render acceptance checks zero reclaimable bytes, the sanitized HTTP 409
  conflict, and continued render progress. It uses the existing public error
  contract rather than expecting the internal maintenance-guard message.
- Inspected screenshots at 390, 768, and 1440 px: one, two, and four storage-card
  columns, readable labels, accessible named controls, no horizontal overflow.
  Existing settings colors, fonts, focus treatment, and native confirmation remain.
  No backend, REST, IPC, persistence, dependency, or scanner policy changes.

## Refresh performance baseline

The page reuses React Query's existing cache key and polling lifecycle, replacing
manual request state. While General is mounted and visible, status refreshes every
five seconds (at most 12 scheduled requests/minute), plus entry, focus, explicit
Refresh, and cleanup. No new timer framework, background worker, or dependency.

The initial local baseline uses the real `render-storage.spec.ts` fixture: two
single-segment fake-Speaches renders, 184.8 KiB managed render storage and 31.3 KiB
cache before cleanup, Linux amd64 Docker, Node 24.19.0, Chromium. Capture it with:

```sh
docker compose -f compose.development.yaml run --name studynarrator-storage-trace tools npm run test:e2e:web -- e2e/web/render-storage.spec.ts --trace on
docker cp studynarrator-storage-trace:/workspace/test-results .tmp/storage-trace
docker rm studynarrator-storage-trace
```

Inspect the trace archive's browser `*-trace.network` records for successful GET
requests ending in `/api/speech-cache`; `snapshot.time` is elapsed milliseconds.
The six browser samples were 7.416, 10.564, 7.978, 6.660, 8.014, and 5.289 ms:
median 7.697 ms, range 5.289–10.564 ms, response bodies 214–250 bytes. The trace
shows approximately five-second scheduled intervals and immediate manual/cleanup
refreshes. Baseline code fetched only on entry, manual refresh, and cleanup; the
additional scheduled requests satisfy cross-client/render-completion freshness.
There is no repository storage-status latency budget. These small-fixture timings
are a repeatable initial comparison, not a guarantee for large render libraries;
the unchanged status inventory still walks managed files.

## Validation

All application tools ran in the repository's Docker environment, using pinned
Node 24.19.0/npm 11.19.0. The documented legacy-builder fallback bootstrapped the
tooling image; the distribution verifier used its isolated Docker daemon/Buildx.

```sh
DOCKER_BUILDKIT=0 docker compose -f compose.development.yaml build verify
docker compose -f compose.development.yaml run --rm tools npm test -- apps/web/src/pages/settings/GeneralSettingsPage.test.tsx
docker compose -f compose.development.yaml run --rm tools npm run typecheck
docker compose -f compose.development.yaml run --rm tools npm run check:package-dependencies
docker compose -f compose.development.yaml run --rm tools npm run test:e2e:web -- e2e/web/render-storage.spec.ts e2e/web/render-execution.spec.ts
docker compose -f compose.development.yaml up --abort-on-container-exit --exit-code-from verify verify
```

- Five focused component tests and six affected Web acceptance tests passed.
  Typecheck and package dependency checks passed.
- The final full verifier passed: Knip within the existing three-finding
  allowance, Prettier, lint, typecheck, 760 tests across 87 files, builds, native
  Electron rebuild, 35 Web/Electron acceptance tests, and three runtime smokes.
  Coverage: 86.99% statements, 76.48% branches, 87.25% functions, 88.82% lines.
- Docker hardening, Chromium/Firefox acceptance, persistence, offline recovery,
  cleanup, and the final resource audit passed. Image:
  `sha256:918a6fb71034d6beffb7a1aebcd9c3782898855f5fd5fdb7cb0b535d7f341671`.
  Trivy 0.74.0 reports 16 highs, zero criticals, and zero findings with fixed
  versions. All 16 pass the unchanged exact-build code-absence assessment,
  expiring 2026-10-14 UTC. The inventory contains 103 components.
- The full run took 3m24.068s from the built tooling image. Reports, screenshots,
  traces, and logs remain ignored under `.tmp/r25b-completion/`; Docker evidence
  is in `docker/run-ZlJG45/`.
- Early checks caught two test API mistakes (an unbound spy assertion and a
  Playwright-only locator option in Testing Library), an assertion expecting an
  internal instead of sanitized error, and an existing cache-help assertion using
  the replaced text. All were corrected without weakening the behavior checks.
  The entire verifier was rerun after the last correction.

## Tracker and dependency sweep

| Item | Transition                     | Evidence                                          |
| ---- | ------------------------------ | ------------------------------------------------- |
| R25b | Ready → In progress → Complete | Accepted UI behavior, full verifier, staged slice |
| R25  | In progress → complete         | R25a and R25b both Complete                       |

The complete accepted dependency table has no successor blocked by R25b or R25;
no Ready transition is required. Historical R25a dependency links remain. No
other item, repository, or hosted tracker was changed. R24 still awaits D1, and
the deferred items retain their existing gates.

## Readiness and local commit handoff

The full verifier ran against staged implementation tree
`73092171af619d82d3c521978766c4e47d3b2999`, based on source commit
`341c6f9019af9e55682495f6fdf759fc49115c1f`. Subsequent edits only record completion
and tracker state; they receive formatting, link/claim, and diff validation.
The final candidate contains General settings source/test/styles, three affected
Web acceptance files, README, the two task records, and this report. No unrelated
change, generated artifact, or unstaged story hunk is included.

**CONDITIONALLY READY:** Review found no remaining P0/P1/P2 issue and all local
pre-submission gates passed. The exact revision's hosted `CI` workflow (caller
job `check`, reusable job `check`) remains normal-submission-created evidence for
`submit-change-request` to monitor if submission is later authorized. This request
authorizes a local commit only; no push, PR, release, or native packaging is claimed.
