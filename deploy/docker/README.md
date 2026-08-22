# StudyNarrator Docker Web

This package runs StudyNarrator only. It does not install, start, update, or otherwise manage Speaches, model files, Python, or GPU drivers.

## Start

Requirements: Docker Engine or Docker Desktop with Docker Compose.

1. Copy `.env.example` to `.env`.
2. Run `docker compose up --build -d`.
3. Open <http://127.0.0.1:8080> and enter the separately installed Speaches address during onboarding.
4. Load the catalog, review the selected model and default voice, then choose **Save and Test**.

The supplied Compose package binds to loopback by default. Change `STUDYNARRATOR_BIND_ADDRESS` only when browser access from another device is intentional and the surrounding network is trusted.

StudyNarrator also validates every HTTP `Host` header. By default it accepts only `localhost`, `127.0.0.1`, and `[::1]` (with or without a port), plus its configured listen host. For intentional LAN or reverse-proxy exposure, use a custom Compose override to pass the additional comma-separated hosts into the container:

```yaml
services:
  study-narrator:
    environment:
      STUDYNARRATOR_ALLOWED_HOSTS: study.example.test,192.168.1.50
```

Do not treat the Compose `.env` file as container environment configuration: the supplied Compose file uses it only for host binding, ports, and image metadata. Keep the allowlist narrow; this setting does not add authentication.

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

StudyNarrator supports unauthenticated Speaches servers. Connection settings are stored in the application data volume and are not supplied through Compose environment variables.

## Release verification

Run `npm run verify:docker` under Node 26.7.0 before distributing an image. The verifier requires Docker Engine/Desktop, Docker Compose, Docker Scout, and Playwright's Chromium and Firefox binaries. It builds from the repository context, exercises a disposable one-service Compose project, verifies offline recovery and volume persistence in both browsers, and removes its test volume on completion.

The verifier writes a CycloneDX image inventory and Docker Scout SARIF report under `.tmp/verify-docker/`. Critical findings always fail. A high finding with an available fix also fails; an unfixed high must match the package, CVE, rationale, and future expiry in `scout-high-exceptions.json`. That exception file is intentionally limited to FFmpeg's current Debian cJSON dependency and must be removed when Debian publishes a fixed package.
