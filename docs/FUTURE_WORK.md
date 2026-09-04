# Future work

This file holds unfinished work deferred from [the release task list](TASKS.md)
on September 4, 2026. R12, R13, R14, and R16 no longer gate the initial
Docker-first beta announcement. Reassess distribution obligations before
publishing prebuilt images or desktop installers.

## Deferral evidence

Source and Git history at `e6be799` show no dedicated implementation of these
four tasks. There is no npm notice generator, third-party notice inventory,
`docs/ARCHITECTURE.md`, or `docs/ROADMAP.md`. The acknowledgment document covers
inspiration, not the tested speech stack's licensing.

Earlier work supplies prerequisites that must be preserved:

- Docker already copies the root `LICENSE` and `ACKNOWLEDGMENTS.md`.
- R02 already updated `UPGRADE.md` to schema 13 and data-layout version 2.
- README and operations documents already describe Docker support and Electron's
  source-only status. They still contain some stale claims.

These prerequisites do not complete R12–R16. Keep them when resuming the work;
implement only what remains. R05 in the release list owns immediate setup and
stale user-guidance corrections, so those do not wait for the R16 rewrite.

## Deferred tasks

| ID  | Task                                                     | Status   | Resume after                                                             |
| --- | -------------------------------------------------------- | -------- | ------------------------------------------------------------------------ |
| R12 | Generate the shipped npm license inventory               | deferred | R24 in TASKS.md settles the ID3 dependency                               |
| R13 | Add bundled-runtime notices to each distribution         | deferred | R12; before distributing affected binaries                               |
| R14 | Document tested Kokoro model and output licensing        | deferred | Resume the explanatory docs independently; R13 only for packaged notices |
| R16 | Replace stale docs with current architecture and roadmap | deferred | R05, R06, R10, R11, and R14 as applicable                                |

The detailed proposals below preserve the earlier planning work. Revalidate
their scope and dependencies when resumed. Paths refer to the repository root.
Use [TASKS.md](TASKS.md) for the execution rules and current release workload;
use this file for deferred roadmap inputs. R24's exact MP3 artist
`Study Narrator AI` takes precedence over R16's broader product-name consistency
proposal. Future R12 must inventory the ID3 package that R24 actually uses.

### R12: Generate the shipped npm license inventory

**Goal:** Derive deterministic notices for npm packages shipped by Docker Web and
Electron before R13 adds operating-system and bundled-runtime notices.

**Scope decision:** The owner does not need to enumerate packages. The generator
must derive both shipped dependency closures from the workspace manifests and
root lockfile. The repository does need an explicit policy for unusual licenses;
this task defines the conservative default below.

**Expected files:**

- `THIRD_PARTY_NOTICES.md` or an npm-specific generated input to it
- a repository-owned generation script
- the generation script's focused test
- `package.json`

**Work:**

1. Traverse from the production dependencies of `apps/server`, `apps/web`, and
   `apps/desktop` through every internal workspace and transitive lockfile entry.
   Include Web assets embedded in Electron. Exclude tests, development servers,
   linters, packagers, and build-only tools. R13 owns Electron, Node, FFmpeg,
   FFprobe, Debian packages, and native runtime binaries as components rather
   than npm package-lock entries.
2. Treat `0BSD`, `MIT`, `MIT-0`, `ISC`, `BSD-2-Clause`, `BSD-3-Clause`,
   `Apache-2.0`, `BlueOak-1.0.0`, and `CC0-1.0` as the repository's pre-approved
   permissive npm license set. Parse SPDX expressions rather than matching loose
   substrings.
3. Stop with a review-required result for missing or custom terms, `SEE LICENSE`
   references, non-SPDX values, or licenses outside the approved set, including
   MPL, EPL, CDDL, LGPL, GPL, AGPL, SSPL, and proprietary terms. Report the
   package and license without a private filesystem path. Do not silently label
   a review-required license as prohibited or compatible.
4. Record package name, exact version, SPDX expression, package source or
   repository URL, copyright/notice text required by the package, and the Docker,
   Electron, or shared distribution scope.
5. Sort by package name, version, and distribution with byte-stable formatting.
   Deduplicate a package/version while preserving every distribution scope.
6. Fail on a lockfile edge that cannot be resolved. Never infer a license from a
   package name, downloaded source, or dependency's parent license.
7. Add tests for deterministic output, workspace traversal, production-versus-dev
   filtering, bundled Web assets, duplicate versions, SPDX alternatives, missing
   metadata, and a review-required license.
8. Include complete license text only when its terms require distribution of that
   text; otherwise include the required notice and source link.

**Acceptance:**

- The npm inventory matches the current lockfile and workspace manifests.
- Docker Web and Electron inventories contain only packages actually shipped in
  those distributions.
- Regeneration produces no diff when inputs do not change.
- A missing, unknown, custom, or non-approved license stops generation with a
  review report; the generator never makes a legal-compatibility decision.
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

### R14: Document the tested Kokoro model and output licensing

**Goal:** Explain the license boundary between StudyNarrator, Speaches, the tested
`speaches-ai/Kokoro-82M-v1.0-ONNX` model, its voice assets, source material, and
generated audio.

**Expected files:**

- `SETUP.md`
- `README.md`
- `ACKNOWLEDGMENTS.md`
- `docs/baselines/speaches.md`

**Work:**

1. Verify the current Speaches repository license from its primary source.
2. Document `speaches-ai/Kokoro-82M-v1.0-ONNX` as the only model tested with
   StudyNarrator. Verify its model card and the license for the voice assets used
   by the repository baseline from primary sources.
3. Do not describe other models or voices from the Speaches catalog as tested or
   recommended. Tell users to review the upstream terms before selecting them.
4. State that StudyNarrator's Apache-2.0 license does not grant rights to imported
   text, model weights, voice assets, or generated output.
5. Link users to upstream license and model-card pages without copying setup
   instructions that will drift.
6. Record the review date and exact upstream version or revision.

**Acceptance:**

- The documentation identifies `speaches-ai/Kokoro-82M-v1.0-ONNX` as the only
  tested model and links its primary-source model card and license.
- The tested baseline voice assets have primary-source license links.
- No other catalog model or voice is presented as tested or recommended.
- Documentation separates shipped components from user-installed components.
- The text makes no claim that generated audio has a universal license.

**Focused verification:** Prettier plus a manual link and version check.

**Commit:** `docs(licenses): document tested speech stack`

### R16: Replace stale docs with current architecture and roadmap

**Goal:** Remove historical documents that no longer describe the shipped
application, preserve accepted decisions in current documentation, and make the
remaining documentation agree with source and public manifests.

**Expected files:**

- delete `docs/IMPLEMENTATION_PLAN_V2.md`
- delete `docs/study-narrator-prd-v1.3.md`
- create `docs/ARCHITECTURE.md`
- create `docs/ROADMAP.md`
- `README.md`
- `SETUP.md`
- `UPGRADE.md`
- `deploy/docker/README.md`
- `docs/baselines/speaches.md`
- `docs/script-grammar-v1.md`, `docs/adr/0001-permissive-script-recovery.md`,
  and `docs/technical-debt.md` only when the source audit finds drift
- `docs/TASKS.md` and `docs/FUTURE_WORK.md` only for status, dependency, or link updates; do not delete,
  archive, or replace this current workload

**Work:**

1. Treat current source, workspace manifests, `APPLICATION_SERVICE_MANIFEST`,
   `REST_API_MANIFEST`, `PUBLIC_IPC_CHANNEL_MANIFEST`, migration list,
   `DATABASE_SCHEMA_VERSION`, `DATA_DIRECTORY_LAYOUT_VERSION`, Docker and
   Electron packaging configuration, accepted ADRs, tests, and
   `docs/technical-debt.md` as the factual baseline.
2. Delete `docs/IMPLEMENTATION_PLAN_V2.md`. It is a completed checkpoint script
   that still describes schema 4 and already-finished work; Git history preserves
   it.
3. Delete `docs/study-narrator-prd-v1.3.md`. It mixes desired version-1 behavior,
   obsolete pre-release reset guidance, and unshipped desktop-release promises.
   Move only still-true architectural decisions into `docs/ARCHITECTURE.md` or a
   focused accepted ADR before deletion. Do not retain an archive copy in the
   active documentation tree.
4. Create `docs/ARCHITECTURE.md` describing the implemented system:
   - Docker Web as the supported single-user distribution and Electron as a
     source/development client until R19 completes native release validation;
   - the monorepo dependency direction and responsibilities of `core`,
     `shared-types`, `application`, `persistence`, `rendering`, `runtime`, the
     Speaches adapter, and each app;
   - deterministic parsing, CIR, pronunciation transformation, project
     authoring, prompt/skill export, previews, scratchpad, and render orchestration;
   - the live `DATABASE_SCHEMA_VERSION` and `DATA_DIRECTORY_LAYOUT_VERSION`,
     append-only migrations, backups, recovery, retention, speech cache, and
     managed render files;
   - manifest-backed application, REST, and IPC operations; Express boundary
     validation; and the sandboxed Electron preload/main-process boundary;
   - the external unauthenticated Speaches boundary, supported loopback/private
     network/HTTPS endpoints, offline authoring, and no bundled speech service;
   - Web Host validation, loopback-first exposure, Docker hardening, redacted
     errors/logs, and the verification layers that enforce those properties.
5. Create `docs/ROADMAP.md` from the then-current incomplete entries in `docs/TASKS.md` and
   `docs/FUTURE_WORK.md`, unresolved `docs/technical-debt.md` items, and open GitHub issues whose
   claims still match source. Use `now`, `next`, and `later`; order `now` by task
   priority and dependency, place deferred release/community work in `later`, and
   link back to `docs/TASKS.md` for executable acceptance criteria.
6. Update `README.md` to use `StudyNarrator AI` as the product name; describe only
   implemented features and navigation; preserve the external-Speaches and
   local-first boundaries; state the current Docker/Electron distribution status;
   point toolchain setup to `.nvmrc` and `packageManager`; and replace deleted PRD
   links with Architecture, Roadmap, Tasks, Upgrade, grammar, ADR, and operations
   links.
7. Update `SETUP.md` to match the current Docker-first installation, source Web
   and Electron development paths, onboarding flow, supported unauthenticated
   Speaches URLs, offline behavior, LAN warning, current model example, and
   unsigned-installer status. Link upstream Speaches instructions instead of
   copying unstable lifecycle guidance beyond the tested quick-start commands.
8. Update `UPGRADE.md` from the live constants and migration behavior at the time
   R16 runs. After R02, application 0.1.0 uses database schema 13 and data-layout
   version 2. Document startup backup, pruning, too-new recovery, restore, data
   locations, Docker volume handling, and the absence of down migrations without
   stale reset instructions.
9. Update `deploy/docker/README.md` to match `compose.yaml`, `.env.example`, the
   effective Host allowlist after R06, UID/GID 10001, `/data`, read-only root,
   external Speaches networking, and the enforced Docker CI/release gate from
   R10. Point Node requirements to `.nvmrc` instead of hard-coding 26.7.0.
10. Rewrite `docs/baselines/speaches.md` as a dated compatibility evidence record,
    not a future integration plan: state that the adapter is implemented, retain
    reproducible redacted request/media/outage evidence, remove the unsupported
    API-key path, and link the current fake-server and adapter tests.
11. Verify `docs/script-grammar-v1.md` against the exported grammar/CIR constants
    and parser tests, verify ADR 0001 against the recovery and ignored-diagnostic
    implementation, and keep both unchanged when accurate. Verify the technical
    debt entry against migration 12 and remove or rewrite it only if source has
    resolved or changed the debt.
12. Search all Markdown, package metadata, HTML metadata, Docker labels, and
    Electron product configuration for deleted links, schema 4, Node 26.7.0,
    `Runtime check`, obsolete distribution claims, and contradictory product-name
    spellings. Update user-facing documentation in this task; leave code/config
    product-name changes to their owning tasks.

**Acceptance:**

- No active document tells an agent to execute completed tasks.
- The old implementation plan and PRD are absent, and no active link references
  them.
- `docs/TASKS.md` remains the detailed current workload; the roadmap contains
  only verified unfinished work and links here instead of duplicating it.
- Architecture and operations claims match public manifests, schema/layout
  constants, packaging, security boundaries, and runtime behavior.
- README, Setup, Upgrade, Docker operations, Speaches baseline, grammar, ADR, and
  technical-debt documents have distinct current purposes and no contradictory
  version or support statements.
- Useful accepted rationale survives in Architecture or a focused ADR without a
  multi-thousand-line historical plan in the active documentation path.

**Focused verification:** Prettier, repository-wide Markdown link checking,
deleted-reference searches, version/name searches, and claim-to-source review
against the manifests and constants named above.

**Commit:** `docs(roadmap): retire completed implementation plans`
