# StudyNarrator AI — Setup

This guide covers the Speaches installation, the speech model download, the first StudyNarrator AI start, and connecting the two. StudyNarrator AI itself does not bundle a speech engine.

## Unsigned desktop installers: verify before opening

If a future desktop installer is published in an [official StudyNarrator AI GitHub Release](https://github.com/drofnas/studynarrator-ai/releases), it will be unsigned until code signing and notarization are available. Download it only from that published release, never a draft, then verify the installer against the published SHA-256 checksum in `SHA256SUMS.txt` before bypassing any warning. Do not continue if the checksum does not match.

After the checksum matches, use only the warning-specific path below; do not disable Gatekeeper or SmartScreen globally.

- **macOS Gatekeeper:** Move the app from the verified DMG to Applications. In Finder, Control-click the app, choose **Open**, then confirm **Open**. If macOS instead reports that the app was blocked, open **System Settings** > **Privacy & Security**, select **Open Anyway** for that app, then confirm **Open**.
- **Windows SmartScreen:** Start the verified installer. In the **Windows protected your PC** dialog, select **More info**, then **Run anyway**. If an organization policy prevents this option, do not change that policy; contact the organization administrator.

## 1. Set up Speaches

Install Docker Engine with the Compose plugin, or Docker Desktop. Speaches recommends Docker Compose and publishes separate CPU and NVIDIA CUDA configurations in its [official installation guide](https://speaches.ai/installation/).

Create a directory outside the StudyNarrator AI repository for Speaches:

```sh
mkdir speaches
cd speaches
```

Download the upstream [base Compose file](https://raw.githubusercontent.com/speaches-ai/speaches/master/compose.yaml)
and either the [CPU configuration](https://raw.githubusercontent.com/speaches-ai/speaches/master/compose.cpu.yaml)
or [CUDA configuration](https://raw.githubusercontent.com/speaches-ai/speaches/master/compose.cuda.yaml)
into that directory using your browser. CPU works with Docker Desktop on Apple
Silicon; CUDA requires the host's NVIDIA container runtime.

Start the selected configuration:

```sh
docker compose --file compose.cpu.yaml up --detach
```

Use `compose.cuda.yaml` instead for CUDA.

Confirm the server is running:

```sh
docker compose --file compose.cpu.yaml exec speaches curl --fail http://127.0.0.1:8000/health
```

The response should report a healthy service. If it does not, inspect the container:

```sh
docker compose --file compose.cpu.yaml ps
docker compose --file compose.cpu.yaml logs speaches
```

Use `compose.cuda.yaml` in those commands if you selected CUDA.

## 2. Install the Kokoro speech model

Speaches requires a model download before text-to-speech use. Run its CLI inside
the Speaches container, which already provides `uv`; no host Python or uv
installation is needed:

```sh
docker compose --file compose.cpu.yaml exec -e SPEACHES_BASE_URL=http://127.0.0.1:8000 speaches \
  uv tool run speaches-cli model download speaches-ai/Kokoro-82M-v1.0-ONNX
```

Confirm that the model appears in the installed text-to-speech model list:

```sh
docker compose --file compose.cpu.yaml exec -e SPEACHES_BASE_URL=http://127.0.0.1:8000 speaches \
  uv tool run speaches-cli model ls --task text-to-speech
```

The output should contain `speaches-ai/Kokoro-82M-v1.0-ONNX`.

Generate a small WAV file before connecting StudyNarrator AI:

```sh
docker compose --file compose.cpu.yaml exec -T speaches curl --fail --silent --show-error \
  http://127.0.0.1:8000/v1/audio/speech \
  --header 'Content-Type: application/json' \
  --data '{
    "input": "Speaches is ready for StudyNarrator AI.",
    "model": "speaches-ai/Kokoro-82M-v1.0-ONNX",
    "voice": "af_heart",
    "response_format": "wav"
  }' > speaches-test.wav

test -s speaches-test.wav && echo "Speaches text-to-speech is ready."
```

See the upstream [Speaches text-to-speech guide](https://speaches.ai/usage/text-to-speech/) for other models, voices, speeds, and API examples.

## 3. Start StudyNarrator AI

> **Distribution support:** Docker Web is a supported single-user distribution. Its supported Docker upgrade path retains the `studynarrator-data` named volume mounted at `/data`; application migrations run at startup.

Clone this repository in a different directory, then create its local environment file:

```sh
git clone https://github.com/drofnas/studynarrator-ai.git
cd studynarrator-ai
cp .env.example .env
```

The checked-in environment template configures the local StudyNarrator AI Web port and image metadata. Speaches is configured inside the application.

Build and start StudyNarrator AI:

```sh
docker compose up --build --detach
docker compose ps
```

Open <http://127.0.0.1:8080>. During onboarding, enter `http://host.docker.internal:8000` for Speaches running on the Docker host, load the catalog, review the selected model and default voice, then choose **Save and Test**. A connected result confirms DNS, TCP, HTTP, model, voice, and sample-audio checks.

StudyNarrator AI remains healthy if Speaches is stopped. You can continue editing and reconnect from Settings after Speaches returns without recreating the StudyNarrator AI container.

## Stop or update Docker Web

Stop the application while retaining projects and renders:

```sh
docker compose down
```

Rebuild after pulling an update:

```sh
git pull --ff-only
docker compose up --build --detach
```

The `studynarrator-data` named volume persists the SQLite database, speech cache, and render artifacts. Do not run `docker compose down --volumes` unless you intend to delete that data. See the [Docker operations guide](deploy/docker/README.md) for backup, restore, and bind-mount permissions.

## Connecting to Speaches from each runtime

Use the URL that the StudyNarrator AI backend can reach. Your browser may use a different URL:

| StudyNarrator AI runtime    | Speaches location               | Base URL                               |
| --------------------------- | ------------------------------- | -------------------------------------- |
| Docker Web                  | Same Docker host                | `http://host.docker.internal:8000`     |
| Web or Electron from source | Same machine                    | `http://127.0.0.1:8000`                |
| Any runtime                 | Another private-network machine | `http://<private-ip-or-dns-name>:8000` |
| Any runtime                 | Reverse proxy with TLS          | `https://<speech-host>`                |

`localhost` inside the StudyNarrator AI container refers to that container, not the Docker host. The supplied Compose file maps `host.docker.internal` through Docker's Linux host-gateway support.

StudyNarrator AI accepts a Speaches root URL or a URL ending in `/v1`; it normalizes the address before making API calls. Cross-origin browser access to Speaches is not required because the Node or Electron backend makes the requests.

The connection is a singleton owned by the application installation. Projects do not contain a connection ID, and neither runtime reads connection profiles or credentials from environment variables. StudyNarrator AI does not have an API-key field, credential vault, or operating-system credential-store integration; authenticated Speaches servers are rejected by the connection test.

## Development and automated verification

Use the [Docker development guide](deploy/development/README.md) to edit or test
StudyNarrator AI. Its tooling image includes the pinned Node/npm versions,
compilers, FFmpeg, browsers, and scanner. The regular application container and
Speaches container do not require those tools on your workstation.
