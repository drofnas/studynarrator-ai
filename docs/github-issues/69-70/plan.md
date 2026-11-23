# Plan: Issues #69 and #70 (Speakers sorting and script voice hints)

Status: Phase 2 (implemented on `feat/speaker-sort-and-script-voices`). The
Phase 1 plan is kept below; the "Phase 2 revision for #70" section supersedes
D1, D7, and the persistence statements.

- #69: Sort the Speakers list in Project Settings (default: by name; option:
  script order).
- #70: Allow a script to choose a speaker's voice: `[speaker_alice|af_heart]`.

## Branching and checkpoints

- The investigation ran on `fix/electron-45-compat`. That branch is unrelated
  work. Implement on a new branch cut from `main`, for example
  `feat/speakers-sort-and-voice-hints`, or use one branch per issue.
- The files these issues touch are identical on `main` and on this branch.
  `git diff --stat main` shows only `packages/core/package.json` differing (a
  dependency bump), so the line references below apply to `main`.
- Use two checkpoint commits, #69 first. It is smaller and Web-only, and both
  issues edit `ProjectSettingsPanel.tsx` and `useProjectsPageController.ts`.
  Landing #69 first means #70's "from script" row UI is built on top of the
  sorted rows. Suggested messages:
  1. `feat(web): sort project speakers by name or script order`
  2. `feat(core): accept voice hints in speaker directives`. If the Web part is
     large, split it: (2a) core grammar, schema, corpus, and docs;
     (2b) `feat(web): apply script voice hints in project speakers`.
     Commit 2a on its own is a safe intermediate state: the hint parses and is
     exposed on the row, nothing consumes it, and the preview and scratchpad
     regexes are already fixed.

## Phase 2 revision for #70 (user decision)

The user replaced D1: "Settings page loads the default value from the script.
But we should allow for an Override in the Settings page." Implementation:

- **Precedence:** saved override (when its voice is enabled and supported) →
  usable script hint → `resolveProjectSpeakerVoiceId` default chain
  (`resolveEffectiveSpeakerVoiceId` in
  `apps/web/src/features/projects/projectAuthoring.ts`).
- **Select:** never locked. `VoiceSelect` takes `scriptDefaultVoiceId` and
  labels that option `* <label> (script default)`. A note tied with
  `aria-describedby` reads "* Script default voice X.", "Overrides script
  default voice X. Choose the * voice to follow the script.", or the
  unavailable warning.
- **Override rule:** `speakerVoiceSelection` stores
  `voiceOverride = voiceId !== voiceHint`. Choosing the `*` voice clears the
  override; any other choice (including when there is no hint) sets it. The
  auto-default effect only changes `voiceId`; it never touches the flag.
- **Persistence:** migration 15 `speaker-voice-override` adds
  `speaker_mappings.voice_override INTEGER NOT NULL DEFAULT 0 CHECK (0, 1)` and
  sets it to 1 for every mapping that already has a voice, so no existing
  project's audio can change when a hint is added later. `DATABASE_SCHEMA_VERSION`
  is 15. Projects read the flag as a boolean; replace and duplicate write it.
- **Contracts:** `SpeakerMappingSchema.voiceOverride` is `z.boolean().optional()`
  (strict object, so `voiceHint` and non-boolean flags are rejected). No
  operation was added or renamed, so `APPLICATION_SERVICE_MANIFEST`,
  `REST_API_MANIFEST`, and `PUBLIC_IPC_CHANNEL_MANIFEST` are unchanged; REST
  (`apps/server/src/app.test.ts`) and IPC (`apps/desktop/src/bridge.test.ts`)
  contract tests cover round-trip, omission (= false), and malformed flags.
  The optional field keeps pre-v15 render snapshots valid (their hash is
  recomputed from the parsed snapshot in `renderPlanStore.ts`).
- **Render and preview:** unchanged; they read the resolved `voiceId` saved
  with the project.
- The speaker-control regex copies in `scratchpad.ts` and `projectPreview.ts`
  now use the shared core `containsSpeakerDirective`.

## Cross-cutting findings that change or add to the issue text

1. **The parse result crosses no REST or IPC contract.** It is produced in the
   Web worker (`apps/web/src/workers/parser/parserWorkerProtocol.ts`) and
   validated at that boundary with the core `ParseScriptResultSchema`. Neither
   `packages/shared-types`, `apps/server/src/routes`, nor `apps/desktop` carries
   `ParseScriptResult` or `discoveries` (confirmed with `git grep`). No
   `REST_API_MANIFEST`, `PUBLIC_IPC_CHANNEL_MANIFEST`, or
   `APPLICATION_SERVICE_MANIFEST` change is needed for either issue.
2. **The server re-parses the script but takes voices only from persisted
   `speakerMappings`.** `packages/application/src/renderPlan.ts:177` calls
   `parseScript` and `:307` reads `project.speakerMappings`.
   `projectPreview.ts:167` and `:218` do the same. So "rendered audio uses the
   resolved voice" (#70) means the Web must write the hinted voice into the
   draft mapping and autosave it. Render and preview code need no change for
   voice resolution. Limitation, the same one today's default-voice fill has:
   a project that is never opened in the Web/Electron UI after a hint is added
   (for example, created only through the API) does not pick up the hint until
   it is opened. Any server-side hint fallback is a follow-up.
3. **Speaker-control regexes are duplicated.**
   `packages/application/src/projectPreview.ts:201` (pronunciation preview) and
   `packages/core/src/scratchpad.ts:72` (Quick Scratchpad) detect speaker
   controls with `/(^|[^\\])\[speaker_[A-Za-z0-9][A-Za-z0-9_-]*\]/u`. Today
   `[speaker_x|v]` is a parse error, so both reject it. Once it parses cleanly
   the regex misses it and both features would silently accept a speaker
   switch. Both regexes must change with #70.
4. **Grammar version bump is costly.** `SCRIPT_GRAMMAR_VERSION` is duplicated in
   `packages/core/src/schemas.ts:3` and `packages/shared-types/src/contracts.ts:3`.
   Render snapshots store `versions.scriptGrammar` as `z.literal(1)`
   (`shared-types/src/renderPlan.ts:25`), and
   `packages/rendering/src/renderPlanStore.ts:225` re-parses stored snapshots
   with that schema. Moving to v2 would make every stored render plan fail
   validation unless the literal becomes a union. That is strong evidence for an
   additive v1 change.
5. **Display order equals persisted order today.** The controller writes
   `reconciled.speakers` (minus `discovered`/`occurrenceCount`) back into
   `draft.speakerMappings` and compares it with JSON `same()`
   (`useProjectsPageController.ts:861-873`). Reordering `configuration.speakers`
   would dirty the draft and autosave. #69 must sort a derived copy only.
6. **New row fields must be stripped before they reach `speakerMappings`.**
   `SpeakerMappingSchema` in `packages/shared-types/src/persistence.ts:121` is
   `.strict()`. Any field added to `AuthoringSpeakerRow` for #70 must be
   destructured away at lines 861-867. Otherwise saving fails validation and the
   `same()` check never matches, which leaves the draft permanently dirty.
7. **Default-voice fill already autosaves.** The effect at
   `useProjectsPageController.ts:726-769` replaces any `null` or non-enabled
   `voiceId` with `resolveProjectSpeakerVoiceId(...)` and autosaves through
   `updateDraft(..., autosave = true)`. Consequence for #70: a speaker who
   appeared before the hint was typed (300 ms analysis debounce) already has a
   saved default voice. The issue's suggested rule ("script fills only when no
   saved voice") would therefore ignore most hints in practice. See decision
   D1.
8. **Persistence and migrations are unaffected.** No SQLite schema, migration,
   `DATABASE_SCHEMA_VERSION`, or data-directory layout change is needed for
   either issue under the recommendations below.

---

## Issue #69: Sort the Speakers table

### Goal

Add a labelled sort control to Project → Settings → Speakers. The default is
**Name (A–Z)**. The option **Script order** keeps today's order. Sorting is
display-only.

### Non-goals

- No change to `reconcileDiscoveredConfiguration`, the order of persisted
  `speakerMappings`, the core, persistence, or contracts.
- No sorting of other speaker lists (dry-run rows, render views, script
  generation). This answers the issue's open question with "not now".
- No pauses-table sort.

### Decisions

- **Sort persistence:** remember the choice per viewer and globally (not per
  project) in `localStorage` under `studynarrator.project-speakers.sort.v1`.
  Follow the try/catch pattern of `RENDER_DISK_SPACE_CHECK_STORAGE_KEY`
  (`useProjectsPageController.ts:92-115`) so blocked storage falls back to the
  in-memory default. No schema change. Rationale: it is a viewer preference, and
  there is already precedent for this kind of key.
- **Undiscovered speakers** (`discovered: false`) sort after all discovered
  speakers in both modes. In Name mode they are sorted by name within their
  group. In Script order they keep reconcile's order, which is saved-mapping
  order. Rationale: unused rows are already styled `styles.unused`, and keeping
  them last matches the current behavior.
- **Comparator:** `new Intl.Collator(undefined, { sensitivity: "base", numeric: true })`
  on `displayName.trim()`, then a code-unit comparison on `speakerId` as the
  tie-break. `numeric: true` sorts "Speaker 2" before "Speaker 10". Tests use
  ASCII names whose order does not depend on locale.
- **Focus stability:** freeze the displayed order while a Name input has focus.
  Hold the frozen `speakerId[]` order in state. Recompute it on blur of the name
  input, on a sort-mode change, or when the set of speaker IDs changes (a new
  speaker discovered or removed). New IDs that appear while the order is frozen
  are appended in sorted position. Rationale: rows are keyed by `speakerId`, so
  a keyed reorder moves the DOM node and can blur the focused input.

### Files to change

- `apps/web/src/features/projects/speakerSort.ts` (new): a pure
  `sortSpeakerRows(rows, mode)` plus a `SpeakerSortMode = "name" | "script"`
  type. `mode === "script"` returns discovered rows in input order, then
  undiscovered rows. Keeping this logic in `features/projects` beside
  `projectAuthoring.ts` follows the Web layout rule.
- `apps/web/src/features/projects/speakerSort.test.ts` (new): unit tests.
- `apps/web/src/pages/projects/useProjectsPageController.ts`:
  - `speakerSort` state, initialized from storage, and `setSpeakerSort`, which
    stores the value.
  - `displayedSpeakers` (memo) built from `configuration.speakers`, the mode,
    and the frozen order.
  - `beginSpeakerNameEdit()` and `endSpeakerNameEdit()` callbacks for the
    freeze.
  - Expose these in the returned controller. Do not touch `configuration`,
    `updateSpeaker`, or the reconcile effect.
- `apps/web/src/pages/projects/ProjectSettingsPanel.tsx`
  (`ProjectConfigurationPanel`):
  - Add a labelled `<select>` ("Sort speakers": "Name (A–Z)" / "Script order")
    in the Speakers `sectionHeading`.
  - Map `displayedSpeakers` instead of `configuration.speakers`.
  - Wire `onFocus` and `onBlur` on the Name input.
  - The count `<b>` stays as is.
- `apps/web/src/pages/projects/ProjectsPage.module.css`: style the control so
  it fits the heading at 390 px width. The existing e2e test covers the narrow
  viewport and horizontal scrolling at `projects-and-settings.spec.ts:560-620`.

### Tests

- **Vitest default (`npm test`):**
  - `speakerSort.test.ts`: name sorting is case-insensitive; the speaker-ID
    tie-break works with duplicate display names; numeric collation; script
    order is preserved; undiscovered rows come last in both modes and are
    name-sorted within their group in Name mode; the input array is not
    mutated.
  - `ProjectsPage.test.tsx`: the default is Name; switching to Script order
    shows first-appearance order; the choice is restored from `localStorage`,
    and blocked storage falls back to Name; switching the sort does **not**
    call `replace`, leaves save state "saved", and schedules no 800 ms autosave
    timer (reuse the `timerSpy` pattern at line 1947); the rename freeze keeps
    the row in place and focused while typing a name that would move it, and
    re-sorts after blur; undiscovered-row placement.
- **Playwright Web project:** in `e2e/web/projects-and-settings.spec.ts`, reuse
  the six-speaker script at lines 526-537 (teacher, student, narrator, coach,
  guest, facilitator), whose Name and Script orders differ. Assert the visible
  order of the `Name for speaker …` inputs within the "Project speakers" region
  for the default Name order, switch to Script order and assert again, reload
  and assert the choice persisted, and assert the project is not marked
  unsaved. Use the role, label, and state locators already in the spec.
- No existing test accesses speaker rows by position (grep for
  `getAllByLabelText(/for speaker/)`, `.nth(`, `.first()` found none), so the
  new default order should not break existing tests.

### Documentation

- No user documentation currently describes the Speakers table. Add a short
  line in the PRD §10.7 "Speaker configuration" area only if the maintainer
  wants the PRD to track UI affordances. Otherwise no doc change is needed. The
  storage key is a per-viewer preference, not a data location that needs
  documenting.

### Risks and rollback

- Risk: the order flickers between Name and Script order during the freeze;
  covered by the component test. Risk: the narrow layout overflows; covered by
  the existing e2e test.
- Rollback: revert the single commit. There is no persisted state except an
  ignorable `localStorage` key.

### Gates

`npm run format:check`, `npm run lint`, `npm run typecheck`, `npm test`
(focused: `speakerSort.test.ts`, `ProjectsPage.test.tsx`),
`npm run test:coverage`, the Playwright **web** project, and `npm run verify`.
Run all of them in the Docker tools container. `check:package-dependencies` and
`audit:knip` are not needed because there are no import-graph changes (run knip
anyway if a new export is unused).

Estimated size: about 60 lines of source and 150 lines of tests, plus a small
CSS change.

---

## Issue #70: Voice hint in the speaker directive

### Goal

`[speaker_<id>|<voiceId>]` switches the active speaker exactly like
`[speaker_<id>]` and records `voiceId` as a voice hint for that speaker. The
Web applies the hint to the speaker's mapping, labels it "from script", and
autosaves it. Rendering then uses it through the existing `speakerMappings`
path.

### Non-goals

- No model selection in the tag. A render uses the single
  `connection.defaultModelId`.
- Script generation output (`packages/core/src/scriptGeneration.ts` prompt
  around line 245 and `ScriptGenerationSpeakerSchema`) is out of scope; file a
  follow-up.
- No server-side hint fallback in render or preview (see finding 2).
- No grammar v2. (Phase 2: a persisted override flag and migration 15 are now in scope; see the revision section.)

### Design decisions and recommendations

| #   | Decision                                                                                        | Recommendation                                                                                                                                                                                                                                                                                                                                                                                                                     | Rationale grounded in code                                                                                                                                                                                                  |
| --- | ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | Precedence between the script hint and a saved Settings voice                                   | **Superseded by the user decision (Phase 2).** Effective voice: saved Settings override (if usable), then usable script hint, then the existing default chain. The select is never locked; the script voice is marked `*` ("script default"). Choosing another voice stores a persisted override; choosing the `*` voice clears it.                                                                                                | The user requires that Settings can always override the script, so the override must be persisted (schema 15) to tell a manual choice from an auto-filled default. Recorded in ADR 0002.                                    |
| D2  | Conflicting hints for one speaker in a script                                                   | **Warning**, new code `CONFLICTING_SPEAKER_VOICE_HINT`, **first hint wins**. `ignorePattern` is the later conflicting token, for example `[speaker_alice\|am_adam]`. A tag without a hint never conflicts. A later tag carrying the same hint is not a conflict.                                                                                                                                                                   | Mirrors `SPEAKER_ID_CASE_COLLISION`, a non-blocking parser warning recorded in `recordSpeaker` (`parser.ts:258-285`). Warnings make the status `readyWithWarnings` without blocking, and remain suppressible by pattern.    |
| D3  | Malformed hint syntax (`[speaker_a\|]`, `[speaker_a\|bad voice]`, two `\|`, illegal characters) | **Blocking error**, new code `INVALID_SPEAKER_VOICE_HINT`. The token stays literal speech and does not switch the speaker. The suggestion text is "Use [speaker_name\|voice_id] with a voice ID containing only letters, numbers, dots, underscores, or hyphens, or remove the \|voice part."                                                                                                                                      | ADR 0001 says malformed control tokens are blocking and stay literal. A separate code gives a precise recovery hint.                                                                                                        |
| D4  | Unknown, disabled, or model-unsupported voice ID                                                | The **parser does not see the catalog** and must not: it stays deterministic and offline (PRD §10). Validation happens in the **Web**, as a non-blocking **warning** `SCRIPT_VOICE_UNAVAILABLE`, computed only when `voiceSelectionState === "ready"`. It is shown inline on the row (role status) and appended to the issues list as a Web-originated warning. The fallback is the existing `resolveProjectSpeakerVoiceId` chain. | The catalog lives in the controller (`enabledVoices`, `supportedProjectVoices`). PRD §16.2 allows a missing catalog entry to be a warning. The issue requires "no silent failure, no parse stop".                           |
| D5  | Allowed voice-ID characters                                                                     | `[A-Za-z0-9][A-Za-z0-9._-]*`, at most 500 characters (the `voiceId` max in `SpeakerMappingSchema`). Voice only, no model part.                                                                                                                                                                                                                                                                                                     | Fake Speaches ships `af_heart`, `af_sky`, and `en_US-lessac-medium`, which need upper case, `_`, and `-`. The `.` covers dotted backend IDs. `]`, `\|`, whitespace, and `/` stay excluded so the token remains unambiguous. |
| D6  | Grammar v1 additive change or v2                                                                | **Additive v1**: no version bump. Update `docs/script-grammar-v1.md` and PRD §9.2.                                                                                                                                                                                                                                                                                                                                                 | A bump changes `z.literal` in two packages and invalidates stored render snapshots (`renderPlanStore.ts:225`). Every v1 script parses identically, so the corpus stays byte-identical.                                      |
| D7  | Persist the "from script" indicator?                                                            | **Superseded.** The `*` marker is derived from the current parse (`voiceHint`), but the **override flag is persisted** as `speaker_mappings.voice_override` / `SpeakerMapping.voiceOverride` (optional in the schema).                                                                                                                                                                                                             | Needed for the user's override rule; optional so render snapshots stored before schema 15 keep parsing with their recorded hashes.                                                                                          |
| D8  | Script generation output                                                                        | **Out of scope**; file a follow-up issue.                                                                                                                                                                                                                                                                                                                                                                                          | The generator prompt (`core/scriptGeneration.ts` ~245) and its schema are a separate feature with their own tests.                                                                                                          |
| D9  | Shape of the parse result                                                                       | Add a dedicated `SpeakerDiscoverySchema = NamedDiscoverySchema.extend({ voiceHint: VoiceHintSchema.optional() }).strict()`. Use it only for `discoveries.speakers`. Pauses keep `NamedDiscoverySchema`. **Omit** the key when there is no hint (never `undefined` or `null`).                                                                                                                                                      | `goldenCorpus.test.ts` compares `JSON.stringify` output **byte for byte**. Omitting the key keeps all nine existing `*.expected.json` files unchanged.                                                                      |
| D10 | Existing `INVALID_SPEAKER_DIRECTIVE` message text                                               | **Keep it unchanged.** Add the hint syntax only to the new `INVALID_SPEAKER_VOICE_HINT` suggestion.                                                                                                                                                                                                                                                                                                                                | Changing it would churn `permissive-recovery.expected.json` (lines 214 and 250) for no behavior benefit. The issue's "messages that say Use [speaker_name]…" concern is met by the new code's text.                         |
| D11 | Speech nodes                                                                                    | Do **not** add the hint to `SpeechNodeSchema` or to the CIR.                                                                                                                                                                                                                                                                                                                                                                       | Voice is per speaker, not per node. The CIR schema version stays 1, and transform and render are untouched.                                                                                                                 |

Accepted behavior change: users who previously **ignored** an
`INVALID_SPEAKER_DIRECTIVE` for a token like `[speaker_x|y]` (keeping it as
spoken literal text) will now see it become a control. The stale suppression is
harmless. They need `\[` to keep the literal. Note this in the grammar doc and
the commit body.

### Files to change

**Core (`packages/core`, `npm test`)**

- `src/schemas.ts`: export a `VoiceHintSchema`
  (`/^[A-Za-z0-9][A-Za-z0-9._-]*$/u`, `.max(500)`) and add
  `SpeakerDiscoverySchema` with the optional `voiceHint`. Use it for
  `discoveries.speakers`. `SCRIPT_GRAMMAR_VERSION` stays 1.
- `src/parser.ts`:
  - In `addSpeech` (lines 357-414), split the speaker token on the first `|`.
    Validate the speaker part with `SPEAKER_ID` and keep
    `INVALID_SPEAKER_DIRECTIVE` for a bad ID. Validate the hint part with the
    voice-hint regex, rejecting empty hints, a second `|`, and illegal
    characters with `INVALID_SPEAKER_VOICE_HINT` (blocking, literal,
    `ignorePattern = match[0]`).
  - Extend `MutableNamedDiscovery`, or use a speaker-specific type with an
    optional `voiceHint`.
  - `recordSpeaker(id, range, lineText, voiceHint?)`: set the hint on the first
    hinted occurrence. A different later hint records the
    `CONFLICTING_SPEAKER_VOICE_HINT` warning and keeps the first.
  - The `INLINE_DIRECTIVE` regex already matches the `|…` form, and escaping
    (`\[`, line 359) already works unchanged. The beginning-of-line path
    (line 516) already delegates `speaker_` tokens to `addSpeech`.
- `src/authoring.ts`: `AuthoringSpeakerRowSchema` gains
  `voiceHint: VoiceHintSchema.optional()` (row only, **not**
  `AuthoringSpeakerConfigurationSchema`). `reconcileDiscoveredConfiguration`
  copies `discovery.voiceHint` onto discovered rows. It does **not** write
  `voiceId`, because catalog-aware resolution belongs to the Web (D4), and
  writing an unknown hint would bounce against the fill effect.
- `src/scratchpad.ts:72`: extend the speaker-control regex to
  `\[speaker_[A-Za-z0-9][A-Za-z0-9_-]*(?:\|[^\]\r\n]*)?\]`, or derive
  "has speaker control" from the parse result. Either way, a hinted tag must be
  rejected as a control.
- `src/index.ts`: export any new public symbols (`VoiceHintSchema`, types).
  Keep exports minimal for knip.
- `test-corpus/speaker-voice-hints.script` and `.expected.json` (new), created
  with `npm run regenerate:corpus`. The script covers a valid hint, a reused
  tag without a hint, a conflict, a malformed hint, an escaped
  `\[speaker_alice|af_heart]`, a hint at beginning of line and inline,
  `en_US-lessac-medium`, and a hint on `narrator`. All existing expected files
  must show **no diff**.

**Application (`packages/application`, `npm run test:api`)**

- `src/projectPreview.ts:201`: apply the same regex extension so pronunciation
  preview keeps rejecting speaker controls.

**Web (`apps/web`, `npm test`)**

- `src/features/projects/projectAuthoring.ts`: change
  `resolveProjectSpeakerVoiceId` to accept the hint. A usable hint wins, then
  the current voice if enabled, then the connection default, then the first
  enabled voice. Add a small `scriptVoiceStatus(row, enabledVoices)` helper
  returning `"applied" | "unavailable" | "none"`.
- `src/pages/projects/useProjectsPageController.ts`:
  - Pass `speaker.voiceHint` into the fill effect (lines 733-741). Its
    replacement path already autosaves, so hint-applied voices persist even
    when the user has not edited.
  - **Strip `voiceHint`** together with `discovered` and `occurrenceCount` at
    lines 861-867.
  - Make `updateSpeaker` ignore `voiceId` patches for rows whose hint is
    applied (defense in depth; the select is disabled).
  - Expose Web-originated `SCRIPT_VOICE_UNAVAILABLE` warnings, either merged
    into the issues list shown in `ProjectWorkspace.tsx:417-455` or as a
    separate list. They are not suppressible, because they are not parser
    diagnostics.
- `src/pages/projects/ProjectSettingsPanel.tsx`: for an applied hint, show a
  disabled `VoiceSelect` plus a visible "From script" label tied to it by
  `aria-describedby`. For an unavailable hint, show an inline warning ("Script
  voice `x` is not available for this model; using `y`."). Keep the speaker ID
  and voice ID visually distinct (PRD §10.7 line 922).
- `ProjectsPage.module.css`: styles for the label and warning.

No change to `packages/shared-types`, `packages/persistence`, server routes,
the desktop preload or IPC, or any manifest.

### Tests

- **Core (`npm test`):**
  - `parser.test.ts`: the hint parses with no diagnostic, the tag is not read
    aloud, the speaker ID is `alice` with hint `af_heart`; a tag without a hint
    is unchanged (no `voiceHint` key); conflict warning with first-wins and the
    exact `ignorePattern`; malformed cases (empty, a second `|`, a space, an
    illegal character, a bad speaker ID with a valid hint) are blocking and
    literal; escaped `\[speaker_alice|af_heart]` stays literal; an ignored
    conflict is suppressed; the 500-character boundary; a hint on the default
    speaker.
  - `authoring.test.ts`: reconcile copies the hint onto rows, leaves `voiceId`
    alone for new and saved rows, and puts no hint on undiscovered rows.
  - `scratchpad.test.ts` (or the existing scratchpad tests): a hinted speaker
    tag is rejected.
  - Golden corpus: the new case passes, and the existing nine expected files
    are byte-identical. Review the full diff of `regenerate:corpus`.
- **Application (`npm run test:api`):** `projectPreview.test.ts`: pronunciation
  preview rejects `[speaker_a|af_heart] text`.
- **Web (`npm test`):**
  - `projectAuthoring.test.ts`: the resolution order (usable hint, unusable
    hint falling back, no hint) and `scriptVoiceStatus`.
  - `parserWorkerProtocol.test.ts`: a result with `voiceHint` round-trips, and
    a result with an invalid `voiceHint` is rejected.
  - `ProjectsPage.test.tsx`:
    - The hint fills the voice and shows "From script"; the select is
      disabled; autosave persists the hinted voice even without a user edit.
    - The type-then-add-hint sequence: the voice switches to the hint.
    - Reopening an existing project with a saved different voice: the hint
      wins.
    - An unavailable hint shows the warning and falls back to the default.
    - Removing the hint re-enables the select and keeps the voice.
    - `voiceHint` is never sent in `replace` payloads.
    - The conflict warning appears in the issues list.
- **Playwright Web project:** in `projects-and-settings.spec.ts` (or a new
  `script-voice-hints.spec.ts`), with the fake Speaches server, type
  `[speaker_alice|af_sky] Hello.\n[speaker_bob] Hi.`. Open Settings. Assert
  that "Voice for speaker alice" has value `af_sky`, is disabled, and shows the
  "From script" label; that bob has the default `af_heart`; that after the save
  state reads "Saved", the API (`GET` project) shows alice's mapping with
  `af_sky`. Optionally extend `render-execution.spec.ts` to assert the
  render-plan speech entry for alice has `voiceId: "af_sky"` (a fake-boundary
  assertion that "rendered audio uses the resolved voice"). Also check an
  unknown hint `[speaker_carol|zz_none]`: the warning is visible and the
  fallback voice is selected.
- **Electron and Docker:** not required. No IPC, native, image, or volume
  change.

### Documentation

- `docs/script-grammar-v1.md`: change the EBNF to
  `speaker = "[speaker_", speaker-id, [ "|", voice-hint ], "]" ;` and
  `voice-hint = letter-or-digit, { letter | digit | "." | "_" | "-" } ;`.
  Add prose on precedence (D1), conflicts (D2), malformed hints (D3), the fact
  that the parser does not validate the catalog (D4), escaping, and the
  ignored-pattern behavior change.
- `docs/study-narrator-prd-v1.3.md`: §9.2 adds the optional voice-hint form and
  rules. §10.7 adds the "From script" indicator while keeping speaker ID and
  voice ID distinct.
- `docs/adr/0001-permissive-script-recovery.md`: optionally add an addendum
  line noting the hinted form, or create a short ADR 0002 if the maintainer
  wants the precedence rule (D1) recorded as an architecture decision.
  Recommendation: ADR 0002, because D1 departs from the issue's suggested rule.

### Risks and rollback

- **Precedence surprise:** a user picks a voice in Settings for a hinted
  speaker and cannot. Mitigated by the disabled select and explicit label
  text. Covered by tests.
- **Autosave on open:** opening an unedited project whose hint differs from the
  saved voice now triggers an autosave. This is the same mechanism and the
  same consequence as today's default-voice fill.
- **Missed regex copy:** a hinted tag leaks into scratchpad or pronunciation
  preview. Covered by the two regression tests. `git grep "speaker_\["` found
  only those two copies.
- **Corpus churn:** mitigated by omitting the key (D9). Any diff to an existing
  `*.expected.json` is a defect.
- **Stale suppression:** described above. Documented.
- **Rollback:** revert the commit(s). No persisted schema changed. Saved
  mappings keep whatever voice the hint wrote, which is a valid voice ID. Old
  code treats hinted tags as `INVALID_SPEAKER_DIRECTIVE` again, which is
  today's behavior.

### Gates

`npm run format:check`, `npm run lint`, `npm run typecheck`, `npm test`
(core: parser, authoring, scratchpad, golden corpus; web: projectAuthoring,
parserWorkerProtocol, ProjectsPage), `npm run test:api` (projectPreview),
`npm run regenerate:corpus` with a full fixture diff review,
`npm run audit:knip` (new core exports), `npm run check:package-dependencies`
(if any import changes), `npm run test:coverage`, the Playwright **web**
project, and `npm run verify`. Run all of them in the Docker tools container
per AGENTS.md. A sentinel-secret assertion is not required: no logs,
diagnostics export, connection handling, or REST/IPC errors change. Hint text
appears only in parser diagnostics shown locally, like existing speaker IDs.

Estimated size: core about 120 lines of source and 200 lines of tests plus one
corpus case; application about 5 lines plus a test; Web about 120 lines of
source and 250 lines of tests; docs about 40 lines.
