# StudyNarrator

StudyNarrator is a local-first authoring and text-to-speech application for turning structured study scripts into narrated audio. It provides a React Web interface and an Electron desktop development client backed by the same TypeScript parser, persistence, connection, and rendering services.

Use it to:

- Write scripts with speakers, sections, and explicit pauses.
- Map speakers to text-to-speech models and voices.
- Maintain project and global pronunciation lexicons.
- Test short passages in the Quick Scratchpad.
- Freeze an immutable render plan before generating audio.
- Render, review, and export MP3 audio, transcripts, manifests, checksums, and individual speech segments.
- Export prompt kits for creating or updating scripts with an external language model.
- Continue authoring while the speech server is offline.

StudyNarrator does not bundle a speech engine. It sends synthesis requests to an external [Speaches](https://speaches.ai/) server through the OpenAI-compatible text-to-speech API.

> **Beta status:** Docker Web is the production-style distribution in this repository. You can run the Electron client from source, but this release does not include a desktop installer.

## Quick start: Docker Web

Docker Web is the recommended local setup. Run Speaches and StudyNarrator as separate applications. The supplied StudyNarrator Compose file contains one application service and no model-management commands.

### 1. Set up Speaches

Install Docker Engine with the Compose plugin, or Docker Desktop. Speaches recommends Docker Compose and publishes separate CPU and NVIDIA CUDA configurations in its [official installation guide](https://speaches.ai/installation/).

Create a directory outside the StudyNarrator repository for Speaches:

```sh
mkdir speaches
cd speaches
```

For CPU operation, including Docker Desktop on Apple Silicon, download and start the CPU configuration:

```sh
curl --fail --remote-name https://raw.githubusercontent.com/speaches-ai/speaches/master/compose.yaml
curl --fail --remote-name https://raw.githubusercontent.com/speaches-ai/speaches/master/compose.cpu.yaml
docker compose --file compose.cpu.yaml up --detach
```

For an NVIDIA GPU with a working CUDA container runtime, use the upstream CUDA configuration instead:

```sh
curl --fail --remote-name https://raw.githubusercontent.com/speaches-ai/speaches/master/compose.yaml
curl --fail --remote-name https://raw.githubusercontent.com/speaches-ai/speaches/master/compose.cuda.yaml
docker compose --file compose.cuda.yaml up --detach
```

Confirm the server is running:

```sh
curl --fail http://127.0.0.1:8000/health
```

The response should report a healthy service. If it does not, inspect the container:

```sh
docker compose --file compose.cpu.yaml ps
docker compose --file compose.cpu.yaml logs speaches
```

Use `compose.cuda.yaml` in those commands if you selected CUDA.

### 2. Install the Kokoro speech model

Speaches requires a model download before text-to-speech use. Install the [`uv` command-line tool](https://docs.astral.sh/uv/getting-started/installation/) if you do not have `uvx`, then run:

```sh
SPEACHES_BASE_URL=http://127.0.0.1:8000 \
  uvx speaches-cli model download speaches-ai/Kokoro-82M-v1.0-ONNX
```

Confirm that the model appears in the installed text-to-speech model list:

```sh
SPEACHES_BASE_URL=http://127.0.0.1:8000 \
  uvx speaches-cli model ls --task text-to-speech
```

The output should contain `speaches-ai/Kokoro-82M-v1.0-ONNX`.

Generate a small WAV file before connecting StudyNarrator:

```sh
curl --fail --silent --show-error \
  http://127.0.0.1:8000/v1/audio/speech \
  --header 'Content-Type: application/json' \
  --output speaches-test.wav \
  --data '{
    "input": "Speaches is ready for StudyNarrator.",
    "model": "speaches-ai/Kokoro-82M-v1.0-ONNX",
    "voice": "af_heart",
    "response_format": "wav"
  }'

test -s speaches-test.wav && echo "Speaches text-to-speech is ready."
```

See the upstream [Speaches text-to-speech guide](https://speaches.ai/usage/text-to-speech/) for other models, voices, speeds, and API examples.

### 3. Start StudyNarrator

Clone this repository in a different directory, then create its local environment file:

```sh
git clone https://github.com/drofnas/studynarrator-ai.git
cd studynarrator-ai
cp .env.example .env
```

The checked-in environment template configures only the StudyNarrator Web binding and image metadata. Speaches is configured inside the application.

Build and start StudyNarrator:

```sh
docker compose up --build --detach
docker compose ps
```

Open <http://127.0.0.1:8080>. During onboarding, enter `http://host.docker.internal:8000` for Speaches running on the Docker host, load the catalog, review the selected model and default voice, then choose **Save and Test**. A connected result confirms DNS, TCP, HTTP, model, voice, and sample-audio checks.

StudyNarrator remains healthy if Speaches is stopped. You can continue editing and reconnect from Settings after Speaches returns without recreating the StudyNarrator container.

### Stop or update Docker Web

Stop the application while retaining projects and renders:

```sh
docker compose down
```

Rebuild after pulling an update:

```sh
git pull --ff-only
docker compose up --build --detach
```

The `studynarrator-data` named volume persists the SQLite database, speech cache, frozen plans, and render artifacts. Do not run `docker compose down --volumes` unless you intend to delete that data. See the [Docker operations guide](deploy/docker/README.md) for backup, restore, LAN access, and bind-mount permissions.

## Other ways to run locally

All source-based modes require:

- Node.js `26.7.0` (`.nvmrc` pins this version).
- npm `11.19.0` (the version declared in `package.json`).
- FFmpeg and FFprobe on `PATH` for diagnostics and rendering.
- A reachable Speaches server for preview and render operations. Authoring works without it.

Install FFmpeg with your operating system's package manager, for example `brew install ffmpeg` on macOS or `sudo apt-get install ffmpeg` on Debian/Ubuntu. Then install JavaScript dependencies from the repository root:

```sh
npm ci
```

### Web development server

Start the Vite UI plus Node API:

```sh
npm run dev:web
```

Open <http://127.0.0.1:5173>. Vite proxies `/api` requests to the Node server on `127.0.0.1:4310`. Development Web data is stored under `.tmp/dev/web` unless `STUDYNARRATOR_DATA_DIR` is set.

Enter the Speaches address during onboarding. Authenticated Speaches servers are not supported by the application connection flow.

### Production Web server without Docker

Build the React application and Node server, then serve both from port `4310`:

```sh
npm run build --workspace @studynarrator/web
npm run build --workspace @studynarrator/server

npm run start --workspace @studynarrator/server
```

Open <http://127.0.0.1:4310>. Set `STUDYNARRATOR_DATA_DIR` to a durable directory if this is more than a disposable local run.

### Electron development client

Start the React development server and Electron shell together:

```sh
npm run dev:desktop
```

Electron opens its own window and uses the operating system's application-data directory. Configure the single loopback, LAN, or HTTPS Speaches connection during onboarding or in Settings.

## Connecting to Speaches from each runtime

Use the URL that the StudyNarrator backend can reach. Your browser may use a different URL:

| StudyNarrator runtime | Speaches location | Base URL |
| --- | --- | --- |
| Docker Web | Same Docker host | `http://host.docker.internal:8000` |
| Web or Electron from source | Same machine | `http://127.0.0.1:8000` |
| Any runtime | Another private-network machine | `http://<private-ip-or-dns-name>:8000` |
| Any runtime | Reverse proxy with TLS | `https://<speech-host>` |

`localhost` inside the StudyNarrator container refers to that container, not the Docker host. The supplied Compose file maps `host.docker.internal` through Docker's Linux host-gateway support.

StudyNarrator accepts a Speaches root URL or a URL ending in `/v1`; it normalizes the address before making API calls. Cross-origin browser access to Speaches is not required because the Node or Electron backend makes the requests.

The connection is a singleton owned by the application installation. Projects do not contain a connection ID, and neither runtime reads connection profiles or credentials from environment variables. StudyNarrator does not have an API-key field, credential vault, or operating-system credential-store integration; authenticated Speaches servers are rejected by the connection test.

## Application surfaces

The primary navigation is **Prompt Kit**, **Projects**, **Quick Scratchpad**, and **Settings**, with **General**, **Voices**, **Lexicon**, **Timings**, and **System diagnostics** beneath Settings. Web requests use the manifest-backed `/api` surface for runtime diagnostics, projects, prompt export, previews, render plans and renders, pacing, preferences, the global lexicon, the singleton connection, setup, voice catalogs, Scratchpad, and speech-cache controls. Electron exposes the same operations through its validated public IPC manifest; operation names are contract-tested in both transports.

New installations include editable Global Lexicon defaults for common acronyms and ambiguous pronunciations. Named-sense aliases use `word/sense` in Settings and resolve explicit script annotations such as `{{resume|cv}}`; users may edit, disable, or delete any default without the application restoring it on restart.

## Pre-release data reset

All persisted contracts are at schema version 1: SQLite, project snapshots, diagnostics, parser grammar, script generation, preview, Scratchpad, and render plans. The repository intentionally supports only the current v1 shapes. Development databases, frozen plans, and cache metadata produced by earlier builds are rejected or treated as cache misses; the application never deletes or converts them automatically.

Before starting a current build, stop StudyNarrator and explicitly remove the disposable data directory if it contains pre-v1 data. For source Web development, remove `.tmp/dev/web`. For a custom Node data location, remove the directory named by `STUDYNARRATOR_DATA_DIR`. For Electron, remove the StudyNarrator application-data directory reported by System diagnostics. For Docker Web, `docker compose down --volumes` deletes the `studynarrator-data` volume and is irreversible; use it only when a complete reset is intended. Back up anything you need first.

## Docker environment reference

The checked-in [.env.example](.env.example) documents the complete Compose-facing configuration. Common settings are:

| Variable | Default | Purpose |
| --- | --- | --- |
| `STUDYNARRATOR_BIND_ADDRESS` | `127.0.0.1` | Host interface that publishes the Web UI. Keep loopback unless LAN access is intentional. |
| `STUDYNARRATOR_HOST_PORT` | `8080` | Host port for Docker Web. |
| `STUDYNARRATOR_IMAGE_TAG` | `0.1.0` | Local image version and OCI version label. |
| `STUDYNARRATOR_SOURCE_REVISION` | `local` | Revision reported by runtime diagnostics and the OCI image label. |

The Compose package fixes `STUDYNARRATOR_DATA_DIR` to `/data`, the only persistent container path. Direct Node and Electron runs can set `STUDYNARRATOR_DATA_DIR` to another writable directory. Set `STUDYNARRATOR_FFMPEG_PATH` only when FFmpeg is not discoverable on `PATH`.

## Troubleshooting

### StudyNarrator opens but reports Disconnected

1. Run `curl --fail http://127.0.0.1:8000/health` on the Speaches host.
2. Confirm the Speaches container is running with `docker compose ps` in its directory.
3. Use `http://host.docker.internal:8000` for Docker Web, not `localhost`.
4. Open **Settings**, verify the saved address, and run the connection test. The staged result identifies the failed URL, DNS, TCP, HTTP, model, voice, or audio check.

### The server is reachable but the model is unavailable

Run the model download again and confirm the exact ID:

```sh
SPEACHES_BASE_URL=http://127.0.0.1:8000 \
  uvx speaches-cli model download speaches-ai/Kokoro-82M-v1.0-ONNX

SPEACHES_BASE_URL=http://127.0.0.1:8000 \
  uvx speaches-cli model ls --task text-to-speech
```

Choose that same model in the StudyNarrator connection or project settings.

### Diagnostics report that FFmpeg is unavailable

Install FFmpeg and ensure `ffmpeg -version` and `ffprobe -version` work in the shell that launches StudyNarrator. The Docker Web image includes FFmpeg.

### Docker Web cannot write `/data`

The container runs as UID/GID `10001:10001`. The named volume works without host preparation. If you replace it with a bind mount, create the directory with ownership and write permission for that identity; do not make it world-writable.

## Development and verification

Run focused checks while developing:

```sh
npm run lint
npm run typecheck
npm run audit:dead-code
npm test
npm run test:api
```

The release-level verifier requires Node `26.7.0`, Playwright browser dependencies, Docker Compose, and Docker Scout:

```sh
npm run verify
```

`npm run verify:docker` can run the Docker acceptance suite alone. It builds the image, produces a CycloneDX dependency inventory, applies the Docker Scout vulnerability policy, runs Chromium and Firefox against a disposable Compose deployment, recreates the container to prove volume persistence, and removes the test deployment afterward.

## Documentation

- [Docker Web operations](deploy/docker/README.md)
- [Script grammar](docs/script-grammar-v1.md)
- [Product requirements and architecture](docs/study-narrator-prd-v1.3.md)
- [Speaches compatibility baseline](docs/baselines/speaches.md)
- [Permissive script recovery ADR](docs/adr/0001-permissive-script-recovery.md)
- [Official Speaches installation](https://speaches.ai/installation/)
- [Official Speaches text-to-speech guide](https://speaches.ai/usage/text-to-speech/)

## License and acknowledgments

StudyNarrator is licensed under the [Apache License 2.0](LICENSE). See [ACKNOWLEDGMENTS.md](ACKNOWLEDGMENTS.md) for project and workflow acknowledgments. Speaches, FFmpeg, models, voices, Electron, and other dependencies retain their own licenses.
