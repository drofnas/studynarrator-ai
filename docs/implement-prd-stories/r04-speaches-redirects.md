# R04 implementation report

**Story:** [R04 — Reject redirects from every Speaches request](../TASKS.md#r04-reject-redirects-from-every-speaches-request)
**Baseline:** `main` at `f692a1c220c7529b4bc4d14b3231f4da8dec50bd`
**Status:** Complete at the validated local checkpoint on 2026-09-14.
R04 has no dependency-linked successors to update.

## Completion plan

- Current repository: `/Users/drofnas/Projects/TwistedPears/study-narrator`
  (`drofnas/studynarrator-ai`), branch `feature/complete-known-issues`, source
  commit `4cc2c1dbf107a41a74a546b665741c4576cad019`. Starting worktree and index
  were clean. No other repository is authorized.
- The local dependency table selects R04 first at P0 with no blockers. GitHub
  has no open repository issues; the canonical local task is the execution
  record. In progress becomes Complete after acceptance, required checks,
  reviewed staging, and the owner-requested local commit. No remote submission
  is part of this run.
- Review found that optional voice-catalog redirects were swallowed, allowing
  a connection check to report success. Stop these checks with the existing
  sanitized `redirect-rejected` result while retaining ordinary optional-catalog
  fallback behavior. Add real loopback coverage for all diagnostic endpoints,
  and exercise the failure and exported diagnostics through the Web UI.
- Existing schemas, application/REST/IPC manifests, and dependency boundaries
  remain compatible; no persistence or dependency change is needed. Stage only
  R04 implementation, tests, user documentation, and its local status/report.
- Validation: pinned Node 24.19.0/npm 11.19.0, clean `npm ci`, focused adapter and
  fake-server tests, focused Web acceptance, then Ponytail and staged readiness
  review followed by the full `npm run verify` gate.

## Outcome

- Every catalog, diagnostic, and synthesis request rejects redirects while preserving existing request and retry behavior.
- Redirect failures are sanitized and non-retryable for catalog discovery and synthesis. Diagnostics expose the stable `redirect-rejected` code.
- Loopback tests cover 301, 302, 307, and 308 for catalog GET and synthesis POST requests. Each case reaches the configured endpoint once and never contacts the redirect target.
- Optional model-scoped and fallback voice-catalog redirects now stop diagnostics
  with `disconnected` / `redirect-rejected`, a null HTTP status, and skipped later
  stages. Ordinary optional-catalog fallback behavior is preserved.
- Twenty real HTTP cases cover all five diagnostic endpoints and four redirect
  codes, validating the shared summary schema, sanitized failure, no retry,
  skipped later stages, and zero requests to the redirect target.
- The fake server supplies a `redirected-voice-catalog` scenario. Browser
  acceptance verifies the displayed failure, the exact three-request sequence,
  redacted JSON export, and successful recovery after restoring a healthy service.

## Initial validation (before R27 restored Docker)

- Focused Speaches adapter suite: 35 tests passed.
- Formatting, lint, typechecking, 81-file/703-test coverage, builds, 30 Web/Electron acceptance tests, runtime smoke checks, and server reopen verification passed.
- Docker image construction and cleanup passed. Vulnerability policy failed on fixable findings in the current `node:24-trixie-slim` Debian packages, including critical `CVE-2026-5450` in glibc.

## Completion review and validation

- The regression suite reproduced eight failures before the fix: both optional
  catalog endpoints across four redirect codes incorrectly reported a successful
  connection. The final focused adapter/fake-server suites pass all 69 tests.
- `npm run test:e2e:web -- --grep 'persists the singleton'` passed. The browser
  test also passed in the full verifier's acceptance run.
- `npm run check:package-dependencies` passed. The full coverage run passed
  745 tests in 84 files: 86.90% statements, 76.28% branches, 87.15% functions,
  and 88.75% lines. Formatting, lint, typecheck, builds, and native rebuild passed.
- The clean install used the pinned toolchain. SQLite/esbuild install scripts
  and the pinned Electron installer were run explicitly to restore required
  test binaries; no dependency versions or install policy were changed.
- Ponytail removed the fixture's redundant return-type declaration (six lines).
  The final review is **Lean already. Ship.** The strict correctness review also
  simplified an assertion to satisfy typed lint, retaining every check. No
  unresolved P0/P1/P2 implementation finding remains.
- Performance scope is an earlier exit on a rejected request. A model-catalog
  redirect previously allowed a fourth HTTP request for speech; the fake-server
  and browser tests now assert exactly three requests, with no speech or target
  request. The healthy path gains no request, allocation, or dependency. These
  deterministic assertions are the repeatable resource-use check.
- `npm run verify` passed in full, including all 33 Web/Electron acceptance
  tests, server/Electron/reopen smoke checks, and Docker verification with two
  browser acceptance tests and audited cleanup. The first attempt stopped at
  missing Trivy; adding the existing pinned `.tmp/trivy-0.74.0` directory to
  PATH allowed the complete rerun to pass. No gate was waived.
- Evidence: `.tmp/r04-regression-before.log`, `.tmp/r04-focused.log`,
  `.tmp/r04-web-focused.log`, `.tmp/r04-package-dependencies.log`, and
  `.tmp/r04-verify-with-trivy.log`. Docker inventory, raw Trivy JSON/SARIF, and
  assessment are in `.tmp/verify-docker/run-8WXG8l/`. The image retains the
  existing 16 individually assessed findings; this story changes no assessment
  or vulnerability policy.

## Checkpoint and dependency verification

All story-owned source and test changes passed the full verifier in staged tree
`995574c89a34283b402a4a4b51702b127c0dffd5` on the source commit recorded above.
The subsequent documentation-only completion updates passed formatting and diff
validation and were included in the final reviewed candidate. All nine changed
files belong to R04; there was no pre-existing work to preserve, no unstaged
story hunk, and no technical change outside this repository.

Canonical R04 and its local dependency row record **Complete**. The dependency
table gives R04 no successors in any repository, so no Ready transition is due.
The requested handoff is a local commit. A future PR still creates `CI/check`
and `CI/e2e`; those remote checks were not part of the requested local completion.
All required local readiness gates passed, and no implementation finding remains.
