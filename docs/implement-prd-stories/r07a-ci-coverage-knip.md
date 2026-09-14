# R07a implementation report

**Story:** [R07 — Enforce coverage and dead-code checks in pull-request CI](../TASKS.md#r07-enforce-coverage-and-dead-code-checks-in-pull-request-ci)
**Baseline:** `main` at `fa93bf7e0b50`
**Status:** Complete at the validated local checkpoint on 2026-09-14.

## Completion plan

- Current repository: `/Users/drofnas/Projects/TwistedPears/study-narrator`
  (`drofnas/studynarrator-ai`), branch `feature/complete-known-issues`, starting
  commit `836f773e2e8fddb6e6b1937289b85906b273aa18`. Worktree and index are clean;
  no other technical repository is authorized. GitHub has no open issues; the
  accepted local dependency table is the execution record.
- R07a is P1, has no blockers, and is the foundational item that unlocks R17
  and contributes to R10b readiness. Complete means its acceptance criteria,
  applicable validation, reviewed changes, and the requested local checkpoint
  are satisfied. R07b has its own completion record.
- The workflow already runs Knip and every Vitest suite once with coverage.
  Inspection found that the active `protect_default` ruleset requires a PR but
  no successful status check. Add only the existing GitHub Actions `check`
  context, retaining the three current rules, scope, enforcement, and empty
  bypass list. No workflow, dependency, or runtime code change is needed.
- Recheck Knip and coverage, refetch the effective branch rules, and review the
  final candidate with Ponytail and production readiness. Reuse this session's
  successful full verifier only after proving all source/configuration files
  still match its staged tree; run fresh Markdown/diff checks for this checkpoint.

## Outcome

- The pull-request check job now runs `npm run audit:knip`.
- Its separate default and API test steps are replaced by one `npm run test:coverage` step, whose configuration includes both suites and enforces the repository thresholds.
- Read-only permissions, fork-safe execution, the separate Web end-to-end job, and the absence of coverage artifact uploads are preserved.
- The active [protect_default ruleset](https://github.com/drofnas/studynarrator-ai/rules/20906646)
  now requires the existing `check` context from GitHub Actions integration
  `15368`. Refetching both the ruleset and effective `main` rules verified it.
  The deletion, force-push, and PR rules, default-branch scope, enforcement, and
  empty bypass list were preserved exactly. No branch-up-to-date requirement
  was added. The change uses GitHub's native
  [required status-check rule](https://docs.github.com/en/rest/repos/rules#update-a-repository-ruleset).

## Initial validation (before the Docker fix)

- Knip passed with the configured three-export allowance.
- Coverage passed: 81 files and 703 tests; 86.56% statements, 75.96% branches, 86.77% functions, and 88.39% lines.
- The full verifier passed formatting, lint, package boundaries, typechecking, tests, builds, 30 Web/Electron acceptance tests, and runtime smoke checks. Docker cleanup passed, but the vulnerability policy found fixable high-severity packages in the current image.

## Completion validation and review

- `npm run audit:knip` passed with the existing three-export allowance.
- `npm run test:coverage` passed: 84 files, 745 tests; 86.90% statements,
  76.28% branches, 87.15% functions, and 88.75% lines. Evidence is in
  `.tmp/r07a-knip.log` and `.tmp/r07a-coverage.log`.
- Reviewed `.github/workflows/ci.yml`, the default/API/coverage Vitest configs,
  and the root manifest. The check job has one coverage invocation covering
  both suites, one Knip invocation, no ignored failures, no coverage upload,
  and read-only permissions. The Web acceptance job remains separate.
- The current source and configuration exactly match this session's fully
  verified staged tree `995574c89a34283b402a4a4b51702b127c0dffd5`; only Markdown
  changed afterward. Its `npm run verify` result includes 745 coverage tests,
  33 Web/Electron acceptance tests, runtime smoke checks, and Docker scanning,
  two Docker acceptance tests, and audited cleanup. Evidence:
  `.tmp/r04-verify-with-trivy.log` and `.tmp/verify-docker/run-8WXG8l/`.
  Reusing that evidence for this documentation-only checkpoint avoids rerunning
  unchanged application suites; fresh formatting, link, and diff checks passed.
- Remote before/after and effective-rule snapshots in `.tmp/r07a-ruleset-*.json`
  and `.tmp/r07a-effective-rules.jsonl` prove the one-rule addition and preserve
  all existing settings. No deliberately failing PR or remote workflow was
  created; the rule was verified through GitHub's effective-rules API.
- Ponytail review of the existing CI change and final completion candidate:
  **Lean already. Ship.** No simplification is needed. The staged readiness
  review found no P0/P1/P2 issue. This change adds no application runtime cost.

## Dependency sweep and handoff

R07a is **Complete**. R17's sole dependency is R07a, its acceptance criteria and
repository settings are already defined, and it needs no additional environment
or owner decision. Its local state moved **Waiting → Ready**; canonical `todo`
is the available-work equivalent. R10b remains **Waiting** because R10a remains
In progress. No cross-repository dependent appears in the accepted table.

The parent R07 stays In progress pending R07b's separate completion review.
Only this story and its dependency-driven R17 readiness records are changed.
The four-file checkpoint contains documentation only; no source or workflow
change was needed beyond the prior R07a implementation in `ea1e60a`.
There was no pre-existing work to preserve and no edit in another repository.
The requested handoff is a local commit; future PR checks still run on that PR's
exact head. No push or PR creation is part of this run.
