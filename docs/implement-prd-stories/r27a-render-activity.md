# R27a: Sidebar render activity

**Story:** [R27a — Render activity](../prd-work-items/local-only-simplification.md#order-and-dependencies)

**Baseline:** `feature/complete-known-issues` at `1c9ea0239415`

**Status:** In progress. The render activity acceptance criteria passed, but the
required Docker vulnerability gate remains red on findings in the current base
image.

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

## Tracker state

R27a remains **In progress** because repository policy requires the full Docker
gate for a source checkpoint. R27b remains **Waiting**.
