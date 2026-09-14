# R27 completion plan

Approved for implementation and local commits by the owner on 2026-09-14.

## Repository and completion contract

- Repository: `/Users/drofnas/Projects/TwistedPears/study-narrator`,
  `drofnas/studynarrator-ai`, branch `feature/complete-known-issues`.
- Starting commit: `82ca286c39c69ba7db036ed193da020c2eacfb8c`; working tree and
  index clean. No other technical repository is authorized.
- Source: R27 in [TASKS.md](../TASKS.md) and the accepted R27a → R27b dependency
  in the [local work-item table](../prd-work-items/local-only-simplification.md).
- Local status mapping: Waiting → Ready → In progress → Complete. Completion
  requires acceptance criteria, all applicable repository validation, reviewed
  and staged changes, and the requested local checkpoint. No remote submission
  is requested. R27 stays in progress until both slices are complete.

## R27a: restore Docker verification

1. Evaluate a supported Debian 13 minimal Node 24 runtime and build FFmpeg with
   only the audio formats, codecs, filters, and file/pipe protocols used by the
   application. Preserve WAV synthesis, normalization, concatenation, MP3
   encoding, metadata remuxing, waveform extraction, and native SQLite.
2. Keep the built media components in the package inventory and raw scan.
   Assess individual findings only where the exact build establishes affected
   code is absent; preserve rejection of new, fixable, unassessed, expired, or
   mismatched findings. Remove obsolete exceptions only when the dependency is
   actually absent. Do not extend the existing owner acceptance to other CVEs.
3. Verify package provenance, runtime permissions, audio behavior, container
   startup, volume persistence, browser acceptance, and resource cleanup. Record
   current scan and compatibility evidence in the security and story documents.
4. Run the required repository checks, perform correctness/readiness and
   Ponytail reviews, apply findings, then commit the validated R27a slice.
5. Verify R27a Complete, then move its sole dependent R27b from Waiting to Ready.

## R27b: persistent unviewed render results

1. Extend the existing shell-level activity provider and typed render client
   with a small client-local record of job IDs and viewed state, containing no
   script text or audio. Reconcile against current projects and render history.
2. Retain completed, failed, and cancelled results distinctly until opened from
   the widget. Opening active work must not mark its future result viewed.
3. Navigate to the exact job/result in the project's Render tab, including older
   results. Prune viewed and removed entries while retaining keyboard and mobile
   navigation behavior.
4. Test reload/reconnect, multiple projects, status transitions, storage failure,
   viewed persistence, removed projects/results, and exact-result navigation.
   Reuse existing contracts unless inspection demonstrates a missing operation.
5. Run applicable repository checks and browser/native acceptance, perform
   correctness/readiness and Ponytail reviews, apply findings, update R27's
   canonical status, and commit the validated slice.

## Validation and scope

Use Node 24.19.0 and npm 11.19.0. Required checks include focused tests,
formatting, lint, typecheck, coverage, dependency/Knip checks where applicable,
the full `npm run verify`, and Docker acceptance. Record a reproducible audio
performance comparison for a changed FFmpeg build and browser reconciliation
behavior for R27b. Generated artifacts remain uncommitted under `.tmp/`.

Do not bundle Speaches, alter supported external endpoints, change database
semantics, weaken unrelated gates, implement other backlog items, push, or
publish. Keep a truthful non-Complete status if a required gate cannot pass.
