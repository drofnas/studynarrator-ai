# R17: Reviewed dependency updates

**Status:** Complete as a reviewed, verified local implementation checkpoint.
Version-update scheduling awaits the configuration reaching the default branch.
**Source:** [R17](../TASKS.md#r17-pin-ci-actions-and-configure-dependabot-updates).

## Plan and completion contract

- Repository: `/Users/drofnas/Projects/TwistedPears/study-narrator`,
  `drofnas/studynarrator-ai`, branch `feature/complete-known-issues`, starting
  commit `2d37070489b812b072e2bcf16dcbfc9db43af062`. Worktree and index were clean
  at the start; no other technical repository was authorized.
- The accepted local table marked R17 Ready and its sole dependency R07a Complete
  at selection. GitHub had no open issue records for this work. Move R17 In progress before
  editing and Complete after reviewed local implementation, applicable checks,
  and the requested checkpoint. Version-update scheduling activates only after
  the configuration reaches the default branch; no push, PR, or release is requested.
- Add one root npm update entry and one GitHub Actions entry, monthly at 09:00
  America/Los_Angeles, with five open version-update PRs per ecosystem.
  Group minor/patch development-tool updates only; keep runtime, native,
  packaging, browser tooling, and major updates individually reviewable.
- Resolve current action tags to official immutable commits, keeping exact tag
  comments. Preserve CI's read-only token and scope release write access to the
  draft-release job. Preserve dependency versions, Node/npm pins, application
  contracts, persistence, repository security settings, and merge rules.
- Validate YAML and workflow semantics, grouping against all workspace manifests,
  action provenance, permissions, and the full repository verifier. Run Ponytail
  and staged production-readiness reviews; commit only this story's configuration
  and documentation. R17 has no dependency-linked successors.

## Implementation and review

- Added one root npm entry and one GitHub Actions entry. The only group uses an
  explicit development-tool list and accepts minor/patch updates. It excludes
  every current runtime dependency, including `fflate`, which appears in both
  development and runtime manifests. Native, packaging, browser-tooling, and
  major updates remain separate.
- Added `dependencies` labels and `chore(deps)` / `ci(deps)` commit prefixes. The
  label already exists remotely. Preserved all manifests, the lockfile, `.nvmrc`,
  and npm's `packageManager` pin.
- Pinned all 12 action references across CI and release. Read the current major
  aliases and matching exact release tags from the owning repositories through
  GitHub's API on September 14, 2026; no action major version was upgraded.
- CI and packaging use `contents: read`; only the existing draft-release job uses
  `contents: write`. No workflow triggers, execution steps, secrets, or
  auto-merge behavior were added. Contributor guidance covers release-note
  review, failed-group isolation, native/package acceptance, toolchain pin
  preservation, and the optional maintainer audit signal.

| Action                        | Verified release | Immutable commit                                                                                                                           |
| ----------------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `actions/checkout`            | `v4.4.0`         | [11d5960a326750d5838078e36cf38b85af677262](https://github.com/actions/checkout/commit/11d5960a326750d5838078e36cf38b85af677262)            |
| `actions/setup-node`          | `v4.4.0`         | [49933ea5288caeca8642d1e84afbd3f7d6820020](https://github.com/actions/setup-node/commit/49933ea5288caeca8642d1e84afbd3f7d6820020)          |
| `actions/upload-artifact`     | `v4.6.2`         | [ea165f8d65b6e75b540449e92b4886f43607fa02](https://github.com/actions/upload-artifact/commit/ea165f8d65b6e75b540449e92b4886f43607fa02)     |
| `actions/download-artifact`   | `v4.3.0`         | [d3f86a106a0bac45b974a628896c90dbdf5c8093](https://github.com/actions/download-artifact/commit/d3f86a106a0bac45b974a628896c90dbdf5c8093)   |
| `softprops/action-gh-release` | `v2.6.2`         | [3bb12739c298aeb8a4eeaf626c5b8d85266b0e65](https://github.com/softprops/action-gh-release/commit/3bb12739c298aeb8a4eeaf626c5b8d85266b0e65) |

Configuration semantics were checked against GitHub's
[Dependabot options reference](https://docs.github.com/en/code-security/reference/supply-chain-security/dependabot-options-reference).
Monthly version-update limits do not suppress independent security updates.

Ponytail review of the complete configuration diff: **Lean already. Ship.**
The two ecosystem entries and positive development-tool list express the requested
policy directly; no abstraction or additional dependency is needed. No
simplification changes were warranted.

## Validation evidence

- Clean `npm ci` with Node 24.19.0 / npm 11.19.0 passed. Restored the existing
  SQLite/esbuild native modules and Electron binary for local acceptance.
- Prettier and `git diff --check` passed.
- Actionlint 1.7.12 passed for both workflows. Its official release archive was
  verified against the published SHA-256 checksum before execution.
- Focused YAML checks passed for both schedules, limits, labels, commit prefixes,
  permissions, and all 12 immutable references. Checked grouping across all 12
  package manifests: 23 development dependencies are eligible, every runtime
  dependency is excluded, and the explicit native/browser exclusions hold.
  Parsed comparisons against HEAD confirm that workflow behavior changes are
  limited to immutable pins and the narrower release token permissions.
- GitHub read-back confirmed Dependabot alerts and security updates enabled,
  security updates unpaused, and auto-merge disabled. Other security-setting
  prerequisites retain the owner's August 31 verification recorded in R17;
  this task did not alter repository settings.
- `npm run verify` passed on staged tree
  `73d12ec956faf2864993113d91f3461f88dcd989`: Knip within its existing allowance,
  formatting, lint, typecheck, 745 tests across 84 files with coverage, all builds,
  the Electron native rebuild, 33 Web/Electron acceptance tests, server/Electron
  smoke tests and server reopen, and Docker verification. Docker passed both
  acceptance tests, persistence/restart checks, inventory and vulnerability
  policy, and resource cleanup. No thresholds, exclusions, or policies changed.
- Local uncommitted evidence: `.tmp/r17-validation.log`, `.tmp/r17-verify.log`,
  and `.tmp/verify-docker/run-ZafHAp/`. Only completion documentation changed
  after the passing verifier; the three configuration files are identical to
  that verified staged tree. Final Markdown formatting and diff checks passed.
- Reviewed all seven staged files and every hunk for scope, configuration
  correctness, permissions, provenance, sensitive content, and acceptance:
  no P0/P1/P2 findings. No new runtime behavior, contracts, storage, dependencies,
  or native packaging steps require additional targeted acceptance.

## Completion and remaining activation

- Canonical R17 and the accepted local table move to Complete in this checkpoint.
  R17 has no dependency-linked successors, so no dependent is newly Ready;
  other work-item states are unchanged.
- Scheduled Dependabot PRs and GitHub-hosted execution cannot be observed from a
  local commit. They await this configuration reaching the default branch; the
  deferred native release exercise remains R19. No push, PR, tag, or release
  was performed for this local implementation request.
