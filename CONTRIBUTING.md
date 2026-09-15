# Contributing

## Set up the repository

Install Docker Engine/Desktop with Compose and Buildx, then follow the
[development guide](deploy/development/README.md). The tooling image installs the
Node version from `.nvmrc`, npm from `packageManager`, and all native and browser
dependencies. Keep these pins and the lockfile unchanged unless your task calls
for a dependency update. `npm ci` runs during the image build.

## Check a change

Run focused tests inside the tooling container:

```sh
docker compose -f compose.development.yaml run --build --rm tools npm test -- path/to/test.ts
docker compose -f compose.development.yaml run --build --rm tools npm run test:api -- path/to/api.test.ts
```

Prettier owns formatting. Mount the checkout only for deliberate source edits;
dependencies still come from the tooling image:

```sh
docker compose -f compose.development.yaml run --build --rm -v "$PWD:/source" tools npm exec prettier -- --write /source/path/to/file
```

Before committing, run the complete pipeline and review the diff:

```sh
docker compose -f compose.development.yaml up --build --abort-on-container-exit --exit-code-from verify verify
```

The container runs `npm run verify`: Knip, formatting, lint, typecheck, coverage,
builds, Web and Linux Electron acceptance, all runtime smoke checks, and Docker
image, vulnerability, browser, persistence, and cleanup checks. It returns a
nonzero exit code if any gate fails. Real macOS/Windows release checks stay in
native CI; they are not prerequisites on a contributor's workstation.

Pull requests must pass the GitHub Actions `check / check` status, emitted by
the `CI` workflow's `check` caller and the reusable workflow's `check` job.
It uses this same Docker command. After changing job names or reusable workflow
calls, compare the actual PR check name with the default branch's required
status; an obsolete name leaves GitHub waiting indefinitely. Generated reports
can be copied from the stopped verification container before cleaning up; see
the development guide.

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

Run `docker compose -f compose.development.yaml run --rm tools npm audit --omit=dev` as an explicit maintainer or release check when needed.
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
