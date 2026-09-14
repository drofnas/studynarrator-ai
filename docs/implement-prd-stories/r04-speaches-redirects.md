# R04 implementation report

**Story:** [R04 — Reject redirects from every Speaches request](../TASKS.md#r04-reject-redirects-from-every-speaches-request)
**Baseline:** `main` at `f692a1c220c7529b4bc4d14b3231f4da8dec50bd`
**Status:** In progress because the mandatory Docker vulnerability gate failed. R04 has no planned dependents to update.

## Outcome

- Every catalog, diagnostic, and synthesis request rejects redirects while preserving existing request and retry behavior.
- Redirect failures are sanitized and non-retryable for catalog discovery and synthesis. Diagnostics expose the stable `redirect-rejected` code.
- Loopback tests cover 301, 302, 307, and 308 for catalog GET and synthesis POST requests. Each case reaches the configured endpoint once and never contacts the redirect target.

## Validation

- Focused Speaches adapter suite: 35 tests passed.
- Formatting, lint, typechecking, 81-file/703-test coverage, builds, 30 Web/Electron acceptance tests, runtime smoke checks, and server reopen verification passed.
- Docker image construction and cleanup passed. Vulnerability policy failed on fixable findings in the current `node:24-trixie-slim` Debian packages, including critical `CVE-2026-5450` in glibc.

## Next action

Resolve the base-image vulnerability findings in R10, rerun `npm run verify`, and mark R04 complete only when that gate passes.
