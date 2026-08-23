# StudyNarrator — Implementation Plan, Tasks 9 and Onward (v2)

Supersedes tasks 9–30 of `IMPLEMENTATION_PLAN.md`. Tasks 1–8 are complete (PR #16); their defects are covered by `CLEANUP_PLAN_PR16.md`, which must be finished first.

Every task in this document is **XS**, **S**, or **M**. Nothing is L or XL. The decomposition is based on observed behaviour while executing tasks 1–8.

Audience: an AI coding assistant executing tasks one at a time.

---

## HOW TO USE THIS DOCUMENT

**Read this section and the Global Rules below before starting any task.**

1. Do **exactly one numbered task per session**. Do not combine tasks. Do not look ahead.
2. Each task lists **FILES YOU MAY TOUCH**. Editing any file not on that list is a failed task. If the work seems to require a file that is not listed, **STOP** and report `TASK <n>: needs unlisted file <path>` rather than editing it.
3. If a task shows a `FIND` block and a `REPLACE WITH` block, reproduce the replacement character for character. If the `FIND` text is absent, **STOP** and report `TASK <n>: FIND text not found in <path>`.
4. Run the task's `VERIFY` commands after every task. If one fails and the fix is not obvious from the error, **STOP** and report the full output.
5. One commit per task, using the task's exact `COMMIT` line.
6. **Status tracking:** every task row in the table and every task section below carries a **Status** — `todo`, `in progress`, or `complete`. Update it when you start or finish the task.

### Size definitions

| Size   | Means                                                                      |
| ------ | -------------------------------------------------------------------------- |
| **XS** | One or two files. Mechanical. No new tests, or one trivial test.           |
| **S**  | Two to four files, one layer of the stack, one concept. One or two tests.  |
| **M**  | Up to six files, still one layer and one concept, with tests. The ceiling. |

If a task appears to be growing past its stated size, **STOP** and report. Do not push through.

---

## GLOBAL RULES

These exist because of specific mistakes made during tasks 1–8. Follow them in every task.

**G1 — Never reformat.** After `CLEANUP_PLAN_PR16.md` task C1, Prettier owns formatting. Run `npm run format` before committing, then confirm the diff contains only intended changes:

```sh
git diff -w --stat
```

If that shows files you did not intend to change, revert them. Do not create commits described as style, normalize, or cleanup.

**G2 — Never claim a tool or convention exists without checking.** Before referring to a formatter, linter, script, or config in a commit message or comment, verify it is present in `package.json` or on disk. During tasks 1–8, five commits referenced a "repo formatter" that did not exist.

**G3 — Never substitute a library.** Use what is already a dependency. Specifically: SQLite access is `better-sqlite3`, always injected as a `Database` parameter, never imported directly in a leaf module, and never `node:sqlite`. Validation is Zod. HTTP is Express. If a task seems to need something not already installed, **STOP** and report.

**G4 — Stay inside the stated scope.** Do not change Node versions, dependency versions, lint rules, or `tsconfig` unless a task says to. During tasks 1–8, an unrequested change to `engines.node` left four files disagreeing with each other.

**G5 — Any new file written into a managed directory must be covered by that directory's listing and pruning logic.** Writing a file into `backups/`, the speech cache tree, or the render artifact tree without teaching the corresponding lister and collector about it creates a permanent invisible leak. This happened once already.

**G6 — Replace files atomically.** Any operation that overwrites an existing file the application depends on must write to a temporary file in the same directory and then `rename`. Never `copyFile` or `writeFile` directly over live data.

**G7 — Wrap every failure path in the same error type.** If a function throws a domain error for its failure modes, every failure mode must throw that type, including filesystem errors. Do not leave one path emitting a raw `ENOENT`.

**G8 — After any removal, check for orphans.** Run `npm run audit:knip` and grep for the removed identifiers. A removal that leaves an uncalled method behind is incomplete.

**G9 — Adding an operation touches four places.** The service manifest, the REST route, the IPC channel, and the contract tests. A task that adds one must do all four or explicitly say which are out of scope.

**G10 — Migrations are append-only.** Never edit a migration that has shipped. Never renumber. Always bump `DATABASE_SCHEMA_VERSION` in the same commit as a new migration, and update every test that asserts the old value.

### Standard verification

```sh
npm run format:check && npm run lint && npm run typecheck && npm test && npm run test:api
```

---

## TASK TABLE

| #     | Task                                               | Priority | Size | Status      |
| ----- | -------------------------------------------------- | -------- | ---- | ----------- |
| 9.1   | Add migration 4 and bump the schema version        | P0       | S    | complete    |
| 9.2   | Rename the connection types in shared-types        | P0       | S    | complete    |
| 9.3   | Propagate the rename through persistence           | P0       | S    | complete    |
| 9.4   | Propagate the rename through application           | P0       | M    | complete    |
| 9.5   | Propagate the rename through server and desktop    | P0       | S    | complete    |
| 9.6   | Propagate the rename through the web client        | P0       | M    | complete    |
| 10.1  | Write and read the data directory manifest         | P0       | M    | complete    |
| 10.2  | Add the layout step runner                         | P0       | S    | done (10.x) |
| 10.3  | Convert cache metadata parsing to Zod              | P0       | S    | complete    |
| 10.4  | Add the two initial layout steps                   | P0       | S    | complete    |
| 11.1  | Add the CI check job                               | P0       | S    | complete    |
| 11.2  | Add the CI e2e and docker jobs                     | P0       | S    | complete    |
| 12.1  | Correct the README                                 | P0       | S    | complete    |
| 12.2  | Write UPGRADE.md                                   | P0       | S    | complete    |
| 12.3  | Split setup into SETUP.md                          | P0       | S    | complete    |
| 13    | Lower the Node requirement to 24                   | P1       | S    | complete    |
| 14    | Make the Vitest configs disjoint                   | P1       | XS   | complete    |
| 15    | Add coverage thresholds                            | P1       | S    | complete    |
| 16.1  | Extract the runtime descriptor type                | P1       | S    | complete    |
| 16.2  | Extract the shared service factory                 | P1       | M    | complete    |
| 16.3  | Reduce both bootstraps to the factory              | P1       | S    | complete    |
| 17.1  | Add the async handler and error middleware         | P1       | S    | complete    |
| 17.2  | Extract the system and persistence routers         | P1       | S    | complete    |
| 17.3  | Extract the connection and catalog routers         | P1       | S    | complete    |
| 17.4  | Extract the render and cache routers               | P1       | M    | complete    |
| 18.1  | Add the logger module                              | P1       | S    | complete    |
| 18.2  | Log startup and migration events                   | P1       | S    | complete    |
| 18.3  | Log render lifecycle and boundary errors           | P1       | S    | complete    |
| 19.1  | Add a render progress observer                     | P1       | S    | complete    |
| 19.2  | Add the SSE endpoint                               | P1       | S    | complete    |
| 19.3  | Consume SSE in the web client                      | P1       | M    | complete    |
| 20.1  | Add the voice timing calibration table             | P1       | S    | complete    |
| 20.2  | Record calibration after each render               | P1       | S    | complete    |
| 20.3  | Add the estimation functions                       | P1       | S    | complete    |
| 20.4  | Show estimates in the script editor                | P1       | M    | complete    |
| 20.5  | Add the preflight disk space check                 | P1       | S    | complete    |
| 21.1  | Add the retention settings table and service       | P1       | S    | complete    |
| 21.2  | Add the cache sweeper                              | P1       | M    | complete    |
| 21.3  | Add render pinning                                 | P1       | S    | complete    |
| 21.4  | Add the retention settings screen                  | P1       | M    | complete    |
| 22    | Host header allowlist                              | P1       | S    | complete    |
| 23.1  | Add electron-builder configuration                 | P1       | M    | complete    |
| 23.2  | Verify the native rebuild per target               | P1       | S    | deferred    |
| 23.3  | Add the release workflow, unsigned                 | P1       | S    | complete    |
| 23.4  | Add signing and notarization                       | P1       | M    | complete    |
| 23.5  | Decide and document the Docker support level       | P1       | S    | complete    |
| 24.1  | Build the golden corpus fixtures                   | P1       | M    | complete    |
| 24.2  | Add the golden corpus test and regeneration script | P1       | S    | complete    |
| 25.1  | Split the rendering package                        | P2       | M    | complete    |
| 25.2  | Split the persistence repository                   | P2       | M    | complete    |
| 25.3  | Split the speaches adapter                         | P2       | M    | complete    |
| 25.4  | Split the render service                           | P2       | M    | complete    |
| 25.5  | Split ProjectsPage                                 | P2       | M    | complete    |
| 27.1  | Add TanStack Query and the provider                | P2       | S    | complete    |
| 27.2  | Migrate the read-only pages                        | P2       | M    | complete    |
| 27.2a | Migrate connection-backed readers                  | P2       | M    | complete    |
| 27.2b | Migrate persistence settings readers               | P2       | M    | complete    |
| 27.2c | Migrate diagnostics readers                        | P2       | S    | complete    |
| 27.3  | Migrate the mutating pages                         | P2       | M    | complete    |
| 28    | Route code splitting                               | P2       | S    | complete    |
| 29.0a | Decouple shared-types schemas from core            | P2       | M    | complete    |
| 29.0b | Remove the shared-types core package dependency    | P2       | XS   | complete    |
| 29.0c | Remove the shared-types core build reference       | P2       | XS   | complete    |
| 29.0d | Remove unused private transport type exports       | P2       | XS   | complete    |
| 29    | Enforce package dependency direction               | P2       | S    | complete    |
| 30.1  | Cover the disjoint Vitest suites together          | P2       | S    | in progress |
| 30    | Replace the dead-code script with knip             | P2       | S    | todo        |
| 26    | Single typed contract map                          | P2       | —    | deferred    |

Execute in the listed order. Tasks 9.1 through 12.3 are P0 and should be finished before any packaged release.

---

# 9 — RENAME SPEACHES OUT OF THE DOMAIN MODEL

Split into six tasks. The rename touches 46 files, which is far beyond one session.

**Read this before starting 9.1.** There are two categories of `Speaches*` identifier and only one is renamed:

**RENAME — domain and connection names:**

| From                                  | To                                       |
| ------------------------------------- | ---------------------------------------- |
| `SpeachesConnectionSchema`            | `SpeechBackendConnectionSchema`          |
| `SpeachesConnectionAuthoringSchema`   | `SpeechBackendConnectionAuthoringSchema` |
| `SpeachesConnection`                  | `SpeechBackendConnection`                |
| `SpeachesConnectionAuthoring`         | `SpeechBackendConnectionAuthoring`       |
| `SpeachesConnectionClient`            | `SpeechBackendConnectionClient`          |
| `SpeachesCatalogDiscoveryInputSchema` | `SpeechCatalogDiscoveryInputSchema`      |
| `SpeachesCatalogDiscoveryInput`       | `SpeechCatalogDiscoveryInput`            |
| `SpeachesSpeechCatalog`               | `SpeechCatalog`                          |

**DO NOT RENAME — adapter internals.** These name the actual Speaches protocol and belong to `packages/speaches-adapter`. Renaming them would be wrong:

`SpeachesSynthesisError`, `SpeachesSynthesisErrorCode`, `SpeachesSynthesisInput`, `SpeachesSynthesisResult`, `SpeachesCatalogError`, `SpeachesCatalogErrorCode`, `SpeachesCatalogInput`, `SpeachesAdapterDependencies`, `SpeachesRequestLog`, `SpeachesDiagnosticInput`, `SpeachesDiagnosticResult`, `SpeachesUrl`, `SpeachesServer`, `SpeachesScenario`, `SpeachesState`.

**DO NOT RENAME — packages, apps, or user-facing text.** `packages/speaches-adapter/` and `apps/fake-speaches/` keep their names. Onboarding copy, settings labels, and documentation still say "Speaches" because that is the software the user installs.

---

## TASK 9.1 — Add migration 4 and bump the schema version

**Status:** complete

**Priority:** P0 · **Size:** S

### Why

The connection table is named after one vendor. Renaming it now costs one migration and affects nobody; renaming it after distribution means migrating live user data.

### FILES YOU MAY TOUCH

```
packages/persistence/src/migrations.ts
packages/shared-types/src/persistence.ts
packages/persistence/src/index.test.ts
apps/server/src/migrate.test.ts
apps/server/src/app.test.ts
apps/desktop/src/bridge.test.ts
packages/application/src/persistence.test.ts
```

### Step 1 — Append the migration

Add to the end of `STUDYNARRATOR_MIGRATIONS`, after the existing version 3 entry. Do not modify migrations 1 through 3.

```ts
  {
    version: 4,
    name: "neutral-speech-backend-naming",
    up(database) {
      database.exec(`
        ALTER TABLE speaches_connection RENAME TO speech_backend_connection;
        ALTER TABLE speech_backend_connection ADD COLUMN backend_id TEXT NOT NULL DEFAULT 'speaches';
      `);
    },
  },
```

SQLite supports both statements natively. Do not use a create-copy-drop rebuild; it would silently lose the `CHECK` constraints on the table.

### Step 2 — Bump the version

In `packages/shared-types/src/persistence.ts`, change `DATABASE_SCHEMA_VERSION` from `3` to `4`.

### Step 3 — Update every test that asserts the old value

These are the known assertion sites. Verify the list before editing with `grep -rn "databaseSchemaVersion: 3\|\[1, 2, 3\]" apps packages --include=*.ts`.

| File                                           | What to change                                                                  |
| ---------------------------------------------- | ------------------------------------------------------------------------------- |
| `apps/server/src/migrate.test.ts`              | `databaseSchemaVersion: 3` → `4`; `appliedVersions: [1, 2, 3]` → `[1, 2, 3, 4]` |
| `packages/persistence/src/index.test.ts`       | `appliedVersions` → `[1, 2, 3, 4]`; `databaseSchemaVersion: 3` → `4`            |
| `apps/server/src/app.test.ts`                  | `databaseSchemaVersion: 3` → `4`                                                |
| `apps/desktop/src/bridge.test.ts`              | `databaseSchemaVersion: 3 as const` → `4 as const`                              |
| `packages/application/src/persistence.test.ts` | `databaseSchemaVersion: 3 as const` → `4 as const`                              |

### Step 4 — Add an upgrade test

In `packages/persistence/src/index.test.ts`, add `"preserves the connection row across the speech backend rename"`:

1. Open a database with `migrations` limited to versions 1–3.
2. Insert a connection row.
3. Reopen with the full migration set.
4. Assert the row is present in `speech_backend_connection` with its original values and `backend_id = 'speaches'`.

### Constraints

- Do **not** rename any TypeScript identifier in this task. Only the table, the column, the version constant, and the assertions.
- Do **not** relax `response_format TEXT NOT NULL CHECK (response_format = 'wav')`.
- Do **not** change `singleton_id INTEGER PRIMARY KEY CHECK (singleton_id = 1)`.
- The SQL in `repository.ts` still says `speaches_connection` after this task and will not compile-fail, but tests will. That is expected; task 9.3 fixes it. If you cannot get the suite green without touching `repository.ts`, do that one file and note it in the commit body.

### VERIFY

```sh
npm run format:check && npm run lint && npm run typecheck && npm test && npm run test:api
```

```sh
rm -rf /tmp/sn-t91 && npm run db:migrate -- --data-dir /tmp/sn-t91
sqlite3 /tmp/sn-t91/studynarrator.sqlite "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE '%connection%';"
```

Output must include `speech_backend_connection`.

### COMMIT

`feat(persistence): rename the connection table to a neutral speech backend`

---

## TASK 9.2 — Rename the connection types in shared-types

**Status:** complete

**Priority:** P0 · **Size:** S

### FILES YOU MAY TOUCH

```
packages/shared-types/src/connections.ts
packages/shared-types/src/index.ts
packages/shared-types/src/persistence.ts
packages/shared-types/src/persistence.test.ts
```

### What to do

Apply the RENAME table from the section header above, in `shared-types` only. Add a `backendId: z.literal("speaches")` field to the connection schema so a second backend later becomes an enum widening rather than a schema migration.

Re-export the new names from `packages/shared-types/src/index.ts`. Do **not** add deprecated aliases for the old names — every consumer is in this repository and will be updated by tasks 9.3 through 9.6.

### Constraints

- Do not touch any file outside `packages/shared-types`.
- Do not rename anything on the DO NOT RENAME list.
- `npm run typecheck` will fail after this task because consumers still use the old names. That is expected. Record the failure count in the commit body.

### VERIFY

```sh
npm run format:check && npm run lint
npx tsc --build packages/shared-types
grep -rn "SpeachesConnection" packages/shared-types/src/
```

The `grep` must return no results. A repository-wide `typecheck` failure is expected here and only here.

### COMMIT

`refactor(shared-types): rename connection types to a neutral speech backend`

---

## TASK 9.3 — Propagate the rename through persistence

**Status:** complete

**Priority:** P0 · **Size:** S

### FILES YOU MAY TOUCH

```
packages/persistence/src/repository.ts
packages/persistence/src/index.test.ts
```

### What to do

Update the SQL table name to `speech_backend_connection`, the row interface, the mapper, and the imported type names. Populate `backendId` from the new `backend_id` column.

### Constraints

- The SQL must match the table as it exists after migration 4. If a query still says `speaches_connection`, the application will fail at runtime, not compile time.
- Do not change any query semantics. Names only.

### VERIFY

```sh
npm run format:check && npm run lint
npx tsc --build packages/persistence
npx vitest run packages/persistence
grep -rn "speaches_connection\|SpeachesConnection" packages/persistence/src/
```

The `grep` must return no results.

### COMMIT

`refactor(persistence): use the renamed speech backend connection`

---

## TASK 9.4 — Propagate the rename through application

**Status:** complete

**Priority:** P0 · **Size:** M

### FILES YOU MAY TOUCH

```
packages/application/src/connections.ts
packages/application/src/render.ts
packages/application/src/cachedSpeech.ts
packages/application/src/scratchpad.ts
packages/application/src/projectPreview.ts
packages/application/src/renderPlan.ts
```

Plus the matching `.test.ts` files for each.

### What to do

Update imports and identifier usages to the new names. This is the largest single file group in the rename; if it exceeds the M ceiling, do `connections.ts` and `renderPlan.ts` first, commit, then the rest as `9.4b`.

### Constraints

- `packages/application/src/kokoroCatalog.ts` keeps its name and contents.
- Where `application` imports from `packages/speaches-adapter`, the adapter-internal names stay unchanged. Only the connection types coming from `shared-types` are renamed.

### VERIFY

```sh
npm run format:check && npm run lint
npx tsc --build packages/application
npx vitest run packages/application
```

### COMMIT

`refactor(application): use the renamed speech backend connection`

---

## TASK 9.5 — Propagate the rename through server and desktop

**Status:** complete

**Priority:** P0 · **Size:** S

### FILES YOU MAY TOUCH

```
apps/server/src/app.ts
apps/server/src/app.test.ts
apps/desktop/src/ipc.ts
apps/desktop/src/bridge.ts
apps/desktop/src/bridge.test.ts
apps/desktop/src/bootstrap.test.ts
apps/desktop/src/security.ts
```

### What to do

Update type imports and identifier usages.

### Constraints

- **Do not change any REST route path.** `/api/connection/*` stays exactly as it is. The REST surface is private transport between the application's own bundle and its own server; renaming it adds churn with no benefit.
- **Do not change any IPC channel string.** Those are stable identifiers.
- `apps/desktop/src/security.ts` references a Speaches URL for its content policy. Update type names only; leave the URL handling alone.

### VERIFY

```sh
npm run format:check && npm run lint && npm run typecheck
npx vitest run apps/server apps/desktop
git diff -U0 | grep -E '^\+.*"/api/' || echo "no route paths changed"
```

### COMMIT

`refactor(server,desktop): use the renamed speech backend connection`

---

## TASK 9.6 — Propagate the rename through the web client

**Status:** complete

**Priority:** P0 · **Size:** M

### FILES YOU MAY TOUCH

```
apps/web/src/services/connections/connectionsClient.ts
apps/web/src/features/connections/ConnectionProvider.tsx
apps/web/src/features/connections/ConnectionProvider.test.tsx
apps/web/src/features/projects/projectAuthoring.ts
apps/web/src/pages/settings/GeneralSettingsPage.tsx
apps/web/src/pages/settings/settingsTestFixtures.ts
apps/web/src/pages/onboarding/OnboardingPage.tsx
apps/web/src/pages/scratchpad/ScratchpadPage.tsx
apps/web/src/app/App.tsx
```

Plus matching test files.

### What to do

Update type imports and identifier usages.

### Constraints

- **Do not change user-visible text.** Every string a user reads still says "Speaches", because that is the name of the software they installed. This task renames code identifiers only. If a diff line changes text inside JSX or a label, revert it.
- Do not change CSS module class names.

### VERIFY

```sh
npm run format:check && npm run lint && npm run typecheck && npm test && npm run test:api
grep -rn "SpeachesConnection\|SpeachesCatalogDiscovery\|SpeachesSpeechCatalog" apps packages
npm run test:e2e:web
```

The `grep` must return no results. This is the task where the full repository check must pass.

### COMMIT

`refactor(web): use the renamed speech backend connection`

---

# 10 — DATA DIRECTORY MANIFEST

Split into four tasks. Task 8 deferred a filesystem cleanup that 10.4 now performs safely.

---

## TASK 10.1 — Write and read the data directory manifest

**Status:** complete

**Priority:** P0 · **Size:** M

### Why

SQLite state is versioned by `schema_migrations`. The cache tree, job snapshots, and render artifacts have no version and no migration mechanism.

### FILES YOU MAY TOUCH

```
packages/persistence/src/dataDirectoryManifest.ts   (new)
packages/persistence/src/dataDirectoryManifest.test.ts   (new)
packages/persistence/src/index.ts
```

### What to build

A module that reads or creates `<dataDir>/manifest.json`:

```json
{
  "manifestVersion": 1,
  "appVersion": "0.1.0",
  "createdAt": "2026-08-18T00:00:00.000Z",
  "updatedAt": "2026-08-18T00:00:00.000Z",
  "layoutVersion": 1,
  "completedSteps": []
}
```

Validate with a Zod schema. Export `readDataDirectoryManifest`, `writeDataDirectoryManifest`, and `LayoutTooNewError`.

Rules:

- Missing file in a directory that already contains `studynarrator.sqlite` means a pre-manifest installation. Write the manifest with the current `layoutVersion` and do not treat it as new.
- Missing file in an empty directory means a fresh install.
- `layoutVersion` greater than this build supports throws `LayoutTooNewError`, which task 10.2 routes to the existing recovery screen.
- Always update `appVersion` and `updatedAt` on a successful read.

Per **G6**, the write must be atomic: write to `manifest.json.tmp` in the same directory, then `rename`.

### Constraints

- No user preferences or connection settings in the manifest. Layout only; settings live in SQLite.
- Do not wire this into either bootstrap in this task. 10.2 does that.
- Read `appVersion` from an injected value, not by importing `package.json`.

### VERIFY

```sh
npm run format:check && npm run lint && npm run typecheck && npx vitest run packages/persistence
```

### COMMIT

`feat(persistence): add a versioned data directory manifest`

---

## TASK 10.2 — Add the layout step runner

**Status:** complete

**Priority:** P0 · **Size:** S

### FILES YOU MAY TOUCH

```
packages/persistence/src/dataDirectoryManifest.ts
packages/persistence/src/dataDirectoryManifest.test.ts
apps/server/src/bootstrap.ts
apps/desktop/src/bootstrap.ts
```

### What to build

```ts
export interface LayoutStep {
  id: string;
  run(dataDirectory: string): Promise<void>;
}

export async function runLayoutSteps(
  dataDirectory: string,
  steps: readonly LayoutStep[],
): Promise<{ completed: string[]; failed: { id: string; error: unknown }[] }>;
```

Rules, all of which are load-bearing:

- A step already in `completedSteps` is skipped.
- A step that succeeds is appended to `completedSteps` and the manifest is rewritten.
- **A step that throws is caught, collected in `failed`, and NOT recorded.** It must never prevent the application from starting. This is precisely the failure mode that made the old `migrateLegacy` dangerous.
- Steps run in array order.

Call `runLayoutSteps` from both bootstraps with an empty step array for now, and route `LayoutTooNewError` through the same unavailable-persistence path that already handles `SchemaTooNewError`.

### Constraints

- No step is registered in this task. The array is empty.
- Do not put step registration in the shared factory yet; task 16.2 moves both bootstraps.

### VERIFY

```sh
npm run format:check && npm run lint && npm run typecheck && npm test && npm run test:api
```

Start the server twice against the same fresh data directory and confirm the manifest exists and `completedSteps` does not grow.

### COMMIT

`feat(persistence): run recorded one-time data directory layout steps`

---

## TASK 10.3 — Convert cache metadata parsing to Zod

**Status:** complete

**Priority:** P0 · **Size:** S

### Why

`parseMetadata` in `packages/rendering/src/index.ts` is a hand-rolled validator that returns `null` for anything unrecognised. Stale entries therefore become invisible rather than collectable, and its strict key-count check means adding one optional field would invalidate the entire cache.

Task 10.4 and task 21.2 both depend on being able to tell "not present" from "present but unreadable".

### FILES YOU MAY TOUCH

```
packages/rendering/src/index.ts
packages/rendering/src/index.test.ts
```

### What to do

Replace `parseMetadata` with a Zod schema. Remove the `Object.keys(item).length !== METADATA_KEYS.size` check and use a non-strict object parse so future optional fields do not invalidate existing entries.

Change the return type so callers can distinguish three outcomes:

```ts
type MetadataReadResult =
  | { status: "ok"; metadata: SpeechCacheMetadata }
  | { status: "missing" }
  | { status: "unreadable"; path: string };
```

Existing callers treat both `missing` and `unreadable` as a cache miss, so behaviour does not change. The distinction only matters to the collector.

### Constraints

- Do not change `SPEECH_CACHE_SCHEMA_VERSION`.
- Do not change the cache key composition. The version components baked into the key are what make invalidation correct.
- Do not delete anything in this task. Reporting only.

### VERIFY

```sh
npm run format:check && npm run lint && npm run typecheck && npx vitest run packages/rendering
```

Add a test asserting a corrupt metadata file yields `unreadable`, not `missing`.

### COMMIT

`refactor(rendering): validate speech cache metadata with zod`

---

## TASK 10.4 — Add the two initial layout steps

**Status:** complete

**Priority:** P0 · **Size:** S

### FILES YOU MAY TOUCH

```
packages/persistence/src/layoutSteps.ts   (new)
packages/persistence/src/layoutSteps.test.ts   (new)
apps/server/src/bootstrap.ts
apps/desktop/src/bootstrap.ts
```

### What to build

Two steps, registered in the array from task 10.2.

**`remove-standalone-render-plans`** — deletes `render-plans/<planId>/` directories, excluding `.jobs`. This is the cleanup deferred from task 8h. It is safe **only** because it runs once and is recorded; an unrecorded version of this is exactly what `migrateLegacy` was.

**`sweep-unreadable-cache-entries`** — walks the speech cache and deletes entries whose metadata reads as `unreadable` per task 10.3, or whose `schemaVersion` is below current.

### Constraints

- **Never delete `render-plans/.jobs/`.** That directory holds the per-render snapshots that make render history explainable and retry reproducible.
- **Never delete render artifacts.** Those are the user's output.
- Both steps must be idempotent.
- Both must tolerate a missing directory without throwing.
- Log what each step removed. If task 18 has not landed, `console.warn` is acceptable and should be replaced later.

### VERIFY

```sh
npm run format:check && npm run lint && npm run typecheck && npm test && npm run test:api
```

Manual, and required:

```sh
# Build a data directory containing a fake standalone plan and a .jobs snapshot.
mkdir -p /tmp/sn-t104/render-plans/fake-plan /tmp/sn-t104/render-plans/.jobs/fake-render
# Start the server against it, then confirm:
ls /tmp/sn-t104/render-plans          # fake-plan gone
ls /tmp/sn-t104/render-plans/.jobs    # fake-render still present
```

### COMMIT

`feat(persistence): remove orphaned render plans and unreadable cache entries once`

---

# 11 — CONTINUOUS INTEGRATION

---

## TASK 11.1 — Add the CI check job

**Status:** complete

**Priority:** P0 · **Size:** S

### FILES YOU MAY TOUCH

```
.github/workflows/ci.yml   (new)
```

### What to build

A workflow triggered on `push` to `main` and on all pull requests, with one job `check` on `ubuntu-latest`:

1. `actions/checkout@v4`
2. `actions/setup-node@v4` with `node-version-file: .nvmrc` and `cache: npm`
3. `npm ci`
4. `npm run format:check`
5. `npm run lint`
6. `npm run typecheck`
7. `npm test`
8. `npm run test:api`

Step 4 exists because of cleanup task C1. If `format:check` is not yet a script in `package.json`, **STOP** — C1 has not been completed.

### Constraints

- Pin actions to a major tag, not `@main`.
- No secrets. The job must run on a fork pull request.
- Do not add e2e or docker here; task 11.2 does.

### VERIFY

```sh
node -e "['format:check','lint','typecheck','test','test:api'].forEach(s=>{if(!require('./package.json').scripts[s])throw new Error('missing '+s)});console.log('ok')"
```

### COMMIT

`ci: add lint, typecheck, and test verification`

---

## TASK 11.2 — Add the CI e2e and docker jobs

**Status:** complete

**Priority:** P0 · **Size:** S

### FILES YOU MAY TOUCH

```
.github/workflows/ci.yml
```

### What to add

**`e2e`**, needs `check`: same setup, then `npx playwright install --with-deps chromium`, then `npm run test:e2e:web`. Upload `playwright-report/` as an artifact on failure.

**`docker`**, needs `check`, only on pushes to `main`: same setup, then `npm run verify:docker`. If it requires Docker Scout and that is unavailable, set `continue-on-error: true` and add a comment explaining why rather than removing the job.

### Constraints

- Do not add a release or publish job. Task 23.3 covers releases.
- Do not run the Electron e2e project in CI; it needs a native rebuild and a display server. Note the gap in a comment.

### VERIFY

Push the branch and confirm all three jobs appear and the first two pass.

### COMMIT

`ci: add end-to-end and docker verification jobs`

---

# 12 — DOCUMENTATION

---

## TASK 12.1 — Correct the README

**Status:** complete

**Priority:** P0 · **Size:** S

### FILES YOU MAY TOUCH

```
README.md
```

### Why

The "Pre-release data reset" section states that all persisted contracts are at schema version 1. After task 9.1 it is 4. It also tells users to delete their data directory, which is now both wrong and dangerous.

### What to write

Replace that section with an accurate description of current behaviour:

- Databases migrate forward automatically on start.
- A full backup is taken before any schema upgrade, in `<dataDir>/backups/`.
- Old backups are pruned: newest per source version, plus the three most recent, plus the two most recent pre-restore copies.
- Opening data created by a newer version shows a recovery screen offering restore from backup. Nothing is deleted or converted.
- Remove the delete-your-data-directory instruction entirely.

### Constraints

- Do not restructure the rest of the README. Task 12.3 does that.
- Do not invent version numbers.

### VERIFY

```sh
grep -n "schema version 1" README.md
```

Must return nothing.

### COMMIT

`docs: correct the schema version and data reset guidance`

---

## TASK 12.2 — Write UPGRADE.md

**Status:** complete

**Priority:** P0 · **Size:** S

### FILES YOU MAY TOUCH

```
UPGRADE.md   (new)
README.md
```

### What to write

1. **Compatibility table** — application version, database schema version, data directory layout version. One row per released version. Seed with the current one only.
2. **Upgrading** — what happens automatically, where the backup goes.
3. **Downgrading** — the honest explanation. An older application cannot read a newer database. Down migrations do not exist and cannot exist, because a version that shipped before a migration has no code to reverse it. The supported paths are restore-from-backup or reinstalling the newer version.
4. **Where the data lives** — per platform. **Read these out of `apps/desktop/src/bootstrap.ts` and `apps/server/src/runtimeConfig.ts` rather than assuming.**
5. **Manual backup and restore** — including that the `-wal` and `-shm` sidecar files must be removed when replacing a database file by hand.
6. **Version policy** — patch and minor releases never require a data reset; the schema only moves forward; every schema change ships with a backup step.
7. **Known vestigial state** — `render_jobs.plan_id` is unused as of the frozen-plan removal and will be dropped in a future migration.

Link it from the README.

### Constraints

- Verify every platform path against the source before writing it down.
- Do not document features that do not exist yet.

### VERIFY

```sh
test -f UPGRADE.md && grep -c "" UPGRADE.md
grep -o "](\./[^)]*)" README.md UPGRADE.md
```

Confirm each relative link resolves.

### COMMIT

`docs: add an upgrade and compatibility guide`

---

## TASK 12.3 — Split setup into SETUP.md

**Status:** complete

**Priority:** P0 · **Size:** S

### FILES YOU MAY TOUCH

```
SETUP.md   (new)
README.md
```

### What to do

Move Speaches installation, model download, and first-run connection instructions out of the README into `SETUP.md`. Reduce the README to: what it is, a short quick start, how to run from source, and links to `SETUP.md`, `UPGRADE.md`, and the license.

### Constraints

- Move content, do not rewrite it. Rewording is a separate concern.
- Do not delete `docs/study-narrator-prd-v1.3.md`. Its architectural decisions should become ADRs first; that is separate work.

### VERIFY

```sh
test -f SETUP.md && grep -o "](\./[^)]*)" README.md SETUP.md
```

### COMMIT

`docs: split setup instructions into SETUP.md`

---

# 13 — LOWER THE NODE REQUIREMENT TO 24

**Status:** complete

**Priority:** P1 · **Size:** S

### Why

Node 26 is not yet LTS. Electron bundles its own Node, so this constrains only source builds and base image availability.

**Cleanup task C2 restored `>=26.0.0 <27.0.0` after an earlier partial attempt left four files disagreeing.** This task changes all four together or not at all.

### FILES YOU MAY TOUCH

```
package.json
.nvmrc
Dockerfile
scripts/verify.mjs
.github/workflows/ci.yml
```

### What to change

| File                       | To                                                         |
| -------------------------- | ---------------------------------------------------------- |
| `package.json`             | `"node": ">=24.0.0"`                                       |
| `.nvmrc`                   | current Node 24 LTS patch version                          |
| `Dockerfile`               | `ARG NODE_IMAGE=node:24-trixie-slim`                       |
| `scripts/verify.mjs`       | replace the `!== 26` check with a `< 24` check             |
| `.github/workflows/ci.yml` | no change if it uses `node-version-file: .nvmrc` — confirm |

Also update `@types/node` in root `devDependencies` to the matching major.

### Constraints

- All four files in one commit. A partial change is worse than none.
- If anything in the codebase requires a Node 25+ API, **STOP** and report which file.

### VERIFY

```sh
rm -rf node_modules && npm ci
npm run format:check && npm run lint && npm run typecheck && npm test && npm run test:api && npm run build
node -e "const e=require('./package.json').engines.node; const n=require('fs').readFileSync('.nvmrc','utf8').trim(); if(!n.startsWith('24'))throw new Error('nvmrc mismatch: '+n); console.log(e, n)"
```

### COMMIT

`chore: lower the Node requirement to the 24 LTS line`

---

# 14 — MAKE THE VITEST CONFIGS DISJOINT

**Status:** complete

**Priority:** P1 · **Size:** XS

### Why

`vitest.config.ts` includes `apps/**/*.test.ts` and `packages/**/*.test.ts`. `vitest.api.config.ts` includes paths already covered by it, so `npm run verify` runs those suites twice.

### FILES YOU MAY TOUCH

```
vitest.config.ts
vitest.api.config.ts
```

### What to do

Exclude the API paths from `vitest.config.ts` so `npm test` and `npm run test:api` are disjoint. Do not switch to Vitest projects in this task; that is a larger change.

### Constraints

- The union of files matched must be identical before and after. Verify, do not assume.

### VERIFY

```sh
npx vitest list --config vitest.config.ts | sort > /tmp/a.txt
npx vitest list --config vitest.api.config.ts | sort > /tmp/b.txt
comm -12 /tmp/a.txt /tmp/b.txt
cat /tmp/a.txt /tmp/b.txt | sort -u | wc -l
```

The `comm` output must be empty, and the final count must equal the count from before the change.

### COMMIT

`test: make the unit and api vitest configurations disjoint`

---

# 15 — ADD COVERAGE THRESHOLDS

**Status:** complete

**Priority:** P1 · **Size:** S

### FILES YOU MAY TOUCH

```
package.json
vitest.config.ts
vitest.api.config.ts
scripts/verify.mjs
.gitignore
```

### What to do

Add `@vitest/coverage-v8` as a dev dependency. Configure `provider: "v8"`, `reporter: ["text", "html", "lcov"]`, excluding `**/*.test.*`, `**/dist/**`, `e2e/**`, `scripts/**`, and `apps/fake-speaches/**`.

**Measure first, then set thresholds to the current values rounded down to the nearest five.** A threshold that fails on the commit introducing it teaches everyone to ignore it.

Add `"test:coverage": "vitest run --coverage"` and call it from `scripts/verify.mjs`. Confirm `coverage/` is in `.gitignore`.

### Constraints

- Do not write new tests to raise coverage in this task.
- Do not set aspirational numbers.

### VERIFY

```sh
npm run test:coverage
```

Must pass on the first run.

### COMMIT

`test: collect coverage and enforce a measured baseline`

---

# 16 — MERGE THE DUPLICATED COMPOSITION ROOT

`apps/desktop/src/bootstrap.ts` and `apps/server/src/bootstrap.ts` are roughly 90% identical and have already grown further apart through tasks 7 and 10.

---

## TASK 16.1 — Extract the runtime descriptor type

**Status:** complete

**Priority:** P1 · **Size:** S

### FILES YOU MAY TOUCH

```
packages/application/src/composition.ts   (new)
packages/application/src/index.ts
apps/server/src/bootstrap.ts
apps/desktop/src/bootstrap.ts
```

### What to do

Define and export:

```ts
export interface StudyNarratorRuntimeDescriptor {
  client: "web" | "electron";
  distribution: string;
  transport: "rest" | "ipc";
  runtimeName: "node" | "electron";
  runtimeVersion: string;
  electronVersion: string | null;
  sourceRevision: string;
  dataDirectory: string;
  appVersion: string;
}
```

Change both bootstraps to build one of these and pass its fields into the existing construction calls. No service construction moves in this task.

### VERIFY

Standard, plus `npm run test:e2e`.

### COMMIT

`refactor(application): introduce a shared runtime descriptor`

---

## TASK 16.2 — Extract the shared service factory

**Status:** complete

**Priority:** P1 · **Size:** M

### FILES YOU MAY TOUCH

```
packages/application/src/composition.ts
packages/application/src/composition.test.ts   (new)
packages/application/src/index.ts
```

### What to build

```ts
export async function createStudyNarratorServices(options: {
  Database: DatabaseConstructor;
  descriptor: StudyNarratorRuntimeDescriptor;
  ffmpegPath?: string;
}): Promise<StudyNarratorServices>;
```

Move the service graph from `apps/server/src/bootstrap.ts` into it verbatim, parameterised by the descriptor.

### Constraints

- **Preserve construction order exactly.** `speechCache` before `renders` matters.
- **Preserve the degraded-mode handling.** `MigrationFailureError`, `SchemaTooNewError`, and `LayoutTooNewError` must all still produce an unavailable-persistence service rather than crashing.
- **Preserve the healthy/unavailable backups split.** In the healthy path `list` works and `restore` throws `PersistenceConflictError` telling the user to close the application. In the unavailable path both work. This was implemented correctly in PR #16 and must not be simplified into one implementation.
- Do not change either bootstrap in this task. 16.3 does.

### VERIFY

```sh
npm run format:check && npm run lint && npm run typecheck && npm test && npm run test:api
```

### COMMIT

`refactor(application): add a shared service composition factory`

---

## TASK 16.3 — Reduce both bootstraps to the factory

**Status:** complete

**Priority:** P1 · **Size:** S

### FILES YOU MAY TOUCH

```
apps/server/src/bootstrap.ts
apps/desktop/src/bootstrap.ts
apps/server/src/bootstrap.test.ts
apps/desktop/src/bootstrap.test.ts
```

### What to do

Each bootstrap becomes: resolve the data directory, build the descriptor, call `createStudyNarratorServices`. Keep `resolveDesktopDataDirectory` and `resolveServerDataDirectory` in their own apps — the defaults genuinely differ.

### Constraints

- Both files should end up under 50 lines. If either is longer, something did not move.
- Behaviour must be identical. Both clients' e2e suites must pass unchanged.

### VERIFY

```sh
npm run format:check && npm run lint && npm run typecheck && npm test && npm run test:api
npm run test:e2e
wc -l apps/server/src/bootstrap.ts apps/desktop/src/bootstrap.ts
```

### COMMIT

`refactor: reduce both bootstraps to the shared composition factory`

---

# 17 — SPLIT THE EXPRESS APPLICATION

`createExpressApp` in `apps/server/src/app.ts` exceeded 1,100 lines after PR #16.

**Applies to all of 17.x:** route paths, response bodies, and status codes must not change. `apps/server/src/app.test.ts` should need no assertion changes beyond imports. If it does, you changed behaviour — revert and retry.

---

## TASK 17.1 — Add the async handler and error middleware

**Status:** complete

**Priority:** P1 · **Size:** S

### FILES YOU MAY TOUCH

```
apps/server/src/asyncHandler.ts   (new)
apps/server/src/errorMiddleware.ts   (new)
apps/server/src/app.ts
```

### What to build

`asyncHandler` wrapping an async handler so rejections reach `next` automatically. A single error middleware mapping `PERSISTENCE_NOT_FOUND` → 404, `PERSISTENCE_CONFLICT` → 409, `PERSISTENCE_UNAVAILABLE` → 503, `RENDER_MEDIA_UNAVAILABLE` → 404, `BACKUP_RESTORE_FAILED` → 400, everything else → 500 with a `BoundaryErrorSchema` body.

Apply `asyncHandler` to existing routes without moving them. Registration order must not change; the static catch-all stays last.

### VERIFY

Standard, plus `npm run test:e2e:web`.

### COMMIT

`refactor(server): centralise async error handling`

---

## TASK 17.2 — Extract the system and persistence routers

**Status:** complete

**Priority:** P1 · **Size:** S

### FILES YOU MAY TOUCH

```
apps/server/src/routes/system.ts   (new)
apps/server/src/routes/persistence.ts   (new)
apps/server/src/app.ts
```

Move the health, diagnostics, persistence status, projects, preferences, lexicon, and backups routes into two router factories. Move code without editing it.

### VERIFY

Standard, plus `npm run test:e2e:web`.

### COMMIT

`refactor(server): extract the system and persistence routers`

---

## TASK 17.3 — Extract the connection and catalog routers

**Status:** complete

**Priority:** P1 · **Size:** S

### FILES YOU MAY TOUCH

```
apps/server/src/routes/connection.ts   (new)
apps/server/src/routes/voiceCatalog.ts   (new)
apps/server/src/routes/scratchpad.ts   (new)
apps/server/src/app.ts
```

### VERIFY

Standard, plus `npm run test:e2e:web`.

### COMMIT

`refactor(server): extract the connection, catalog, and scratchpad routers`

---

## TASK 17.4 — Extract the render and cache routers

**Status:** complete

**Priority:** P1 · **Size:** M

### FILES YOU MAY TOUCH

```
apps/server/src/routes/renders.ts   (new)
apps/server/src/routes/speechCache.ts   (new)
apps/server/src/routes/preview.ts   (new)
apps/server/src/routes/scriptGeneration.ts   (new)
apps/server/src/app.ts
```

### Constraints

- `streamRenderMedia` and `attachStaticWebApplication` stay where they are.
- Range request handling for media must be preserved exactly.

### VERIFY

Standard, plus `npm run test:e2e:web` and `wc -l apps/server/src/app.ts` — it should now be well under 200 lines.

### COMMIT

`refactor(server): extract the render, cache, preview, and generation routers`

---

# 18 — STRUCTURED LOGGING

---

## TASK 18.1 — Add the logger module

**Status:** complete

**Priority:** P1 · **Size:** S

### FILES YOU MAY TOUCH

```
packages/runtime/src/logger.ts   (new)
packages/runtime/src/logger.test.ts   (new)
packages/runtime/src/index.ts
packages/runtime/package.json
package-lock.json
```

Add `pino` as a dependency and `pino-pretty` as a dev dependency. Export a factory taking a level and an optional file destination, with size-based rotation keeping the last few files. Default level `info`, overridable via `STUDYNARRATOR_LOG_LEVEL`.

**Redaction is mandatory.** Never log script content, project names, or the Speaches base URL — the URL can contain a private hostname. Log a hash of it; `serverIdentityHash` in the cache metadata already does this, reuse the approach.

### VERIFY

Standard.

### COMMIT

`feat(runtime): add a structured logger with rotation and redaction`

---

## TASK 18.2 — Log startup and migration events

**Status:** complete

**Priority:** P1 · **Size:** S

### FILES YOU MAY TOUCH

```
packages/persistence/src/migrations.ts
packages/persistence/src/dataDirectoryManifest.ts
packages/application/src/composition.ts
```

Log: application start with version, schema version, layout version, data directory, and distribution; each applied migration; the backup path; prune results; and each layout step outcome. Take the logger by injection; do not construct one inside these modules.

### VERIFY

Standard, plus start the server and confirm the log file contains the start line.

### COMMIT

`feat: log startup, migration, and layout events`

---

## TASK 18.3 — Log render lifecycle and boundary errors

**Status:** complete

**Priority:** P1 · **Size:** S

### FILES YOU MAY TOUCH

```
packages/application/src/render.ts
apps/server/src/errorMiddleware.ts
apps/server/src/app.ts
```

Log render start, phase transitions, cache hit and miss totals, completion with duration, and failure with cause. Log every error reaching the boundary middleware with a request id. Add a request-id middleware if none exists.

### VERIFY

Standard, plus run a render against the fake Speaches server and inspect the log.

### COMMIT

`feat: log the render lifecycle and boundary errors`

---

# 19 — SERVER-SENT EVENTS FOR RENDER PROGRESS

---

## TASK 19.1 — Add a render progress observer

**Status:** complete

**Priority:** P1 · **Size:** S

### FILES YOU MAY TOUCH

```
packages/application/src/render.ts
packages/application/src/render.test.ts
```

Add a subscribe method to `RenderService` that notifies a callback on every progress update and on the terminal state, returning an unsubscribe function. Emit from the existing internal update path; do not poll the repository.

### Constraints

- Do not change any existing method signature.
- Subscribers must never be able to throw into the render loop; wrap each callback in try/catch.
- Do not touch the transport layers.

### VERIFY

Standard, plus a test asserting a subscriber sees the terminal event exactly once.

### COMMIT

`feat(application): let callers observe render progress`

---

## TASK 19.2 — Add the SSE endpoint

**Status:** complete

**Priority:** P1 · **Size:** S

### FILES YOU MAY TOUCH

```
apps/server/src/routes/renders.ts
apps/server/src/apiManifest.ts
apps/server/src/app.test.ts
```

Add `GET /api/renders/:renderId/events` returning `text/event-stream`, with `Cache-Control: no-cache`, `Connection: keep-alive`, and `X-Accel-Buffering: no`. Emit on each progress update and a terminal event on completion, failure, or cancellation. Send a comment heartbeat every 15 seconds. Unsubscribe and end the response on client disconnect.

Per **G9**, update the API manifest and contract tests. The IPC surface is out of scope — the Electron client does not use SSE.

### VERIFY

Standard, plus a test asserting the stream ends after a terminal event.

### COMMIT

`feat(server): stream render progress over server-sent events`

---

## TASK 19.3 — Consume SSE in the web client

**Status:** complete

**Priority:** P1 · **Size:** M

### FILES YOU MAY TOUCH

```
apps/web/src/services/renders/renderClient.ts
apps/web/src/services/renders/renderClient.test.ts
apps/web/src/pages/projects/ProjectsPage.tsx
apps/web/src/pages/projects/ProjectsPage.test.tsx
e2e/web/render-execution.spec.ts
```

Replace the `window.setInterval` poll with `EventSource`. Keep a single polled fallback for a dropped connection. Close the stream on unmount and on the terminal event.

### Constraints

- The Electron client keeps its existing mechanism. Do not force SSE through IPC.
- Per `AGENTS.md`, the e2e assertion must wait on observed progress, not a fixed sleep.

### VERIFY

Standard, plus `npm run test:e2e:web`.

### COMMIT

`feat(web): consume render progress over server-sent events`

---

# 20 — DURATION AND DISK SIZE ESTIMATION

A 15,000-word script produces roughly two hours of audio, a ~115 MB MP3, and roughly 345 MB of cached WAV segments. The cache is the number users do not expect.

---

## TASK 20.1 — Add the voice timing calibration table

**Status:** complete

**Priority:** P1 · **Size:** S

### FILES YOU MAY TOUCH

```
packages/persistence/src/migrations.ts
packages/shared-types/src/persistence.ts
packages/persistence/src/repository.ts
packages/persistence/src/index.test.ts
```

Add migration 5 creating `voice_timing_calibration` keyed by `(model_id, voice_id)` with a rolling average of milliseconds per normalized character, a sample count, and an updated timestamp. Bump `DATABASE_SCHEMA_VERSION` to 5 and update every assertion per **G10** — the same five test files listed in task 9.1.

Add repository read and upsert methods. No consumers yet.

### VERIFY

Standard, plus a fresh-database migration check.

### COMMIT

`feat(persistence): add a voice timing calibration table`

---

## TASK 20.2 — Record calibration after each render

**Status:** complete

**Priority:** P1 · **Size:** S

### FILES YOU MAY TOUCH

```
packages/application/src/render.ts
packages/application/src/render.test.ts
```

After a render completes, update the rolling average from `render_segments.audio_duration_ms` and the normalized text length already persisted.

### Constraints

- Only completed renders contribute. Never a failed or canceled one.
- A calibration failure must never fail the render.

### VERIFY

Standard.

### COMMIT

`feat(application): calibrate voice timing from completed renders`

---

## TASK 20.3 — Add the estimation functions

**Status:** complete

**Priority:** P1 · **Size:** S

### FILES YOU MAY TOUCH

```
packages/core/src/estimation.ts   (new)
packages/core/src/estimation.test.ts   (new)
packages/core/src/index.ts
```

Pure functions, no I/O:

- `estimateSpeechMs(normalizedCharacters, msPerCharacter, speed)`
- `estimatePlanDurationMs(plan, calibration)` — pauses are known exactly; only speech is estimated
- `estimateMp3Bytes(durationMs, bitrateKbps)` — `bitrateKbps * 1000 / 8 * seconds`
- `estimateCacheBytes(durationMs, sampleRate, bytesPerSample, channels)` — 48 KB/s for 24 kHz 16-bit mono
- `estimatePeakDiskBytes(...)` — cache plus intermediate concatenation plus final MP3

Ship a bundled default milliseconds-per-character constant used when calibration is absent.

### VERIFY

Standard, plus a test asserting estimated duration is within 15% of actual for a fixture with known segment durations.

### COMMIT

`feat(core): add render duration and size estimation`

---

## TASK 20.4 — Show estimates in the script editor

**Status:** complete

**Priority:** P1 · **Size:** M

### FILES YOU MAY TOUCH

```
apps/web/src/pages/projects/ProjectsPage.tsx
apps/web/src/pages/projects/ProjectsPage.test.tsx
apps/web/src/features/projects/estimateStrip.tsx   (new)
apps/web/src/features/projects/estimateStrip.module.css   (new)
```

A strip showing word count, estimated duration, estimated MP3 size, estimated cache footprint, peak disk needed, and free space on the data volume. Mark values as estimates until the voice has calibration data.

### Constraints

- Estimation must not block the editor's main thread. The parser worker already exists; use it.
- Do not add a render button or change render behaviour here.

### VERIFY

Standard, plus `npm run test:e2e:web`.

### COMMIT

`feat(web): show duration and disk estimates in the script editor`

---

## TASK 20.5 — Add the preflight disk space check

**Status:** complete

**Priority:** P1 · **Size:** S

### FILES YOU MAY TOUCH

```
packages/application/src/render.ts
packages/application/src/render.test.ts
apps/web/src/pages/projects/ProjectsPage.tsx
```

At render start, compare peak estimate against free space via `statfs`. If it exceeds free space minus a 10% margin, block with a message naming both numbers. If it exceeds a soft threshold, warn and continue. Add a setting to disable the block, defaulting to enabled.

### Constraints

- **Never refuse a render based on script length alone.** Disk space is the only legitimate blocker.
- Fail at start, not mid-render.

### VERIFY

Standard, plus a test asserting a render is blocked when free space is insufficient and allowed when the setting is disabled.

### COMMIT

`feat: block renders that would exhaust available disk space`

---

# 21 — AUTOMATIC RETENTION AND CLEANUP

Three classes, treated separately. One global TTL would delete the wrong thing.

| Class                    | Contents                              | Default                |
| ------------------------ | ------------------------------------- | ---------------------- |
| Speech cache segments    | Regenerable WAV, `lastUsedAt` tracked | TTL, 7 days            |
| Job snapshots (`.jobs/`) | Small JSON explaining history         | Lifetime of the render |
| Render artifacts         | The user's output                     | Never                  |

---

## TASK 21.1 — Add the retention settings table and service

**Status:** complete

**Priority:** P1 · **Size:** S

### FILES YOU MAY TOUCH

```
packages/persistence/src/migrations.ts
packages/shared-types/src/persistence.ts
packages/persistence/src/repository.ts
packages/persistence/src/index.test.ts
```

Migration 6 creating a `retention_settings` singleton with per-class TTL and a cache size cap. Options: 8 hours, 24 hours, 7 days, Never. Bump `DATABASE_SCHEMA_VERSION` to 6 and update all assertions per **G10**.

### VERIFY

Standard.

### COMMIT

`feat(persistence): add retention settings`

---

## TASK 21.2 — Add the cache sweeper

**Status:** complete

**Priority:** P1 · **Size:** M

### FILES YOU MAY TOUCH

```
packages/rendering/src/speechCacheSweeper.ts   (new)
packages/rendering/src/speechCacheSweeper.test.ts   (new)
packages/rendering/src/index.ts
packages/application/src/composition.ts
```

Sweep by TTL using `lastUsedAt`, plus LRU eviction above the size cap. Run at start and on a long interval.

### Constraints

- **Delete entries that read as `unreadable` per task 10.3, do not skip them.** Skipping is what strands them permanently.
- Never delete anything belonging to an in-flight render.
- Never delete render artifacts.
- Never run during an active render.
- Report reclaimable bytes without deleting when asked to preview.

### VERIFY

Standard, plus tests for TTL eviction, LRU eviction, and unreadable-entry collection.

### COMMIT

`feat(rendering): sweep the speech cache by age and size`

---

## TASK 21.3 — Add render pinning

**Status:** complete

**Priority:** P1 · **Size:** S

### FILES YOU MAY TOUCH

```
packages/persistence/src/migrations.ts
packages/shared-types/src/render.ts
packages/persistence/src/repository.ts
packages/rendering/src/speechCacheSweeper.ts
packages/persistence/src/index.test.ts
```

Migration 7 adding a `pinned` column to `render_jobs`, defaulting to 0. Bump `DATABASE_SCHEMA_VERSION` to 7 per **G10**. A pinned render and everything it depends on is exempt from all automatic cleanup.

### VERIFY

Standard, plus a test that a pinned render survives a sweep whose TTL has elapsed.

### COMMIT

`feat: exempt pinned renders from automatic cleanup`

---

## TASK 21.4 — Add the retention settings screen

**Status:** complete

**Priority:** P1 · **Size:** M

### Corrected decomposition

The original UI-only file allowance was incomplete: the retention table was
private to persistence and the cache sweeper was private to composition, so a
truthful screen first needed a typed maintenance surface. The approved
correction includes the narrow supporting transport work below; it does not
restore the removed standalone RenderHistory feature.

1. Expose typed retention settings, usage, preview reclaim, and explicit
   confirmed reclaim operations through the persistence service, REST, and
   Electron IPC. Keep their schemas, API/IPC/application manifests, and
   manifest-driven contract tests in lockstep.
2. Apply each saved non-`never` TTL to its managed class: speech cache
   segments, `render-plans/.jobs` snapshots, and render artifact directories.
   Scan only these managed roots, skip symlinks and missing roots, preserve
   cache activity and pinned-project guarantees, and keep pinned render
   snapshots, artifacts, and cache dependencies.
3. Add the minimal `renders.setPinned` mutation to both transports and place
   an accessible pin/unpin control in the completed-render area of
   `ProjectsPage`.
4. Add the Retention Settings route and navigation entry. The page loads and
   saves all retention controls, reports all three usage classes, previews
   before explicit confirmation, surfaces errors and success, and persists on
   reload.

### Verification

Focused service, transport, client, component, pin-control, and Playwright
coverage covers configured TTLs for every class, preview non-destructiveness,
pin protection, missing managed roots, payload validation, loading/saving,
preview cancel/confirm, errors, and reload persistence. `npm run verify` and
`npm run test:e2e:web` passed before this task was marked complete.

### COMMIT

`feat(web): add a retention settings screen`

---

# 22 — HOST HEADER ALLOWLIST

**Status:** complete

**Priority:** P1 · **Size:** S

### FILES YOU MAY TOUCH

```
apps/server/src/hostAllowlist.ts   (new)
apps/server/src/hostAllowlist.test.ts   (new)
apps/server/src/app.ts
apps/server/src/runtimeConfig.ts
.env.example
deploy/docker/README.md
```

Middleware at the top of the stack rejecting any request whose `Host` header is not allowed, with 403 and a `BoundaryErrorSchema` body. Default allowlist: `localhost`, `127.0.0.1`, `[::1]`, and `STUDYNARRATOR_LISTEN_HOST`, each with and without the port. Extend via `STUDYNARRATOR_ALLOWED_HOSTS`.

### Constraints

- Applies to `/api/*` **and** the static handler.
- Not applied in the Electron client, which does not use HTTP.
- **Do not add authentication.** The product is single-user and local by design.

### VERIFY

Standard, plus tests asserting `Host: evil.example.com` gets 403 and `Host: 127.0.0.1:4310` passes.

### COMMIT

`feat(server): reject requests with unexpected host headers`

---

# 23 — ELECTRON PACKAGING AND SIGNED RELEASES

**Tasks 23.2 and 23.4 involve native compilation and certificates. Those should be driven by a human, not delegated.**

---

## TASK 23.1 — Add electron-builder configuration

**Status:** complete

**Priority:** P1 · **Size:** M

### FILES YOU MAY TOUCH

```
apps/desktop/package.json
apps/desktop/electron-builder.yml   (new)
apps/desktop/build/   (new, icons and entitlements)
.gitignore
package-lock.json
scripts/audit-dead-code.mjs
```

Add `electron-builder` as a dev dependency in `apps/desktop`. Targets: macOS `dmg` arm64 and x64, Windows `nsis` x64, Linux `AppImage` and `deb` x64. Configure `asarUnpack` for the `better-sqlite3` native binding. Ignore build output.

### Constraints

- Do not configure signing here; 23.4 does.
- Do not add a CI workflow here; 23.3 does.
- Build locally for the current platform only and confirm it produces an artifact.

### VERIFY

```sh
npm run build --workspace @studynarrator/web
npm run build --workspace @studynarrator/desktop
npm exec --workspace @studynarrator/desktop electron-builder -- --dir --config electron-builder.yml
```

Launch the unpacked application and confirm it opens.

### COMMIT

`build(desktop): add electron-builder packaging configuration`

---

## TASK 23.2 — Verify the native rebuild per target

**Status:** deferred (human-led; future verification)

**Priority:** P1 · **Size:** S · **Human-led**

`better-sqlite3` must be rebuilt against the Electron ABI for each target architecture. `apps/desktop/rebuild-native.mjs` already does this for local development.

Confirm the packaged application on each platform can open a database. **Do not cross-compile** — build each platform on its own machine or runner. A packaged app that launches but cannot open SQLite is the expected failure and only appears at runtime.

Record results per platform. No commit unless configuration changes are needed.

---

## TASK 23.3 — Add the release workflow, unsigned

**Status:** complete

**Priority:** P1 · **Size:** S

### FILES YOU MAY TOUCH

```
.github/workflows/release.yml   (new)
```

Triggered on tags matching `v*`. Matrix over `macos-latest`, `windows-latest`, `ubuntu-latest`. Build, generate SHA-256 checksums, attach artifacts to the GitHub Release. No signing yet.

### Constraints

- No secrets in this task.
- Mark the release as a draft so a human confirms before publishing.

### VERIFY

Push a `v0.0.0-test` tag on a branch and confirm three artifact sets and a checksum file appear on the draft release.

### COMMIT

`ci: build and attach unsigned desktop installers on tagged releases`

---

## TASK 23.4 — Add signing and notarization

**Status:** complete

**Priority:** P1 · **Size:** M · **Human-led**

macOS needs a Developer ID certificate plus notarization; Windows needs an Authenticode certificate. Both cost money and take time to obtain. Certificates go in repository secrets and are never committed.

If certificates are not yet available: ship unsigned, and add prominent install instructions to `SETUP.md` covering the Gatekeeper and SmartScreen warnings users will see. An unsigned `.dmg` produces a block most users read as a broken application.

**COMMIT (when signed):** `ci: sign and notarize desktop installers`

**COMMIT (unsigned fallback):** `docs: explain unsigned desktop installer warnings`

---

## TASK 23.5 — Decide and document the Docker support level

**Status:** complete

**Priority:** P1 · **Size:** S

### FILES YOU MAY TOUCH

```
README.md
SETUP.md
UPGRADE.md
deploy/docker/README.md
```

Supporting both Electron and Docker means testing every data migration against two data directory layouts. Either state Docker's support level explicitly or demote it to development only, and record the decision in `UPGRADE.md` alongside the compatibility table.

**COMMIT:** `docs: state the support level for the docker distribution`

---

# 24 — PARSER AND TRANSFORMER GOLDEN CORPUS

---

## TASK 24.1 — Build the golden corpus fixtures

**Status:** complete

**Priority:** P1 · **Size:** M

### FILES YOU MAY TOUCH

```
packages/core/test-corpus/   (new)
```

Input scripts plus committed expected outputs, covering: every speaker directive form, every pause directive form, section directives, named-sense annotations, escaping, blank-line and paragraph handling, unknown directives, malformed input exercising the permissive recovery from ADR 0001, Unicode, mixed line endings, and one input over 5,000 words.

### Constraints

- Expected outputs are committed files, not inline strings.
- No test code in this task. Fixtures only.

### VERIFY

```sh
ls packages/core/test-corpus | wc -l
```

### COMMIT

`test(core): add golden corpus fixtures`

---

## TASK 24.2 — Add the golden corpus test and regeneration script

**Status:** complete

**Priority:** P1 · **Size:** S

### FILES YOU MAY TOUCH

```
packages/core/src/goldenCorpus.test.ts   (new)
scripts/regenerate-corpus.mjs   (new)
package.json
```

Parse every input and compare byte for byte against the committed output. Add a regeneration script, run manually only, never in CI. When a version constant is deliberately bumped, outputs are regenerated in the same commit so the diff shows exactly what changed.

### VERIFY

```sh
npx vitest run packages/core
```

### COMMIT

`test(core): assert parser and transformer determinism against the corpus`

---

# 25 — SPLIT OVERSIZED MODULES

**Status:** todo

One file per task. **Move code without editing it.** A split whose diff shows modified logic is a failed split — verify with `git diff -w` that only import lines and file boundaries changed. Keep `index.ts` as a barrel re-exporting the new modules so no consumer import changes.

| Task         | File                                           | Split into                                                                  |
| ------------ | ---------------------------------------------- | --------------------------------------------------------------------------- |
| **25.1** (M) | `packages/rendering/src/index.ts`              | `ffmpeg.ts`, `speechCache.ts`, `renderPlanStore.ts`                         |
| **25.2** (M) | `packages/persistence/src/repository.ts`       | `projects.ts`, `renders.ts`, `lexicon.ts`, `connection.ts`, `rowMappers.ts` |
| **25.3** (M) | `packages/speaches-adapter/src/index.ts`       | `httpClient.ts`, `catalog.ts`, `synthesis.ts`                               |
| **25.4** (M) | `packages/application/src/render.ts`           | `queue.ts`, `orchestration.ts`, `artifacts.ts`                              |
| **25.5** (M) | `apps/web/src/pages/projects/ProjectsPage.tsx` | container plus presentational components plus hooks                         |

Re-measure before starting each: tasks 8, 17, and 19 have already changed several of these files.

**COMMIT:** `refactor(<package>): split <file> into focused modules`

---

# 26 — SINGLE TYPED CONTRACT MAP

**Status:** deferred (human-led; do not delegate)

**Priority:** P2 · **Human-led. Do not delegate.**

Replacing the four-way-maintained operation surface with one contract map is roughly a thousand lines of glue deleted, but it touches every operation at once. Attempt only after 9.x, 16.x, and 17.x have settled the surface, migrating one domain at a time behind the existing manifest tests. When ready, it needs its own decomposed plan.

---

# 27 — FRONTEND DATA-FETCHING LAYER

**Status:** todo

Do task 19 first. SSE changes how render state arrives and would otherwise be migrated twice.

- **27.1 (S)** — Add `@tanstack/react-query`, the provider in `App.tsx`, and a query key convention. No page migrated yet.
- **27.2 (M)** — Migrate the read-only pages. The original scope exceeded the M ceiling, so complete its three sequential sub-tasks before marking 27.2 complete:
  - **27.2a (M)** — Migrate the connection-backed readers: `GeneralSettingsPage`, `VoicesSettingsPage`, and `OnboardingPage`, with their two direct page tests. Preserve `ConnectionProvider` contracts and page workflows.
  - **27.2b (M)** — Migrate the persistence settings readers: `LexiconSettingsPage`, `TimingsSettingsPage`, and `RetentionSettingsPage`, with their direct tests. Do not migrate their save mutations.
  - **27.2c (S)** — Migrate the diagnostics reader hook/page and its direct test coverage. Preserve existing diagnostics rendering and error states.
- **27.3 (M)** — Migrate the mutating pages: projects, scratchpad. Includes optimistic updates and invalidation.

**COMMIT:** `refactor(web): manage server state with tanstack query`

---

# 28 — ROUTE CODE SPLITTING

**Status:** complete

**Priority:** P2 · **Size:** S

### FILES YOU MAY TOUCH

```
apps/web/src/app/routes.tsx
apps/web/src/app/AppShell.tsx
apps/web/src/app/App.test.tsx
```

Convert to `React.lazy` with a `Suspense` boundary in `AppShell`. Keep the onboarding page eager — it is the first screen a new user sees. Keep the database recovery screen eager; it must render when things are broken.

### VERIFY

Standard, plus `npm run test:e2e:web` and confirm the settings route no longer pulls the CodeMirror chunk.

### COMMIT

`perf(web): lazy-load routes`

---

# 29.0 — REMOVE THE SHARED-TYPES CORE DEPENDENCY

This prerequisite preserves Task 29's requested layer direction without weakening it. `core` already has no `shared-types` imports, so the transport-contract subset can be made dependency-free inside `shared-types` without a cyclic dependency or human-led architecture decision.

## TASK 29.0a — Decouple shared-types schemas from core

**Status:** complete

**Priority:** P2 · **Size:** M

### FILES YOU MAY TOUCH

```
packages/shared-types/src/contracts.ts   (new)
packages/shared-types/src/contracts.test.ts   (new)
packages/shared-types/src/persistence.ts
packages/shared-types/src/preview.ts
packages/shared-types/src/renderPlan.ts
packages/shared-types/src/scriptGeneration.ts
```

Copy only the dependency-free transport primitives currently imported from `core` into `contracts.ts`: schema/version constants, speaker/pause identifiers, ignored-diagnostic and lexicon-entry schemas, source ranges, and script prompt kinds. Rewire the four importing modules to use the local definitions. Preserve every public shared-types export and Zod validation behavior. The test must cover the copied contract constraints without importing `core`.

### VERIFY

```sh
npm run format:check && npm run lint && npx tsc --build packages/shared-types && npx vitest run packages/shared-types
rg -n 'from "@studynarrator/core"' packages/shared-types/src
```

The grep must return nothing after 29.0b, not necessarily after this task while `package.json` still declares the dependency.

### COMMIT

`refactor(shared-types): decouple transport schemas from core`

## TASK 29.0b — Remove the shared-types core package dependency

**Status:** complete

**Priority:** P2 · **Size:** XS

### FILES YOU MAY TOUCH

```
packages/shared-types/package.json
package-lock.json
```

Remove `@studynarrator/core` from shared-types dependencies after 29.0a has removed all source imports. Regenerate the lockfile without changing other dependency versions.

### VERIFY

```sh
npm run format:check && npm run lint && npm run typecheck && npx vitest run packages/shared-types
rg -n 'from "@studynarrator/core"' packages/shared-types/src
```

The grep must return nothing.

### COMMIT

`refactor(shared-types): remove the core package dependency`

## TASK 29.0c — Remove the shared-types core build reference

**Status:** complete

**Priority:** P2 · **Size:** XS

### FILES YOU MAY TOUCH

```
packages/shared-types/tsconfig.json
```

Remove the stale `../core` TypeScript project reference. It is an internal build dependency left behind after 29.0a/29.0b and conflicts with Task 29's declaration that `shared-types` depends on no internal package. Do not change root project-reference ordering or other package references.

### VERIFY

```sh
npx tsc --build packages/shared-types
npm run typecheck
rg -n '"\.\./core"|@studynarrator/core' packages/shared-types --glob '!dist/**'
```

The grep must return nothing.

### COMMIT

`refactor(shared-types): remove stale core build reference`

## TASK 29.0d — Remove unused private transport type exports

**Status:** complete

**Priority:** P2 · **Size:** XS

### FILES YOU MAY TOUCH

```
packages/shared-types/src/contracts.ts
packages/shared-types/src/scriptGeneration.ts
```

`contracts.ts` is private to shared-types and is not exported from its public barrel. Change every unconsumed inferred type export to a local type, preserving every schema and runtime export consumed by the shared contract modules. Preserve the public `ScriptPromptKind` export by declaring it in `scriptGeneration.ts` from its local schema rather than re-exporting the private contracts type. This removes the task-caused dead-code audit findings introduced when the Core primitives were decoupled.

### VERIFY

```sh
npm run format:check && npm run lint && npm run typecheck && npm test
```

The audit must no longer report any `packages/shared-types/src/contracts.ts` export. The known unrelated Core and rendering audit findings may remain until Task 30 replaces the audit. A failed attempt removed four type exports but left `ScriptPromptKind`; its correction is included in this task.

### COMMIT

`refactor(shared-types): remove unused transport type exports`

# 29 — ENFORCE PACKAGE DEPENDENCY DIRECTION

**Status:** complete

**Priority:** P2 · **Size:** S

### FILES YOU MAY TOUCH

```
eslint.config.js
package.json
scripts/verify.mjs
```

Encode the layering: `shared-types` and `core` depend on nothing internal; `persistence`, `rendering`, and `speaches-adapter` depend only on those two; `application` may depend on all packages; `apps/*` may depend on any package but never on each other. Add the check to `npm run verify`.

If the rule reports existing violations, **STOP** and report them rather than fixing them here.

### COMMIT

`chore: enforce package dependency direction`

---

# 30.1 — COVER THE DISJOINT VITEST SUITES TOGETHER

This prerequisite restores the release verifier after Task 14 deliberately split the default and API suites. The previous coverage command ran only the default suite while counting `packages/application` source whose tests run exclusively in the API suite, which reduced global function coverage to 69.67% despite the full suite measuring 86.26%.

**Status:** in progress

**Priority:** P2 · **Size:** S

### FILES YOU MAY TOUCH

```
vitest.coverage.config.ts   (new)
package.json
tsconfig.tools.json
```

Add a dedicated coverage config that runs the exact union of the existing default and API test inclusions once, preserving their shared aliases, existing coverage exclusions, reporters, and thresholds. Add it to `tsconfig.tools.json` so ESLint's project service type-checks the new root config; do not suppress typed linting. Update `test:coverage` to use that config. Do not modify either disjoint default/API config or lower thresholds; the coverage command must measure every currently tested source path.

### VERIFY

```sh
npm test
npm run test:api
npm run test:coverage
```

The default and API suites must remain disjoint, and the coverage command must pass all existing 70/60/70/70 thresholds.

### COMMIT

`test: cover all disjoint Vitest suites together`

# 30 — REPLACE THE DEAD-CODE SCRIPT WITH KNIP

**Status:** todo

**Priority:** P2 · **Size:** S

### FILES YOU MAY TOUCH

```
knip.config.js   (new)
knip.json   (delete)
package.json
package-lock.json
scripts/verify.mjs
scripts/audit-dead-code.mjs   (delete)
scripts/audit-dead-code.test.ts   (delete)
README.md
```

Add `knip`, tune the configuration until it reports at least what the existing script reports, then delete the script, its actual TypeScript test, and the `audit:dead-code` npm script, updating `scripts/verify.mjs` and README. Regenerate only the lockfile changes required to add Knip. Use the JavaScript Knip config to register a CSS compiler that converts `@import` edges to imports and include web CSS project files; Knip does not natively analyze plain CSS, but legacy coverage requires reporting orphan CSS files.

### Constraints

- Do not delete the old script until Knip demonstrably covers the same findings, including plain-CSS orphan detection. Record the comparison in the commit body.
- Update all repository documentation references to the removed command in the same correction.

### COMMIT

`chore: replace the bespoke dead-code audit with knip`

---

# APPENDIX — OBSERVED FAILURE MODES FROM TASKS 1–8

Recorded so they are not repeated. The Global Rules above exist because of these.

| What happened                                                                 | Rule |
| ----------------------------------------------------------------------------- | ---- |
| Reformatted 9,000 lines across 57 files, mixed into logic commits             | G1   |
| Five commits cited a "repo formatter" that did not exist                      | G2   |
| Used `node:sqlite` in a `better-sqlite3` codebase                             | G3   |
| Changed `engines.node` unprompted, leaving four files disagreeing             | G4   |
| Wrote `pre-restore-*.sqlite` into `backups/` where nothing lists or prunes it | G5   |
| Overwrote the live database with a non-atomic `copyFile`                      | G6   |
| Left one restore failure path throwing raw `ENOENT`                           | G7   |
| Left `findActiveRenderJob` orphaned after replacing its guard                 | G8   |

What it did well, and which the decomposition preserves: exact `FIND`/`REPLACE` edits, literal data generation (44 seed rows, all ids correct), and small-scope design reasoning — it independently recognised that the plan-level render guard would become a no-op and reimplemented it at project level with an in-flight promise map closing the concurrent-start race.

The pattern is clear. It executes precisely and reasons well within a narrow seam, and it improvises badly when a task spans several layers at once. Every task above is sized to stay inside one seam.
