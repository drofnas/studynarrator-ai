# Contributing

## Set up the repository

Use the Node.js version in `.nvmrc` and the npm version in the root
`packageManager` field. Install FFmpeg and FFprobe on `PATH`, then install the
locked dependencies from the repository root:

```sh
npm ci
```

See [README.md](README.md) for the Web, Electron, and Docker development commands.

## Check a change

Run focused tests while developing:

```sh
npm test -- path/to/test.ts
npm run test:api -- path/to/api.test.ts
```

The default suite covers foundational packages and the Web application. The API
suite covers application services, server boundaries, and the Electron bridge.
Run the affected end-to-end suite for user-facing Web or Electron changes:

```sh
npm run test:e2e:web
npm run test:e2e:electron
```

Prettier owns formatting. Before committing, format the intended files, inspect
the diff, and run the full verifier:

```sh
npx prettier --write <changed-files>
npm run verify
```

The full verifier also requires the Docker and Trivy prerequisites listed in the
[README](README.md#development-and-verification). Run `npm run verify:docker`
when changing the Docker distribution.

Pull requests targeting the default branch must pass the GitHub Actions `check`
job. It runs Knip, formatting, lint, typechecking, and both Vitest suites together
with coverage thresholds. Web end-to-end tests remain a separate `e2e` job.

## Review dependency updates

After `.github/dependabot.yml` reaches the default branch, Dependabot checks the
root npm workspace and GitHub Actions on the first day of each month at 09:00
America/Los_Angeles. Each ecosystem allows five open version-update PRs. The root
lockfile covers all npm workspaces; do not add duplicate per-workspace schedules.
Security updates remain enabled independently of the monthly schedule.

The `development-tools` group includes only minor and patch updates to the listed
development tools. Runtime dependencies, major updates, Electron, Electron
Builder, `better-sqlite3`, Vite, esbuild, and Playwright remain separate. A package
used at runtime anywhere in the repository must stay out of the group, even if
another workspace lists it as a development dependency.

Review release notes and the full manifest and lockfile diff before merging.
Preserve the Node.js pin in `.nvmrc` and npm pin in `packageManager`; toolchain
changes require a separate reviewed task. If a grouped update fails, split it
into individual updates to isolate the failure. Electron or `better-sqlite3`
updates also require the affected native rebuilds, Electron acceptance, and
installer/package validation. Run the full verifier and never bypass failing
checks to clear the update queue. Updates require review; auto-merge is disabled.

Keep action references pinned to full commit SHAs from their owning repositories,
with the exact release tag in a comment. Verify both when reviewing action
updates. CI, including Dependabot PRs, uses a read-only token and no secrets;
only the draft-release job has `contents: write`.

Run `npm audit --omit=dev` as an explicit maintainer or release check when needed.
It is not a required PR gate: advisory-service availability must not determine
whether deterministic checks pass. License inventory and the Docker image policy
remain separate checks.

## Keep changes within the existing architecture

- Put deterministic domain logic in `packages/core`, orchestration in
  `packages/application`, and public schemas and transport contracts in
  `packages/shared-types`.
- Keep SQLite code in `packages/persistence`, audio and cache infrastructure in
  `packages/rendering`, Speaches HTTP behavior in `packages/speaches-adapter`, and
  runtime utilities in `packages/runtime`.
- Keep server routers in `apps/server/src/routes`, Web pages and features under
  their existing `apps/web/src` layers, and privileged Electron operations behind
  the validated main-process IPC boundary.
- Import other workspaces through their public `@studynarrator/*` exports.

Database migrations are append-only. Add the next consecutive migration, update
`DATABASE_SCHEMA_VERSION` and the migration tests in the same change, and never
edit committed migrations or their historical seed values.

Keep each commit focused. Preserve unrelated work and leave generated output such
as `.tmp/`, coverage reports, Playwright reports, and packaged installers out of
commits.
