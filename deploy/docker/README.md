# StudyNarrator Docker Web

This package runs StudyNarrator only. It does not install, start, update, or otherwise manage Speaches, model files, Python, or GPU drivers.

## Start

Requirements: Docker Engine or Docker Desktop with Docker Compose.

1. Copy `.env.example` to `.env`.
2. Set `SPEACHES_BASE_URL` for the separately installed Speaches server.
3. Leave `SPEACHES_API_KEY` empty when the server does not require one; otherwise protect the `.env` file as a credential.
4. Run `docker compose up --build -d`.
5. Open <http://127.0.0.1:8080> and use **Runtime** and **Settings** to check the installation.

The supplied Compose package binds to loopback by default. Change `STUDYNARRATOR_BIND_ADDRESS` only when browser access from another device is intentional and the surrounding network is trusted.

## Connect to Speaches

- Docker host: `http://host.docker.internal:8000`
- Private server: `http://192.168.1.50:8000`
- Private DNS: `http://speaches.home.arpa:8000`

`localhost` inside the StudyNarrator container refers to StudyNarrator's container, not the Docker host. The Compose file supplies the Linux `host-gateway` mapping used by `host.docker.internal`.

Follow the official [Speaches installation guide](https://speaches.ai/installation/) and [text-to-speech guide](https://speaches.ai/usage/text-to-speech/) for Speaches installation, hardware, model, and voice setup.

StudyNarrator starts and remains healthy while Speaches is offline. Project editing, parsing, lexicon work, dry runs, and prompt exports remain available. Preview and rendering recover after the configured Speaches endpoint becomes reachable; the StudyNarrator container does not need to restart.

## Data and upgrades

The named `studynarrator-data` volume is mounted at `/data` and contains the SQLite database, cache, frozen plans, render artifacts, and generated exports. Recreating or upgrading the application container leaves this volume intact.

Before an upgrade, stop StudyNarrator and back up the volume:

```sh
docker compose stop study-narrator
docker run --rm --volume studynarrator_studynarrator-data:/data:ro --volume "$PWD:/backup" alpine \
  tar -C /data -czf /backup/studynarrator-data.tgz .
docker compose start study-narrator
```

Restore only into an empty replacement volume while StudyNarrator is stopped. Confirm the actual Compose volume name with `docker volume ls`; a custom Compose project name changes the prefix.

The default named volume inherits the image's non-root ownership. For a bind mount, create the host directory for container UID/GID `10001:10001` and grant only that identity read/write access. Do not make the directory world-writable.

`docker compose down` preserves the named volume. `docker compose down --volumes` deletes it and is therefore not an upgrade command.

## Distribution contents and security

The image contains Node.js, the compiled StudyNarrator Web/server application, FFmpeg, CA certificates, the Apache-2.0 `LICENSE`, and `ACKNOWLEDGMENTS.md`. It runs as UID/GID 10001, drops Linux capabilities, prevents privilege escalation, uses a read-only root filesystem, and writes persistent application state only under `/data`.

The Speaches API key remains in the Node.js process environment. It must never be copied into browser storage, projects, manifests, diagnostics exports, or normal logs.
