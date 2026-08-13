# G05 Review Evidence Template

This directory is for reviewer-produced G05 evidence. Implementation QA artifacts may be added before approval, but they do not approve the gate.

## Environment

- Review date:
- Reviewer:
- Commit:
- Operating system:
- Browser and version:
- Electron version:
- Node version (must be 26.x):
- SQLite version:
- FFmpeg version:
- Web data directory:
- Electron data directory:
- Speaches state: stopped

## Automated result

- Command: `npm run verify:gate -- G05`
- Exact final line: `GATE G05: AUTOMATED CHECKS PASSED`
- Full log artifact:

## Authoring result

- Project `Gate 05 Deterministic Authoring` created and reloaded:
- Exact Unicode/source-line-ending persistence confirmed:
- Speaker `teacher` mapped to `voice_teacher_raw_g05`:
- Speaker `student` mapped to `voice_student_raw_g05`:
- Known pause defaults and unknown-pause blocking confirmed:
- Original/readable/TTS text separation confirmed:
- Explicit pause suppression of automatic paragraph pause confirmed:
- Section lines and speech counts confirmed:
- Lexicon precedence, conflicts, match counts, and source jumps confirmed:
- Dry-run request counter remained zero for TTS/Speaches/audio/external requests:

## Persistence and concurrency result

- 800 ms autosave status sequence captured:
- Rapid-edit stale response did not overwrite the final revision:
- Manual **Save now** reload proof:
- Invalid draft blocked save and duplicate:
- Failed draft blocked duplicate and triggered navigation/unload guards:
- Atomic duplicate has fresh project and project-lexicon IDs:
- Duplicate edits did not alter the original:
- Confirmed deletion removed only the selected project:
- System-default copy-on-create comparison:

## Input and editor result

- LF paste/upload/drag-drop equivalence:
- CRLF paste/upload/drag-drop equivalence:
- Unicode paste/upload/drag-drop equivalence:
- Wrong extension rejected:
- Invalid UTF-8 rejected:
- 5,000,001-character source rejected:
- Literal search and replace verified:
- Code-fence cleanup and one-step restore verified:
- Diagnostic/discovery/lexicon/section/dry-run jumps verified:

## Web, Electron, responsive, and keyboard result

- Web primary and review-tool routes:
- Electron primary and review-tool routes:
- Desktop capture:
- Tablet capture:
- Mobile capture:
- Keyboard-only traversal capture/notes:
- Visible focus and announced status/error notes:
- Console errors: none
- Page-level horizontal clipping: none

## Network evidence

- Preserved Web network log:
- Electron IPC/request counter log:
- Local persistence requests observed:
- TTS requests observed: 0
- Speaches requests observed: 0
- Audio/synthesis/render requests observed: 0
- Credential or external requests observed: 0

## Reviewer decision

- Decision: pending
- Blocking findings:
- Follow-up notes:

Only after an explicit human approval may the gate-plan checkbox, `docs/gates/approvals/G05.md`, approval commit, and annotated `gate-G05-approved` tag be created.
