# G05 Manual Test — Gate 05 Deterministic Authoring

Use Node `26.7.0` (or another supported Node 26 release) and disposable local data. Keep Speaches stopped for the complete review. G05 is ready for review only when the automated verifier passes and this checklist proves that authoring, analysis, persistence, and Dry Run remain offline and deterministic.

Do not check G05 in the gate plan, create an approval record, make an approval commit, or create `gate-G05-approved` until a human explicitly approves the gate.

## Setup and zero-TTS baseline

1. Run `npm run gate:reset -- G05` from the repository root.
2. Confirm `node --version` reports Node 26.
3. Stop Speaches and any local TTS or audio service.
4. Start Web with `STUDYNARRATOR_DATA_DIR=.tmp/gates/G05/manual-web npm run dev:web`.
5. Open browser developer tools, preserve the network log, and record a starting request count.
6. Confirm the primary navigation contains **Projects** and **Settings**. Confirm Script Lab, Persistence Lab, and Runtime diagnostics remain available under **Review tools**.
7. Confirm the footer describes local authoring and dry run with no credentials, synthesis, or external traffic.

## Copy-ready authoring fixture

Create a project with these exact values:

- **Project name:** `Gate 05 Deterministic Authoring`
- **Description:** `Offline authoring, autosave, duplicate, and dry-run proof`

Paste this exact source into **Script source**:

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

Use these raw voice IDs. They are opaque authoring values; G05 must not attempt to verify them:

- `teacher` → `voice_teacher_raw_g05`
- `student` → `voice_student_raw_g05`

Use these pause values:

- `pause_short` → `350 ms`
- `pause_medium` → `0.75 s`
- `pause_long` → `1.5 s`

Create these lexicon entries with all entries enabled, case-sensitive, whole-word, and priority `0`:

| Scope | Type | Display text | Sense ID | Spoken text | Notes |
| --- | --- | --- | --- | --- | --- |
| Global | Exact term | `SQL` | — | `sequel` | `Global SQL pronunciation` |
| Project | Named sense | `resume` | `cv` | `rez-oo-may` | `Curriculum vitae sense` |
| Project | Named sense | `resume` | `continue` | `ree-zoom` | `Continue action sense` |

## Discovery, configuration, and readiness

1. Confirm analysis starts after approximately 300 ms and does not require **Save now**.
2. Confirm discovered speaker IDs `teacher` and `student` remain visually distinct from the raw voice IDs.
3. Confirm each speaker reports its occurrence count and offers line-jump buttons.
4. Confirm `pause_short`, `pause_medium`, and `pause_long` use exact integer durations `350`, `750`, and `1500 ms` after normalization.
5. Confirm the sections are:
   - `Resumes and background processing` — line 1 — 3 speech segments.
   - `SQL pronunciation` — line 10 — 2 speech segments.
6. Before entering the voices, require blocking messages that identify the exact IDs:
   - `Speaker teacher needs a voice ID.`
   - `Speaker student needs a voice ID.`
7. After entering both voices and all pause durations, require **Ready to render** with no live model or voice verification. Confirm the UI says live verification is deferred until G06.
8. Temporarily remove the `student` voice and require `MISSING_VOICE_MAPPING` for `student`; restore it.
9. Add `[pause_custom]` to the end of the script. Require `MISSING_PAUSE_CONFIGURATION` for `pause_custom`, leave its duration blank, and confirm readiness is blocked.
10. Enter `425 ms` for `pause_custom`, confirm readiness recovers, then remove the temporary directive. Confirm the now-unused custom configuration remains visible and marked unused rather than being deleted.

## Duration parser boundaries

For one pause duration field, enter each value and verify the result before restoring `350 ms`:

| Input | Expected result |
| --- | --- |
| `350 ms` | accepted as exactly `350 ms` |
| `0.35 s` | accepted as exactly `350 ms` |
| `1.5 s` | accepted as exactly `1500 ms` |
| `0 s` | accepted as exactly `0 ms` |
| `30 s` | accepted as exactly `30000 ms` |
| `-1 s` | **Invalid**; negative duration message; Save and Duplicate blocked |
| `1.5 ms` | **Invalid**; milliseconds must be whole |
| `0.0001 s` | **Invalid**; at most three decimal places |
| `30.001 s` | **Invalid**; outside `0–30,000 ms` |
| `later` | **Invalid**; corrective format message |

Confirm an invalid value stays visible for correction and is never silently replaced by the previous valid value.

## Narration score and pronunciation

1. Confirm the narration score has 11 ordered rows: 2 section rows, 5 speech rows, and 4 explicit pause rows.
2. Confirm every speech row separately displays source/original text, readable text, and TTS text. In particular:
   - `{{resume|cv}}` remains in original text, `resume` appears in readable text, and `rez-oo-may` appears in TTS text.
   - `{{resume|continue}}` remains in original text, `resume` appears in readable text, and `ree-zoom` appears in TTS text.
   - `SQL` remains in original/readable text and `sequel` appears only in TTS text.
3. Confirm speech duration is unavailable and every pause duration is exact.
4. Add a paragraph break between two speech segments and confirm one automatic `pause_medium` row appears.
5. Place `[pause_short]` at that same boundary and confirm the explicit pause suppresses the automatic paragraph pause; two pause rows must never appear at one boundary.
6. Select a dry-run row and confirm focus moves to its source line.
7. In the pronunciation test, enter `SQL and {{resume|cv}}`. Confirm original, readable, and TTS results remain separately visible and no audio control appears.
8. Confirm lexicon cards show match counts and line/column jump buttons. Disable the global SQL entry and confirm the matches and TTS text update; re-enable it.
9. Create a project `SQL` entry with spoken text `ess cue ell`, confirm project scope wins deterministically, and confirm a conflict diagnostic is navigable. Delete the temporary override and require `sequel` again.

## Autosave, reload, and duplicate

1. Change the description to `Autosave revision one` and require the sequence **Unsaved** → **Saving…** → **Saved** after roughly 800 ms.
2. Rapidly change it to `Autosave revision two`, `Autosave revision three`, and `Autosave revision final`. Wait for **Saved**, reload the browser, and require only `Autosave revision final`.
3. Change the project name to `Gate 05 Manual Save`, immediately select **Save now**, reload, and require that exact name.
4. Make a valid unsaved description change, select **Duplicate**, and name the copy `Gate 05 Deterministic Authoring Copy`. Confirm the pending save completes before duplication.
5. Open both projects and confirm source, speaker mappings, pauses, paragraph pacing, connection reference, and project lexicon were copied.
6. Edit the copy and confirm the original does not change. Confirm project IDs and project-owned lexicon IDs are not shared.
7. Enter `-1 s` in the copy and select **Duplicate**. Confirm duplication is blocked without asking for a copy name.
8. Restore a valid duration, simulate or observe a failed local save, and confirm **Save failed**. Confirm duplication remains blocked until a successful save.
9. With an unsaved, invalid, or failed draft, attempt a project switch, Settings navigation, and browser close/reload. Require a discard warning. With **Saved** state, confirm no warning appears.
10. Select **Delete** on the copy, cancel once, then confirm deletion. Reload and confirm only the copy was removed.

## Paste, upload, drag/drop, and source tools

Use these exact short fixtures for paste, file picker, and drag/drop:

- LF: `[speaker_teacher] LF résumé 🧠\n[pause_short]\nContinue.`
- CRLF: `[speaker_teacher] CRLF résumé 🧠\r\n[pause_short]\r\nContinue.`
- Unicode: `[speaker_teacher] naïve façade — 東京 — 🧠`

1. Confirm paste, upload, and drag/drop produce equivalent analysis while preserving Unicode and the source's line-ending form in persistence.
2. Confirm uploaded filename is never displayed or persisted as a filesystem path.
3. Reject a `.md` file, invalid UTF-8 bytes, and a source over 5,000,000 characters without replacing the current source.
4. Confirm the line-number gutter stays aligned with source lines.
5. Search literally for `SQL`, toggle case sensitivity, use **Find next**, replace one occurrence, undo by restoring the source, and then test **Replace all**.
6. Confirm diagnostics, discoveries, lexicon matches, sections, and narration-score rows all jump to the correct source line.
7. Paste the complete source inside one surrounding `text` code fence. Confirm no automatic cleanup occurs. Select **Remove surrounding code fence**, then **Restore fenced source**, and confirm the one-step restore is exact.

## System-default copy behavior

1. In **Settings**, set paragraph pacing enabled with `1.2 s`, then save.
2. Create `Gate 05 Defaults 1200`. Confirm the new project owns enabled `pause_medium = 1200 ms`.
3. Change Settings to disabled with `900 ms`, then save.
4. Reload `Gate 05 Defaults 1200`; confirm it remains enabled at `1200 ms`.
5. Create `Gate 05 Defaults 900 Disabled`; confirm it owns disabled `pause_medium = 900 ms`.
6. Open projectless Script Lab. Confirm its initial paragraph setting uses the saved disabled/900 ms system default, but its source remains memory-only and is not persisted.

## Responsive, keyboard, Web, and Electron checks

1. Review at approximately 1440 px, 1024 px, 768 px, and 375 px widths. Confirm the desktop project rail, script workspace, and configuration rail collapse into one logical column without lost controls or page-level horizontal clipping.
2. Starting at the browser address bar, use only Tab, Shift+Tab, Enter, Space, arrow keys, and Escape where applicable. Confirm keyboard order follows project rail → editor → configuration → lexicon → validation/dry run.
3. Confirm every interactive element has visible focus, labels remain associated with controls, and status/error changes are announced without moving focus.
4. Confirm Script Lab, Persistence Lab, and Runtime diagnostics still open from **Review tools** in Web.
5. Run Electron against a separate disposable G05 data directory. Repeat create, edit, Save now, duplicate, reload, Settings, and the three review-tool route checks.
6. Confirm Web and Electron produce the same narration-score ordering and readiness messages.

## Automated and zero-TTS evidence

1. Clear the network log and capture its starting request count.
2. Run analysis repeatedly, edit every configuration panel, use the pronunciation test, and rebuild Dry Run.
3. Require zero TTS, Speaches, audio, synthesis, render, analytics, credential, or external requests. Local persistence requests are allowed in Web; Electron should use the typed IPC boundary.
4. Confirm there is no audio element, generated audio file, cache entry, render history, portable bundle, model/output setting, or prompt-builder setting.
5. Run `npm run verify:gate -- G05` under Node `26.7.0`.
6. Require the exact final line `GATE G05: AUTOMATED CHECKS PASSED`.
7. Record OS, browser, Electron, Node, SQLite, and FFmpeg versions plus screenshots at desktop/mobile widths, the ready narration score, exact blocking messages, autosave/reload proof, duplicate comparison, system-default copy proof, and the zero TTS network log.
8. Leave G05 unchecked and untagged for explicit human review.
