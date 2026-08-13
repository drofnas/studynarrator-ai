# G06 Review Evidence Template

This directory is for reviewer-produced G06 evidence. Implementation QA artifacts do not approve the gate.

## Environment

- Review date:
- Reviewer:
- Commit:
- Operating system:
- Browser and version:
- Electron version:
- Node version (must be 26.x):
- SQLite version:
- FFmpeg/ffprobe version:
- Web data directory:
- Electron data directory:
- Fake server port:
- Real Speaches values source (ignored local file/manual; do not record values):

## Automated result

- Command: `npm run verify:gate -- G06`
- Exact final line: `GATE G06: AUTOMATED CHECKS PASSED`
- Full log artifact:

## Onboarding, profile, and shell result

- First-run redirect:
- Continue-offline persistence:
- Setup reopened from shell indicator:
- Profile CRUD and active selection:
- Environment profile lock/unconfigured reconciliation:
- Shell state screenshots:
- Project reference preservation/nulling:
- Project before/after diagnostic snapshots:

## Fake diagnostics matrix

| Scenario | Expected | Observed | Stage evidence |
| --- | --- | --- | --- |
| healthy | connected | | |
| timeout | disconnected | | |
| unauthorized | authenticationRequired | | |
| missing-model | modelUnavailable | | |
| rejected-voice | voiceUnavailable | | |
| empty-body | invalidAudio | | |
| invalid-content-type | invalidAudio | | |
| corrupt-audio | invalidAudio | | |
| closed port | disconnected | | |

- Root request inspection:
- `/v1` request inspection:
- Confirmed no `/v1/v1`:
- Confirmed one speech request and no retry:
- Sanitized fake request log:

## Credential and redaction result

- Electron `safeStorage` persistence:
- Encryption-unavailable refusal:
- Replace/clear/delete behavior:
- Compensation/orphan cleanup evidence:
- Sentinel `g06-secret-must-not-appear` absent from SQLite, renderer storage, logs, exceptions, REST/IPC, export, and fake server:
- Redacted diagnostics export artifact:
- Endpoint represented only by classification:
- Raw hostname, headers, response body, diagnostic text, key, and audio absent:

## Catalog and Projects result

- Kokoro friendly label/raw ID/search evidence:
- Apache-2.0/source attribution:
- Strict replacement success:
- Strict invalid replacement rejection and preservation:
- Bundled fallback preservation:
- Project profile/model selection:
- Available/unavailable/unverified voice states:
- Manual-ID fallback:
- Dry Run semantics unchanged:
- Project editing and Dry Run fake request delta: 0
- Preview/audio controls present: none

## Real G00 integration result

- Initial connected test:
- Outage classification without StudyNarrator restart:
- Projects remained usable:
- Approved support-link handling:
- Recovery without StudyNarrator restart:
- Updated last-successful-test time:
- Diagnostic audio persisted or playable: no

## Reviewer decision

- Decision: pending
- Blocking findings:
- Follow-up notes:

Only after explicit human approval may the gate-plan checkbox, `docs/gates/approvals/G06.md`, approval commit, and annotated `gate-G06-approved` tag be created.
