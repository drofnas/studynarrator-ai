# R25a: Project-render storage service and contracts

**Story:** [R25a — Storage service and contracts](../prd-work-items/local-only-simplification.md#order-and-dependencies)
**Baseline:** `feature/complete-known-issues` at `8a310fa7ebb9`
**Status:** In progress. The service and contract acceptance criteria passed, but
the required Docker vulnerability gate remains red on findings in the current
base image.

## Outcome

- Speech-cache status now reports total managed project-render bytes and the
  reclaimable subset. It reports `null` when persistence is unavailable instead
  of presenting missing storage data as zero.
- Storage reporting and cleanup share the managed render-directory inventory and
  treat only terminal, unpinned render jobs as reclaimable. Active, recoverable,
  and pinned renders remain protected.
- Combined cleanup reports total bytes freed across cache entries and project
  renders, plus the exact render-file count and bytes as a nested breakdown. This
  prevents the settings UI from double-counting the two storage sources.
- Existing maintenance guards, projects, snapshots, and render history remain
  unchanged.

## Validation

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

## Ponytail review

- Removed a cleanup-lock probe and transient availability flag from the read-only
  storage status. Cleanup still acquires the lock and rechecks its safety guards
  before deleting files.
- Removed cross-field schema refinements and duplicate malformed-value assertions
  that restated arithmetic already derived from one inventory.
- Kept the nested storage schema private because only its inferred public type is
  consumed outside the shared-types package.

All findings were applied. Net reduction: 87 lines.

## Tracker state

R25a remains **In progress** because repository policy requires the full Docker
gate for a source checkpoint. R25b remains **Waiting** and is not unblocked by
this checkpoint.
