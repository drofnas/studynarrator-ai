# G06 Manual Test — Gate 06 Speaches Profiles, Diagnostics, and Onboarding

G06 functional acceptance is automated. The reviewer does not manually replay API, fake-server, persistence, credential, or route matrices. Human review begins only after the cumulative verifier is green and is limited to UX quality, accessibility feel, responsive behavior, perceived timing, audio-diagnostic feedback, and operating-system-native interaction feel.

Do not check G06 in the gate plan, create an approval record, or create `gate-G06-approved` until a human explicitly approves the UX review. Never commit a real endpoint or credential. The credential sentinel used by automation is `g06-secret-must-not-appear`.

## Automated prerequisite

1. Use Node 26 and confirm `ffprobe -version` succeeds.
2. Run `npm run gate:reset -- G06`.
3. Run `npm run verify:gate -- G06`.
4. Require the exact final line `GATE G06: AUTOMATED CHECKS PASSED`.
5. Confirm the run includes `test:api`, the Chromium Web Playwright project, and the single-worker Electron Playwright project.
6. If a functional finding appears during review, stop approval, add a regression test, and rerun the full verifier.

Automation already proves all current routes, onboarding/offline recovery, runtime diagnostics, Script Lab, Persistence Lab, Projects, Settings, every fake-Speaches scenario, root and `/v1` normalization, profile and catalog management, environment locking, project persistence, synthesis-free Dry Run, redacted export, REST/IPC/service manifests, renderer confinement, desktop persistence, one-shot credential behavior, and approved external-link policy.

## Human Web UX review

Use a disposable local data directory and, if desired, the loopback fake server. Do not repeat the functional scenario matrix.

From the repository root, start the optional healthy fake Speaches server in Terminal 1 and leave it running for either UI:

```bash
STUDYNARRATOR_FAKE_SPEACHES_PORT=18080 \
STUDYNARRATOR_FAKE_SPEACHES_SCENARIO=healthy \
npm run fake:speaches
```

In Terminal 2, start the Web UI with disposable data:

```bash
STUDYNARRATOR_DATA_DIR=.tmp/gates/G06/ux-web npm run dev:web
```

Open `http://127.0.0.1:5173` in a browser. To exercise connection presentation, create a saved profile using endpoint `http://127.0.0.1:18080`, model `speaches-ai/Kokoro-82M-v1.0-ONNX`, and voice `af_heart`.

To review environment-managed and locked fields, stop Terminal 2 and start this separate disposable Web session:

```bash
STUDYNARRATOR_DATA_DIR=.tmp/gates/G06/ux-web-locked \
SPEACHES_BASE_URL=http://127.0.0.1:18080/v1 \
SPEACHES_MODEL_ID=speaches-ai/Kokoro-82M-v1.0-ONNX \
SPEACHES_VOICE_ID=af_heart \
STUDYNARRATOR_LOCK_SPEACHES_SETTINGS=true \
npm run dev:web
```

Optional fake-server controls can be run from another terminal without restarting StudyNarrator:

```bash
npm run fake:speaches:scenario -- unauthorized
npm run fake:speaches:scenario -- healthy
npm run fake:speaches:inspect
```

- Review first-run onboarding for clarity, hierarchy, readable endpoint guidance, obvious offline recovery, and understandable status transitions.
- Review Settings profile management, staged diagnostics, catalog search, locked-field presentation, and redacted-export feedback for visual clarity and perceived timing.
- Review Projects connection/model/voice controls, friendly labels plus raw IDs, live availability language, autosave feedback, and Narration Score readability.
- Review Script Lab, Persistence Lab, and Runtime diagnostics navigation for discoverability and consistent focus order.
- At a narrow mobile viewport, check that content remains usable without accidental horizontal overflow and that controls do not become unreachable.
- Traverse primary actions by keyboard. Judge focus visibility, announced status changes, error recovery, contrast, density, and whether timing feels stalled or surprising.

## Human Electron UX review

Use a separate disposable Electron data directory.

Stop either Web session first so its Vite server releases port 5173. Leave the optional fake Speaches terminal running, then launch Electron from the repository root:

```bash
STUDYNARRATOR_DATA_DIR=.tmp/gates/G06/ux-electron npm run dev:desktop
```

The command builds the desktop entry points, rebuilds the native SQLite dependency for Electron, starts the renderer development server, and opens the Electron window. Reuse the same command and data directory when relaunching for the persistence-feel review. If using fake Speaches, create the desktop profile with `http://127.0.0.1:18080`, the model and voice IDs listed above, and a disposable one-shot credential only if you want to inspect credential feedback.

- Review window sizing, scrolling, focus, route transitions, and perceived IPC timing.
- Enter a disposable value in the one-shot password field and judge whether the clearing/configured-state feedback is understandable. Do not record the value.
- Open the official Speaches links and confirm the system-browser transition feels intentional.
- Close and relaunch once to assess startup and persistence feel; automation already validates the persisted data.
- Note any OS-native interaction, window-management, or timing issue that Playwright cannot meaningfully judge.

## Optional real-server UX check

The real G00 server may be used only to judge connection feedback and recovery timing. Keep private values in ignored local configuration. Do not treat this as the first functional validation: fake and adapter behavior must already be green in automation.

- Observe connection, outage, and recovery status language without restarting StudyNarrator.
- Judge whether the staged result helps a person understand what to do next.
- Confirm no preview player or persistent diagnostic-audio affordance appears in G06.

## Reviewer decision

Record the automated log link and concise Web/Electron UX observations in `docs/gates/evidence/G06/README.md`. Leave the decision pending for any functional, accessibility, responsive, timing, or native-integration defect. A functional defect requires an automated regression test before approval.
