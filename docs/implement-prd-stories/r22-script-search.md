# R22: Search the complete project script

**Story:** [R22 — Script editor](../prd-work-items/local-only-simplification.md#order-and-dependencies)
**Baseline:** `feature/complete-known-issues` at `1f856bc2a51e`
**Status:** In progress. The feature acceptance criteria passed, but the required
Docker vulnerability gate remains red on findings in the current base image.

## Outcome

- The project script editor has an accessible **Search Script** control and opens
  the same search panel from Control+F or Command+F while the editor is focused.
- Search covers the complete CodeMirror document, including content outside the
  visible viewport. Previous and next actions select and reveal repeated matches.
- The panel reports no matches, follows script edits while open, closes with
  Escape, and preserves the script's normal edit and autosave behavior.
- The focused panel deliberately omits replacement controls because replacement
  is outside this local-only story.

## Validation

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

## Tracker state

R22 remains **In progress** because repository policy requires the full Docker
gate for a source checkpoint. It has no dependents to unblock.
