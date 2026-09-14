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
