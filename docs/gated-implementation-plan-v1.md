# StudyNarrator

## Gate-Driven Implementation, Automation, and Human UX Validation Plan

**Document status:** Implementation companion to `StudyNarrator PRD v1.3`  
**PRD status:** Unchanged  
**Purpose:** Build StudyNarrator in small, independently testable increments with explicit human approval before work advances.

---

## 1. Why this plan exists

The PRD describes the complete Version 1 product, but its delivery phases are too large to use as individual implementation tasks. A single phase such as “React Web UI and Node.js Docker application” contains many independent risks:

- Script parsing.
- Pronunciation transformation.
- SQLite persistence.
- Speaches connectivity.
- Audio generation.
- FFmpeg assembly.
- Caching.
- Render recovery.
- Player and waveform behavior.
- Docker packaging.

Building all of those at once would make failures difficult to isolate. It would also make it easy for an AI coding agent to create a large amount of plausible-looking code before any of it has been proven against the real Speaches server or the user’s listening workflow.

This plan replaces that approach with **automation-first, human-approved gates**. Every gate must produce something observable, include unit and backend contract checks, exercise every new or changed user workflow through Playwright, and receive an explicit approval or rejection. Human review begins only after automation is green and is limited to UX qualities that automation cannot judge reliably.

---

## 2. Operating rules for every gate

### 2.1 One branch and one review per gate

Use one branch per gate:

```text
gate/G00-baseline
gate/G01-walking-skeleton
gate/G02-parser
...
gate/G17-v1-release
```

A gate should be reviewable and revertible as one logical change. Do not combine two gates into one pull request merely because an implementation agent can generate both quickly.

### 2.2 Strict sequential gate order

Gates must be implemented and approved in numeric order from G00 through G17. The progress checklist in Section 6 is the human-readable source of truth: the first unchecked gate is the only gate eligible for implementation or review.

- Do not skip a gate.
- Do not implement, scaffold, or review later gates in parallel with the current gate.
- Before beginning Gate GXX, confirm every lower-numbered Gate GNN is checked and has both an approval record and a matching `gate-GNN-approved` tag.
- If the current gate is rejected, leave it unchecked and continue work only on that gate until it is approved.
- Later gate sections may inform architectural boundaries, but their deliverables must not be started early.

Check a gate only after its automated validation and UX review pass and its approval record contains either `APPROVED` or `APPROVED WITH DOCUMENTED DEFERRED ISSUE`. The deferred-issue form counts only under the rules in Section 2.6. Update the checklist in the same approval commit that records the decision, then create the approved tag for that checkpoint. A rejected gate remains unchecked and blocks every later gate.

### 2.3 No speculative next-gate work

A gate implementation must not add unfinished code for later gates. In particular:

- Do not add TTS calls during parser gates.
- Do not add full rendering during Scratchpad work.
- Do not add Electron packaging during Docker work.
- Do not bundle Speaches at any point in Version 1.
- Do not silently implement P1 or future-version features.

A small interface or placeholder is acceptable only when the current gate needs it to prove an architectural boundary. It must be labeled clearly and must not pretend to be working functionality.

### 2.4 Every gate includes five kinds of evidence

Each gate must provide:

1. **Unit and backend contract evidence** — tests for every application service method, REST operation, and typed IPC channel added or changed by the gate.
2. **Playwright acceptance evidence** — real Web workflows and focused Electron parity for every added or changed route, navigation path, dialog, or access method.
3. **Cumulative automated evidence** — the current `verify:gate` command, including earlier regressions, type checking, linting, and builds.
4. **Observable output and UX review** — inspectable UI or artifacts followed by a short human assessment of visual quality, accessibility feel, responsive behavior, perceived timing, audio perception, and OS-native interactions only.
5. **Approval record** — the commit, environment, automated results, UX findings, known limitations, and approval decision.

Automation fixtures must be runnable without requiring a reviewer to infer fixture contents or reverse-engineer schemas. Whenever a workflow requires pasted or entered data, its Playwright fixture or UX checklist must include the complete value, including as applicable:

- Full JSON roots with every required property, valid IDs, and valid cross-references between editors or records.
- Exact source text, prompts, filenames, URLs, commands, environment variables, form values, and confirmation text.
- Separate replacement payloads when a later step changes only part of an earlier value.
- A specific invalid payload and the expected error path/message when validation failure is part of the test.

Examples must be valid for the implementation at the reviewed checkpoint. JSON examples must parse and satisfy the same exported schemas used by the product boundary. Do not use placeholders such as “add mappings,” “enter suitable JSON,” or “use the valid fixture” unless the exact referenced content is included directly. Human review must never be the first validation of functionality; any functional defect found during UX review requires a regression test before approval.

### 2.5 Previously approved behavior must continue to pass

The automated gate command must run the current gate’s unit/API contracts, Web and Electron Playwright acceptance where applicable, builds and smoke checks, plus all previously approved regression checks. A later gate does not get to break an earlier gate merely because its own new tests pass. Any changed way of reaching a UI component must update the corresponding Playwright workflow in the same checkpoint.

The repository should expose one command beginning in Gate G01:

```bash
npm run verify:gate -- G05
```

The command must finish with an unambiguous result such as:

```text
GATE G05: AUTOMATED CHECKS PASSED
```

It must exit nonzero if any required check fails.

### 2.6 Approval is explicit

At the end of a review, record one of:

```text
APPROVED
REJECTED — CHANGES REQUIRED
APPROVED WITH DOCUMENTED DEFERRED ISSUE
```

“Looks mostly okay” is not approval. An approved-with-deferred-issue decision is allowed only when the issue does not violate the gate’s pass criteria and has a named follow-up gate or issue.

### 2.7 Tag approved checkpoints

After merging an approved gate, create an annotated tag:

```text
gate-G05-approved
```

This provides a known-good rollback point and makes it easy to compare behavior between gates.

### 2.8 Use disposable test data

Automated tests and human UX review must not use the user’s permanent StudyNarrator data directory. Development and gate validation should use a unique disposable location such as:

```text
.tmp/gates/G05/data
```

The repository must provide a safe reset command that refuses to remove directories outside the project’s designated temporary area:

```bash
npm run gate:reset -- G05
```

API keys and real server addresses belong in ignored local environment files, never fixtures or committed evidence.

---

## 3. Standard implementation choices

These choices keep the project lightweight and make the gates reproducible:

- **Workspace:** npm workspaces.
- **Language:** strict TypeScript throughout shared code, Node.js services, React, and Electron.
- **Frontend:** React and Vite.
- **Web transport:** Express REST endpoints.
- **Desktop transport:** typed Electron preload and IPC commands.
- **Schema validation:** Zod or an equivalent runtime TypeScript validator.
- **Unit/integration tests:** Vitest or an equivalent fast TypeScript test runner.
- **Browser tests:** pinned Playwright, mandatory from G06 onward and backfilled at G06 for every current user-facing route. Chromium runs at every gate; Firefox joins the required matrix at G14 and WebKit at G17.
- **Persistence:** SQLite behind repository interfaces. The concrete driver is accepted only after the G01 Node/Electron compatibility spike.
- **Audio processing:** FFmpeg launched with argument arrays; no shell interpolation of user input.
- **Real TTS:** external Speaches server configured through environment variables or a local desktop connection profile.
- **Mock TTS:** a repository-owned fake Speaches server with deterministic responses and request counters.

Exact dependency versions should be pinned in the lockfile at implementation time. Version upgrades are separate maintenance changes and must not be folded into unrelated feature gates.

---

## 4. Test environments

Four environments are used across the gates.

### Environment A: Core and mock environment

Requires only Node.js and repository dependencies. It runs parser, lexicon, persistence, API, UI, and mock-Speaches tests. Most gates must pass here without the real TTS server.

### Environment B: Real Speaches environment

Uses the user’s existing Speaches server and the model:

```text
speaches-ai/Kokoro-82M-v1.0-ONNX
```

Recommended ignored environment file:

```dotenv
SPEACHES_BASE_URL=http://your-server:8000
SPEACHES_API_KEY=
SPEACHES_MODEL_ID=speaches-ai/Kokoro-82M-v1.0-ONNX
SPEACHES_DEFAULT_VOICE=af_heart
```

The test instructions must never assume that an API key is absent. They should add an authorization header only when a key is configured.

### Environment C: Docker production-like environment

Runs the production StudyNarrator image and the application-only Compose file. Speaches remains external.

### Environment D: Electron clean-install environment

Runs a packaged desktop artifact rather than `npm run dev`. Final release validation requires clean operating-system accounts or clean virtual machines rather than only the developer’s configured workstation.

---

## 5. Permanent acceptance fixtures

These fixtures are introduced early and reused through the final release. Their expected structures must be versioned so regressions are visible.

### 5.1 Canonical valid study-guide fixture

File:

```text
fixtures/gates/study-guide-valid.txt
```

Contents:

```text
[section: Resumes and background processing]

[speaker_teacher] Today we will compare two meanings of the word {{resume|cv}}.
[pause_short]
[speaker_student] That is the document I send with a job application.
[pause_short]
[speaker_teacher] Correct. A paused job can {{resume|continue}} after a restart.
[pause_long]

[section: SQL pronunciation]

[speaker_teacher] SQL indexes can speed up database reads.
[pause_short]
[speaker_student] In this project, SQL is pronounced using the project lexicon.
```

Expected discoveries:

- Speakers: `teacher`, `student`.
- Pause IDs: `pause_short`, `pause_long`.
- Sections: 2.
- Speech segments: 5.
- Explicit pause segments: 4.
- Explicit pronunciation-sense annotations: 2.
- `SQL` occurrences eligible for the project lexicon: 2.

Paragraph-boundary metadata may exist in the canonical representation, but it must not change those counts.

### 5.2 Canonical lexicon fixture

Global entry:

```text
SQL → sequel
```

Project named senses:

```text
resume + cv       → rez-oo-may
resume + continue → ree-zoom
```

Expected readable transcript behavior:

- Both pronunciation annotations display as `resume`.
- Both occurrences of `SQL` remain displayed as `SQL`.

Expected transformed TTS behavior:

- `{{resume|cv}}` becomes `rez-oo-may`.
- `{{resume|continue}}` becomes `ree-zoom`.
- Whole-word `SQL` becomes `sequel`.

### 5.3 Canonical invalid fixture

File:

```text
fixtures/gates/study-guide-invalid.txt
```

Contents:

```text
[speaker_1bad] This speaker name begins with a number and can be mapped later.
[section Database indexes]
[pause_short] This speech follows the pause on [pause_short] {{resume|cv the same line.
[section Database indexes]
[speaker_1bad] This annotation [speaker_teacher] is not closed: {{resume|cv
```

The fixture discovers `1bad` and `teacher`, emits both `pause_short` occurrences in source order, and splits speech around the inline pause and speaker tokens. The inline speaker changes the active speaker to `teacher`. Both malformed sections and both malformed annotations produce actionable diagnostics and remain literal speech; ignoring either focused pattern suppresses both matching errors without changing recovered speech.

### 5.4 Audio assembly fixture

The audio test generator creates:

- `tone-a.wav`: 1.000 seconds.
- `pause_short.wav`: 0.350 seconds.
- `tone-b.wav`: 1.000 seconds.
- `pause_long.wav`: 1.500 seconds.

Expected uncompressed timeline duration:

```text
1.000 + 0.350 + 1.000 + 1.500 = 3.850 seconds
```

The final MP3 duration may differ slightly because of encoder delay. The allowed tolerance must be documented and tested; the initial recommendation is ±0.080 seconds.

---

## 6. Gate progress and summary

### 6.1 Linear progress checklist

The first unchecked item is the next gate. Only that gate may be implemented or reviewed.

- [x] G00 — Freeze the external TTS baseline
- [x] G01 — Walking skeleton and architecture-risk spike
- [x] G02 — Script parser and canonical intermediate representation
- [x] G03 — Lexicon, named senses, and transcript transformation
- [x] G04 — SQLite project persistence and migrations
- [x] G05 — Project authoring, discovery, configuration, and dry run
- [ ] G06 — Speaches connection profiles and diagnostics
- [ ] G07 — Quick Scratchpad and first audible output
- [ ] G08 — Segment preview and content-addressed cache
- [ ] G09 — Frozen render plan and exact silence generation
- [ ] G10 — Deterministic FFmpeg assembly from fixed audio
- [ ] G11 — Full render orchestration and artifact bundle
- [ ] G12 — Waveform player and segment-level render history
- [ ] G13 — External-LLM prompt and skill export
- [ ] G14 — Production Docker Web distribution
- [ ] G15 — Electron functional integration and native desktop behavior
- [ ] G16 — Cross-platform packages and clean-install release matrix
- [ ] G17 — Version 1 release acceptance

The checked G00 through G05 entries are supported by their records under `docs/gates/approvals/` and their matching approved tags. Therefore, G06 is the current and only eligible gate.

### 6.2 Gate outcomes

| Gate | Outcome proven by automation before UX review | Real Speaches required? |
|---|---|---:|
| G00 | Existing server and shell path can produce a known-good baseline | Yes |
| G01 | React, Node, Electron, SQLite, and FFmpeg can coexist in the chosen architecture | No |
| G02 | Script grammar produces a correct canonical representation | No |
| G03 | Lexicon and named senses produce deterministic readable and TTS transcripts | No |
| G04 | Projects and settings survive restart and migrate safely | No |
| G05 | A complete project can be authored, discovered, configured, and dry-run without TTS | No |
| G06 | Connection profiles diagnose simulated Speaches failures accurately and present recovery clearly | Mock; real check optional for UX |
| G07 | Scratchpad produces and plays one real speech result | Yes |
| G08 | Segment preview and content-addressed cache reuse only valid audio | Yes for listening; mock for counts |
| G09 | A frozen render plan and exact silence segments are correct before synthesis | No |
| G10 | FFmpeg assembles deterministic, bounded-memory MP3 output from fixed components | No |
| G11 | Full project rendering, artifacts, retry, cancellation, and selective rerender work | Yes |
| G12 | Waveform and segment-level history tools operate on completed audio without hidden synthesis | Yes for listening |
| G13 | Prompt and skill exports round-trip through an external LLM workflow | No server required |
| G14 | The application-only Docker release works against external Speaches and preserves data | Yes for final integration |
| G15 | The Electron application runs the shared product through secure IPC and native desktop actions | Yes for final integration |
| G16 | Windows, macOS, and Linux packages pass clean-install and release checks | Only for render checks |
| G17 | The complete Version 1 acceptance fixture passes on release candidates | Yes |

---

# 7. Detailed gates

## G00 — Freeze the external TTS baseline

### Goal

Prove the external dependency before writing the harness. This gate captures a known-good Speaches request, output, voice, and model so later failures can be attributed to StudyNarrator rather than uncertainty about the server.

### Deliverables

- `docs/baselines/speaches.md` containing the tested endpoint shape, model ID, voice ID, response format, and date tested.
- A redacted copy of the successful request structure.
- `fixtures/baseline/speaches-smoke.txt` with a short, stable sentence.
- A successful WAV and MP3 generated through the existing shell workflow or a temporary probe script.
- FFprobe metadata for both artifacts.
- No application code.

Recommended smoke text:

```text
This is the StudyNarrator baseline. SQL indexes can speed up database reads.
```

### Automated checks

This gate may use a temporary script, but it must verify:

- HTTP success.
- Nonempty response.
- Expected audio content type or decodable audio.
- FFmpeg/FFprobe can decode the result.
- Model and voice values are recorded without recording an API key.

### Historical human acceptance evidence

1. Start or verify the existing Speaches server.
2. Run the existing shell conversion against `speaches-smoke.txt`.
3. Play the resulting MP3 from beginning to end.
4. Confirm that the selected voice is recognizable and the complete sentence is present.
5. Run FFprobe against the WAV and MP3.
6. Record the exact model ID, voice ID, and whether the server URL was supplied as a root URL or a `/v1` URL.
7. Temporarily stop or block Speaches and repeat the request. Record the actual failure shape for later diagnostics tests.

### Pass criteria

- Both WAV and MP3 are playable and nonempty.
- FFprobe recognizes both files.
- The successful request can be reproduced twice.
- The failure response is captured without secrets.
- The reviewer approves the baseline artifacts.

### Explicitly excluded

- React.
- Node application structure.
- Parsing.
- Lexicons.
- Any attempt to install or manage Speaches.

### Human approval evidence

- Audio filenames.
- FFprobe summary.
- Model and voice IDs.
- `APPROVED` or `REJECTED`.

---

## G01 — Walking skeleton and architecture-risk spike

### Goal

Prove the selected React/Node/Electron architecture before building product behavior. The same shared TypeScript function must be callable through the Web REST transport and Electron IPC transport. SQLite and FFmpeg must also work from both Node runtimes.

### Deliverables

- npm-workspace monorepo with the planned `apps/` and `packages/` boundaries.
- Strict TypeScript configuration.
- React status screen.
- Express `/api/health`, `/api/runtime`, and `/api/diagnostics` endpoints.
- Electron development shell loading the same React UI.
- Narrow preload bridge with one validated `system.diagnostics` operation.
- Shared runtime self-test service.
- Minimal SQLite migration and one diagnostic key/value record.
- FFmpeg executable detection and version capture.
- Root `LICENSE` using Apache-2.0.
- Initial acknowledgment file crediting Kokoro Local GUI inspiration without implying affiliation.
- Lint, type-check, unit-test, and gate-verification commands.

The status screen should show:

```text
Shared core: PASS
Storage write/read: PASS
FFmpeg: PASS
Transport: REST or IPC
Client: Web or Electron
```

### Automated checks

```bash
npm ci
npm run lint
npm run typecheck
npm test
npm run build
npm run verify:gate -- G01
```

Required tests:

- Shared service returns the same schema through REST and IPC.
- Runtime output is schema-validated.
- SQLite migration is idempotent.
- A value written by the service can be read back.
- FFmpeg is invoked without shell interpolation.
- Electron renderer has no unrestricted Node.js access.

### Historical human acceptance evidence: Web

1. Set a disposable data directory.
2. Start the server and Web development environment.
3. Open the status screen.
4. Run the local runtime self-test.
5. Verify that all four status lines report `PASS`.
6. Stop the server completely.
7. Start it again with the same disposable data directory.
8. Verify the diagnostic record created before restart still exists.

### Historical human acceptance evidence: Electron

1. Start the Electron development application.
2. Open the same status screen.
3. Run the self-test.
4. Verify that the client says `Electron` and transport says `IPC`.
5. Open renderer developer tools and confirm that direct Node primitives such as unrestricted `require` are not exposed.
6. Close and reopen the application; confirm the diagnostic record persists.

### Pass criteria

- Web and Electron both pass the self-test.
- Shared output schemas are identical apart from expected client/transport metadata.
- SQLite and FFmpeg work in both runtime paths.
- No domain product features are present yet.
- The chosen SQLite driver is explicitly approved for the rest of the project.

### Stop condition

Do not begin parser work until the reviewer accepts the runtime, storage driver, FFmpeg strategy, and Electron boundary.

---

## G02 — Script parser and canonical intermediate representation

### Goal

Prove that StudyNarrator understands its deterministic script language before any persistence or TTS behavior is added.

### Deliverables

- Versioned grammar and parser in the shared core package.
- Canonical intermediate representation schemas.
- Structured parse errors with line, column, code, offending text, and suggested correction.
- Exact diagnostic suppression input and an in-memory Script Lab ignore list; durable personal storage is deferred to G04.
- Inline pause and speaker control tokens that split speech at their exact source position; inline speaker state persists until the next speaker token.
- A stable system default speaker ID, `narrator`, so bare scripts remain valid while callers may still provide an override.
- Discovery summary for speakers, pauses, sections, and pronunciation annotations.
- A minimal Script Lab screen in the shared React UI.
- Original source remains byte-for-byte unchanged in parser output.
- Golden parser snapshots for the valid and invalid fixtures.

### Automated checks

Required parser tests include all cases from PRD Section 19.1 plus:

- Exact valid-fixture discovery counts.
- Stable output across repeated parsing.
- Unix and Windows line-ending equivalence.
- No timestamps or random IDs in deterministic parser output.
- Invalid fixture recovery and its remaining errors stay stable and line-specific.
- Bare one-line, multi-line, and large scripts produce narrator speech without missing-speaker diagnostics.

Run:

```bash
npm run verify:gate -- G02
```

### Historical human acceptance evidence

1. Open Script Lab in the Web UI.
2. Paste `study-guide-valid.txt`.
3. Select **Parse**.
4. Confirm the discovery summary shows:
   - 2 speakers.
   - 2 distinct pause IDs.
   - 2 sections.
   - 5 speech segments.
   - 4 explicit pause segments.
   - 2 pronunciation annotations.
5. Inspect the ordered node view and verify that it follows source order.
6. Confirm each node displays its source line.
7. Confirm the source editor text has not changed.
8. Paste a bare multi-line study guide with no directives and leave the override blank. Confirm it produces narrator speech without `MISSING_DEFAULT_SPEAKER` diagnostics.
9. Paste `study-guide-invalid.txt`.
10. Confirm `[speaker_1bad]` discovers `1bad`, both pause tokens emit pause nodes, and line 3 is split into speech, pause, and speech in source order.
11. Confirm line 5 splits at `[speaker_teacher]`, its trailing speech uses `teacher`, and a following plain line remains assigned to `teacher` until another speaker token.
12. Confirm both malformed sections and annotations receive blocking, line-specific errors and remain literal speech.
13. Ignore either repeated section or annotation pattern, confirm both matching errors disappear while all speech nodes remain, then restore the pattern.
14. Escape an inline pause as `\[pause_short]` and confirm it remains readable text without creating a pause node.

### Pass criteria

- All expected counts are correct.
- Node ordering and source locations are correct.
- Inline control tokens split speech correctly, and active-speaker state persists across lines.
- Bare scripts use `narrator`; explicit default overrides and speaker directives take precedence.
- Invalid syntax is diagnosed and retained as explicit literal speech, never misclassified as a speaker.
- Parsing the same input twice produces structurally identical output.
- The human reviewer agrees that error messages explain how to fix the source.

### Explicitly excluded

- Saving projects.
- Persisting ignored diagnostic preferences.
- Voice mappings.
- Pause duration configuration.
- Lexicon replacement.
- Speaches calls.

---

## G03 — Lexicon, named senses, and transcript transformation

### Goal

Prove that pronunciation corrections and automatic paragraph-pause decisions are deterministic while readable text remains separate from TTS text.

### Deliverables

- Global and project lexicon engines operating in memory.
- Exact terms, exact phrases, case rules, priorities, and deterministic tie-breaking.
- Named-sense resolution.
- Readable transcript generation.
- Transformed TTS transcript generation.
- Match audit showing which entry changed each span.
- Script Lab tabs for source, readable transcript, TTS transcript, and lexicon matches.
- A separate in-memory Transition settings panel with paragraph pauses enabled by default as `pause_medium` at 750 milliseconds.
- An ordered paragraph-pacing preview showing applied pauses and explicit-pause suppressions without generating audio.

### Automated checks

Required tests include PRD Section 19.2 and:

- Project entry overrides global entry.
- Longer exact phrase wins over a shorter exact term.
- No replacement inside directives.
- No replacement inside the display half of unresolved annotations.
- Original source object remains immutable.
- Match audit offsets correspond to the displayed source.
- Paragraph boundaries resolve at most once between neighboring speech nodes, while leading/trailing blanks do not create pauses.
- Explicit pauses suppress the automatic paragraph pause without altering authored pause nodes.
- Pacing changes invalidate stale worker results but do not alter source, CIR, transcripts, lexicon matches, or synthesis readiness.

Run:

```bash
npm run verify:gate -- G03
```

### Historical human acceptance evidence

1. Load the valid fixture.
2. Add the global `SQL → sequel` entry.
3. Add the two project named-sense entries for `resume`.
4. Parse and transform.
5. In the readable transcript, verify:
   - Both annotated words display as `resume`.
   - Both `SQL` occurrences display as `SQL`.
6. In the TTS transcript, verify:
   - CV sense becomes `rez-oo-may`.
   - Continue sense becomes `ree-zoom`.
   - Both whole-word `SQL` occurrences become `sequel`.
7. Open the match audit and confirm the source entry and rule are shown for each change.
8. Delete the `resume + cv` sense and rerun validation.
9. Confirm the unresolved annotation remains byte-for-byte literal in both transcripts and produces a source-linked, non-blocking warning rather than being guessed.
10. Ignore the warning and verify it moves to the shared session diagnostic list without changing either transcript; restore it, then restore the entry and verify the warning clears.
11. Confirm Transition settings shows **Pause at paragraph breaks** enabled as `pause_medium · 750 ms` and the canonical fixture's explicit pause suppresses its automatic paragraph boundary.
12. Analyze two bare paragraphs separated by blank lines and confirm one applied automatic pause appears in the pacing preview. Disable the checkbox, reanalyze, and confirm the preview reports that automatic paragraph pauses are disabled.
13. Copy the original source and compare it with the fixture; it must remain unchanged.

### Pass criteria

- Readable and TTS transcripts differ only where deterministic rules require it.
- Named senses never use context guessing.
- Every change has an inspectable reason.
- Missing senses remain literal, produce non-blocking warnings, and never disable synthesis-ready validation.
- Parser and transformation errors or warnings can be ignored and restored by exact code and pattern for the current session.
- Paragraph pacing is auditable, explicit pauses win, and pacing never rewrites parser or transformation output.

### Explicitly excluded

- Database persistence.
- Audio preview.
- Project UI beyond the validation lab.

---

## G04 — SQLite project persistence and migrations

### Goal

Prove that user work survives application restart and schema upgrades before the full editor depends on persistence.

### Deliverables

- SQLite schema and migration runner.
- Repository interfaces and shared application services for:
  - Projects.
  - Script source.
  - Speaker mappings.
  - Pause presets.
  - System pacing defaults and project-owned paragraph-pause configuration.
  - Personal ignored-diagnostic patterns.
  - Global lexicon entries.
  - Project lexicon entries.
  - Connection-profile placeholders without real connectivity behavior.
- Create, read, update, list, and delete operations through REST.
- Equivalent high-level IPC operations or contract tests for later Electron use.
- Database backup-before-migration behavior.
- Diagnostics showing schema version, effective data directory/database path, migration state, and latest retained backup.
- A dedicated Persistence Lab for restart and migration review; the approved G03 Script Lab remains memory-only until G05.
- A strict `db:migrate -- --data-dir <directory>` command that reports versions and backup location without project content.

### Automated checks

Required tests:

- Fresh database migration.
- Repeated migration is safe.
- Upgrade from a checked-in prior schema fixture.
- Failed migration leaves the original database recoverable.
- Failed startup enters a diagnostics-only state and rejects persistence operations with sanitized recovery guidance.
- Project deletion does not delete unrelated global entries.
- No secret values appear in logs or API responses.
- REST and IPC application-service schemas match.
- New projects copy the current system paragraph-pause enabled state and duration; later system edits do not mutate existing projects.

Run:

```bash
npm run verify:gate -- G04
```

### Historical human acceptance evidence

1. Reset the G04 disposable data directory.
2. Create a project named `Gate 04 Persistence`.
3. Paste the valid fixture.
4. Add the global SQL entry and both project resume senses.
5. Add speaker placeholders and pause values.
6. Confirm the project owns a copied `pause_medium = 750 ms` preset and enabled paragraph transition.
7. Save the project.
8. Stop every application process.
9. Restart the Web application with the same data directory.
10. Open the project and verify every saved value.
11. Change the system paragraph duration, create another project, and confirm only the new project receives the new value.
12. Change one project pause duration, restart again, and confirm the override persists.
13. Duplicate or back up the database, then run the migration command again.
14. Confirm the schema version remains correct and no duplicate records appear.
15. Delete the project and confirm the global SQL entry still exists.
16. Confirm the Persistence Lab accepts no credentials and makes no Speaches, TTS, render, or external network calls.

### Pass criteria

- All project data survives two full restarts.
- Migrations are idempotent and backed up.
- Project-scoped deletion respects ownership boundaries.
- The human reviewer can identify the actual data directory from diagnostics.

---

## G05 — Project authoring, discovery, configuration, and dry run

### Goal

Deliver the first coherent StudyNarrator workflow without audio: create a project, paste or upload a script, configure discovered items, validate it, and inspect the exact render-ready sequence.

### Deliverables

- Project list and project editor.
- Paste and `.txt` upload.
- Automatic parsing on source changes with debouncing.
- Speaker discovery and voice-ID mapping fields.
- Pause discovery and duration fields.
- A System Settings **Pacing defaults** area for the new-project paragraph-pause enabled state and duration.
- Project transition controls initialized from, but independent of, those system defaults.
- Section list.
- Pronunciation workbench using persisted lexicons.
- Validation summary with blocking errors and warnings.
- Dry-run ordered segment table.
- Offline operation with no Speaches dependency.
- Unsaved-change warning.

A voice field may accept a manual raw voice ID in this gate. Live catalog validation belongs to G06.

### Automated checks

Required tests:

- Upload and paste produce equivalent source.
- Auto-discovered items are stable across reload.
- Pause values normalize from milliseconds and seconds.
- Invalid or missing mappings block render-ready status.
- Dry run does not call the mock Speaches server.
- Explicit pauses suppress duplicate automatic transition pauses according to the PRD.
- System pacing defaults apply to projectless analysis and are copied, not live-linked, when a project is created.
- Original, readable, and TTS text remain separately accessible.

Run:

```bash
npm run verify:gate -- G05
```

### Historical human acceptance evidence

1. Disconnect or stop Speaches to prove offline operation.
2. Create a project and upload the valid fixture.
3. Verify the application discovers both speakers and both pause IDs.
4. Assign placeholder voice IDs to `teacher` and `student`.
5. Set:

```text
pause_short = 350 ms
pause_medium = 750 ms
pause_long  = 1.5 s
```

6. Confirm **Pause at paragraph breaks** is enabled and points to `pause_medium`.
7. Change the System Settings paragraph duration, create a second project, and confirm the first project remains at 750 ms while the second receives the new default.
8. Add the canonical lexicon entries.
9. Run validation.
10. Confirm the project reports no blocking deterministic errors.
11. Open Dry Run and verify the source order, speakers, pauses, sections, readable text, and transformed text.
12. Clear the `student` voice mapping and rerun validation.
13. Confirm rendering becomes blocked and the error identifies `student`.
14. Restore the mapping.
15. Enter `-1 s` for a pause and confirm it is rejected.
16. Enter `0 s` and confirm it is accepted.
17. Reload the browser and verify the project remains intact.

### Pass criteria

- A project can become deterministically render-ready while Speaches is offline.
- Missing mappings and invalid durations are caught before synthesis.
- Dry Run makes the future audio order understandable to the reviewer.
- Network logs or mock counters show zero TTS requests.

### Milestone

**Deterministic Authoring Prototype.** At this point the non-audio product can be evaluated before any more infrastructure is added.

---

## G06 — Speaches connection profiles and diagnostics

### Goal

Prove the external service boundary independently of normal synthesis workflows. Connection errors must be precise enough that the user knows whether the problem is the URL, network, authentication, model, voice, or returned audio.

### Deliverables

- Connection-profile create, edit, list, test, and delete behavior.
- Root URL and `/v1` normalization.
- Optional API-key handling confined to Node/Electron privileged processes.
- Fake Speaches server with selectable scenarios and request logging.
- Diagnostic stages for:
  - URL parsing.
  - DNS or host resolution where available.
  - TCP/HTTP reachability.
  - Authentication.
  - Model request.
  - Voice request.
  - Audio response validity.
- Redacted diagnostics export.
- Official Speaches installation and TTS documentation links.
- Environment-managed settings shown as locked in the Web UI.

### Automated checks

G06 establishes the automation baseline for the current application. The fake server must cover:

- Healthy response.
- Connection refused.
- Timeout.
- Unauthorized response.
- Missing model.
- Rejected voice.
- Empty body.
- Invalid content type.
- Root and `/v1` URL inputs.
- API key never returned to the browser or logs.

Required repository commands:

```bash
npm run test:api
npm run test:e2e:web
npm run test:e2e:electron
npm run test:e2e
```

The API suite must use explicit manifests covering all 27 current REST operations, every public typed IPC channel, and every System, Persistence, Connections, Setup, and Voice Catalog service method. A route, channel, or service added or removed without a corresponding contract case must fail the suite. Tests cover successful schemas, input validation, expected policy and availability failures, persistence, credential compensation, environment locking, catalog fallback/replacement, and sanitized errors.

Playwright must run the built applications against dynamic loopback ports and a unique disposable data directory per test. Chromium Web acceptance covers:

- Shell navigation, runtime diagnostics, onboarding, and offline recovery.
- Script Lab parsing, transformations, pacing, warnings, and source preservation.
- Persistence Lab validation, CRUD, reload, and deletion.
- Projects creation, autosave/reload, configuration, catalog and manual voices, and deterministic Dry Run.
- Settings pacing, profile CRUD, environment locking, catalog replacement, staged diagnostics, shell states, and redacted export.
- Healthy and failing fake-Speaches scenarios, root and `/v1` normalization, and proof that project editing and Dry Run make no TTS request.
- Keyboard traversal, mobile viewport overflow, and announced state transitions.

Focused Electron acceptance uses Playwright's Electron launcher with a separate data directory and one worker. It covers IPC transport, route access, persistence across relaunch, narrow preload exposure, one-shot credential behavior, and approved external-link handling. Locators use semantic roles and labels, fixed sleeps are forbidden, and failures retain screenshots and traces in ignored artifact directories. No production test-reset endpoint may be added.

Run:

```bash
npm run verify:gate -- G06
```

### Human UX review

Only after `verify:gate -- G06` is green, use the copy-ready checklist in `docs/gates/G06-manual-test.md`. Review visual hierarchy, understandable connection-state language, keyboard focus visibility, responsive layout, perceived diagnostic timing, and Electron's OS-native credential and external-link interactions. A real Speaches server may be used to assess recovery feel, but it is not the first functional validation. Any functional finding must receive a Playwright or API regression test before G06 can be approved.

### Pass criteria

- Each simulated failure is classified correctly.
- The fake and adapter boundary can disconnect and reconnect without restarting StudyNarrator; optional real-server review may confirm the same recovery feel.
- No API key reaches browser-visible state or redacted exports.
- Connection testing does not create or modify a project.
- All current user-facing routes have Playwright acceptance coverage.
- Every current REST operation, public IPC channel, and application service method appears in its manifest-driven suite.
- The cumulative verifier finishes with `GATE G06: AUTOMATED CHECKS PASSED` before human UX review begins.

---

## G07 — Quick Scratchpad and first audible output

From G07 onward, every numbered workflow under a **Playwright acceptance** heading is an automated requirement, not a functional manual checklist. Each gate updates those workflows in the same checkpoint whenever UI behavior or its access path changes. Human review is listed separately and is restricted to UX judgment; listening remains human only when audio perception is the quality being judged.

### Goal

Produce the first end-to-end user-audible result through StudyNarrator while keeping the workflow intentionally limited to one short request.

### Deliverables

- Quick Scratchpad screen.
- Connection, model, voice, and speed selection.
- Optional global lexicon application.
- Original and transformed text display.
- Single synthesis request through the shared Speaches adapter.
- Temporary audio result and basic play, pause, replay, and volume controls.
- Scratchpad history limited to local temporary results.
- Clear error and retry behavior.
- No project mutation.

### Automated checks

- Mock request has the expected model, voice, speed, and transformed text.
- Cancellation before request completion leaves no valid result record.
- Invalid audio cannot be played or marked complete.
- Scratchpad does not write project tables.
- API key remains privileged.
- Repeated request behavior is explicitly defined; cache reuse is not required until G08.

Run:

```bash
npm run verify:gate -- G07
```

### Playwright acceptance: Scratchpad workflow

Run against the deterministic fake Speaches server:

1. Open Scratchpad with a healthy connection profile.
2. Enter:

```text
SQL indexes can improve database reads.
```

3. Enable the global lexicon.
4. Confirm transformed text shows `sequel` while the entered text remains `SQL`.
5. Select a known voice and synthesize.
6. Start playback and assert the player reaches its playing and completed states.
7. Assert the request log contains the complete transformed sentence and selected voice ID.
8. Change the voice and synthesize again; assert the request uses the new voice and the player exposes the new result.
9. Enter a deliberately bad voice ID and confirm the error is actionable.
10. Open an existing project before and after Scratchpad use; confirm it is unchanged.
11. Switch the fake server to unavailable, attempt synthesis, and confirm the typed text remains available for retry.

### Human audio UX review

After automation passes, synthesize the fixed sentence with real Speaches and judge only intelligibility, voice distinction, playback controls, and perceived response timing.

### Pass criteria

- One real speech result is understandable and playable.
- Selected voice and lexicon transformation are honored.
- A failed request preserves user input.
- Project state remains unchanged.

### Milestone

**First Audible MVP.** The product now proves its external-service and playback path before full rendering is attempted.

---

## G08 — Segment preview and content-addressed cache

### Goal

Prove that an individual project segment can be previewed and that identical synthesis inputs reuse valid audio while relevant changes invalidate only the correct cache entry.

### Deliverables

- Preview action from Dry Run and pronunciation workbench.
- Stable cache-key algorithm covering model, voice, speed, transformed text, and relevant synthesis settings.
- Cache metadata and integrity validation.
- Cache hit/miss indication.
- Request counter in the fake server and diagnostic development view.
- Safe cache cleanup operation.
- No final MP3 assembly yet.

### Automated checks

- Same synthesis inputs produce the same key.
- Text, voice, model, or speed changes produce a different key.
- Pause-only and output-metadata changes do not change speech keys.
- Corrupt or missing cache files are misses.
- Concurrent requests for the same key do not duplicate synthesis.
- Cache metadata never treats a partial file as complete.

Run:

```bash
npm run verify:gate -- G08
```

### Playwright acceptance: fake-server request accounting

1. Reset the G08 cache and fake-server request counter.
2. Preview the first speech segment.
3. Confirm one TTS request and a cache miss.
4. Preview the same segment again.
5. Confirm zero additional TTS requests and a cache hit.
6. Change `pause_short` only and preview the speech again.
7. Confirm zero additional TTS requests.
8. Change one word in that speech segment and preview again.
9. Confirm exactly one additional request.
10. Restore the original sentence and confirm the original cached audio is reusable.
11. Change the speaker’s voice and confirm one new request.
12. Have the isolated fixture corrupt the cached test file, then preview again.
13. Confirm StudyNarrator rejects the corrupt file and synthesizes a replacement.

### Human audio UX review

Repeat selected cases against real Speaches and confirm the cached replay is the same audio rather than a newly generated variation.

### Pass criteria

- Request counts exactly match the expected cache behavior.
- Relevant changes invalidate only relevant speech.
- Corrupt or incomplete cache entries are never accepted.
- Preview remains an isolated segment operation.

---

## G09 — Frozen render plan and exact silence generation

### Goal

Prove the full ordered render plan and exact pause assets before combining them with TTS generation.

### Deliverables

- Versioned project snapshot created when a render is requested.
- Immutable render plan derived from the snapshot.
- Ordered speech, pause, and section entries.
- Cache-state prediction for speech entries.
- Exact-duration PCM silence generation.
- Automatic paragraph, speaker-change, and section pauses according to configuration.
- Explicit-pause precedence preventing duplicate silence.
- Render-plan JSON artifact.
- No full render queue and no MP3 assembly yet.

### Automated checks

- Editing a project after snapshot creation does not mutate the plan.
- Same snapshot yields the same plan.
- Explicit adjacent pauses suppress automatic duplicates.
- The project snapshot freezes its paragraph-pause enabled state, preset ID, and effective duration independently of later System Settings changes.
- The starter paragraph pause produces exact 750-millisecond PCM silence when not overridden.
- Zero-duration pauses are represented without an invalid audio file.
- Silence metadata and decoded duration match configuration within a strict PCM tolerance.
- Plan references source lines and transformation audits.

Run:

```bash
npm run verify:gate -- G09
```

### Playwright acceptance

1. Open the canonical project and create a render plan.
2. Inspect the plan and verify sections, speech, and explicit pauses follow source order.
3. Confirm `pause_short` entries are 350 ms, automatic `pause_medium` paragraph entries are 750 ms, and `pause_long` is 1,500 ms.
4. Edit the project’s `pause_long` value after the plan is created.
5. Reopen the existing plan and confirm it still contains the frozen old value.
6. Create a new plan and confirm it contains the new value.
7. Enable an automatic speaker-change pause while leaving explicit pauses in the script.
8. Verify the plan does not insert duplicate pauses at explicit handoffs.
9. Set one pause to zero and confirm the plan remains valid without producing audible silence.
10. Inspect the surfaced duration metadata; the service contract independently verifies generated files with FFprobe.

### Human UX review

Review whether the render-plan hierarchy, frozen-versus-current values, and pacing labels are understandable without consulting raw JSON.

### Pass criteria

- Render plans are immutable snapshots.
- Silence duration is exact at the PCM level.
- Automatic and explicit pacing rules do not double-count.
- No TTS requests occur in this gate.

---

## G10 — Deterministic FFmpeg assembly from fixed audio

### Goal

Prove lossless intermediate assembly, final MP3 encoding, ordering, duration, decodability, and bounded-memory behavior without involving Speaches.

### Deliverables

- Audio fixture generator.
- FFmpeg assembly-plan builder.
- Safe subprocess runner with cancellation and captured diagnostics.
- Lossless intermediate output.
- Final MP3 encoding.
- FFprobe validation.
- Assembly manifest with component order and timestamps.
- Automated memory-behavior test using a long synthetic fixture.

### Automated checks

- The 3.850-second fixture assembles in the correct order.
- Final duration remains within documented tolerance.
- No component is omitted or duplicated.
- Output decodes successfully.
- Timeline timestamps are monotonic.
- User-controlled paths and metadata are passed as arguments, never interpolated into a shell command.
- Long assembly does not accumulate complete decoded audio in the Node or renderer heap.
- Cancellation removes or clearly marks incomplete final artifacts.

Run:

```bash
npm run fixtures:audio
npm run verify:gate -- G10
```

### Playwright acceptance

1. Open the deterministic assembly fixture through the application workflow.
2. Start assembly and assert that progress and completion states are announced.
3. Start the final MP3 and assert the player reaches playing and completed states.
4. Verify the displayed duration is approximately 3.850 seconds within tolerance.
5. Open the assembly manifest and confirm the four components and monotonic timestamps.
6. Start the long synthetic assembly and confirm the UI remains responsive while the backend memory contract enforces its bound.
7. Cancel an assembly and confirm no incomplete file is displayed as a successful artifact.

### Human audio UX review

Listen to the deterministic fixture and judge only tone order, the perceptible short and long gaps, clicks, clipping, and player responsiveness. FFprobe correctness and bounded memory remain automated requirements.

### Pass criteria

- The deterministic fixture is audibly and numerically correct.
- FFprobe validates the output.
- Memory behavior meets the documented threshold.
- Cancellation cannot create a false success.

---

## G11 — Full render orchestration and artifact bundle

### Goal

Connect project snapshots, cache, Speaches requests, silence, FFmpeg assembly, progress, cancellation, retry, and final artifacts into the complete core Web workflow.

### Deliverables

- Persisted single-worker render queue.
- Render status and progress events.
- Per-segment state.
- Cache reuse and missing-segment synthesis.
- Exact silence generation.
- Lossless assembly and MP3 output.
- Cancellation between requests and during FFmpeg work.
- Retry and interrupted-job recovery.
- Artifact bundle containing:
  - Original script.
  - Readable transcript.
  - TTS transcript.
  - Project snapshot.
  - Render plan or manifest.
  - Final MP3.
  - Checksums.
- Artifact validation before completion is recorded.
- Detailed errors associated with the failing segment.

### Automated checks

Use the fake server for deterministic request counts and failure injection:

- Full successful render.
- Identical rerender produces zero new TTS requests.
- Pause-only change produces zero new TTS requests.
- One-sentence change requests only affected speech chunks.
- Failure at a selected segment preserves completed chunks.
- Retry resumes from valid completed chunks.
- Cancellation leaves a recoverable job state.
- Restart detects interrupted jobs.
- Final checksum and manifest refer to existing validated files.

Run:

```bash
npm run verify:gate -- G11
```

### Playwright acceptance: deterministic mock workflow

1. Reset render data, cache, and fake-server counter.
2. Render the canonical project.
3. Confirm the progress display identifies phase, section, segment, speaker, and cache status.
4. Confirm the completed artifact bundle contains every required file.
5. Render the unchanged project again.
6. Confirm zero new TTS requests and a successful new assembly.
7. Change only `pause_long` and render again.
8. Confirm zero new TTS requests and a different final duration.
9. Change one sentence and render again.
10. Confirm only that affected speech cache key is requested.
11. Configure the fake server to fail on a later segment.
12. Start a render, observe the segment-specific failure, restore healthy mode, and retry.
13. Confirm completed earlier segments are reused.
14. Start another render and cancel it.
15. Restart StudyNarrator and confirm the interrupted job is offered for recovery or cleanup.

### Human audio UX review: real listening workflow

1. Render the canonical project through the real Speaches server.
2. Listen to the entire MP3.
3. Confirm:
   - Teacher and student use the configured voices.
   - `resume` senses sound distinct.
   - `SQL` follows the lexicon.
   - Short and long pauses are perceptibly different.
   - Sections occur in the right order.
   - There are no obvious clicks, missing words, duplicate sentences, or clipped transitions.
4. Judge progress timing, transition quality, and whether retry/cancellation states feel trustworthy. Transcript and checksum correctness remain automated requirements.

### Pass criteria

- The complete study guide is understandable and correctly ordered.
- Mock request counts prove selective rerendering.
- Failed and cancelled jobs never masquerade as complete.
- Artifact bundle and checksums are internally consistent.

### Milestone

**Complete Functional Web Alpha.** The core StudyNarrator workflow now exists before waveform polish, exports, and packaging.

---

## G12 — Waveform player and segment-level render history

### Goal

Add the practical review tools inspired by Kokoro Local GUI while preserving StudyNarrator’s independent React/Node implementation and explicit attribution.

### Deliverables

- Shared player with play, pause, stop, replay, volume, mute, elapsed time, and duration.
- Compact downsampled waveform with pointer seeking.
- Keyboard-accessible seek control and fallback progress bar.
- Expandable render-history entries.
- Child rows in manifest order.
- Per-segment:
  - Play existing audio.
  - Copy readable text.
  - Copy transformed TTS text.
  - Export audio explicitly.
  - Navigate to source.
- Clear unavailable state when temporary segment audio has been cleaned.
- No hidden rerender when a file is unavailable.
- About/Credits view containing the planned upstream acknowledgment.

### Automated checks

- Waveform peak data is bounded and downsampled.
- Seeking updates playback position.
- Keyboard seeking works.
- Segment play makes no TTS request.
- Copy actions return the correct representation.
- Segment export writes only the selected audio.
- Missing audio displays unavailable state and an explicit regeneration choice.
- History ordering matches the manifest.
- Credits text is present in release builds.

Run:

```bash
npm run verify:gate -- G12
```

### Playwright acceptance

1. Open a completed real render.
2. Play the final MP3 using the shared player.
3. Click several waveform locations and confirm playback seeks accordingly.
4. Repeat seeking using only the keyboard.
5. Expand the render history.
6. Play a middle speech segment and confirm only that segment plays.
7. Observe the fake-server or diagnostics counter and confirm no synthesis request occurs.
8. Copy readable text and TTS text from a segment containing `SQL`; confirm the two copied values differ appropriately.
9. Export one segment and play the exported file separately.
10. Use **Go to source** and confirm the editor focuses the corresponding source line.
11. Run the safe temporary-cache cleanup.
12. Reopen history and confirm removed audio is clearly marked unavailable rather than regenerated.
13. Open About/Credits and verify the independent-project disclaimer and contributor kudos.

### Human UX review

Judge waveform legibility, pointer and keyboard seeking feel, control discoverability, copied-text feedback, and unavailable-audio messaging. Listen only to assess seek responsiveness and segment boundaries; request accounting remains automated.

### Pass criteria

- Review actions operate on existing artifacts only.
- Waveform seeking works with pointer and keyboard.
- Missing files are handled honestly.
- Attribution is visible and accurate.

---

## G13 — External-LLM prompt and skill export

### Goal

Complete the script-generation workflow without embedding or calling an LLM inside StudyNarrator.

### Deliverables

- Universal prompt builder.
- Dynamic speaker roles, pause definitions, section syntax, pronunciation aliases, and source material.
- Prompt preview, copy, and file export.
- Reusable skill/instruction package export.
- Example generated script.
- Secret and machine-specific value exclusion.
- Version metadata for exported instructions.

### Automated checks

- Same inputs produce stable prompt content.
- Prompt includes only configured speakers, pauses, aliases, and source.
- Prompt never includes Speaches API keys, local data paths, or private connection URLs.
- Exported script-format instructions match the supported grammar version.
- Skill package contains required files and valid metadata.
- Offline export works with Speaches unavailable.

Run:

```bash
npm run verify:gate -- G13
```

### Playwright acceptance

1. Stop Speaches.
2. Open the canonical project.
3. Export the universal prompt.
4. Confirm it includes:
   - `teacher` and `student` roles.
   - `pause_short` and `pause_long` descriptions.
   - Section syntax.
   - Named pronunciation aliases.
   - The source study material.
5. Search the export for the API key, server URL, and local data directory; none may appear.
6. Feed the exported prompt to the fixed external-LLM response fixture; StudyNarrator itself must make no LLM request.
7. Paste the fixture response into a new StudyNarrator project.
8. Run parsing and validation and assert the supported grammar succeeds.
9. Paste the malformed-response fixture and assert the parser surfaces actionable grammar feedback.
10. Export the reusable skill package and validate its download, metadata, and required files.

### Human UX review

Judge prompt-preview readability, copy/download feedback, secret-warning clarity, and the ease of moving content between StudyNarrator and an external tool. Export content and offline behavior are already contract-tested.

### Pass criteria

- Prompt and skill exports work offline.
- No secrets or machine-specific connection values leak.
- At least one external-LLM round trip produces a script that can be corrected and validated using the documented grammar.
- The product itself made no LLM network request.

---

## G14 — Production Docker Web distribution

### Goal

Package the approved Web workflow as a production application-only Docker deployment that connects to external Speaches and preserves data across recreation.

### Deliverables

- Multi-stage production Dockerfile.
- Non-root runtime user.
- Compiled React assets served by Node/Express.
- Bundled or installed FFmpeg using a license-compatible strategy.
- Application-only `compose.yaml`.
- `.env.example`.
- Persistent `/data` volume.
- Default bind address `127.0.0.1`.
- Optional Linux `host.docker.internal` host-gateway mapping.
- Health check and startup diagnostics.
- Setup instructions for same-host and private-network Speaches.
- Image metadata, license, acknowledgment, and source revision.

### Automated checks

- Image builds from a clean checkout.
- Container runs as non-root.
- Health endpoint succeeds without Speaches.
- Compose service list contains only StudyNarrator.
- Data persists across container recreation.
- Wrong Speaches endpoint does not create a restart loop.
- Browser never receives an API key.
- Image scan and dependency/license inventory meet the project’s documented threshold.

Run:

```bash
npm run verify:gate -- G14
```

### Playwright acceptance: Chromium and Firefox

The gate harness builds the image, asserts the Compose service list contains only StudyNarrator, verifies non-root execution and loopback binding, and launches the container with isolated data. Chromium and Firefox then run the same workflow:

1. Open the production Web UI and run diagnostics against fake Speaches.
2. Create the canonical project and complete a deterministic render.
3. Recreate the container without deleting its disposable volume and confirm the project and render history remain.
4. Relaunch with an invalid Speaches URL and confirm StudyNarrator stays healthy and offline authoring works.
5. Restore the healthy URL and reconnect without deleting application data.
6. On Linux CI, verify the supplied host-gateway configuration against loopback fake Speaches.
7. Assert from an isolated network probe that the default configuration is not reachable beyond loopback.

### Human UX review

Review production page loading, responsive behavior, perceived reconnect timing, and the clarity of container-specific setup guidance. Functional persistence, networking, and browser parity must already be green.

### Pass criteria

- Production Docker Web behavior matches the approved development behavior.
- Persistence survives recreation.
- Speaches remains external.
- Default network exposure is local only.
- Offline authoring remains available.

### Milestone

**Docker Web Beta.** This is the first distribution suitable for sustained personal use while desktop packaging continues.

---

## G15 — Electron functional integration and native desktop behavior

### Goal

Run the approved shared application through Electron’s secure main/preload/renderer boundary and add desktop-native file behavior without duplicating domain logic.

### Deliverables

- Production React renderer in Electron.
- Typed, validated high-level IPC operations corresponding to application services.
- No unrestricted filesystem, process, database, or network primitives in the renderer.
- Operating-system application-data directory.
- Native `.txt` open and drag/drop.
- Native artifact save/export.
- **Show in folder**.
- External documentation links restricted to approved HTTPS destinations.
- Connection settings and credential-store integration where available.
- Clean shutdown and interrupted-render recovery.
- Development package for the reviewer’s current operating system.

### Automated checks

- IPC input and output validation.
- Renderer sandbox and context isolation configuration.
- Direct Node access unavailable to renderer code.
- Parser and transformation results match Web outputs for the same fixture.
- Native file operations remain within explicit user selections.
- Connection secrets do not enter renderer state.
- Closing during a render produces a recoverable state.

Run:

```bash
npm run verify:gate -- G15
```

### Playwright acceptance: Electron

1. Launch the Electron application in development mode.
2. Import the valid fixture using the native file dialog.
3. Repeat through drag-and-drop.
4. Configure and dry-run the project.
5. Compare the dry-run manifest hash or normalized JSON with the Web result; it must match.
6. Configure the real Speaches profile.
7. Run Scratchpad and a full project render.
8. Export the MP3 through a native save dialog.
9. Use **Show in folder**.
10. Stop Speaches and confirm authoring remains usable.
11. Restart Speaches and reconnect without restarting Electron.
12. Begin a render, close the application, reopen it, and verify recovery handling.
13. Open developer tools and verify no unrestricted Node API is available to renderer scripts.
14. Open the official setup link and verify it uses the system browser and an approved HTTPS destination.

### Human UX review

Judge native dialog clarity, drag/drop affordance, OS credential prompts, show-in-folder behavior, shutdown feel, and whether long work keeps the desktop UI perceptibly responsive. IPC, persistence, security, and recovery behavior must already pass Playwright.

### Pass criteria

- Electron and Web produce equivalent deterministic project outputs.
- Desktop-native actions work without exposing raw privileged APIs.
- Secrets remain outside renderer state.
- Render work does not freeze the UI.

---

## G16 — Cross-platform packages and clean-install release matrix

### Goal

Prove that installable Electron packages work on supported Windows, macOS, and Linux environments. A successful cross-compilation build alone is not sufficient approval.

### Deliverables

- Windows package.
- macOS package.
- Linux package.
- Checksums.
- Clear signed, notarized, or unsigned status for each artifact.
- Installation and uninstall instructions.
- Per-platform test record.
- Upgrade test from an earlier package fixture.
- Accurate application version, schema version, and source revision in diagnostics.

### Automated checks

- CI produces all intended artifacts.
- Artifact names and checksums are deterministic enough for release tracking.
- Packages contain required license and acknowledgment files.
- Smoke launch runs in clean test environments.
- No development server or source checkout is required.
- Upgrade preserves compatible application data.

### Playwright acceptance matrix

For each operating system, CI or a release runner installs the package into a clean VM or clean user account and records:

1. OS and version.
2. CPU architecture.
3. Installer/package filename and checksum.
4. Install result.
5. First launch result.
6. Diagnostics result.
7. Offline project creation and parsing.
8. Real or mock Speaches connection.
9. Scratchpad playback.
10. Full fixture render.
11. Native file import and export.
12. Show-in-folder behavior.
13. Application restart and persistence.
14. Upgrade result.
15. Uninstall result and whether user data was intentionally retained.

The matrix uses Playwright Electron for every automatable renderer/IPC workflow and platform harness assertions for installer, show-in-folder, upgrade, and uninstall behavior. Each row retains traces, screenshots, package logs, and checksums on failure.

### Human UX review

On each advertised platform, review native visual integration, accessibility feel, installer messaging, security prompts, perceived launch timing, and OS-specific interaction quality only after its automated matrix row is green.

### Pass criteria

- Every advertised operating system has actual clean-environment automated launch and workflow evidence plus its UX review record.
- Build success without launch evidence is marked unverified and cannot be advertised as supported.
- Package signing status is accurate and not implied.
- Clean install and upgrade both preserve expected behavior.

### Stop condition

Do not publish a three-platform V1 claim until all three rows of the matrix are approved. It is acceptable to publish a clearly labeled platform-specific beta earlier.

---

## G17 — Version 1 release acceptance

### Goal

Run the complete release candidate through a final regression and human listening workflow. This gate adds no features.

### Deliverables

- Release candidate commit.
- Complete automated test report.
- Docker artifact and desktop artifacts.
- Checksums.
- Apache-2.0 license and third-party notices.
- About/Credits view.
- Release notes.
- Known-issues list.
- Backup and upgrade instructions.
- Final approval record.

### Automated checks

Run the complete repository suite, not only a gate subset:

```bash
npm ci
npm run lint
npm run typecheck
npm test
npm run test:e2e
npm run build
npm run verify:gate -- G17
```

Required final checks include:

- Canonical parser snapshot.
- Lexicon snapshot.
- Persistence migration suite.
- Mock-Speaches failure matrix.
- Cache request-count suite.
- Audio assembly duration and memory suite.
- Render recovery suite.
- Chromium, Firefox, and WebKit browser end-to-end suites.
- Electron IPC/security suite.
- Docker production smoke suite.
- Package metadata and license checks.

### Playwright end-to-end acceptance

Perform the following once in the Docker Web distribution and once in an approved Electron package:

1. Start with a new disposable data directory.
2. Configure a real Speaches profile.
3. Create a project.
4. Import the canonical fixture.
5. Configure two distinct voices.
6. Set short and long pauses.
7. Add the canonical lexicon entries.
8. Validate and inspect Dry Run.
9. Preview one segment twice and confirm cache reuse.
10. Render the full project.
11. Start the complete MP3 and assert the player reaches playing and completed states.
12. Inspect waveform and segment history.
13. Copy readable and TTS text from the SQL segment.
14. Export one segment.
15. Change only the long pause and rerender; confirm no new speech requests.
16. Change one sentence and rerender; confirm only affected speech is requested.
17. Export an LLM prompt and verify it contains no secret.
18. Stop Speaches and verify offline authoring.
19. Restart the application and verify persistence.
20. Verify output checksums.
21. Open About/Credits and review the license and acknowledgment.

### Human audio UX review

The reviewer explicitly answers yes or no:

- Are all words present in the correct order?
- Are the two speakers distinguishable?
- Are the CV and continue senses of `resume` audibly different?
- Is `SQL` pronounced according to the lexicon?
- Is the short pause noticeably shorter than the long pause?
- Are section transitions easy to follow?
- Are there clicks, clipping, repeated words, missing words, or unnatural truncation?
- Does the final MP3 play in at least one external player, not only StudyNarrator?

### Pass criteria

- All automated suites pass.
- Docker and Electron end-to-end tests pass.
- Every advertised desktop platform has G16 evidence.
- The listening checklist has no unresolved blocking failures.
- Known limitations are documented honestly.
- The reviewer explicitly approves the release.

### Milestone

**StudyNarrator Version 1.0 approved.**

---

## 8. Human approval record template

Create one record per gate in the pull request description or under `docs/gates/approvals/`:

```markdown
# Gate GXX Approval

- Commit SHA:
- Pull request:
- Reviewer:
- Review date:
- Operating system:
- Node version:
- Browser or Electron package:
- Data directory used:
- Speaches endpoint type: mock / localhost / LAN
- Speaches model:
- Voice IDs:

## Automated results

- Unit and service tests: PASS / FAIL
- REST route manifest: PASS / FAIL / N/A
- IPC channel manifest: PASS / FAIL / N/A
- Playwright Web acceptance: PASS / FAIL / N/A
- Playwright Electron acceptance: PASS / FAIL / N/A
- `npm run verify:gate -- GXX`: PASS / FAIL
- Report or CI link:

## Human UX review

- Automation was green before review: YES / NO
- Visual quality and responsive behavior: PASS / FAIL / N/A
- Accessibility feel and keyboard flow: PASS / FAIL / N/A
- Perceived timing and state feedback: PASS / FAIL / N/A
- Audio perception, when applicable: PASS / FAIL / N/A
- OS-native interactions, when applicable: PASS / FAIL / N/A
- Functional findings and regression-test links: None / links

## Evidence

- Screenshots:
- Playwright reports, traces, and screenshots:
- API/IPC/service manifest output:
- Optional audio or package artifacts:
- Logs or diagnostics:

## Defects found

- None / issue links

## Known non-blocking limitations

- None / details

## Decision

APPROVED / REJECTED — CHANGES REQUIRED / APPROVED WITH DOCUMENTED DEFERRED ISSUE

## Reviewer notes

...
```

---

## 9. Reusable implementation prompt for an AI coding agent

Use this prompt separately for each gate. Replace the gate number and attach the relevant gate section plus the PRD.

```text
Implement StudyNarrator Gate GXX only.

Authoritative documents:
1. StudyNarrator PRD v1.3.
2. StudyNarrator Gate-Driven Implementation Plan, Gate GXX.

Rules:
- Before changing code, confirm GXX is the first unchecked gate in the Section 6 progress checklist.
- Confirm every lower-numbered gate is checked and has both an approval record and a matching approved tag. If either condition fails, stop and report the mismatch instead of implementing GXX.
- Do not begin or scaffold later gates.
- Do not implement another gate in parallel with GXX.
- Do not add hidden future features.
- Preserve all previously approved gate behavior.
- Use shared TypeScript domain/application services; do not duplicate behavior in REST and Electron transports.
- Add or update unit and manifest-driven contract tests for every changed application service method, REST route, and typed IPC channel.
- Add or update Playwright acceptance for every added or changed user-facing route, workflow, navigation path, dialog, or access method in the same checkpoint. Use semantic roles and labels; use a test ID only when no stable accessible locator exists.
- Cover happy paths, validation, expected failures, persistence/reload, and security/redaction wherever applicable.
- Extend `npm run verify:gate -- GXX` so it runs the API contracts, relevant Web and Electron Playwright projects, builds, smoke checks, and all prior regressions.
- Provide a short UX-only human checklist. Human review must not be the first functional validation.
- Use disposable test data and never commit secrets.
- Do not modify the PRD unless a contradiction makes implementation impossible. Document any such contradiction instead.
- Stop after the gate deliverables are complete.

At completion, report:
1. Files changed.
2. Architecture decisions made.
3. Automated commands run and their results.
4. Playwright workflows and the UX-only human review checklist.
5. Known limitations confined to this gate.
6. Confirmation that no later-gate work was added.
```

---

## 10. Reusable review prompt for a second AI or human reviewer

```text
Review StudyNarrator Gate GXX against its gate specification and the PRD.

Do not reward extra features. Treat out-of-scope later-gate work as a review concern.

Before reviewing implementation, confirm GXX is the first unchecked gate in the Section 6 progress checklist and that every lower-numbered gate is checked with a matching approval record and approved tag. If not, stop and report the sequencing violation.

Check:
- Every required deliverable exists.
- Every functional pass criterion is covered by automated evidence; human evidence is limited to UX judgment.
- Previously approved behavior still passes.
- Shared domain logic is not duplicated across transports.
- User content and secrets are not leaked.
- Errors are honest and actionable.
- The implementation can be reverted as one gate.
- Every changed route, workflow, navigation path, dialog, REST operation, IPC channel, and application service appears in its required automated suite.
- The UX checklist avoids re-testing functionality and starts only after focused tests and the cumulative verifier pass.

Return:
1. Blocking findings.
2. Non-blocking findings.
3. Missing tests.
4. Scope creep.
5. Approval recommendation: approve or reject.
```

---

## 11. Handling a failed gate

When any pass criterion fails:

1. Mark the gate `REJECTED — CHANGES REQUIRED`.
2. Leave its Section 6 progress checkbox unchecked so it continues to block every later gate.
3. Record the exact failing test and environment.
4. Fix only the current gate or a regression it introduced.
5. Add an automated regression test for every functional failure, including any functional finding discovered during UX review.
6. Rerun the entire current gate suite, including previously approved regression checks.
7. Rerun the affected Playwright/API workflow from its first setup step, then repeat only the relevant UX observation if one was affected.
8. Update the approval record.
9. Do not start the next gate until approval is explicit and the current gate's checkbox is checked.

If the failure reveals a PRD contradiction, write an Architecture Decision Record describing:

- The conflicting requirements.
- The observed evidence.
- Available options.
- Recommended resolution.
- Whether the PRD must eventually be revised.

Do not silently reinterpret the PRD in code.

---

## 12. Recommended implementation stopping points

The gates intentionally provide useful points where development can pause for real use and feedback:

### After G05 — Deterministic authoring prototype

Validate whether the script grammar, discovery UI, pronunciation workflow, and dry-run presentation feel right before audio complexity begins.

### After G07 — First audible MVP

Validate real Speaches connectivity, voice choice, pronunciation transformation, and basic playback.

### After G11 — Complete functional Web alpha

Use the application for actual study-guide conversion before investing in waveform polish and packaging.

### After G14 — Docker Web beta

Run StudyNarrator as a normal locally hosted application for an extended period. Defects found during real use should be fixed before desktop release claims.

### After G17 — Version 1 release

Publish only after the complete cross-distribution and cross-platform evidence exists.

---

## 13. Scope discipline checklist

Before approving each gate, confirm:

- Was this gate the first unchecked item when implementation began?
- Are all lower-numbered gates checked and supported by matching approval records and approved tags?
- Does the gate prove one coherent risk?
- Can its primary output be inspected without later features?
- Are real Speaches calls used only where necessary?
- Is deterministic behavior tested with mocks or fixed fixtures?
- Does the reviewer know exactly what success looks like?
- Do manifest-driven tests cover every added or changed REST operation, IPC channel, and application service method?
- Does Playwright cover every added or changed user workflow and the current way of reaching it, using isolated disposable data and stable accessible locators?
- Did focused tests and the cumulative verifier pass before the human UX review began?
- Is there a rollback tag after approval?
- Did the implementation avoid future-version Speaches management?
- Did the implementation preserve the original source and distinguish readable text from TTS text?
- Are secrets confined to privileged processes and ignored configuration?
- Will a rejected decision leave this gate unchecked and block all later gates?
- Can the next gate begin without unresolved ambiguity from this one?

If any answer is no, the gate is not ready to approve.
