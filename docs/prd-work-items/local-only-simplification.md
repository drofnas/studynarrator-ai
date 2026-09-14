# Local-only work-item breakdown

**Mode:** Local audit and tracker-planning record. This document does not authorize GitHub mutation.
**Planning input:** The owner's single-person, local-machine product boundary and the Ponytail audit in this conversation.
**Baseline:** `main` at `f692a1c220c7529b4bc4d14b3231f4da8dec50bd`, inspected September 13, 2026.
**Proposed tracker:** [drofnas/studynarrator-ai issues](https://github.com/drofnas/studynarrator-ai/issues). No Project was selected.

This draft accounts for all 21 previously identified remaining entries: 14 active R-tasks, five deferred R-tasks, the historical contract-map proposal, and the vestigial database-column debt. It proposes 25 implementation/discovery slices: 18 in current scope, including one awaiting a product decision, and seven still deferred. Splitting a task does not expand its requirements or promote deferred work into a release gate.

This is a review and ticket-creation artifact. [TASKS.md](../TASKS.md) and [FUTURE_WORK.md](../FUTURE_WORK.md) remain the canonical workload until the proposed revisions are accepted. Do not maintain a third status list here or create `ROADMAP.md`. After publication, record issue links beside the canonical R-identifiers and use the tracker for execution state.

## Decisions and boundaries

- The supported product runs for one person on their local machine. Keep local Web/Docker and source Electron workflows. Remove the proposed LAN product feature; add no accounts, authentication service, cloud hosting, remote collaboration, or multi-device notification system.
- The local-only boundary concerns access to StudyNarrator AI. Preserve its existing external Speaches integration, including Docker-to-host connectivity; do not silently bundle a speech server or prohibit already supported backend endpoints.
- Retain protections that safeguard a local user's scripts, files, and browser session: redirect rejection, Host validation, a small header policy, CSP, atomic writes, migration recovery, and narrow Electron IPC.
- **D1 — pending owner decision:** R24 currently explicitly requires an ID3 package. Ponytail recommended using the existing FFmpeg writer and deleting the unused `node-id3` wrapper. The FFmpeg branch below remains conditional until that earlier requirement is revised. Exact requested tags and safe rename behavior remain required either way.
- Desktop installers remain deferred. Docker scanning gates Docker distribution claims; it must not become an unrelated prerequisite for native desktop packaging. The existing release workflow has no such Docker dependency; avoid adding the proposed one.
- Licensing work remains deferred until preparing the affected prebuilt distributions. Native npm inventory output helps identify components; it does not replace required license/notice texts or maintainer review.

## Coverage of the audit and original backlog

The source R-task acceptance criteria remain applicable except for the explicit reductions below. Completed R01, R02, R18, and R23 and superseded R03 receive no new implementation items.

| Original entry                    | Disposition                | Proposed slices / retained scope                                                                                     |
| --------------------------------- | -------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| R04                               | Keep                       | R04: reject Speaches redirects and protect script text                                                               |
| R05                               | Keep                       | R05: truthful setup, runtime target, and product name                                                                |
| R06                               | Replace                    | R06: local-only launcher and guidance; cancel LAN allowlist forwarding                                               |
| R07                               | Keep and simplify          | R07a: coverage/Knip CI; R07b: remove three duplicate local verifier invocations                                      |
| R08                               | Keep                       | R08: fixed browser headers; replace the old LAN justification with local-browser protection                          |
| R09                               | Keep                       | R09: production Web CSP using actual resource needs                                                                  |
| R10                               | Keep and simplify          | R10a: scanner/policy transition; R10b: enforced Docker workflow, without an extra SARIF output or desktop dependency |
| R11                               | Shrink                     | R11: concise contribution and private-reporting guides that link to existing instructions                            |
| R17                               | Keep                       | R17: pinned actions and one reviewed dependency-update configuration                                                 |
| R19                               | Defer                      | R19: native RC validation when installers are wanted; depend on R13, not R10                                         |
| R22                               | Keep                       | R22: CodeMirror's native whole-document search                                                                       |
| R24                               | Conditional simplification | R24: correct MP3 tags and creation-year preservation; FFmpeg/dependency removal awaits D1                            |
| R25                               | Keep                       | R25a: accurate storage contracts; R25b: General settings callout and cleanup feedback                                |
| R26                               | Keep                       | R26: three lexicon mappings with a safe upgrade                                                                      |
| R27                               | Keep                       | R27a: active render activity; R27b: persistent unviewed results and exact-result navigation                          |
| R12                               | Defer and simplify         | R12a: prove native npm inventory coverage; R12b: generate notices from those inventories                             |
| R13                               | Defer                      | R13: verified non-npm notices in affected packages                                                                   |
| R14                               | Defer and shrink           | R14: one dated speech-stack baseline; other documents link to it                                                     |
| R16                               | Defer and shrink           | R16a: concise architecture; R16b: delete historical plans and fix references; no new roadmap                         |
| Historical implementation task 26 | Drop speculative rewrite   | Record the decision during R16b; retain existing application, REST, and IPC manifests and their parity tests         |
| `render_jobs.plan_id` debt        | Leave dormant              | Record during R16b: keep writes required by `NOT NULL`; reconsider only during an independently needed table rebuild |

All ten Ponytail findings are represented: historical-doc deletion, native npm inventory, no unified contract-map rewrite, proportionate Docker gates, conditional FFmpeg reuse, removal of LAN scope, no standalone column migration, shorter contribution guides, one speech baseline, and deduplicated verification. No deletion quota or architecture rewrite is added.

## Tracker discovery and deduplication

- The repository has Issues enabled. The paginated all-state issue listing returned 27 closed pull requests and no issues. No existing issue can be reused at this baseline; recheck immediately before publication.
- [PR #25](https://github.com/drofnas/studynarrator-ai/pull/25) is the merged planning refresh. It is source material, not an implementation issue to reopen. Earlier MP3, cleanup, and lexicon PRs overlap the baseline; current source still has the specific R24/R25/R26 gaps. Keep their implemented behavior and test only the remaining changes.
- There are no checked-in issue forms/templates. Existing suitable labels are `bug`, `enhancement`, `documentation`, and `dependencies`. Proposed labels below use these; do not create a label taxonomy.
- GitHub schema inspection exposes `addBlockedBy` and `addSubIssue` and their removal operations. GitHub also documents native [issue dependencies](https://docs.github.com/en/rest/issues/issue-dependencies) and [sub-issues](https://docs.github.com/en/rest/issues/sub-issues). Use native blocked-by links for the graph below; labels and descriptions must not become its source of truth. These are capability findings, not evidence that any relationship has been created.
- Project discovery failed because the current credential lacks `read:project`. Project fields, statuses, and organization issue types are therefore unverified. Do not infer a board or change authentication. Regular repository issues suffice if that target is accepted; Type and Priority below remain draft metadata until supported fields are known.
- No umbrella epic is necessary for these single-repository slices. Parent is **none** for every proposed issue. Original R-identifiers provide traceability without creating empty parent tickets. Assignees are unset; every item has one owning repository and area.

## Order and dependencies

Every row is a proposed new issue in `drofnas/studynarrator-ai`, subject to the final duplicate check. “Ready” means no planning dependency, not permission to implement or a claim that validation has passed. P0 protects script confidentiality; P1 covers local behavior and checks; P2 covers maintenance; P3 is deliberately deferred work.

| ID   | Type  | Area                          | Priority | Planning state  | Blocked by                             | Blocks    |
| ---- | ----- | ----------------------------- | -------- | --------------- | -------------------------------------- | --------- |
| R04  | Task  | Speaches adapter              | P0       | In progress     | —                                      | —         |
| R05  | Task  | Setup and product identity    | P1       | In progress     | —                                      | —         |
| R06  | Task  | Local Docker launcher         | P1       | In progress     | —                                      | —         |
| R07a | Task  | CI                            | P1       | In progress     | —                                      | R10b, R17 |
| R07b | Task  | Local verification            | P1       | In progress     | —                                      | —         |
| R08  | Task  | HTTP boundary                 | P1       | In progress     | —                                      | R09       |
| R09  | Task  | Production Web                | P1       | Waiting         | R08                                    | —         |
| R10a | Task  | Docker scanner                | P1       | In progress     | —                                      | R10b      |
| R10b | Task  | Docker CI                     | P1       | Waiting         | R10a, R07a                             | —         |
| R11  | Task  | Contributor documentation     | P1       | Complete        | —                                      | —         |
| R17  | Task  | Dependency maintenance        | P2       | Waiting         | R07a                                   | —         |
| R22  | Story | Script editor                 | P1       | In progress     | —                                      | —         |
| R24  | Task  | MP3 rendering                 | P1       | Decision needed | D1                                     | R12b      |
| R25a | Task  | Storage service and contracts | P1       | In progress     | —                                      | R25b      |
| R25b | Story | General settings              | P1       | Waiting         | R25a                                   | —         |
| R26  | Task  | Lexicon and persistence       | P1       | In progress     | —                                      | —         |
| R27a | Story | Render activity               | P1       | In progress     | —                                      | R27b      |
| R27b | Story | Render results                | P1       | Waiting         | R27a                                   | —         |
| R12a | Spike | npm inventory                 | P3       | Deferred        | —                                      | R12b      |
| R12b | Task  | npm notices                   | P3       | Deferred        | R12a, R24                              | R13       |
| R13  | Task  | Distribution notices          | P3       | Deferred        | R12b                                   | R19       |
| R14  | Task  | Speech baseline docs          | P3       | Deferred        | —                                      | —         |
| R16a | Task  | Architecture docs             | P3       | Deferred        | —                                      | R16b      |
| R16b | Task  | Historical docs retirement    | P3       | Deferred        | R16a                                   | —         |
| R19  | Task  | Native release validation     | P3       | Deferred        | R13, RC authorization and native hosts | —         |

Recommended first slices are R04 (confidentiality), R07a/R07b (reliable checks with less duplicate execution), R06 (the owner's product boundary), then R05 and useful local features. Other ready items need no artificial sequencing. R17 need not wait for R10: R10 must pin its newly introduced actions itself. R16 need not wait for every future feature; describe current behavior, then each later feature updates its own documentation. R12a can evaluate inventory coverage before D1; final R12b notices wait for the settled dependency set.

The only non-issue blockers are D1 and eventual R19 release authorization/native-platform access. Do not create an issue pretending to represent owner consent. If deferred items are omitted from initial publication, publish their native dependencies when those items are later created; do not treat absent links as evidence of readiness.

## Validation inherited by every implementation slice

Use the toolchain pinned by `.nvmrc` and root `packageManager` (at this baseline Node 24.19.0/npm 11.19.0) and `npm ci`. These are existing root commands, verified against `package.json`:

- Source/configuration work: `npm run format:check`, `npm run lint`, `npm run typecheck`, affected tests, `npm run test:coverage`, and `npm run verify`. The full verifier still includes Docker; this draft does not waive the current repository gate. Report unavailable gates precisely.
- Default-suite work: `npm test -- <test-file>`. Application/server/Electron bridge work: `npm run test:api -- <test-file>`. The existing R08/R09 examples incorrectly use the default suite for server tests; use `test:api` instead.
- Use `npm run test:e2e:web`, `npm run test:e2e:electron`, and `npm run verify:docker` for affected browser, native, and container behavior. Native package inspection is additional to Electron development acceptance where packaging changes.
- Run `npm run check:package-dependencies` after import/workspace changes and `npm run audit:knip` after removals or structural changes. R07b removes redundant invocations inside the full verifier, not these available commands or their checks.
- Documentation-only work: Prettier on intended Markdown, `git diff --check`, link/anchor checks, and referenced-command/claim verification. No full application test run solely for documentation.

Keep each changed operation coherent across strict shared schemas, application services/manifests, applicable REST/IPC surfaces, clients, and live contract tests. A backend-first slice includes compatible adapters and validation; it must leave the existing UI working. Preserve transport-specific exceptions instead of introducing a global contract-map framework. Use disposable storage and the fake Speaches server. Add sentinel-secret checks for affected errors, logs, connection behavior, and exported artifacts. Existing migration, recovery, atomic-file, accessibility, and acceptance requirements in [AGENTS.md](../../AGENTS.md) continue to apply.

The canonical TASKS/FUTURE_WORK entries supply each item's implementation details and acceptance criteria. This document records only the audit's scope changes and dependency graph. When a proposed change is accepted, update its canonical entry before creating a tracker issue from that entry.

## Proposed mutation and handoff

1. Resolve D1 before publishing or implementing R24.
2. If repository-issue creation is authorized, recheck duplicates and create the accepted current-scope records from TASKS/FUTURE_WORK (18 candidates; R24 remains held until D1). Preserve the original R-identifiers and accepted source amendments in each body. Deferred records can stay in FUTURE_WORK until explicitly included; no issue should imply they gate the local beta.
3. Create native blocked-by relationships among published records from the table, then refetch to verify each edge. Do not use labels as blockers. If a native relationship operation fails, report it and obtain a representation decision rather than silently falling back to text.
4. If a Project is requested, first obtain its URL and sufficient existing access, inspect fields/status semantics, then propose additions. Lack of Project access does not prevent repository-issue drafting.
5. Update the canonical TASKS/FUTURE_WORK entries with accepted scope and issue links when that documentation update is authorized. Report created/updated IDs, exact relationships, unresolved decisions, and the next unblocked work. Keep this document as the dated planning/mutation record, not a live duplicate board.

The tracker plan remains a review draft. The open product decision is R24's tagging mechanism; the open publication decisions are whether to create repository issues and whether deferred records should also be published. The audit's dormant/canceled proposals never become implementation tickets.

**Draft validation:** Prettier passed. Checked all 21 source dispositions, 25 unique proposed slices, seven deferred states, and 11 reciprocal dependency edges with no cycles. Every referenced root npm script was verified. Application suites were not rerun for this documentation-only breakdown; its validation rules describe future acceptance, not completed implementation.
