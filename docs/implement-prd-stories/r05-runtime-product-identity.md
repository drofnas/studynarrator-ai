# R05 implementation report

**Story:** [R05 — Setup and product identity](../prd-work-items/local-only-simplification.md#order-and-dependencies)
**Baseline:** `main` at `85b5c91adc22`
**Status:** In progress because the mandatory Docker vulnerability gate failed. R05 has no dependents.

## Outcome

- Source setup now follows the Node version pinned by `.nvmrc`, npm follows the root `packageManager`, and the server build target matches Node 24.
- User-facing Web, Electron, Docker, export, error, and maintained-documentation text now uses the exact product title `StudyNarrator AI` while compatibility identifiers remain unchanged.
- Browser, Electron, packaged-application, and Docker image checks cover the exact product title.
- The README no longer presents the obsolete render-plan workflow or links the historical PRD as current architecture; the PRD now directs readers to current setup and upgrade guidance.

## Validation

- Focused product tests passed: 26 tests.
- Focused application and server API tests passed: 27 tests.
- Focused Web navigation acceptance passed: 5 tests; focused Electron acceptance passed: 7 tests.
- A packaged Electron application reported `StudyNarrator AI` for both `CFBundleName` and `CFBundleDisplayName`, and its bundled renderer used the exact title.
- Formatting, lint, typechecking, 703 coverage tests, builds, 30 Web/Electron acceptance tests, and runtime smoke checks passed.
- Docker image construction and contract checks passed, including the exact OCI title label. Docker Scout stopped the full verifier on fixable high-severity vulnerabilities in the current image; cleanup passed.

## Ponytail review

The review kept `.nvmrc` as the single Node source of truth, preserved established export filenames and historical Speaches evidence, and added no dependency, abstraction, or speculative configuration.

## Next action

Resolve the image findings in R10a and rerun `npm run verify` before completing R05.
