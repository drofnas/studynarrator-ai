# R07a implementation report

**Story:** [R07 — Enforce coverage and dead-code checks in pull-request CI](../TASKS.md#r07-enforce-coverage-and-dead-code-checks-in-pull-request-ci)
**Baseline:** `main` at `fa93bf7e0b50`
**Status:** In progress because the mandatory Docker vulnerability gate failed. R10b and R17 remain blocked.

## Outcome

- The pull-request check job now runs `npm run audit:knip`.
- Its separate default and API test steps are replaced by one `npm run test:coverage` step, whose configuration includes both suites and enforces the repository thresholds.
- Read-only permissions, fork-safe execution, the separate Web end-to-end job, and the absence of coverage artifact uploads are preserved.

## Validation

- Knip passed with the configured three-export allowance.
- Coverage passed: 81 files and 703 tests; 86.56% statements, 75.96% branches, 86.77% functions, and 88.39% lines.
- The full verifier passed formatting, lint, package boundaries, typechecking, tests, builds, 30 Web/Electron acceptance tests, and runtime smoke checks. Docker cleanup passed, but the vulnerability policy found fixable high-severity packages in the current image.

## Next action

Resolve the Docker image findings in R10a, rerun `npm run verify`, then complete R07a and propagate R10b and R17 to Ready.
