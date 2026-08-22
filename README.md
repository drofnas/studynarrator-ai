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

> **Beta distribution status:** Docker Web is a supported single-user distribution. Its supported Docker upgrade path retains the `studynarrator-data` named volume mounted at `/data`; application migrations run at startup. Electron is available from source only; unsigned desktop installers are not published, and cross-target native verification remains deferred.

## Quick start: Docker Web

See [SETUP.md](SETUP.md) for the full setup: Speaches installation, the speech model download, starting StudyNarrator, and connecting them. In short, with Docker Engine and the Compose plugin available:

```sh
git clone https://github.com/drofnas/studynarrator-ai.git
cd studynarrator-ai
cp .env.example .env
docker compose up --build --detach
```

Open <http://127.0.0.1:8080> and complete the onboarding connection to Speaches.

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

## Application surfaces

The primary navigation is **Prompt Kit**, **Projects**, **Quick Scratchpad**, and **Settings**, with **General**, **Voices**, **Lexicon**, **Timings**, and **System diagnostics** beneath Settings. Web requests use the manifest-backed `/api` surface for runtime diagnostics, projects, prompt export, previews, render plans and renders, pacing, preferences, the global lexicon, the singleton connection, setup, voice catalogs, Scratchpad, and speech-cache controls. Electron exposes the same operations through its validated public IPC manifest; operation names are contract-tested in both transports.

New installations include editable Global Lexicon defaults for common acronyms and ambiguous pronunciations. Named-sense aliases use `word/sense` in Settings and resolve explicit script annotations such as `{{resume|cv}}`; users may edit, disable, or delete any default without the application restoring it on restart.

## Data upgrades and backups

StudyNarrator migrates the database forward automatically when it starts. Before any schema upgrade it takes a full backup of the current database in the `backups/` directory next to the database file, for example `<dataDir>/backups/`.

Old backups are pruned automatically: the newest backup for each source schema version, plus the three most recent backup files, plus the two most recent pre-restore safety copies always survive.

If the data directory was created by a newer version of this application, a recovery screen appears at startup offering a restore from one of those backups. Nothing is ever deleted or converted automatically.

## Docker environment reference

The checked-in [.env.example](.env.example) documents the complete Compose-facing configuration. Common settings are:

| Variable                        | Default     | Purpose                                                                                   |
| ------------------------------- | ----------- | ----------------------------------------------------------------------------------------- |
| `STUDYNARRATOR_BIND_ADDRESS`    | `127.0.0.1` | Host interface that publishes the Web UI. Keep loopback unless LAN access is intentional. |
| `STUDYNARRATOR_HOST_PORT`       | `8080`      | Host port for Docker Web.                                                                 |
| `STUDYNARRATOR_IMAGE_TAG`       | `0.1.0`     | Local image version and OCI version label.                                                |
| `STUDYNARRATOR_SOURCE_REVISION` | `local`     | Revision reported by runtime diagnostics and the OCI image label.                         |

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

- [Setup (Speaches, model, first-run connection)](SETUP.md)
- [Upgrading, downgrading, and your data](UPGRADE.md)
- [Docker Web operations](deploy/docker/README.md)
- [Script grammar](docs/script-grammar-v1.md)
- [Product requirements and architecture](docs/study-narrator-prd-v1.3.md)
- [Speaches compatibility baseline](docs/baselines/speaches.md)
- [Permissive script recovery ADR](docs/adr/0001-permissive-script-recovery.md)
- [Official Speaches installation](https://speaches.ai/installation/)
- [Official Speaches text-to-speech guide](https://speaches.ai/usage/text-to-speech/)

## License and acknowledgments

StudyNarrator is licensed under the [Apache License 2.0](LICENSE). See [ACKNOWLEDGMENTS.md](ACKNOWLEDGMENTS.md) for project and workflow acknowledgments. Speaches, FFmpeg, models, voices, Electron, and other dependencies retain their own licenses.
