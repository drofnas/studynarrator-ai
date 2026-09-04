# StudyNarrator remediation tasks

This file tracks the current release workload. The original remediation plan
started from `main` commit `ed6879d`; the September 4, 2026 task refresh starts
from `e6be799` on `feature/release-task-refresh`.

Deferred licensing and documentation work lives in [FUTURE_WORK.md](FUTURE_WORK.md).
R22–R27 record the September 4 product requests. R23 is already implemented;
R24 supersedes R03 and the completed tasks' older MP3 tagging approach.
Implementation entries below describe planned work, not changes made by this
documentation checkpoint.

## Execution rules

1. Complete one task per checkpoint. Do not combine task IDs in one commit.
2. Change a task to `in progress` before editing and to `complete` after every
   listed gate passes. Record a blocker in the task section before changing its
   status to `blocked`.
3. Read the current source, public manifests, affected tests, accepted ADRs,
   and `docs/technical-debt.md` before editing. Source and manifests override
   claims in this plan when they conflict.
4. Keep one MP3 per render. Keep its audio frames and frozen project snapshot
   stable after publication. An explicit project rename may replace ID3 metadata.
   Completed render artifacts do not need provenance manifests or persisted
   checksums because the application can recreate them. Preserve operational
   hashes used by render plans, speech caching, script export, and data-layout
   safety, plus release-installer checksums. Do not add a persistent download
   copy, metadata tracking column, read-path mutex, or multi-file repair
   transaction.
5. Keep migrations append-only. Do not squash, edit, or renumber migrations
   9 through 12.
6. Keep raw exceptions, private paths, script text, project names, endpoint
   details, and upstream response bodies out of logs and transport errors.
7. Use Node and npm versions from `.nvmrc` and `package.json`. Run commands from
   the repository root.
8. Use concise commits in the form `type(scope): imperative outcome`. Do not
   add AI attribution or `Co-authored-by` lines.
9. For source or configuration changes, run the focused checks listed in the
   task plus `npm run format:check`, `npm run lint`, and `npm run typecheck`.
   Run `npm run verify` before marking the task complete. Record any external
   tool that prevents the verifier from finishing.
10. For documentation-only changes, run Prettier on the changed documents and
    verify every command, path, link, version, and implementation claim.

## Current state

Status values: `todo`, `in progress`, `blocked`, `deferred`, `complete`, `superseded`.

| ID  | Task                                                     | Priority | Status     | Depends on                                |
| --- | -------------------------------------------------------- | -------- | ---------- | ----------------------------------------- |
| R01 | Add MP3 metadata to the FFmpeg encoder                   | P0       | complete   | none                                      |
| R02 | Remove render provenance and retag MP3s on rename        | P0       | complete   | R01                                       |
| R03 | Remove `node-id3` and its obsolete wrapper               | P1       | superseded | replaced by R24                           |
| R04 | Reject redirects from every Speaches request             | P0       | todo       | none                                      |
| R05 | Correct runtime documentation and the browser title      | P1       | todo       | none                                      |
| R06 | Make Compose LAN allowlisting work from `.env`           | P1       | todo       | none                                      |
| R07 | Enforce coverage and dead-code checks in pull-request CI | P1       | todo       | none                                      |
| R08 | Add baseline Web security headers                        | P1       | todo       | none                                      |
| R09 | Add and verify a production Content Security Policy      | P1       | todo       | R08                                       |
| R10 | Promote Docker verification from advisory to enforced    | P1       | deferred   | R07                                       |
| R11 | Add contributor and vulnerability-reporting guides       | P1       | todo       | none                                      |
| R15 | Add an in-application About and Credits page             | P2       | todo       | R13, R14                                  |
| R17 | Add dependency-update automation and pin GitHub Actions  | P2       | todo       | R07                                       |
| R18 | Set the public repository description and topics         | P2       | todo       | none                                      |
| R19 | Validate the desktop release workflow with an RC tag     | P2       | deferred   | R10; R13 in [future work](FUTURE_WORK.md) |
| R20 | Add a license-cleared sample MP3 to the project overview | P2       | deferred   | R14                                       |
| R21 | Reassess optional community and code-scanning files      | P3       | deferred   | R19                                       |
| R22 | Search the complete project script                       | P1       | todo       | none                                      |
| R23 | Remove the completed-output pin action                   | P1       | complete   | none                                      |
| R24 | Write final MP3 tags with an ID3 package                 | P1       | todo       | R02; supersedes R03                       |
| R25 | Show project-render storage in General settings          | P1       | todo       | none                                      |
| R26 | Update built-in Global Lexicon pronunciations            | P1       | todo       | none                                      |
| R27 | Track active and unviewed renders in the sidebar         | P1       | todo       | none                                      |

## Detailed tasks

### R01: Add MP3 metadata to the FFmpeg encoder

**Historical completion:** R24 now owns changes to the metadata writer and tag
values. Preserve this task's other completed behavior.

**Goal:** Write MP3 metadata during encoding so FFmpeg produces the final file
without a second whole-file rewrite.

**Expected files:**

- `packages/rendering/src/ffmpeg.ts`
- `packages/rendering/src/index.ts`
- `packages/rendering/src/ffmpeg.test.ts` or the closest existing rendering test

**Work:**

1. Add a typed metadata input to `encodeMp3` for title, artist, year, and genre.
2. Pass each value to FFmpeg with argument-array entries. Keep shell execution
   disabled.
3. Preserve the current codec, bit rate, sample rate, channel count, overwrite
   behavior, cancellation behavior, and sanitized error handling.
4. Use ID3v2.3 output if supported FFmpeg versions need it for player
   compatibility. Prove the choice with the project-owned FFmpeg test.
5. Encode a disposable MP3 in the test and read its tags with `ffprobe`.
6. Include a title with Unicode and punctuation to prove argument boundaries.

**Acceptance:**

- `ffprobe` reports the supplied title, artist, date or year, and genre.
- FFmpeg receives metadata through separate arguments.
- Encoding does not load the completed MP3 into the Node heap.
- Existing cancellation and decode-validation behavior still passes.

**Focused verification:**

```sh
npm test -- packages/rendering/src/ffmpeg.test.ts
npm run test:api -- packages/application/src/render.test.ts
```

**Commit:** `feat(rendering): write MP3 metadata during encoding`

### R02: Remove render provenance and retag MP3s on rename

**Historical completion:** R24 now owns changes to the metadata writer and tag
values. Preserve this task's other completed behavior.

**Goal:** Remove the completed-render manifest and checksum subsystem, then move
MP3 title refresh from read paths to the explicit Project Name update. Completed
renders remain disposable and reproducible, each render keeps one MP3, and
downloads start without FFmpeg or filesystem preparation.

**Scope decision:** Remove provenance metadata for completed render artifacts,
including `render-manifest.json`, `checksums.txt`, persisted artifact checksums,
and waveform cache coupling to the MP3 checksum. Keep operational hashes used by
render plans and silence assets, the content-addressed speech cache, script
exports, and the data-directory layout manifest. Keep release-installer
`SHA256SUMS.txt`; it protects downloaded binaries rather than reproducible render
output.

**Expected files:**

- `packages/rendering/src/ffmpeg.ts`
- `packages/rendering/src/ffmpeg.test.ts`
- `packages/shared-types/src/render.ts` and focused schema or manifest tests
- `packages/shared-types/src/persistence.ts`
- `packages/persistence/src/migrations.ts`
- `packages/persistence/src/renders.ts`
- `packages/persistence/src/rowMappers.ts`
- `packages/persistence/src/layoutSteps.ts`
- `packages/persistence/src/index.test.ts`
- `packages/persistence/src/dataDirectoryManifest.ts` and its focused test
- `packages/application/src/artifacts.ts`
- `packages/application/src/persistence.ts`
- `packages/application/src/persistence.test.ts`
- `packages/application/src/composition.ts`
- `packages/application/src/composition.test.ts`
- `packages/application/src/render.test.ts`
- `apps/server/src/routes/renders.ts`
- `apps/server/src/app.test.ts`
- `apps/server/src/migrate.test.ts`
- affected Web artifact and waveform consumers and tests
- `e2e/web/render-execution.spec.ts`
- focused Electron IPC or acceptance coverage when the shared project update
  changes a native-boundary contract
- `UPGRADE.md` for schema 13 and data-layout version 2

**Work:**

1. Pass the render snapshot project name and the exact artist `StudyNarrator AI`
   to the FFmpeg encoder from R01.
2. Stop generating `render-manifest.json` and `checksums.txt`. Remove their
   artifact types from shared schemas, REST and IPC responses, route content-type
   handling, Web consumers, retention inventory, tests, and documentation.
3. Append database migration 13. Rebuild `render_artifacts` without the
   `checksum` column and without the `manifest` and `checksums` type values.
   Preserve every remaining artifact row and index. Bump `DATABASE_SCHEMA_VERSION`
   and the migration-command expectations in the same checkpoint. Do not edit
   migrations 1 through 12.
4. Add an idempotent post-database data-directory layout step and bump
   `DATA_DIRECTORY_LAYOUT_VERSION` to 2. Run the new cleanup only after schema 13
   succeeds; keep the existing pre-database steps in their current order.
   Traverse only validated render directories under the managed `renders/` root
   and delete the exact legacy files `render-manifest.json` and `checksums.txt`.
   Reject symlinks and paths outside the managed root. Record the step only after
   it succeeds, tolerate missing files, prove retry after partial failure, and
   preserve too-new layouts without modification.
5. Remove artifact checksum calculation, persistence, transport fields, and
   download-time checksum comparison. Keep path containment, expected filename,
   regular-file, symlink, positive-size, and media validation. Keep MP3 size and
   duration metadata current after replacement.
6. Remove `sourceChecksum` from the public waveform contract and stored
   `waveform.json`. A waveform belongs to its immutable render ID; project-name
   retagging preserves the MPEG audio frames and does not invalidate its peaks.
   Keep bounded parsing and regenerate a missing, malformed, or invalid waveform.
7. Keep Download Details as an on-demand archive containing the original script,
   readable transcript, TTS transcript, and frozen project snapshot. Exclude the
   MP3, segment audio, waveform cache, manifest, checksum list, and any new
   provenance substitute. Do not persist the archive.
8. Add a bounded-memory FFmpeg metadata remux operation that copies the existing
   MP3 audio stream without decoding or re-encoding it. Pass metadata through
   separate arguments, keep shell execution disabled, and preserve ID3v2.3.
9. Detect a Project Name change in the application project-replacement use case.
   Reconcile every retained completed MP3 for that project before reporting the
   update as successful. A repeated save with the same name must retry an earlier
   failed reconciliation.
10. Process MP3s one at a time. Write each result to a temporary sibling, verify
    it, and replace the original with an atomic rename. Check free space first.
    Peak temporary storage must stay at one source MP3, and the application must
    not retain a second MP3 or cached details archive.
11. Preserve the MPEG audio frames. Prove that the title changes while an audio
    frame or decoded-audio hash, duration, sample rate, and channel count remain
    unchanged. The comparison hash exists only in the disposable test.
12. Use the current Project Name for the audio and details download filenames
    without renaming stored artifact paths. Keep the frozen project snapshot and
    render-time script, voice, model, and transformation records unchanged.
13. Remove `refreshTitleForCurrentProject`, its Node byte-buffer replacement
    helper, and every refresh call from playback, waveform, GET, HEAD, Range,
    audio download, artifact download, and details download paths.
14. Keep those read paths free of FFmpeg calls, filesystem writes, and artifact
    row updates. Concurrent downloads must stream the reconciled MP3 without
    locks or mutations.
15. Define a sanitized failure for a rename-time remux. Atomic replacement must
    leave the prior MP3 playable, and retrying the same Project Name update must
    converge without a repair state machine.

**Acceptance:**

- Fresh renders create no manifest or checksum-list file, artifact type, database
  column, transport field, or waveform source-checksum field.
- An upgrade from schema 12 to 13 preserves projects, render jobs, segments, the
  MP3, scripts, transcripts, snapshots, duration, size, and paths while removing
  legacy manifest/checksum rows. Fresh creation, rollback on migration failure,
  backup recovery, idempotent reopen, and newer-schema refusal pass.
- The layout-2 step removes only legacy render provenance files. Fresh, upgraded,
  interrupted, retried, missing-file, symlink, and too-new-layout cases pass.
- Operational render-plan, silence, speech-cache, script-export, data-layout, and
  release-installer hashes remain intact.
- After a successful Project Name update, every retained completed MP3 for that
  project reports the current title and `StudyNarrator AI` artist while its audio
  content remains unchanged.
- Audio Download and Download Details use filenames based on the current Project
  Name. Download Details contains only the four approved text/JSON artifacts, and
  the frozen project snapshot still records the render-time name.
- Clicking Download performs no retagging or preparation. GET, HEAD, Range,
  waveform, audio download, artifact download, and details download do not change
  persisted files or artifact rows.
- HTTP Range playback returns the expected bytes, and concurrent downloads do
  not invoke FFmpeg or wait on a metadata lock.
- A failed retag leaves a playable MP3 and returns a stable sanitized error. A
  retry of the same Project Name update completes without corruption.
- No replacement provenance format, metadata column, read-path mutex, permanent
  MP3 copy, or artifact repair state machine is added.

**Focused verification:**

```sh
npm test -- packages/rendering/src/ffmpeg.test.ts
npm test -- packages/shared-types/src/index.test.ts
npm test -- packages/persistence/src/index.test.ts packages/persistence/src/dataDirectoryManifest.test.ts
npm run test:api -- packages/application/src/persistence.test.ts packages/application/src/render.test.ts packages/application/src/composition.test.ts
npm run test:api -- apps/server/src/app.test.ts apps/server/src/migrate.test.ts
npm run test:e2e:web -- e2e/web/render-execution.spec.ts
npm run test:e2e:electron
```

Run `npm run check:package-dependencies` if public imports change and
`npm run audit:knip` after deleting the provenance paths.

**Commit:** `refactor(render): remove provenance artifacts and retag on rename`

**Completed 2026-09-01:** Implementation checkpoint `12d2550`. `npm run verify`
passed all non-Docker gates: 539 default-suite tests, 156 API tests, coverage,
30 Web/Electron acceptance tests, builds, and persistence smoke checks. Docker
acceptance exposed a stale seven-artifact assertion; it now requires the exact
five retained types and no checksum field. After that correction, formatting,
lint, and type checks passed again, and `npm run verify:docker` passed both
browsers, volume recreation, and cleanup. Verification used the pinned Node/npm
versions with a local two-CPU test-concurrency cap; repository thresholds and
worker settings were unchanged. The Docker security gate now enforces the
[image-specific CVE-2026-52490 assessment](security/CVE-2026-52490.md), which
expires on 2026-10-01 and retains the raw Scout finding.

### R03: Remove `node-id3` and its obsolete wrapper

**Status:** Superseded by [R24](#r24-write-the-requested-final-mp3-tags-with-an-id3-package)
on September 4, 2026. Do not execute the former package-removal plan.

The owner now requires a third-party ID3 package for final MP3 metadata.
`node-id3` and its wrapper remain available for R24 to review and reuse.
Any obsolete-code cleanup must follow R24's selected implementation.

**Commit:** none for the superseded removal task.

### R04: Reject redirects from every Speaches request

**Goal:** Keep URL validation effective after the first HTTP response.

**Expected files:**

- `packages/speaches-adapter/src/catalog.ts`
- `packages/speaches-adapter/src/synthesis.ts`
- `packages/speaches-adapter/src/index.test.ts`
- `packages/speaches-adapter/src/httpClient.ts` only if a small shared request
  helper reduces duplication

**Work:**

1. Inventory every `fetchImpl` call in catalog discovery, diagnostics, and
   synthesis.
2. Set `redirect: "error"` on each request. Prefer a small request-options
   helper only when it preserves the existing method, headers, body, and signal.
3. Add tests for 301, 302, 307, and 308 responses on GET and speech POST paths.
4. Prove that a redirect target receives no request and no script text.
5. Preserve retry classification, timeouts, aborts, bounded responses, and safe
   public errors.
6. Add a sentinel-secret assertion for redirected synthesis text and endpoint
   details.

**Acceptance:**

- No Speaches request follows an HTTP redirect.
- Diagnostics return a stable sanitized failure.
- Synthesis does not retry a policy-blocked redirect unless the existing retry
  contract names that case as retryable.
- Tests cover each request family, not one representative fetch call.

**Focused verification:**

```sh
npm test -- packages/speaches-adapter/src/index.test.ts
```

**Commit:** `fix(speaches): reject redirected requests`

### R05: Correct runtime documentation and the browser title

**Goal:** Make setup instructions agree with the checked-in toolchain and give
the production browser tab the product name.

**Release-scope addition (September 4, 2026):** Correct the README's removed
freeze-plan workflow and reconcile the server build target with the Node runtime
in `.nvmrc`. Remove the active README link that presents the historical PRD as
current architecture, and mark its obsolete reset guidance as superseded by
`UPGRADE.md`. Preserve accurate schema/layout documentation. The full architecture
and roadmap rewrite belongs to [future work](FUTURE_WORK.md).

The product title remains `StudyNarrator AI`. MP3 artist metadata is an explicit
exception: [R24](#r24-write-the-requested-final-mp3-tags-with-an-id3-package) owns
the exact value `Study Narrator AI`; this task must not change it.

**Expected files:**

- `README.md`
- `deploy/docker/README.md`
- `apps/web/index.html`
- one Web or Playwright test if no title assertion exists

**Work:**

1. Replace source-build and verifier references to Node 26.7.0 with the exact
   version pinned by `.nvmrc`, or direct readers to `.nvmrc` when the patch value
   should not appear twice.
2. Keep the npm version aligned with `packageManager` in `package.json`.
3. Change `StudyNarrator · Runtime check` to a short production title.
4. Add a title assertion to the smallest existing Web acceptance test.
5. Leave test-fixture runtime strings alone unless they claim to represent the
   pinned runtime.

**Acceptance:**

- `rg '26\.7\.0|Runtime check' README.md deploy/docker apps/web/index.html`
  returns no stale user-facing references.
- A source-build user can follow the documented Node and npm setup.
- The browser and Electron renderer display the product title.

**Focused verification:**

```sh
npm run format:check
npm test -- apps/web/src/app/App.test.tsx
```

**Commit:** `docs(setup): align runtime requirements and product title`

### R06: Make Compose LAN allowlisting work from `.env`

**Goal:** Let a user opt into LAN binding with the supplied Compose file while
keeping loopback as the default.

**Expected files:**

- `compose.yaml`
- `.env.example`
- `README.md`
- `deploy/docker/README.md`
- `e2e/docker/distribution.spec.ts` or `scripts/verify-docker.mjs`

**Work:**

1. Forward `STUDYNARRATOR_ALLOWED_HOSTS` from Compose interpolation into the
   container environment.
2. Keep an unset or empty value equivalent to the current loopback allowlist.
3. Update `.env.example` so a user can set the bind address and allowlist in the
   same file without a custom override.
4. State that LAN exposure has no application authentication and belongs on a
   trusted network.
5. Add Docker verification for an allowed custom Host header and a rejected Host
   header. Keep the default loopback case.

**Acceptance:**

- Default Compose startup still binds to `127.0.0.1`.
- A configured LAN host passes the Host-header middleware.
- An unlisted host returns the current sanitized rejection.
- Documentation gives one supported path instead of an `.env` plus override
  sequence.

**Focused verification:**

```sh
docker compose config
npm run verify:docker
```

**Commit:** `fix(docker): forward the LAN host allowlist`

### R07: Enforce coverage and dead-code checks in pull-request CI

**Goal:** Make pull-request CI enforce checks already required by the repository.

**Expected files:**

- `.github/workflows/ci.yml`
- `README.md` only if the documented CI command list changes

**Work:**

1. Add `npm run audit:knip` to the `check` job.
2. Replace redundant unit and API test steps with `npm run test:coverage` if the
   coverage config still includes both suites. If it no longer does, keep the
   suites and add coverage without losing either one.
3. Keep fork pull requests free of secrets and write permissions.
4. Preserve Web end-to-end coverage as a separate job.
5. Confirm that CI uploads no coverage output unless a maintainer has requested
   it.

**Acceptance:**

- A pull request cannot merge with failed coverage thresholds or new Knip
  findings.
- CI runs every Vitest suite once unless a documented runner constraint requires
  a duplicate pass.
- The workflow keeps `permissions: contents: read`.

**Focused verification:**

```sh
npm run audit:knip
npm run test:coverage
```

**Commit:** `ci(checks): enforce coverage and dead-code gates`

### R08: Add baseline Web security headers

**Goal:** Add low-risk response headers before designing the CSP in R09.

**Expected files:**

- `apps/server/src/app.ts`
- `apps/server/src/app.test.ts`

**Work:**

1. Add one middleware before API routes and static files.
2. Set `X-Content-Type-Options: nosniff`.
3. Set `Referrer-Policy: no-referrer`.
4. Block framing with `X-Frame-Options: DENY`; R09 will add the CSP equivalent.
5. Consider `Permissions-Policy` only for browser capabilities the application
   does not use. Do not copy a broad template without checking the UI.
6. Assert headers on JSON, static HTML, media Range, error, and fallback route
   responses.

**Acceptance:**

- Each supported Web response carries the selected headers.
- SSE, downloads, audio Range responses, and static caching still work.
- Electron security preferences and navigation guards remain unchanged.

**Focused verification:**

```sh
npm test -- apps/server/src/app.test.ts
npm run test:e2e:web
```

**Commit:** `feat(server): add baseline Web security headers`

### R09: Add and verify a production Content Security Policy

**Goal:** Restrict the production Web application to resources it needs.

**Expected files:**

- `apps/server/src/app.ts`
- `apps/server/src/app.test.ts`
- Web files that must replace incompatible inline styles
- `e2e/web` coverage for production behavior
- `docs/technical-debt.md` if a narrow temporary exception remains

**Work:**

1. Inventory scripts, styles, workers, images, fonts, blob downloads, audio
   sources, and network connections in the built Web application.
2. Start with `default-src 'self'`, `object-src 'none'`, `base-uri 'none'`,
   `frame-ancestors 'none'`, and `form-action 'self'`.
3. Add the smallest directives needed for the parser worker, blob-backed
   downloads or playback, local images, and compiled styles.
4. Replace inline waveform style attributes if a small CSS-variable or element
   change removes the need for `unsafe-inline`. Record any retained exception.
5. Apply the policy to production Web responses. Do not break Vite development
   or Electron development loading.
6. Capture browser console CSP violations in Playwright and fail the test on an
   unexpected violation.

**Acceptance:**

- Production onboarding, parsing, previews, audio playback, downloads, workers,
  and navigation pass under the CSP.
- The policy permits no unrelated external origin.
- The browser cannot frame the app or load plugins.
- Tests assert the exact policy and user-visible workflows.

**Focused verification:**

```sh
npm test -- apps/server/src/app.test.ts
npm run test:e2e:web
npm run verify:docker
```

**Commit:** `feat(server): enforce the production Web CSP`

### R10: Promote Docker verification from advisory to enforced

**Goal:** Fail protected main-branch builds when Docker distribution acceptance
or vulnerability policy fails.

**Status note:** Keep this task `deferred` until a hosted runner completes
`npm run verify:docker` without a missing Docker Scout or browser dependency.

**Expected files:**

- `.github/workflows/ci.yml`
- Docker verification scripts only when the hosted runner exposes a real defect
- `deploy/docker/README.md` if runner requirements change

**Work:**

1. Inspect recent main-branch Docker job logs and separate infrastructure
   failures from product failures.
2. Install or configure the missing hosted-runner tools in the workflow.
3. Keep Docker verification on main, scheduled runs, or an explicit maintainer
   dispatch unless PR cost permits broader use.
4. Remove `continue-on-error: true` after one green representative run.
5. Preserve the cleanup audit and disposable resource ownership rules.

**Acceptance:**

- A Docker product, persistence, cleanup, or vulnerability-policy failure fails
  the workflow.
- Runner provisioning failures show a named missing prerequisite.
- The job leaves no verification-owned Docker resources.

**Focused verification:** `npm run verify:docker` on the same runner image.

**Commit:** `ci(docker): enforce distribution verification`

### R11: Add contributor and vulnerability-reporting guides

**Goal:** Give public contributors a short path to build, test, and report a
security issue without exposing it in a public issue.

**Expected files:**

- `CONTRIBUTING.md`
- `SECURITY.md`
- `README.md`

**Work:**

1. Document the pinned Node/npm setup, `npm ci`, focused test suites, full
   verifier, formatting ownership, architecture boundaries, and migration rule.
2. Tell contributors to keep unrelated changes and generated artifacts out of
   commits.
3. Name the supported release line and security-reporting channel. Use GitHub
   private vulnerability reporting only after the owner confirms it is enabled.
4. Tell reporters which version, distribution, and reproduction details help.
5. Warn reporters not to include scripts, project names, private endpoints,
   tokens, or user data.
6. Link both files from the README.

**Acceptance:**

- A new contributor can reach the standard verification commands from one page.
- A vulnerability reporter has a private contact path confirmed by the owner.
- The documents make no promise about response time or supported release dates
  that the maintainer has not accepted.

**Focused verification:**

```sh
npx prettier --check CONTRIBUTING.md SECURITY.md README.md
```

**Commit:** `docs(project): add contribution and security guides`

### R15: Add an in-application About and Credits page

**Goal:** Give Web and Electron users access to application version, license,
acknowledgments, and third-party notices.

**Expected files:**

- `apps/web/src/pages/about/AboutPage.tsx`
- `apps/web/src/pages/about/AboutPage.module.css`
- `apps/web/src/pages/about/AboutPage.test.tsx`
- `apps/web/src/app/routes.tsx`
- `apps/web/src/app/AppShell.tsx`
- package or runtime descriptor files only when version data is unavailable

**Work:**

1. Add a lazy-loaded `/about` route and a clear navigation link in the sidebar
   footer or settings area.
2. Show StudyNarrator version, Apache-2.0, `ACKNOWLEDGMENTS.md`, and the generated
   notice inventory from R13.
3. Use validated external links and the established Electron external-link
   policy. Do not give the renderer filesystem access.
4. Keep the page usable offline.
5. Add component coverage and Web/Electron navigation acceptance.

**Acceptance:**

- Users can find the page through visible navigation.
- Web and Electron show the same first-party and third-party information.
- External links use the existing approved navigation boundary.
- The page remains readable on narrow and wide layouts.

**Focused verification:**

```sh
npm test -- apps/web/src/pages/about/AboutPage.test.tsx apps/web/src/app/App.test.tsx
npm run test:e2e:web
npm run test:e2e:electron
```

**Commit:** `feat(web): add About and Credits`

### R17: Add dependency-update automation and pin GitHub Actions

**Goal:** Reduce dependency and workflow supply-chain drift without adding a
mandatory audit job that fails on advisory-service noise.

**Expected files:**

- `.github/dependabot.yml`
- `.github/workflows/ci.yml`
- `.github/workflows/release.yml`
- contributor or maintenance documentation

**Work:**

1. Configure monthly Dependabot updates for npm and GitHub Actions.
2. Limit open pull requests and group compatible development-tool updates where
   grouping keeps review clear.
3. Resolve immutable commit SHAs for each GitHub Action from the official action
   repository. Keep the release tag as an end-of-line comment for readability.
4. Grant each workflow the smallest permissions it needs.
5. Keep `npm audit` as a release or maintainer check. Do not make advisory
   endpoint availability a pull-request gate.
6. Document how maintainers review and merge generated update pull requests.

**Acceptance:**

- Workflow actions use immutable SHAs.
- Dependabot can update npm and action references.
- CI keeps read-only permissions; the release workflow keeps only the write
  permission needed for draft releases.
- No generated update merges without tests and maintainer review.

**Focused verification:** YAML validation plus the standard CI command set.

**Commit:** `chore(dependencies): automate reviewed dependency updates`

### R18: Set the public repository description and topics

**Goal:** Make the GitHub project discoverable and describe its supported scope.

**Repository change:** This task changes GitHub metadata and may produce no file
diff. Ask the owner for approval before calling `gh repo edit`.

**Work:**

1. Draft a one-sentence description that says local-first, script-to-audio, and
   external Speaches without claiming bundled speech models.
2. Propose a short topic list such as `text-to-speech`, `audiobook`, `electron`,
   `react`, `typescript`, `self-hosted`, `local-first`, and `speaches`.
3. Confirm the project name and URL before changing metadata.
4. Apply the approved description and topics.
5. Read the repository metadata back and record the result in the task notes.

**Acceptance:** The public repository shows the approved description and topics.

**Commit:** none unless a repository profile document also changes.

### R19: Validate the desktop release workflow with an RC tag

**Goal:** Prove macOS, Windows, and Linux packaging before advertising desktop
installers.

**Status note:** Keep this task `deferred` until R10 and deferred R13 in
[FUTURE_WORK.md](FUTURE_WORK.md) pass. Tag pushes and
release deletion require owner approval.

**Expected files:**

- `.github/workflows/release.yml` when the test finds a defect
- desktop packaging configuration when a platform fails
- release documentation after all platforms pass

**Work:**

1. Confirm main CI and the Docker gate are green.
2. Confirm the package includes licenses, acknowledgments, and third-party
   notices.
3. Ask the owner to approve an exact release-candidate tag.
4. Push the approved tag and monitor every native packaging job.
5. Download each artifact, check its filename, open or inspect the package on its
   target OS, and verify `SHA256SUMS.txt`.
6. Confirm GitHub creates a draft release and labels unsigned installers as
   unsigned.
7. Fix one platform defect per checkpoint. Use another approved RC tag for a new
   run.
8. Delete failed drafts or tags only with owner approval.

**Acceptance:**

- All three platform jobs pass from a tag.
- The draft release contains each expected installer and matching checksums.
- Documentation states signing and notarization status.
- No release claims support for an untested platform or architecture.

**Commit:** use a scoped fix commit only when the RC run exposes a defect.

### R20: Add a license-cleared sample MP3 to the project overview

**Goal:** Let a prospective user hear a short representative output before
installing the application.

**Status note:** Keep this task `deferred` until R14 confirms the text, model,
voice, and output rights.

**Expected files:**

- `docs/assets/` for a small committed sample, or release assets when repository
  size argues against committing audio
- `README.md`
- a source script and provenance note beside the sample

**Work:**

1. Write a short first-party script that demonstrates two speakers, one pause,
   and one pronunciation rule without third-party text.
2. Render it through a documented Speaches, model, and voice version.
3. Keep the MP3 short and compressed. Record its checksum and duration.
4. Store the source script, render settings, model and voice identifiers, license
   links, and generation date with the sample.
5. Link the sample near the README introduction with a text description.
6. Verify the link works on GitHub and does not depend on a private host.

**Acceptance:**

- The maintainer can account for rights in the source text, model, voice, and
  generated file.
- The sample plays from the public project page.
- The repository or release asset remains small enough for normal clones.
- A user can reproduce the sample from the checked-in script and settings.

**Commit:** `docs(demo): add a reproducible audio sample`

### R21: Reassess optional community and code-scanning files

**Goal:** Add maintenance systems when public contribution or release activity
creates a need for them.

**Status note:** This task remains `deferred` through the first RC. The files
below do not block the core script-to-audio product.

**Work:**

1. Review issue volume, contributor count, and release cadence after the first
   RC.
2. Add issue forms and a pull-request template when repeated reports omit the
   same required information.
3. Adopt a code of conduct when the project starts accepting community
   participation. Name the enforcement contact and process.
4. Add a changelog when releases need a maintained compatibility history;
   otherwise use complete GitHub release notes.
5. Enable GitHub CodeQL default setup for JavaScript and TypeScript when the
   owner accepts its alert and update workflow.
6. Record each accepted or rejected item in this section with a date and reason.

**Acceptance:** Each added system has an owner, a maintenance path, and evidence
that it solves a recurring project need.

**Commit:** one focused commit per accepted file or scanning configuration.

### R22: Search the complete project script

**Goal:** Find text anywhere in a project script, including lines outside the
CodeMirror viewport.

**Current evidence:** `ScriptSourceEditor.tsx` uses CodeMirror `minimalSetup`
without a search extension. Browser Find cannot reliably search virtualized lines.

**Expected files:**

- `apps/web/src/features/projects/ScriptSourceEditor.tsx` and its tests/styles
- `apps/web/src/pages/projects/ProjectScriptPanel.tsx`
- `apps/web/package.json` and root lockfile if a direct CodeMirror search dependency is needed
- focused Web acceptance coverage in `e2e/web/`

**Work and acceptance:**

1. Add an accessible **Search Script** control and the editor's standard
   Ctrl+F / Cmd+F shortcut while the editor has focus. Search the entire editor
   document with the existing CodeMirror search facilities.
2. Let users move to the next and previous match, reveal and highlight the match,
   see when there are no matches, and close search with Escape. Keep the script,
   selection behavior, undo history, and autosave intact.
3. Keep Browser Find available outside the editor. Search-and-replace is outside
   this request.
4. Test a long script with a match initially outside the rendered viewport,
   repeated matches, no matches, edits while searching, and keyboard navigation.
   Playwright must prove that an offscreen match becomes visible and selected.

**Focused verification:** Editor component tests and `npm run test:e2e:web`.

**Commit:** `feat(editor): search the complete project script`

### R23: Remove the completed-output pin action from the website

**Status:** Complete before this planning update; no implementation remains.

**Completion evidence:** Commit `1008570` removed the action. Current
`ProjectsPage.test.tsx` contains **offers completed render controls without a pin
action**, which asserts that Download and Download Details remain available,
that no pin button exists, and that the UI does not call `setPinned`.

The underlying persisted pin state and transport operation remain for
compatibility. Removing those is outside this website-only request. R25 must
respect existing pinned files when describing reclaimable storage.

**Verification note:** Source and existing regression assertions inspected on
September 4, 2026; the test was not rerun for this documentation-only update.

**Commit:** none; preserve the existing regression coverage.

### R24: Write the requested final MP3 tags with an ID3 package

**Goal:** Use a third-party ID3 package to tag the final project MP3 with exactly:

| Tag    | Value                              |
| ------ | ---------------------------------- |
| title  | Project Name                       |
| artist | `Study Narrator AI`                |
| year   | Current year at final MP3 creation |
| genre  | `Audio Book`                       |

**Scope decision:** This September 4 request supersedes R03's package-removal
plan and the metadata implementation/values described in completed R01/R02.
Keep R01/R02's completed history. R05's product branding does not override the
explicit MP3 artist above.

**Current evidence:** `packages/rendering/src/id3.ts` already wraps `node-id3`
and supplies the requested artist/genre, but production does not call it.
`packages/application/src/artifacts.ts` currently uses FFmpeg for tags with
artist `StudyNarrator AI` and genre `Speech`. Reuse the installed ID3 package and
review its wrapper before considering a replacement.

**Expected files:**

- `packages/rendering/src/id3.ts`, its tests, and the public rendering export
- `packages/application/src/artifacts.ts` and `render.test.ts`
- `packages/rendering/package.json` and root lockfile only if the dependency changes
- existing MP3 assertions in Web, Electron, and Docker acceptance

**Work and acceptance:**

1. Apply all four tags through the ID3 package after encoding and before atomic
   publication of the single final MP3. Verify the written file before marking
   the render complete; handle the package's failure return values and exceptions.
2. Preserve R02's rename behavior: changing Project Name updates the existing
   completed MP3 title without changing audio frames or the frozen snapshot.
   Preserve the creation year on rename and keep artist/genre consistent with
   this task. Reads and downloads must not initiate metadata rewrites.
3. Perform updates on temporary files and atomically replace the managed file.
   Keep the package in rendering infrastructure; no filesystem access in React.
   Assess the existing wrapper's whole-file memory and blocking cost with a
   representative long MP3 before adopting it in production.
4. Test actual tags with an independent reader, Unicode project names, year
   boundaries via the injected clock, rename, failed writes, temporary-file
   cleanup, and sentinel-secret redaction. A tag failure must not publish an
   incomplete output or destroy the previous valid MP3.
5. Update existing FFmpeg-only/tag-value assertions to the intended final
   behavior without reintroducing provenance files or download-time copies.

**Focused verification:** Rendering unit tests, application render API tests,
relevant Web/Electron acceptance, and `npm run verify:docker`.

**Commit:** `fix(render): write the requested MP3 tags with an ID3 package`

### R25: Show project-render storage in General settings

**Goal:** Add a **Product Renders** callout alongside the Speech cache statistics
so users can see project-audio storage and the space reclaimable through
**Include Rendered Project Clips**.

**Current evidence:** General settings shows Stored, This session, and Activity.
Retention already inventories render-artifact bytes, but clip cleanup excludes
pinned/nonterminal jobs and rejects active or recoverable rendering. Its current
`bytesFreed` result counts only speech-cache bytes, not the removed render files.

**Expected files:**

- `apps/web/src/pages/settings/GeneralSettingsPage.tsx` and its tests/styles
- `packages/application/src/retention.ts`, `cachedSpeech.ts`, and affected tests
- shared schemas, manifests, REST/IPC handlers, and typed Web adapters only where
  existing storage contracts cannot express the required values
- General settings Web acceptance coverage

**Work and acceptance:**

1. Show the total managed project-render storage with a readable byte value,
   including an explicit zero, loading state, and unavailable state.
2. Derive the reclaimable amount from the same eligibility and file inventory as
   the checkbox's cleanup operation. If total and reclaimable storage differ,
   show both; do not promise that pinned output or protected work will be freed.
3. Refresh the values after rendering, deletion, cleanup, and the existing
   Refresh action. Checking the box must not delete anything by itself.
4. Ensure the cleanup confirmation and result accurately account for removed
   project-render files as well as cache files, without double counting. Keep
   the existing maintenance guards and protect projects and snapshots.
5. Test empty storage, existing render files, protected files, active rendering,
   a successful clear with the checkbox, and an unchecked cache-only clear.
   Assert the resulting bytes and remaining files, not just the button click.

**Focused verification:** General settings component tests, affected application
API/contract tests, and Web acceptance; IPC acceptance if its contract changes.

**Commit:** `feat(settings): show project-render storage and reclaimable bytes`

### R26: Update the built-in Global Lexicon pronunciations

**Goal:** Supply these exact built-in mappings:

| Input       | Spoken replacement |
| ----------- | ------------------ |
| `redis`     | `red.is`           |
| `postgres`  | `post.gress`       |
| `retryable` | `retry.uble`       |

**Current evidence:** The current `globalLexicon.json` has a PostgreSQL entry,
but no exact entries for these three requested inputs. Preserve PostgreSQL's
separate entry when adding `postgres`.

**Expected files:**

- `packages/shared-types/src/globalLexicon.json` and catalog tests
- `packages/persistence/src/migrations.ts` and migration tests
- `packages/shared-types/src/persistence.ts`
- `apps/server/src/migrate.test.ts`
- applicable lexicon/transformer tests and Web acceptance
- `UPGRADE.md` for the new schema version

**Work and acceptance:**

1. Add or reconcile the three mappings through the established built-in catalog
   mechanism, with the existing case and word-boundary rules.
2. Append the next migration at implementation time; do not rewrite historical
   migration seeds. Update the schema constant and version-check test together.
3. Apply the mappings to fresh installs and upgrades. Preserve custom/project
   entries and existing enable/disable choices when updating a matching built-in.
   Built-in reimport must restore these mappings without erasing custom entries.
4. Test the exact transformed speech, word boundaries, case handling, fresh
   creation, upgrade, rollback, idempotent reopen, and user-data preservation.
   Verify the entries in the Global Lexicon UI and preview path.

**Focused verification:** Shared-types, persistence, and transformer tests,
applicable API tests, and lexicon Web acceptance. Regenerate golden fixtures only
if this intended catalog change affects them, and review the complete diff.

**Commit:** `feat(lexicon): add Redis Postgres and retryable pronunciations`

### R27: Track active and unviewed project renders in the sidebar

**Goal:** Let users start project renders, work elsewhere in the app, and return
from the left sidebar to queued, running, and recently completed work.

**Current evidence:** The application already owns a render queue and typed
per-project history/progress clients. AppShell has no render activity widget.
Project navigation already accepts `?tab=render`. A second start on a project
with active work returns that job; preserve this behavior and the current queue.

**Expected files:**

- `apps/web/src/app/AppShell.tsx`, its styles, and shell tests
- a render activity provider/hook and widget under `apps/web/src/features/`
- `apps/web/src/pages/projects/useProjectsPageController.ts` and workspace tests
- `apps/web/src/services/renders/renderClient.ts` if adapter changes are needed
- shared/application/REST/IPC contracts only if existing operations are insufficient
- Web acceptance for sidebar navigation and multiple project renders

**Work and acceptance:**

1. Show each queued/running project render with its project name, phase, and
   meaningful progress. Track work above route containers so navigating to
   Settings or another project does not stop updates.
2. Keep recent completed renders visible as unviewed until the user opens that
   completed result from the widget. Clicking an active item must not suppress
   its later completion notification. Show failures/cancellations distinctly.
3. Clicking an item must open that project's Render tab and reveal the associated
   result, including an older render when a project has multiple results.
4. Reconcile job status from existing typed clients and reuse subscriptions with
   bounded polling fallback. Restore tracked/unviewed state after reload through
   a small service-owned local record of IDs; avoid storing scripts or audio.
   Mark viewed state per client, without a new cross-device notification system.
5. Keep active and unviewed entries available in a scrollable sidebar list.
   Prune viewed entries and stale references to deleted projects or removed
   artifacts. Preserve keyboard access and the mobile navigation drawer.
6. Test queued work across at least two projects, progress while off-route,
   successful completion, failure, reconnect/reload, viewed-state persistence,
   removed results, and click-through to the correct project/result. Use the
   existing fake Speaches server and observable state transitions.

**Focused verification:** Shell, activity hook, and project component tests;
typed adapter/contract tests when changed; Web acceptance and Electron acceptance
when bridge behavior changes.

**Commit:** `feat(sidebar): track active and unviewed project renders`

## Decisions that are not tasks

- Do not squash migrations 9 through 12.
- Do not add a container memory limit to mask MP3 rewrite costs.
- Do not add a render read-path mutex or `title_tagged_as` column. R02 owns title
  changes in the explicit project-update path.
- Do not replace every bare `catch` block. Preserve causes on operational
  failures that need diagnosis and keep raw details out of public errors and
  logs.
- Do not bundle Speaches, model weights, voice assets, Redis, a separate job
  queue, object storage, or an external database for version 1.
