# R10b: Reusable Docker verification CI

**Status:** Complete — 2026-09-15. Source commit:
`d50b7f79e8fc4d041f0e14213e5ae2b9aca6940e` on
`feature/complete-known-issues` in the current `drofnas/studynarrator-ai`
checkout. The index and working tree started clean; no other repository is in
scope. GitHub issue discovery returned no open issues.

## Scope and readiness

The canonical [R10 task](../TASKS.md#r10-enforce-docker-distribution-verification-in-ci)
and accepted [dependency table](../prd-work-items/local-only-simplification.md)
define the slice. R10a and R07a are Complete. R10b has no successors. Complete
requires acceptance criteria, required validation, and staged implementation.
Only a local commit is requested; hosted workflow execution follows submission.

## Implementation

The full verifier now lives in one reusable workflow. CI calls it for pull
requests and main pushes; it also handles weekly, manual, and `v*` tag runs.
The existing Docker tooling supplies application tools. Jobs have a 30-minute
timeout and cancel obsolete runs for the same workflow/ref. Checkout uses the
triggering revision with credentials disabled and read-only repository
permissions. Provisioning and verification failures propagate, and cleanup runs
unconditionally.

Failure uploads contain only the inventory, raw vulnerability report, and
applicability assessment, with seven-day retention. The accepted SARIF removal
deletes its conversion, parsing, path plumbing, and output. Native packaging
remains independent of the Docker distribution gate; R19's historical task prose
now agrees with the accepted dependency table.

Six regression cases parse the actual workflow, exercise failing Docker
prerequisites and verification commands, and check event coverage, permissions,
cleanup, and artifact selection. A sentinel secret in excluded data, logs, traces,
registry configuration, and caches stays outside the selected uploads.
The tests declare the existing `yaml` 2.9.0 package as a direct development
dependency. The lockfile hoists the same version and integrity from Knip's nested
dependency; production dependencies and toolchain versions do not change.

## Validation

All application tools ran in Docker with Node 24.19.0, npm 11.19.0, and Trivy
0.74.0. The host's missing Buildx was handled by the documented
[legacy-builder fallback](../../deploy/development/README.md#full-verification).
The isolated distribution verifier used bundled Buildx.

```sh
DOCKER_BUILDKIT=0 docker compose -f compose.development.yaml build verify
docker compose -f compose.development.yaml run --rm tools npm test -- scripts/docker-workflow.test.ts
docker compose -f compose.development.yaml run --rm tools npm run lint
docker compose -f compose.development.yaml run --rm tools npm run typecheck
docker compose -f compose.development.yaml run --rm tools npm run check:package-dependencies
docker compose -f compose.development.yaml up --abort-on-container-exit --exit-code-from verify verify
```

- Actionlint 1.7.11 passed both changed workflows. Its official release archive
  matched the published SHA-256 checksum and ran inside the tooling container.
- All six focused workflow tests passed. An initial lint error in the test
  helper's type narrowing was corrected before the final run.
- Full verification passed: Knip within its existing three-finding allowance,
  formatting, lint, typecheck, 756 tests across 87 files, all builds, Electron
  native rebuild, 34 Web/Electron acceptance tests, three runtime smokes, and the
  Docker distribution gate. Coverage: 86.92% statements, 76.30% branches,
  87.16% functions, and 88.76% lines.
- The Docker gate passed hardening, Chromium and Firefox acceptance, persistence,
  offline recovery, cleanup, and the final leftover-resource audit.
- Fresh amd64 image:
  `sha256:12dd0afef0f536c7e8e0e70889affc1520fa73f17221d4951e135080bdd84482`.
  The raw scan retained 16 highs, zero critical findings, and zero findings with
  a fixed version. All 16 passed the existing exact-build code-absence assessment,
  which expires on 2026-10-14 UTC. No vulnerability policy or exception changed.
- The output directory contains exactly the CycloneDX inventory (103 components),
  Trivy JSON, and applicability assessment. No SARIF file was generated.
- Ignored evidence: `.tmp/r10b-verification/`, including logs, Actionlint checksum,
  image summary, coverage/Playwright reports, and Docker run `run-isWx9h`.

## Performance

Application hot paths and production bundles are unchanged. The verifier removes
one Trivy conversion process and one generated file; CI retains three scanner
files only on failure. This run produced 447,028 uncompressed evidence bytes.
One full run took 3m27.170s on local Linux amd64, starting from the built tooling
image and a fresh nested Docker daemon, against the repository fixtures and fake
Speaches service. Repeat the full command above with shell `time` for comparison.
This is a local operational baseline, not a hosted-runner timing guarantee; the
30-minute job timeout also covers tooling-image creation on GitHub.

## Tracker and readiness handoff

R10b moved Ready → In progress → Complete after acceptance, validation, and
staging. The parent R10 is Complete. The full accepted dependency table contains
no R10b successors, so no dependent Ready transitions are required. R19 remains
Deferred for R13, RC authorization, and native hosts. No second item was
implemented.

The full gauntlet validated staged tree
`1f68b6e181a3812544cab27320442eff8a5917c5`; subsequent changes only record completion
and this evidence and receive formatting/diff validation. The final staged set
contains the two workflows, verifier and workflow tests, root manifest/lockfile,
two user/operational guides, this report, and two tracker documents. There is no
unrelated work or generated artifact in the candidate.

**Readiness: CONDITIONALLY READY.** All local pre-submission gates pass and the
review found no P0/P1/P2 issues. The normal-submission-created gate remains
pending: the exact PR revision's `CI` workflow, caller job `check`, reusable job
`check`. Hand it to `submit-change-request` for monitoring when submission is
authorized. This request authorizes the local commit only; hosted Actions and
native release validation have not been claimed as executed.

Workflow semantics were checked against GitHub's
[reusable-workflow documentation](https://docs.github.com/en/actions/how-tos/reuse-automations/reuse-workflows)
and [workflow syntax](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax).

## Ponytail review

Lean already. Ship.
