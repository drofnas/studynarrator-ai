# Speaches Compatibility Baseline

- **Status:** Automated, outage, recovery, and listening evidence captured
- **Prepared:** 2026-08-11

This record freezes the external Speaches behavior that StudyNarrator will later integrate with. It records only redacted connection details and derived media evidence. API keys, the complete remote hostname, response bodies, and generated audio are not committed.

## Fixed request

- Endpoint: `POST <redacted-server>/v1/audio/speech`
- Supplied base URL form: root URL
- Model: `speaches-ai/Kokoro-82M-v1.0-ONNX`
- Voice: `af_heart`
- Formats: `wav`, `mp3`
- Speed: `1`
- Authorization: omitted; server accepted an unauthenticated tailnet request
- Smoke input: generated at `.tmp/speaches-baseline/input.txt`

```json
{
  "input": "This is the StudyNarrator baseline. SQL indexes can speed up database reads.",
  "model": "speaches-ai/Kokoro-82M-v1.0-ONNX",
  "voice": "af_heart",
  "response_format": "wav or mp3",
  "speed": 1
}
```

The probe accepts either a server root URL or a URL ending in `/v1` and always sends the request to exactly one `/v1/audio/speech` path. If `SPEACHES_API_KEY` is configured, the probe supplies it through a temporary permission-restricted header file and removes that file on exit.

## Client environment

| Field            | Tested value                           |
| ---------------- | -------------------------------------- |
| Test date        | 2026-08-11 02:15 PDT                   |
| Operating system | macOS 26.5.1 (25F80), arm64            |
| `curl`           | 8.7.1, SecureTransport, LibreSSL 3.3.6 |
| `jq`             | 1.7.1-apple                            |
| `ffmpeg`         | 8.1.2                                  |
| `ffprobe`        | 8.1.2                                  |
| `file`           | 5.41                                   |
| `shasum`         | 6.02                                   |

## Optional server preflight

The probe records sanitized status information for `/health` and `/v1/models`. These endpoints are informative rather than the primary pass condition because the successful synthesis request is the definitive compatibility check.

| Check        | HTTP status | Result                                                   |
| ------------ | ----------: | -------------------------------------------------------- |
| `/health`    |         200 | Supported                                                |
| `/v1/models` |         200 | Supported; configured model present among 2 local models |

## Successful-run evidence

Generated files remain in `.tmp/speaches-baseline/`. Hashes are recorded for traceability; separate requests are not required to be byte-identical.

| Run | Format | Local filename                                       | HTTP | Content type |  Bytes | Duration | Codec       | SHA-256                                                            |
| --: | ------ | ---------------------------------------------------- | ---: | ------------ | -----: | -------: | ----------- | ------------------------------------------------------------------ |
|   1 | WAV    | `.tmp/speaches-baseline/run-1/speaches-baseline.wav` |  200 | `audio/wav`  | 261164 |  5.440 s | `pcm_s16le` | `92ef2fc52926354cf9a9ae5986bd4c06237b18e2e5cb0da86711c3e08f800d02` |
|   1 | MP3    | `.tmp/speaches-baseline/run-1/speaches-baseline.mp3` |  200 | `audio/mp3`  |  43944 |  5.440 s | `mp3`       | `0f209125dd96404658280c0e5837f8aa39ea0c5057f26f4c2f41096af67c0cd9` |
|   2 | WAV    | `.tmp/speaches-baseline/run-2/speaches-baseline.wav` |  200 | `audio/wav`  | 261164 |  5.440 s | `pcm_s16le` | `92ef2fc52926354cf9a9ae5986bd4c06237b18e2e5cb0da86711c3e08f800d02` |
|   2 | MP3    | `.tmp/speaches-baseline/run-2/speaches-baseline.mp3` |  200 | `audio/mp3`  |  43944 |  5.440 s | `mp3`       | `0f209125dd96404658280c0e5837f8aa39ea0c5057f26f4c2f41096af67c0cd9` |

### FFprobe summaries

All four files contain one 24,000 Hz mono audio stream and a positive 5.440-second duration. The WAV files use `pcm_s16le` in a WAV container; the MP3 files use the `mp3` codec in an MP3 container. FFmpeg decoded every file without error. Runs 1 and 2 were byte-identical for both formats, although byte equality is not required.

## Unavailable-server evidence

The server operator must stop Speaches or block the client connection before this check. The probe accepts a network error or HTTP 5xx, rejects a successful response, and rejects HTTP 4xx because authentication and request errors do not demonstrate an unavailable server.

| Field                           | Captured value       |
| ------------------------------- | -------------------- |
| Test date                       | 2026-08-11 02:23 PDT |
| Failure class                   | `connection-failure` |
| Curl exit                       | `7`                  |
| HTTP status                     | `000`                |
| Authorization header configured | `false`              |

No raw error body, hostname, or credential is copied into this document.

## Recovery evidence

Speaches was restarted and the complete normal probe was rerun at 2026-08-11 02:24 PDT. `/health` and `/v1/models` returned HTTP 200, the configured model was present, and all four WAV/MP3 requests passed. File sizes, durations, codecs, and SHA-256 hashes exactly matched the pre-outage baseline.

## Reproduction

```bash
export SPEACHES_BASE_URL="https://your-private-speaches-server"
export SPEACHES_API_KEY="..." # omit when the server does not require one
export SPEACHES_MODEL_ID="speaches-ai/Kokoro-82M-v1.0-ONNX"
export SPEACHES_DEFAULT_VOICE="af_heart"

bash -n scripts/speaches/baseline-probe.sh
bash -n scripts/speaches/reset-baseline-artifacts.sh
bash scripts/speaches/baseline-probe.sh
```

Play the first WAV and MP3 completely and spot-check both files from run 2. After the operator makes the server unavailable, capture the failure:

```bash
bash scripts/speaches/baseline-probe.sh --expect-unavailable
```

Restore the server and rerun the normal probe. Review `.tmp/speaches-baseline/evidence.json` and `.tmp/speaches-baseline/failure/failure.json`, then copy only their non-sensitive results into this baseline.

Disposable artifacts can be removed only with the guarded command:

```bash
bash scripts/speaches/reset-baseline-artifacts.sh --confirm
```
