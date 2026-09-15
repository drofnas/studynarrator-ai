# R22: Search the complete project script

**Story:** [R22 — Script editor](../prd-work-items/local-only-simplification.md#order-and-dependencies)
**Baseline:** `feature/complete-known-issues` at `1f856bc2a51e`
**Status:** Complete — 2026-09-15. Acceptance, validation, and staged evidence
satisfy the local completion contract. R22 has no dependents.

## Completion review plan — 2026-09-15

Review R22 in `/home/mini-boss/Projects/Personal/studynarrator-ai`
(`drofnas/studynarrator-ai`) on `feature/complete-known-issues`, starting at
`d60dd688ff4e60a5cba19ba71ed0b2d101186bd2` with a clean worktree and index.
The accepted local dependency table has no R22 blocker or successor; GitHub
discovery found no open issues. Local Complete requires accepted behavior,
required validation, and staged evidence.

Recheck the existing whole-document search, keyboard and selection behavior,
editing, undo, and autosave. Run the editor/project-page tests and focused Web
acceptance inside Docker. Reuse the recent full-verifier evidence only after
proving application source, tests, and configuration are unchanged. Apply any
useful Ponytail simplifications, validate the final documentation candidate,
and create the authorized local commit. Scope is R22's report and local task
records unless this review finds a functional gap.

## Outcome

- The project script editor has an accessible **Search Script** control and opens
  the same search panel from Control+F or Command+F while the editor is focused.
- Search covers the complete CodeMirror document, including content outside the
  visible viewport. Previous and next actions select and reveal repeated matches.
- The panel reports no matches, follows script edits while open, closes with
  Escape, and preserves the script's normal edit and autosave behavior.
- The focused panel deliberately omits replacement controls because replacement
  is outside this local-only story.

## Initial implementation validation

- Focused editor and project-page tests passed: 46 tests.
- The complete Web Playwright suite passed: 24 tests. The new acceptance test
  searches a 242-line script, selects and reveals both distant matches, navigates
  backward, closes with Escape, and reopens with the platform shortcut.
- Package dependency validation, Knip, Prettier, ESLint, TypeScript, coverage,
  application builds, native rebuild, server smoke, Electron smoke, and server
  reopen smoke all passed.
- The full coverage suite passed 704 tests, and the combined Web and Electron
  Playwright run passed 31 tests.
- The full verifier reached the Docker vulnerability policy after all application
  gates passed. The current Debian image produced 205 findings: one unassessed
  critical (`CVE-2026-6653`), 204 highs, and five fixable highs. The verifier
  removed and audited its disposable Docker resources.

## Ponytail review

- Removed redundant search-panel configuration and unused update data; the panel
  now uses its own position and reads current editor state directly.
- Shared the existing button-sizing rule instead of adding a duplicate rule.
- Kept the component fixture to two repeated matches and left long-document
  viewport behavior to the Playwright acceptance test.

All findings were applied. Net reduction: 16 lines.

## Current completion evidence

- The implementation already meets R22: CodeMirror's search extension and keymap
  own whole-document matching, selection, and reveal; the project toolbar opens
  the same accessible panel. Search effects do not replace the document or
  re-create the editor, and normal edits still reach the existing autosave path.
- Docker-focused validation passes: 51 editor/project-page tests and the Web
  acceptance test for a 242-line script with repeated offscreen matches. The
  component tests cover no matches, edits while searching, Enter/Shift+Enter,
  unchanged source during navigation, and Escape returning focus to the editor.
- A disposable Chromium probe also passes: edit with search open, await the
  successful autosave, search the added text, undo, observe no matches, and
  verify the exact restored script in the save response and after reload.
  An outside-editor Ctrl+F event remains unhandled by the application. The
  probe's first reload assertion incorrectly read CodeMirror's line elements as
  one text node; checking the separate lines and exact persisted source fixed
  the probe. No application defect or source change was needed.
- Commands ran in the existing Docker tooling image with pinned Node/npm:
  `npm test -- apps/web/src/features/projects/ScriptSourceEditor.test.tsx apps/web/src/pages/projects/ProjectsPage.test.tsx`
  and `npm run test:e2e:web -- e2e/web/projects-and-settings.spec.ts --grep "finds and selects repeated script text"`.
  The temporary probe ran through the same Web Playwright command and disposable
  repository fixture. Logs and the probe remain ignored in `.tmp/r22-completion/`.
- The recent [full-verifier run](r25b-render-storage-settings.md#validation)
  passed 760 tests, coverage, 35 Web/Electron acceptance tests, three runtime
  smokes, and Docker distribution/scanner checks. Comparing this review's
  starting commit with verified tree
  `73092171af619d82d3c521978766c4e47d3b2999` shows only four completion/status
  documents changed. Application source, tests, configuration, dependencies,
  and toolchain are identical, so that full-verifier evidence remains current.
  R10a/R10b resolved the original Docker blocker; the linked report records the
  exact image, assessed findings, and assessment expiry.
- This completion candidate changes documentation only. It has no runtime,
  bundle-size, persistence, or application-performance effect.

## Completion Ponytail review

**Lean already. Ship.** The initial simplifications remain in place; this
completion review found no further useful cut.

## Tracker and readiness handoff

R22 moves from In progress to Complete in both local task records after its
validated evidence is staged. Rechecking the accepted dependency table finds no
R22 successor, so no Ready transition is required. R26 remains open for its own
completion review, and R24 still awaits D1. No hosted tracker changed.

The candidate contains only this report, R22's canonical task entry, and its
accepted dependency-table row. Documentation formatting, local links/anchors,
command and implementation claims, and staged diff hygiene pass. Application
source remains identical to the verified tree; generated evidence is ignored.

**CONDITIONALLY READY:** No P0/P1/P2 issue remains; the documentation-only
pre-submission gates pass with current application validation evidence. The
exact revision's hosted `CI` workflow (caller and reusable jobs named `check`)
remains normal-submission-created evidence for `submit-change-request` to
monitor if a future submission is authorized. This request authorizes the local
commit only.
