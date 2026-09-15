# StudyNarrator AI

StudyNarrator AI is a local-first authoring and text-to-speech application for turning structured study scripts into narrated audio. It provides a React Web interface and an Electron desktop development client backed by the same TypeScript parser, persistence, connection, and rendering services.

Use it to:

- Write scripts with speakers, sections, and explicit pauses.
- Map speakers to text-to-speech models and voices.
- Maintain project and global pronunciation lexicons.
- Test short passages in the Quick Scratchpad.
- Render, review, and export MP3 audio, transcripts, project snapshots, and individual speech segments.
- Export prompt kits for creating or updating scripts with an external language model.
- Continue authoring while the speech server is offline.

StudyNarrator AI does not bundle a speech engine. It sends synthesis requests to an external [Speaches](https://speaches.ai/) server through the OpenAI-compatible text-to-speech API.

> **Beta distribution status:** Docker Web is a supported single-user distribution. Its supported Docker upgrade path retains the `studynarrator-data` named volume mounted at `/data`; application migrations run at startup. Electron is available from source only; unsigned desktop installers are not published, and cross-target native verification remains deferred.

## Quick start: Docker Web

See [SETUP.md](SETUP.md) for the full setup: Speaches installation, the speech model download, starting StudyNarrator AI, and connecting them. In short, with Docker Engine and the Compose plugin available:

```sh
git clone https://github.com/drofnas/studynarrator-ai.git
cd studynarrator-ai
cp .env.example .env
docker compose up --build --detach
```

Open <http://127.0.0.1:8080> and complete the onboarding connection to Speaches.

## Develop in Docker

Development and verification require Docker Engine/Desktop with Compose and
Buildx. Node, npm, compilers, FFmpeg, test browsers, and Trivy are installed in a
separate tooling image. No application toolchain is required on your workstation.

Start the live Web development server:

```sh
docker compose -f compose.development.yaml up --build --watch web
```

Open <http://127.0.0.1:5173>. Compose Watch syncs source edits into the container;
the dependency tree stays inside its image. Development data lives in a separate
Docker volume and survives service recreation. Use `host.docker.internal` for
Speaches running on the Docker host.

Use the final, unauthenticated Speaches address directly. Catalog discovery,
connection checks, and synthesis reject redirects with sanitized errors,
including redirects from optional voice catalogs.

Run the complete verification pipeline:

```sh
docker compose -f compose.development.yaml up --build --abort-on-container-exit --exit-code-from verify verify
```

This includes Linux Electron tests on a virtual display. Native macOS/Windows
packaging stays on matching CI hosts; platform acceptance and signing remain
separate release work.
See the [development guide](deploy/development/README.md) for focused commands,
formatting, reports, dependency changes, and cleanup.

## Application surfaces

The primary navigation is **Prompt Kit**, **Projects**, **Quick Scratchpad**, and **Settings**, with **General**, **Voices**, **Lexicon**, **Timings**, and **System diagnostics** beneath Settings. Web requests use the manifest-backed `/api` surface for runtime diagnostics, projects, prompt export, previews, render plans and renders, pacing, preferences, the global lexicon, the singleton connection, setup, voice catalogs, Scratchpad, and speech-cache controls. Electron exposes the same operations through its validated public IPC manifest; operation names are contract-tested in both transports.

New installations include built-in Global Lexicon defaults for common acronyms and ambiguous pronunciations. Named-sense aliases use `word/sense` directly in scripts, such as `resume/cv`. Built-in entries can only be enabled or disabled. Add fully editable Custom Lexicon entries for personal rules; reimporting the bundled Global Lexicon catalog restores only built-ins and preserves every custom entry.

## Data upgrades and backups

StudyNarrator AI migrates the database forward automatically when it starts. Before any schema upgrade it takes a full backup of the current database in the `backups/` directory next to the database file, for example `<dataDir>/backups/`.

Old backups are pruned automatically: the newest backup for each source schema version, plus the three most recent backup files, plus the two most recent pre-restore safety copies always survive.

If the data directory was created by a newer version of this application, a recovery screen appears at startup offering a restore from one of those backups. Nothing is ever deleted or converted automatically.

## Docker environment reference

The checked-in [.env.example](.env.example) documents the complete Compose-facing configuration. Common settings are:

| Variable                        | Default | Purpose                                                           |
| ------------------------------- | ------- | ----------------------------------------------------------------- |
| `STUDYNARRATOR_HOST_PORT`       | `8080`  | Host port for Docker Web, published on `127.0.0.1` only.          |
| `STUDYNARRATOR_IMAGE_TAG`       | `0.1.0` | Local image version and OCI version label.                        |
| `STUDYNARRATOR_SOURCE_REVISION` | `local` | Revision reported by runtime diagnostics and the OCI image label. |

The Compose package fixes `STUDYNARRATOR_DATA_DIR` to `/data`, the only persistent container path. Direct Node and Electron runs can set `STUDYNARRATOR_DATA_DIR` to another writable directory. Set `STUDYNARRATOR_FFMPEG_PATH` only when FFmpeg is not discoverable on `PATH`.

The Docker runtime uses a minimal Debian 13 Node image and an FFmpeg build limited
to the application's WAV/MP3 audio operations. It contains no shell or package
manager. Speech-service HTTP/HTTPS connections remain supported by the app.
See the [audio build and security assessment](docs/security/docker-audio-build.md)
for source, licenses, package inventory, and update validation.

## Render activity

The sidebar keeps queued/running renders and unviewed completed, failed, or
canceled results available while you work elsewhere. Open a result there to view
its exact Render tab output and remove its notification. Opening active work
keeps its later completion unviewed. Older results remain selectable until their
audio is removed by retention or cleanup.

Viewed state is stored locally for this browser or desktop profile using only
render IDs. It survives reloads and desktop restarts; clearing browser storage
resets it. If local storage is unavailable, viewed state lasts for the current
session. The app periodically reconciles activity with existing render history.

## Audio storage

General settings shows **Product Renders** alongside the speech cache: total
project-audio storage and the reclaimable portion. Statistics refresh while the
page is open, when you return, after cleanup, and with **Refresh**. Unavailable
storage is shown explicitly instead of as zero.

**Clear all cached speech** clears previews. Selecting **Include Rendered Project
Clips** also clears eligible project audio after confirmation. Pinned and unfinished
renders are protected; clip cleanup waits until no render is active or recoverable.
Projects and render history are preserved. The result reports total space freed and the
project-render portion, so that portion is already included in the total.

## Troubleshooting

### StudyNarrator AI opens but reports Disconnected

1. Check the Speaches container health using its Compose configuration.
2. Confirm the Speaches container is running with `docker compose ps` in its directory.
3. Use `http://host.docker.internal:8000` for Docker Web, not `localhost`.
4. Open **Settings**, verify the saved address, and run the connection test. The staged result identifies the failed URL, DNS, TCP, HTTP, model, voice, or audio check.

### The server is reachable but the model is unavailable

From the Speaches Compose directory, run the model download inside its container and confirm the exact ID (use the CUDA Compose file if applicable):

```sh
docker compose --file compose.cpu.yaml exec -e SPEACHES_BASE_URL=http://127.0.0.1:8000 speaches \
  uv tool run speaches-cli model download speaches-ai/Kokoro-82M-v1.0-ONNX

docker compose --file compose.cpu.yaml exec -e SPEACHES_BASE_URL=http://127.0.0.1:8000 speaches \
  uv tool run speaches-cli model ls --task text-to-speech
```

Choose that same model in the StudyNarrator AI connection or project settings.

### Diagnostics report that FFmpeg is unavailable

Both the application and development Docker images include FFmpeg. Rebuild the affected image and check its container logs; installing FFmpeg on the workstation does not repair a container.

### Docker Web cannot write `/data`

The container runs as UID/GID `10001:10001`. The named volume works without host preparation. If you replace it with a bind mount, create the directory with ownership and write permission for that identity; do not make it world-writable.

## Development and verification

[CONTRIBUTING.md](CONTRIBUTING.md) describes the Docker-based development workflow.
The full verifier retains formatting, lint, typechecking, coverage, builds,
Web/Electron acceptance, runtime smoke checks, and Docker distribution checks.
The Docker checks use a dedicated nested daemon, scan the actual image with
Trivy, and verify browser behavior, persistence, and resource cleanup. Locally,
reports remain in the stopped verification container for inspection or export.

[Docker verification](.github/workflows/docker-verification.yml) runs the same
pipeline for pull requests and main pushes through CI, plus weekly, manual, and
`v*` tag runs. Docker distribution claims require a green run for the exact
revision. Jobs are limited to 30 minutes; failed runs retain only scanner evidence
for seven days. Native packaging remains independent of this Docker gate.

## Documentation

- [Setup (Speaches, model, first-run connection)](SETUP.md)
- [Upgrading, downgrading, and your data](UPGRADE.md)
- [Contributing](CONTRIBUTING.md)
- [Security policy and private vulnerability reporting](SECURITY.md)
- [Docker Web operations](deploy/docker/README.md)
- [Script grammar](docs/script-grammar-v1.md)
- [Speaches compatibility baseline](docs/baselines/speaches.md)
- [Permissive script recovery ADR](docs/adr/0001-permissive-script-recovery.md)
- [Official Speaches installation](https://speaches.ai/installation/)
- [Official Speaches text-to-speech guide](https://speaches.ai/usage/text-to-speech/)

## License and acknowledgments

StudyNarrator AI is licensed under the [Apache License 2.0](LICENSE). See [ACKNOWLEDGMENTS.md](ACKNOWLEDGMENTS.md) for project and workflow acknowledgments. Speaches, FFmpeg, models, voices, Electron, and other dependencies retain their own licenses.
