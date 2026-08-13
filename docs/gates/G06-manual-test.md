# G06 Manual Test — Gate 06 Speaches Profiles, Diagnostics, and Onboarding

Use Node 26, FFmpeg/`ffprobe`, disposable data, and the loopback fake server. This review proves connection management and diagnostics only. It must not produce a playable preview, cache audio, persist diagnostic audio, or alter project content.

Do not check G06 in the gate plan, create an approval record, or create `gate-G06-approved` until a human explicitly approves the gate. Never commit a real endpoint or credential.

## Automated baseline and disposable data

1. Run `npm run gate:reset -- G06`.
2. Confirm `node --version` reports Node 26 and `ffprobe -version` succeeds.
3. Run `npm run verify:gate -- G06`.
4. Require the exact final line `GATE G06: AUTOMATED CHECKS PASSED`.
5. Record the full log in `docs/gates/evidence/G06/README.md` or as a linked local review artifact.

## Start and inspect the fake server

In terminal A, run:

```bash
STUDYNARRATOR_FAKE_SPEACHES_PORT=18080 npm run fake:speaches
```

In terminal B, these commands must work without restarting StudyNarrator:

```bash
npm run fake:speaches:inspect
npm run fake:speaches:reset
npm run fake:speaches:scenario -- healthy
```

The fake endpoint is `http://127.0.0.1:18080`. Start Web with disposable data in terminal C:

```bash
STUDYNARRATOR_DATA_DIR=.tmp/gates/G06/manual-web npm run dev:web
```

## First-run onboarding and offline recovery

1. Open StudyNarrator with the empty G06 data directory. Require an automatic redirect to `/onboarding`.
2. Confirm Web guidance says keys come from `SPEACHES_API_KEY` or server-side secret injection and offers official Speaches installation and TTS links.
3. Confirm the shell connection indicator opens onboarding/setup.
4. Select **Continue offline**. Require Projects to open and remain usable while the indicator reports a configuration/disconnected state.
5. Reload. Require Projects to remain open without another forced onboarding redirect.
6. Open setup from the shell indicator and enter exactly:
   - Profile name: `G06 Fake Root`
   - Endpoint: `http://127.0.0.1:18080`
   - Model ID: `speaches-ai/Kokoro-82M-v1.0-ONNX`
   - Voice ID: `af_heart`
7. Select **Create + Test Connection**. Require `connected`; require the shell indicator to transition through **Testing** to **Connected**.
8. Confirm URL, DNS, TCP, HTTP, authentication, model, voice, and audio stages all pass and show stable codes and timings.
9. Confirm there is no preview button, audio element, player, cache entry, or persisted diagnostic WAV.

## Root and `/v1` normalization

1. Run `npm run fake:speaches:reset`.
2. Test `G06 Fake Root` once.
3. Create a second profile with the same values except:
   - Profile name: `G06 Fake V1`
   - Endpoint: `http://127.0.0.1:18080/v1`
4. Test it once, then run `npm run fake:speaches:inspect`.
5. Require normalized paths such as `/health`, `/v1/models`, `/v1/audio/voices`, and `/v1/audio/speech`; require no `/v1/v1` path.
6. Attempt each invalid endpoint and require a URL/configuration failure before network access:
   - `ftp://127.0.0.1:18080`
   - `http://embedded-user@127.0.0.1:18080`
   - `http://127.0.0.1:18080?key=value`
   - `http://127.0.0.1:18080/#fragment`
   - `http://127.0.0.1:18080/custom/path`

## Every deterministic fake scenario

Before each row, run the scenario command, test `G06 Fake Root`, and inspect both the stage rail and shell indicator. A failed diagnostic is a successful UI/API operation containing the result, not a transport error from StudyNarrator.

| Command | Expected overall | Required distinction |
| --- | --- | --- |
| `npm run fake:speaches:scenario -- healthy` | `connected` | all eight stages pass |
| `npm run fake:speaches:scenario -- timeout` | `disconnected` | timeout guidance; exactly one attempt |
| `npm run fake:speaches:scenario -- unauthorized` | `authenticationRequired` | HTTP reachable; authentication fails |
| `npm run fake:speaches:scenario -- missing-model` | `modelUnavailable` | names `speaches-ai/Kokoro-82M-v1.0-ONNX` |
| `npm run fake:speaches:scenario -- rejected-voice` | `voiceUnavailable` | model passes; speech rejects `af_heart` |
| `npm run fake:speaches:scenario -- empty-body` | `invalidAudio` | HTTP/audio status passes before empty-body validation fails |
| `npm run fake:speaches:scenario -- invalid-content-type` | `invalidAudio` | reports non-audio content type |
| `npm run fake:speaches:scenario -- corrupt-audio` | `invalidAudio` | `ffprobe` decode validation fails |

For connection refusal, stop the fake server, keep StudyNarrator open, and test `http://127.0.0.1:18080`. Require `disconnected` with TCP refusal. Restart the fake server in healthy mode and retest without restarting StudyNarrator; require recovery to `connected`.

After the scenario matrix, run `npm run fake:speaches:inspect`. Require request logs to contain only method, normalized path, status, model, voice, input length, and input hash. They must not contain authorization values or diagnostic source text.

## Profile management, locking, deletion, and project references

1. In Settings, create `G06 Editable Peer` at `http://127.0.0.1:18080` with the same model and voice, timeout `120`, retries `2`, and WAV format.
2. Edit its name, endpoint, timeout, retry count, model, and voice; reload and require exact persistence.
3. Switch the active profile between the two saved profiles. Require the shell indicator to follow the active profile.
4. Create project `G06 Reference Preservation`. Select `G06 Editable Peer` and set optional model override `speaches-ai/Kokoro-82M-v1.0-ONNX`. Save and reload.
5. Test the connection repeatedly. Snapshot the project before and after; require no project field or timestamp to change because of connection testing.
6. Delete `G06 Editable Peer`. Require the project connection reference to become null while its model override remains unchanged.
7. Confirm an environment profile cannot be deleted.

Restart Web with disposable environment configuration:

```bash
STUDYNARRATOR_DATA_DIR=.tmp/gates/G06/manual-web-locked \
SPEACHES_BASE_URL=http://127.0.0.1:18080/v1 \
SPEACHES_MODEL_ID=speaches-ai/Kokoro-82M-v1.0-ONNX \
SPEACHES_VOICE_ID=af_heart \
STUDYNARRATOR_LOCK_SPEACHES_SETTINGS=true \
npm run dev:web
```

Require stable profile ID `environment-speaches`, locked fields with effective source **server environment**, a disabled active-profile selector, and no delete control. Stop Web and restart with the same data directory but without the Speaches environment values. Require the environment reference to remain present and become unconfigured; projects must not silently repoint.

## Desktop credential boundary

Run Electron against a separate directory and the healthy fake endpoint:

```bash
STUDYNARRATOR_DATA_DIR=.tmp/gates/G06/manual-electron npm run dev:desktop
```

1. Enter the sentinel `g06-secret-must-not-appear` in the one-shot password field for a saved profile.
2. Save or Create + Test. Require the renderer password field to clear immediately after submission.
3. Require the profile to report only **configured**, never the key value.
4. Close and reopen Electron; require the encrypted credential to remain usable.
5. Replace the key with another disposable value, then use **Clear stored key** and confirm configured state changes accordingly.
6. Delete the profile and confirm its vault entry is removed.
7. Inspect the disposable SQLite database, renderer storage, logs, errors, IPC responses, diagnostics export, and fake request log. Require the sentinel to be absent everywhere.
8. On a test harness/mocked run where `safeStorage.isEncryptionAvailable()` is false or the backend is `basic_text`, require replacement to fail. There must be no plaintext fallback.

## Voice catalog and Projects integration

1. In Settings search for `Heart`, `af_heart`, and `American English`. Require `Heart — American English — af_heart`, its raw ID, enabled state, and locale metadata.
2. Confirm the catalog attribution names `hexgrad/Kokoro-82M`, `VOICES.md`, and Apache-2.0, with no subjective quality claim.
3. Replace the selected model overrides with this exact JSON:

```json
{
  "schemaVersion": 1,
  "modelId": "speaches-ai/Kokoro-82M-v1.0-ONNX",
  "entries": [
    {
      "voiceId": "af_heart",
      "label": "Heart — Course Narrator — af_heart",
      "enabled": true,
      "language": "American English",
      "locale": "en-US",
      "accent": "American",
      "category": "narration",
      "style": null,
      "sampleText": "A short neutral catalog sample."
    },
    {
      "voiceId": "custom_lab_voice",
      "label": "Custom Lab Voice — custom_lab_voice",
      "enabled": false,
      "language": null,
      "locale": null,
      "accent": null,
      "category": null,
      "style": null,
      "sampleText": null
    }
  ]
}
```

4. Require the renamed `af_heart`, the disabled added entry, and untouched bundled entries to remain available as fallback.
5. Submit this exact invalid replacement and require a strict validation error for the unknown `unexpected` property; the previous catalog must remain intact:

```json
{"schemaVersion":1,"modelId":"speaches-ai/Kokoro-82M-v1.0-ONNX","entries":[],"unexpected":true}
```

6. Open `G06 Reference Preservation`. Select a connection profile and optional model override. For a discovered speaker, choose `af_heart`; require the friendly label, raw ID, and **available** state.
7. Enter manual ID `manual_voice_not_in_catalog`; require the raw ID to remain editable and display **unavailable** or **unverified** from the last diagnostic rather than changing Dry Run readiness.
8. Run Dry Run and require the same deterministic G05 ordering and validation semantics. Require zero new fake-server requests from project editing or Dry Run.

## Redacted export

1. Test a profile, then select **Export redacted JSON**.
2. Require schema/application/runtime versions; profile source; endpoint class `loopback`, `private`, or `public`; root-versus-`/v1` form; model/voice IDs; API-key-configured boolean; HTTP status; eight stage codes/timings; and sanitized request counts.
3. Require absence of raw hostname, full endpoint, API key, authorization/header values, response body, diagnostic input text, and generated audio.
4. Repeat after `unauthorized` and `corrupt-audio`; require useful staged detail without secret or source leakage.

## Real G00 server outage and recovery

Use the private G00 values only from an ignored local environment file or manual entry.

1. Start the real G00 Speaches server and test its profile. Require model, voice, and WAV decoding to pass.
2. Stop Speaches and retest without restarting StudyNarrator. Require the correct disconnected/TCP or HTTP stage, while Projects remains usable.
3. Open both official support links from Web and Electron. Electron must open only approved HTTPS Speaches hosts externally.
4. Restart Speaches and retest without restarting StudyNarrator. Require `connected` and a new last-successful-test time.
5. Confirm the diagnostic sample was discarded and no playable or persistent audio artifact exists.

## Reviewer decision

Record the environment, automated log, screenshots, scenario table, redacted export inspection, project snapshots, credential-boundary evidence, and real-server outage/recovery in `docs/gates/evidence/G06/README.md`.

Leave the decision pending until all checks pass. Only after explicit human approval may G06 be checked in the plan, an approval record and approval commit be created, and annotated tag `gate-G06-approved` be added.
