# Speaches G00 Baseline

- **Status:** Pending real-server validation
- **Prepared:** 2026-08-11
- **Authoritative gate:** G00 — Freeze the external TTS baseline

This record freezes the external Speaches behavior that StudyNarrator will later integrate with. It records only redacted connection details and derived media evidence. API keys, the complete remote hostname, response bodies, and generated audio are not committed.

## Fixed request

- Endpoint: `POST <redacted-server>/v1/audio/speech`
- Supplied base URL form: `PENDING — root or /v1`
- Model: `speaches-ai/Kokoro-82M-v1.0-ONNX`
- Voice: `af_heart`
- Formats: `wav`, `mp3`
- Speed: `1`
- Authorization: `PENDING — omitted or Bearer <redacted>`
- Smoke fixture: `fixtures/baseline/speaches-smoke.txt`

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

| Field | Tested value |
| --- | --- |
| Test date | PENDING |
| Operating system | PENDING |
| `curl` | PENDING |
| `jq` | PENDING |
| `ffmpeg` | PENDING |
| `ffprobe` | PENDING |
| `file` | PENDING |
| `shasum` | PENDING |

## Optional server preflight

The probe records sanitized status information for `/health` and `/v1/models`. These endpoints are informative rather than the primary pass condition because the successful synthesis request is the definitive compatibility check.

| Check | HTTP status | Result |
| --- | ---: | --- |
| `/health` | PENDING | PENDING |
| `/v1/models` | PENDING | PENDING — include whether the configured model was listed |

## Successful-run evidence

Generated files remain in `.tmp/gates/G00/`. Hashes are recorded for traceability; separate requests are not required to be byte-identical.

| Run | Format | Local filename | HTTP | Content type | Bytes | Duration | Codec | SHA-256 |
| ---: | --- | --- | ---: | --- | ---: | ---: | --- | --- |
| 1 | WAV | `.tmp/gates/G00/run-1/speaches-baseline.wav` | PENDING | PENDING | PENDING | PENDING | PENDING | PENDING |
| 1 | MP3 | `.tmp/gates/G00/run-1/speaches-baseline.mp3` | PENDING | PENDING | PENDING | PENDING | PENDING | PENDING |
| 2 | WAV | `.tmp/gates/G00/run-2/speaches-baseline.wav` | PENDING | PENDING | PENDING | PENDING | PENDING | PENDING |
| 2 | MP3 | `.tmp/gates/G00/run-2/speaches-baseline.mp3` | PENDING | PENDING | PENDING | PENDING | PENDING | PENDING |

### FFprobe summaries

PENDING — copy the format, duration, size, and first audio-stream fields from each ignored `*.ffprobe.json` file after the real-server run.

## Unavailable-server evidence

The server operator must stop Speaches or block the client connection before this check. The probe accepts a network error or HTTP 5xx, rejects a successful response, and rejects HTTP 4xx because authentication and request errors do not demonstrate an unavailable server.

| Field | Captured value |
| --- | --- |
| Test date | PENDING |
| Failure class | PENDING |
| Curl exit | PENDING |
| HTTP status | PENDING |
| Authorization header configured | PENDING — boolean only |

No raw error body, hostname, or credential is copied into this document.

## Reproduction

```bash
export SPEACHES_BASE_URL="https://your-private-speaches-server"
export SPEACHES_API_KEY="..." # omit when the server does not require one
export SPEACHES_MODEL_ID="speaches-ai/Kokoro-82M-v1.0-ONNX"
export SPEACHES_DEFAULT_VOICE="af_heart"

bash -n scripts/gates/g00-speaches-baseline.sh
bash -n scripts/gates/g00-reset.sh
bash scripts/gates/g00-speaches-baseline.sh
```

Play the first WAV and MP3 completely and spot-check both files from run 2. After the operator makes the server unavailable, capture the failure:

```bash
bash scripts/gates/g00-speaches-baseline.sh --expect-unavailable
```

Restore the server and rerun the normal probe. Review `.tmp/gates/G00/evidence.json` and `.tmp/gates/G00/failure/failure.json`, then copy only their non-sensitive results into this baseline and the G00 approval record.

Disposable artifacts can be removed only with the guarded command:

```bash
bash scripts/gates/g00-reset.sh --confirm
```
