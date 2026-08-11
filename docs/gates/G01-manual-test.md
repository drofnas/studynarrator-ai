# Gate G01 Manual Validation

Use only the disposable directories below. Do not point either client at permanent application data.

## Preparation

```bash
fnm use 26.7.0
npm ci
npm run gate:reset -- G01
```

## Web REST path

```bash
STUDYNARRATOR_DATA_DIR="$PWD/.tmp/gates/G01/web" npm run dev:web
```

1. Open `http://127.0.0.1:5173`.
2. Select **Run self-test**.
3. Confirm Shared core, Storage write/read, and FFmpeg report `PASS`.
4. Confirm Transport reports `REST` and Client reports `Web`.
5. Record the persistent marker creation time and data directory.
6. Stop both development processes completely and rerun the same command.
7. Run the self-test again and confirm the marker creation time is unchanged.

## Electron IPC path

```bash
STUDYNARRATOR_DATA_DIR="$PWD/.tmp/gates/G01/desktop" STUDYNARRATOR_OPEN_DEVTOOLS=true npm run dev:desktop
```

1. Select **Run self-test**.
2. Confirm Shared core, Storage write/read, and FFmpeg report `PASS`.
3. Confirm Transport reports `IPC` and Client reports `Electron`.
4. Record the persistent marker creation time and data directory.
5. In developer tools, confirm `window.require` and `window.process` are `undefined`.
6. Confirm `Object.keys(window.studyNarrator)` contains only `system` and its only operation is `diagnostics`.
7. Close Electron completely, rerun the same command, and confirm the marker creation time is unchanged.

## Approval

Copy the tested versions, results, and screenshots into `docs/gates/approvals/G01.md`. Explicitly approve or reject the SQLite driver, FFmpeg strategy, and Electron boundary. Do not begin G02 until the decision is approved and tagged.
