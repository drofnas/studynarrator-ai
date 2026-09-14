# R26: Global Lexicon pronunciations

**Story:** [R26 — Update built-in Global Lexicon pronunciations](../prd-work-items/local-only-simplification.md#order-and-dependencies)

**Baseline:** `feature/complete-known-issues` at `8033d2b71a75`

**Status:** In progress. The pronunciation and migration acceptance criteria
passed, but the required Docker vulnerability gate remains red on findings in
the current base image.

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

## Validation

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

## Tracker state

R26 remains **In progress** because repository policy requires the full Docker
gate for a source checkpoint. It has no dependent work items to unblock.
