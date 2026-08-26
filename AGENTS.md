# Repository Instructions

## Core SDLC Workflow

Use this workflow for each task. The affected surfaces determine the required gates. A task is incomplete while an applicable gate is failing or unverified.

### 1. Ground the task and control scope

Before editing:

- Inspect `git status`, relevant source, public manifests, tests, accepted ADRs, and `docs/technical-debt.md`.
- Treat current source, configuration, and manifests as authoritative. Check historical plans and product documents for intent, then verify their claims against the implementation.
- Preserve unrelated and user-authored changes. Do not stage, rewrite, or discard them.
- Define the affected behavior, layers, contracts, persistence, tests, and documentation. Keep each checkpoint to one coherent, validated slice.
- Use the Node and npm versions pinned by `.nvmrc` and the root `packageManager`. Use `npm ci` for a clean reproducible install.
- Use existing dependencies and established patterns. Add a dependency only when the task requires it, place it in the owning workspace, and update the root lockfile in the same checkpoint.
- Do not change dependency versions, the Node or npm toolchain, ESLint rules, TypeScript configuration, coverage thresholds, or CI configuration outside the task's scope.
- Verify commands and conventions in `package.json` or their configuration before citing or running them.

### 2. Preserve the architecture

- Keep deterministic domain logic in `packages/core`, use cases and orchestration in `packages/application`, and transport contracts and Zod schemas in `packages/shared-types`.
- Keep SQLite access in `packages/persistence`, audio and cache infrastructure in `packages/rendering`, Speaches HTTP behavior in `packages/speaches-adapter`, and runtime utilities in `packages/runtime`.
- Keep Express routers in `apps/server/src/routes`. Routers validate requests, delegate to typed services, validate responses, and pass rejected promises through `asyncHandler` to the shared boundary middleware. Do not introduce a controller layer or place business logic in a router.
- Follow the Web layout: route containers in `pages`, domain UI and hooks in `features`, transport clients in `services`, reusable UI in `shared`, and browser worker code in `workers`.
- React code must use typed clients and the established service and React Query patterns. Keep raw REST calls and `window.studyNarrator` access inside Web service adapters.
- Keep the Electron renderer unprivileged. Route filesystem, process, database, FFmpeg, and network access through narrow validated IPC operations owned by the main process.
- Obey the dependency direction enforced by ESLint: foundational packages import no internal workspaces, infrastructure packages depend only on allowed foundations, and apps may consume packages but may not import other apps.
- Import other workspaces through their public `@studynarrator/*` exports. Do not use relative cross-workspace paths or deep package internals.

### 3. Keep contracts, persistence, and security aligned

- Validate REST and IPC path parameters, query values, request bodies, inputs, and outputs with strict shared Zod schemas.
- Update each applicable public surface in one checkpoint when an operation changes:
  - shared schemas, client interfaces, and channel constants;
  - the application service and `APPLICATION_SERVICE_MANIFEST`;
  - the REST router, Web client, and `REST_API_MANIFEST`;
  - the IPC handler, preload bridge, and `PUBLIC_IPC_CHANNEL_MANIFEST`;
  - focused behavior tests and exact manifest-driven contract tests.
- Record intentional transport-specific exceptions in code or tests. Test the exception instead of forcing false REST and IPC symmetry.
- Contract tests for a changed operation must prove live-to-manifest parity, a schema-valid success, malformed or unknown input rejection, and stable sanitized errors where those cases apply.
- Return errors through the central boundary. Preserve stable domain error types across all failure paths, including filesystem and external-service failures.
- Use the injected structured logger. Do not add raw `console` logging to application code or log script text, project names, request bodies, credentials, raw private endpoints, upstream response bodies, or unsanitized errors.
- Add a sentinel-secret regression assertion for changes to logs, diagnostics, connection handling, exported artifacts, REST errors, or IPC errors.
- Keep SQLite migrations append-only, consecutive, and immutable after commit. Append the next migration, bump `DATABASE_SCHEMA_VERSION`, and update the version-check test in `apps/server/src/migrate.test.ts` in the same checkpoint. Do not edit existing migration seed values to change current defaults; add an explicit reconciliation migration.
- Test schema changes against fresh creation, upgrades from relevant older versions, user-data preservation, failure rollback, backup recovery, idempotent reopen, and newer-schema refusal as applicable.
- Use disposable data directories for migration and recovery tests. Never point development or test migrations at user data.
- Implement data-directory layout changes as stable, idempotent, retryable steps. Record a step only after it succeeds and preserve too-new layouts without modification.
- Replace live persisted files through a temporary sibling followed by atomic rename. Add new managed files to inventory, retention, cleanup, and size-accounting logic.
- Preserve Electron sandboxing, loopback-first Web exposure, path validation, output redaction, and subprocess execution with argument arrays and shell execution disabled.

### 4. Test at the affected layer

- Co-locate Vitest tests as `*.test.ts` or `*.test.tsx`. Structure tests as clear Arrange-Act-Assert sequences; phase comments are optional.
- Use `npm test` for core, shared-types, persistence, rendering, runtime, Speaches adapter, Web, fake-server, and other default-suite work. Use `npm run test:api` for application services, server boundaries, and Electron bridge or bootstrap work.
- Add focused coverage for changed happy paths, branches, invalid input, failure recovery, cleanup, concurrency, persistence, idempotency, and redaction where they apply.
- Require `npm run test:coverage` to pass. Do not lower thresholds or add exclusions to make a change pass, and do not claim per-file or 100% path coverage that the repository does not enforce.
- Add or update Playwright coverage for changed user-facing routes, primary workflows, navigation or access paths, dialogs, and user-observable actions. A click alone is not acceptance; assert the resulting UI, persistence, API, or fake-boundary state.
- Prefer role, label, text, and state locators. Add a test ID only when the UI has no stable semantic locator and an accessible name would be inappropriate.
- Wait for observable application state. Do not use fixed sleeps for UI synchronization. Bounded polling with a deadline is allowed for process or infrastructure readiness.
- Reuse the disposable Web and Electron fixtures and the repository-owned fake Speaches server. Do not use fixed ports, real user data, external speech services, or shared mutable state in automated acceptance.
- Run the Web Playwright project for shared browser workflows, the Electron project for IPC or native behavior, and Docker verification for image, Compose, runtime, or volume behavior.
- Regenerate golden parser fixtures only for an intended parser or transformer change. Use the repository command and review the complete fixture diff before committing it.
- Keep component and service tests when Playwright coverage exists. Human review begins after automation is green and covers visual quality, accessibility feel, responsive behavior, perceived timing, audio perception, and operating-system-native interaction. Add an automated regression test for each functional defect found in human review.

### 5. Verify, document, checkpoint, and hand off

- Prettier owns formatting. Format intended files before a checkpoint, inspect the formatting diff, and keep broad formatting-only work separate from logic changes.
- For code or configuration checkpoints, run `npm run format:check`, `npm run lint`, `npm run typecheck`, and the focused tests for the affected layer.
- Run `npm run check:package-dependencies` after import or workspace dependency changes. Run `npm run audit:knip` after removals or structural refactors, and do not add findings beyond the configured allowance.
- Run the relevant Web, Electron, or Docker acceptance suite when the checkpoint changes that surface.
- Run `npm run verify` before completing a source or configuration behavior change. If FFmpeg, Playwright, native modules, Docker, Compose, or Docker Scout blocks the verifier, report the exact missing gate and do not describe the task as fully verified.
- Use proportionate checks for documentation-only work: Prettier, Markdown and diff validation, plus verification of referenced commands, links, versions, and implementation claims.
- Update user and operational documentation in the same checkpoint when behavior, setup, environment variables, supported distributions, data locations, schema or layout compatibility, backup and restore behavior, security posture, or release status changes.
- Create a checkpoint after each coherent, validated slice and before moving to another concern or risky refactor. Use concise `type(scope): imperative outcome` messages and do not use `WIP`, `updates`, or `misc changes`.
- Keep unrelated work out of checkpoints. Do not rewrite, squash, or discard checkpoint commits unless the user asks.
- Before each commit, review `git status`, the staged file list, and the complete staged diff. Stage only the intended slice.
- Do not commit API keys, tokens, passwords, credentials, private keys, personal endpoints, private infrastructure details, sensitive generated files, unsafe permissions, or accidental data exposure.
- Add a narrow `.gitignore` entry for an untracked or generated file that should never enter source control. Do not use `.gitignore` to conceal tracked sensitive content; sanitize or remove tracked content and address any history exposure. Ask the user when source-control intent is unclear.
- Keep generated coverage, Playwright, Docker verification, temporary, and release artifacts uncommitted unless the task requests a reviewed artifact.
- Never add automated attribution metadata, AI bylines, or `Co-authored-by` lines to commits.
- When the user authorizes implementation on the current branch, create these checkpoint commits without requesting approval for each one.
- At handoff, report the behavior changed, commands run, results, and any gate that remains incomplete.
