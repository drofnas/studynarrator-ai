# G06 Review Evidence Template

Implementation QA artifacts do not approve the gate. Functional acceptance is automated; the human record is UX-only after automation is green.

## Environment

- Review date:
- Reviewer:
- Commit:
- Operating system:
- Browser and version:
- Electron version:
- Node version (must be 26.x):
- FFmpeg/ffprobe version:
- Disposable Web data directory:
- Disposable Electron data directory:
- Real Speaches values source, if used (ignored local file/manual; never record values):

## Automated result

- `npm run test:api`: PASS / FAIL
- REST manifest: 27 operations matched and exercised
- Public IPC manifest: PASS / FAIL
- Application-service manifest: PASS / FAIL
- Chromium Web Playwright project: PASS / FAIL
- Electron Playwright project: PASS / FAIL
- `npm run verify:gate -- G06`: PASS / FAIL
- Exact final line: `GATE G06: AUTOMATED CHECKS PASSED`
- CI or full-log artifact:

## Human Web UX review

- Onboarding clarity and offline recovery:
- Navigation and setup discoverability:
- Profile/diagnostic/catalog information hierarchy:
- Shell and announced state transitions:
- Projects connection/model/voice usability:
- Keyboard and focus experience:
- Narrow/mobile responsive behavior:
- Perceived timing or jank:
- Visual/accessibility concerns:

## Human Electron UX review

- Window, scrolling, and focus behavior:
- IPC timing feel:
- One-shot credential feedback:
- System-browser link transition:
- Relaunch/startup feel:
- OS-native interaction concerns:

## Optional real-server UX observations

- Connection/outage/recovery language:
- Guidance usefulness:
- Perceived diagnostic timing:
- Diagnostic audio persisted or playable: no

## Findings and regression status

- Functional findings discovered during UX review:
- Regression test added for each functional finding:
- Focused tests rerun:
- Cumulative verifier rerun:
- Remaining UX-only findings:

## Reviewer decision

- Decision: pending
- Blocking findings:
- Known non-blocking limitations:
- Notes:

Only after explicit human approval may the gate-plan checkbox, `docs/gates/approvals/G06.md`, approval commit, and annotated `gate-G06-approved` tag be created.
