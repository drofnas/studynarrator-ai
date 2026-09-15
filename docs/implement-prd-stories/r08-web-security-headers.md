# R08: Web response security headers

**Story:** [R08 — HTTP boundary](../TASKS.md#r08-set-explicit-web-response-security-headers)

**Status:** Complete at the validated local checkpoint on 2026-09-14.

## Scope and completion contract

- Repository: the current `drofnas/studynarrator-ai` checkout, branch
  `feature/complete-known-issues`, source commit
  `2ec141300223fa64082cc74c756ed3bf944d31f5`. The working tree and index were
  clean; no other repository was changed.
- R08 was In progress, with its implementation already present and no
  dependencies. Its earlier verifier stopped at Docker vulnerabilities; this
  run rechecks the current image under the existing policy.
- `TASKS.md` is the canonical tracker. Complete requires acceptance criteria,
  required validation, and staged changes. Ready is `todo` with all dependencies
  complete. The accepted [dependency table](../prd-work-items/local-only-simplification.md#order-and-dependencies)
  records the relationship graph. GitHub has no open issues.

## Implementation review

- One dependency-free middleware applies the fixed headers after Host validation
  and before the request parsers, routers, error boundary, and static handlers.
- API, media, downloads, errors, SSE, static files, and SPA fallback responses
  receive `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`,
  `X-Frame-Options: DENY`, `X-XSS-Protection: 0`, and
  `Permissions-Policy: camera=(), geolocation=(), microphone=(), payment=(), usb=()`.
- The exact header assertions cover all 63 REST operations plus the other
  response classes. Existing error tests retain sentinel-secret redaction
  checks; media ranges, streaming, and caching retain their behavior checks.
- This checkpoint changes test assertions and documentation. The production
  middleware, public manifests, persistence, dependencies, and Electron security
  settings are unchanged. No application performance measurement is needed.

## Ponytail review

`apps/server/src/app.test.ts:L72: shrink: Remove the assertion wrapper. Call Vitest's toMatchObject directly.`

Applied while preserving every header assertion. Final review found no further
complexity to remove. `net: -6 lines possible.` All six lines were removed.

## Validation

All application tooling ran in Docker with Node 24.19.0 and npm 11.19.0. The
[documented legacy-builder fallback](../../deploy/development/README.md#full-verification)
bootstrapped the tooling image because the workstation lacks Buildx; the nested
distribution verifier uses its bundled Buildx.

```sh
DOCKER_BUILDKIT=0 docker compose -f compose.development.yaml build verify
docker compose -f compose.development.yaml run --rm tools npm run test:api -- apps/server/src/app.test.ts
docker compose -f compose.development.yaml up --abort-on-container-exit --exit-code-from verify verify
```

- Focused server suite: 21 tests passed.
- Full verifier: Knip within its three-finding allowance, formatting, lint,
  typecheck, 748 tests across 85 files with coverage, all builds, Electron native
  rebuild, 33 Web/Electron acceptance tests, and three runtime smoke checks
  passed.
- Coverage: 86.92% statements, 76.30% branches, 87.15% functions, 88.75% lines.
- Docker image construction, inventory, vulnerability policy, Chromium and
  Firefox acceptance, volume persistence/restart, and audited cleanup passed.
  All 16 raw Trivy findings were assessed under the existing image policy;
  no threshold or security gate was weakened.
- Ignored evidence: `.tmp/r08-verification/`, including focused/full logs,
  coverage and Playwright reports, and Docker run `run-AgR8E7`.

## Completion and dependency sweep

R08 moves In progress → Complete in the canonical task list and dependency
table. R09 is its only successor and moves Waiting → Ready: R08 was its sole
dependency, its acceptance criteria are already defined, and its verification
uses the available Docker tooling and fake services. The canonical R09 status
remains `todo`, now with a completed dependency and an explicit readiness note.
The full local graph contains no other R08 dependents or cross-repository work.
This run implements no second story.

The checkpoint contains the server test simplification, this report, R08/R09's
canonical entries, and dependency statuses. Only a local commit was requested;
the hosted GitHub Actions `check` must run on any future PR submission.
