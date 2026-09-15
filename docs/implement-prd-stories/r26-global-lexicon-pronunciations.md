# R26: Global Lexicon pronunciations

**Story:** [R26 — Update built-in Global Lexicon pronunciations](../prd-work-items/local-only-simplification.md#order-and-dependencies)

**Baseline:** `feature/complete-known-issues` at `8033d2b71a75`

**Status:** Complete — 2026-09-15. Acceptance, validation, and staged evidence
satisfy the local completion contract. R26 has no dependents.

## Completion review plan — 2026-09-15

Review R26 in `/home/mini-boss/Projects/Personal/studynarrator-ai`
(`drofnas/studynarrator-ai`) on `feature/complete-known-issues`, starting at
`0a6d0a57226959b15bb6fea3688240dd21f3195f` with a clean worktree and index.
The accepted local dependency table has no R26 blocker or successor; GitHub
discovery found no open issues. Local Complete requires accepted behavior,
required validation, and staged evidence.

Check the exact catalog mappings, frozen migration seeds, schema/version
alignment, user-data preservation, and the preview path. Run focused catalog,
transformer, migration/recovery, and Web acceptance tests in Docker. Reuse the
recent full-verifier evidence only after proving application source, tests, and
configuration are unchanged. Finish with Ponytail review, documentation checks,
staged readiness review, and the authorized local commit. Scope is R26's report
and local task records unless the acceptance review finds a functional gap.

## Outcome

- The built-in Global Lexicon now maps `redis` to `red.is`, `postgres` to
  `post.gress`, and `retryable` to `retry.uble`. The existing `PostgreSQL`
  pronunciation remains available.
- Database schema version 14 installs these entries for new users and reconciles
  existing installations without overwriting built-in enabled choices, custom
  global entries, or project entries. User-owned identifier collisions are
  reassigned without losing the entry.
- Reimporting the built-in catalog restores the requested mappings while
  preserving custom entries.
- The Settings acceptance test verifies all three mappings in the Global Lexicon,
  and the Scratchpad preview test verifies exact speech output, case-insensitive
  matching, and whole-word boundaries through the real preview request path.

## Initial implementation validation

- Focused shared-types and persistence tests passed: 41 tests.
- Focused server migration tests passed: 2 tests.
- The changed Web acceptance cases for Global Lexicon display and Scratchpad
  preview transformation passed.
- Knip remained within its configured allowance. Prettier, ESLint, TypeScript,
  coverage, application builds, native rebuild, server smoke, Electron smoke,
  and server reopen smoke all passed.
- The full coverage suite passed 706 tests, and the combined Web and Electron
  Playwright run passed 31 tests.
- The full verifier reached the Docker vulnerability policy after all application
  gates passed. The current Debian image produced 205 findings: one critical
  (`CVE-2026-6653`) without an available fix, 204 high instances across 40 unique
  high CVEs, and five unique fixable highs. The verifier removed and audited its
  disposable Docker resources.

## Ponytail review

- Derived the migration reconciliation entry type from the frozen version 12
  seed instead of maintaining a duplicate structural type.
- Removed repeated migration assertions for catalog-owned ordinals and matching
  flags; catalog and end-to-end tests already cover those constants and their
  behavior.
- Removed repeated read-only-control assertions for each new Settings row; the
  existing built-in row already proves the shared row behavior.

All findings were applied. Net reduction: 20 lines.

## Current completion evidence

- The current catalog supplies all three exact mappings and retains the separate
  `PostgreSQL` entry. Migration 14 uses its frozen reconciliation seed and the
  existing reconciliation helper. The original implementation appended the seed
  without changing earlier seed values; schema 14, the migration command test,
  and `UPGRADE.md` agree. No additional migration or catalog edit is needed.
- Fresh creation and upgrade tests pass. The schema-13 upgrade fixture proves
  that an existing built-in's disabled state survives, missing entries are
  added, a colliding custom entry is reassigned without losing its contents,
  project entries remain intact, and reopening applies no migration. Existing
  migration/recovery tests also prove backup creation, transactional rollback,
  safe restore, and refusal of newer schemas.
- All 77 focused tests pass: catalog/persistence/recovery/lexicon (53),
  transformer and lexicon components (22), and the migration command (2).
  Both affected Web acceptance tests pass. Settings displays the requested
  values and preserves custom entries through reimport. Scratchpad verifies
  the exact transformed request via its input hash, including mixed case and
  unchanged longer words such as `rediscover`, `postgres2`, and `retryables`.
- All commands used the existing Docker tooling image and pinned Node/npm:
  `npm test -- packages/shared-types/src/persistence.test.ts packages/persistence/src/index.test.ts packages/persistence/src/restore.test.ts packages/core/src/lexicon.test.ts`,
  `npm test -- packages/core/src/transformer.test.ts apps/web/src/features/lexicon/LexiconEditor.test.tsx apps/web/src/pages/settings/LexiconSettingsPage.test.tsx`,
  `npm run test:api -- apps/server/src/migrate.test.ts`, and
  `npm run test:e2e:web -- e2e/web/projects-and-settings.spec.ts e2e/web/scratchpad.spec.ts --grep "separates fixed global|transforms, synthesizes"`.
  Disposable fixtures use isolated data and the repository's fake speech server.
  Logs and browser reports remain ignored under `.tmp/r26-completion/`.
- The recent [full-verifier run](r25b-render-storage-settings.md#validation)
  passed 760 tests, coverage, 35 Web/Electron acceptance tests, three runtime
  smokes, and Docker distribution/scanner checks. This review's starting commit
  differs from verified tree `73092171af619d82d3c521978766c4e47d3b2999` only in
  five completion/status documents. Application source, tests, configuration,
  dependencies, and toolchain are identical, so the existing full-verifier
  evidence remains current. R10a/R10b resolved the original Docker blocker;
  the linked report records the exact image, assessed findings, and expiry.
- This completion changes documentation only; it has no runtime, database,
  bundle-size, or application-performance effect. No golden fixtures changed.

## Completion Ponytail review

**Lean already. Ship.** The initial simplifications remain in place; this
completion review found no further useful cut.

## Tracker and readiness handoff

R26 moves from In progress to Complete in both local task records after its
validated evidence is staged. Rechecking the accepted dependency table finds no
R26 successor, so no Ready transition is required. The only remaining active
item is R24, which still awaits D1; the seven deferred slices stay deferred.
No hosted tracker changed.

The candidate contains only this report, R26's canonical task entry, and its
accepted dependency-table row. Documentation formatting, local links/anchors,
command and implementation claims, and staged diff hygiene pass. Application
source remains identical to the verified tree; generated evidence is ignored.

**CONDITIONALLY READY:** No P0/P1/P2 issue remains; the documentation-only
pre-submission gates pass with current application validation evidence. The
exact revision's hosted `CI` workflow (caller and reusable jobs named `check`)
remains normal-submission-created evidence for `submit-change-request` to
monitor if a future submission is authorized. This request authorizes the local
commit only.
