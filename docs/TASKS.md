# StudyNarrator remediation tasks

This plan turns the August 26, 2026 architecture and release review into small,
ordered checkpoints. It starts from `main` commit `ed6879d` on branch
`feature/feedback-remediation-tasks`.

## Execution rules

1. Complete one task per checkpoint. Do not combine task IDs in one commit.
2. Change a task to `in progress` before editing and to `complete` after every
   listed gate passes. Record a blocker in the task section before changing its
   status to `blocked`.
3. Read the current source, public manifests, affected tests, accepted ADRs,
   and `docs/technical-debt.md` before editing. Source and manifests override
   claims in this plan when they conflict.
4. Keep render artifacts immutable after publication. Do not add a metadata
   tracking column, read-path mutex, or multi-file repair transaction.
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

Status values: `todo`, `in progress`, `blocked`, `deferred`, `complete`.

| ID  | Task                                                     | Priority | Status   | Depends on |
| --- | -------------------------------------------------------- | -------- | -------- | ---------- |
| R01 | Add MP3 metadata to the FFmpeg encoder                   | P0       | complete | none       |
| R02 | Make published render artifacts immutable                | P0       | todo     | R01        |
| R03 | Remove `node-id3` and its obsolete wrapper               | P0       | todo     | R02        |
| R04 | Reject redirects from every Speaches request             | P0       | todo     | none       |
| R05 | Correct runtime documentation and the browser title      | P1       | todo     | none       |
| R06 | Make Compose LAN allowlisting work from `.env`           | P1       | todo     | none       |
| R07 | Enforce coverage and dead-code checks in pull-request CI | P1       | todo     | none       |
| R08 | Add baseline Web security headers                        | P1       | todo     | none       |
| R09 | Add and verify a production Content Security Policy      | P1       | todo     | R08        |
| R10 | Promote Docker verification from advisory to enforced    | P1       | deferred | R07        |
| R11 | Add contributor and vulnerability-reporting guides       | P1       | todo     | none       |
| R12 | Generate the npm third-party license inventory           | P1       | todo     | R03        |
| R13 | Add bundled-runtime notices to each distribution         | P1       | todo     | R12        |
| R14 | Document Speaches, model, voice, and output licensing    | P1       | todo     | R13        |
| R15 | Add an in-application About and Credits page             | P2       | todo     | R13, R14   |
| R16 | Replace stale planning documents with a current roadmap  | P2       | todo     | none       |
| R17 | Add dependency-update automation and pin GitHub Actions  | P2       | todo     | R07        |
| R18 | Set the public repository description and topics         | P2       | todo     | none       |
| R19 | Validate the desktop release workflow with an RC tag     | P2       | deferred | R10, R13   |
| R20 | Add a license-cleared sample MP3 to the project overview | P2       | deferred | R14        |
| R21 | Reassess optional community and code-scanning files      | P3       | deferred | R19        |

## Detailed tasks

### R01: Add MP3 metadata to the FFmpeg encoder

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

### R02: Make published render artifacts immutable

**Goal:** Stop playback, waveform, audio download, and details download from
changing published files or artifact rows.

**Expected files:**

- `packages/application/src/artifacts.ts`
- `packages/application/src/render.test.ts`
- `e2e/web/render-execution.spec.ts`
- `apps/server/src/app.test.ts` if a route-level Range assertion belongs there

**Work:**

1. Pass the render snapshot project name and fixed StudyNarrator metadata to the
   FFmpeg encoder from R01.
2. Remove `refreshTitleForCurrentProject` and the byte-buffer replacement helper
   that supports it.
3. Remove every refresh call from audio resolution and details archive creation.
4. Keep the MP3 title and MP3 filename captured at render time after a project
   rename. The outer details archive may keep its current download name because
   that name does not modify stored artifacts.
5. Replace tests that expect project renames to retag old MP3 files.
6. Add regression coverage that records artifact bytes, checksums, sizes, and
   modification times before GET, HEAD, Range, waveform, audio download, and
   details download operations, then proves those values did not change.
7. Resolve the same audio through concurrent calls and assert that each call
   succeeds without changing files or database rows.
8. Keep the existing path, regular-file, symlink, size, and checksum validation.

**Acceptance:**

- Published render files and artifact rows change only through retention or
  deletion operations.
- A project rename does not change an earlier MP3 title or checksum.
- HTTP Range playback returns the expected bytes without filesystem writes.
- The render manifest and `checksums.txt` remain valid after each read path.
- No metadata column, render mutex, or artifact repair state machine is added.

**Focused verification:**

```sh
npm run test:api -- packages/application/src/render.test.ts
npm test -- apps/server/src/app.test.ts
npm run test:e2e:web -- e2e/web/render-execution.spec.ts
```

**Commit:** `fix(render): keep published artifacts immutable`

### R03: Remove `node-id3` and its obsolete wrapper

**Goal:** Remove the synchronous whole-file tag writer after R02 removes its last
caller.

**Expected files:**

- `packages/rendering/src/id3.ts`
- `packages/rendering/src/id3.test.ts`
- `packages/rendering/src/index.ts`
- `packages/rendering/package.json`
- `package-lock.json`

**Work:**

1. Prove `writeFinalMp3Metadata` has no callers.
2. Delete the ID3 wrapper and its unit test.
3. Remove the public export and `node-id3` dependency.
4. Update the root lockfile through npm. Do not hand-edit resolved dependency
   sections.
5. Search the repository for `node-id3`, `writeFinalMp3Metadata`, and the old
   sanitized ID3 error messages.

**Acceptance:**

- The application produces the same required MP3 tags through FFmpeg.
- The lockfile contains no `node-id3` package.
- Knip reports no new findings.
- The production dependency audit reports no known vulnerabilities.

**Focused verification:**

```sh
npm run audit:knip
npm run check:package-dependencies
npm test
npm run test:api
npm audit --omit=dev
```

**Commit:** `refactor(rendering): remove the ID3 rewrite dependency`

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

### R12: Generate the npm third-party license inventory

**Goal:** Generate deterministic notices for production npm dependencies before
adding operating-system and bundled-binary notices in R13.

**Expected files:**

- `THIRD_PARTY_NOTICES.md` or an npm-specific generated input to it
- a repository-owned generation script
- the generation script's focused test
- `package.json`

**Work:**

1. Derive the Web server and Electron production dependency sets from the root
   lockfile and workspace manifests.
2. Record package name, version, license identifier, source URL, and required
   notice text. Flag unknown or custom licenses for human review.
3. Sort output by package name and version with byte-stable formatting.
4. Fail on missing license metadata instead of guessing.
5. Add a test for deterministic output, workspace ownership, duplicate package
   versions, and an unknown license.
6. Do not copy complete license texts when the license requires only a notice
   and source link; include full text when the license requires it.

**Acceptance:**

- The npm inventory matches the current lockfile and workspace manifests.
- Regeneration produces no diff when inputs do not change.
- A missing, unknown, or prohibited license stops generation with a package name
  but no private filesystem path.
- The task does not attempt to inventory Debian packages, FFmpeg, Node, or
  Electron runtime binaries; R13 owns those inputs.

**Focused verification:**

Run the generator test, regenerate notices, run `git diff --check`, and run
`npm run audit:knip`.

**Commit:** `docs(licenses): generate npm dependency notices`

### R13: Add bundled-runtime notices to each distribution

**Goal:** Add notices for non-npm components that Docker and desktop packages
ship, then prove each package contains the complete notice set.

**Expected files:**

- `THIRD_PARTY_NOTICES.md` or the generator inputs created by R12
- Docker packaging files
- Electron packaging configuration
- `scripts/verify-docker.mjs`
- focused Electron package or acceptance coverage

**Work:**

1. Inventory bundled Node, Electron, FFmpeg, FFprobe, `better-sqlite3` native
   binaries, and operating-system packages that require notices.
2. Use package-manager metadata and official upstream license files. Do not infer
   a binary's license from its project name.
3. Add reviewed runtime entries to the generated notice output from R12.
4. Include `LICENSE`, `ACKNOWLEDGMENTS.md`, and third-party notices in Docker and
   desktop packages.
5. Inspect actual package contents in Docker and Electron verification.
6. Fail verification when a required notice is absent.

**Acceptance:**

- Each shipped distribution contains the Apache license, acknowledgments, and
  third-party notices.
- The inventory names each bundled runtime component and its source.
- Docker and Electron tests inspect packaged files instead of source-tree files.
- A maintainer reviews unknown, custom, weak-copyleft, or copyleft terms.

**Focused verification:**

```sh
npm run verify:docker
npm run test:e2e:electron
```

**Commit:** `docs(licenses): package bundled runtime notices`

### R14: Document Speaches, model, voice, and output licensing

**Goal:** Explain the license boundary between StudyNarrator, the external speech
stack, source material, and generated audio.

**Expected files:**

- `SETUP.md`
- `README.md`
- `ACKNOWLEDGMENTS.md`
- `docs/baselines/speaches.md`
- `THIRD_PARTY_NOTICES.md` only for software the application ships

**Work:**

1. Verify the current Speaches repository license from its primary source.
2. Verify the recommended Kokoro ONNX model card and each recommended voice
   asset license from primary sources.
3. Verify FFmpeg distribution terms for the Docker image and supported desktop
   package path.
4. State that StudyNarrator's Apache license does not grant rights to imported
   text, model weights, voice assets, or generated output.
5. Link users to upstream license and model-card pages without copying setup
   instructions that will drift.
6. Record the review date and exact upstream version or revision.

**Acceptance:**

- Every recommended external component has a primary-source license link.
- Documentation separates shipped components from user-installed components.
- The text makes no claim that generated audio has a universal license.
- A maintainer reviews any voice or model restriction before R20 begins.

**Focused verification:** Prettier plus a manual link and version check.

**Commit:** `docs(licenses): clarify speech stack and output rights`

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

### R16: Replace stale planning documents with a current roadmap

**Goal:** Stop presenting completed implementation instructions as current
contributor guidance.

**Expected files:**

- `docs/IMPLEMENTATION_PLAN_V2.md`
- `docs/study-narrator-prd-v1.3.md`
- `docs/ROADMAP.md`
- `docs/ARCHITECTURE.md` only if the README and current PRD cannot explain the
  implemented boundaries in a short form
- `README.md`

**Work:**

1. Extract unfinished, deferred, and release-blocking work from the implementation
   plan. Verify each item against current source and manifests.
2. Write a concise roadmap with `now`, `next`, and `later` sections. Link to
   GitHub issues when they exist.
3. Remove the completed implementation plan from active documentation. Git
   history already preserves it; archive it only when a maintainer wants the
   historical file in the working tree.
4. Mark the PRD as a dated pre-release baseline. State that source, manifests,
   tests, accepted ADRs, and current operations docs define shipped behavior.
5. Correct stale section statuses, including sections 25 and 27, if the PRD or
   plan remains in the tree.
6. Update README links so contributors land on current material.

**Acceptance:**

- No active document tells an agent to execute completed tasks.
- The roadmap contains only verified unfinished work.
- Contributor-facing architecture text matches package boundaries and runtime
  behavior.
- The change keeps useful design rationale available without a 2,000-line task
  script in the main documentation path.

**Focused verification:** Prettier, link checking, and claim-to-source review.

**Commit:** `docs(roadmap): retire completed implementation plans`

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

**Status note:** Keep this task `deferred` until R10 and R13 pass. Tag pushes and
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

## Decisions that are not tasks

- Do not squash migrations 9 through 12.
- Do not add a container memory limit to mask MP3 rewrite costs.
- Do not add a render mutex or `title_tagged_as` column after R02 removes
  read-path mutation.
- Do not replace every bare `catch` block. Preserve causes on operational
  failures that need diagnosis and keep raw details out of public errors and
  logs.
- Do not bundle Speaches, model weights, voice assets, Redis, a separate job
  queue, object storage, or an external database for version 1.
