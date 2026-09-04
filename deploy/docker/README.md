# StudyNarrator Docker Web

This package runs StudyNarrator only. It does not install, start, update, or otherwise manage Speaches, model files, Python, or GPU drivers.

## Distribution support

Docker Web is a supported single-user distribution. Its supported Docker upgrade path retains the `studynarrator-data` named volume mounted at `/data`; application migrations run at startup.

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

The named `studynarrator-data` volume is mounted at `/data` and contains the SQLite database, cache, render artifacts, and generated exports. Recreating or upgrading the application container leaves this volume intact.

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

Run `npm run verify:docker` using the Node version in `.nvmrc` and npm version in the root `packageManager` before distributing an image. The verifier requires Docker Engine/Desktop with Buildx and Compose, Docker Scout, and Playwright's Chromium and Firefox binaries. It builds from the repository context with a disposable Buildx builder, exercises a disposable one-service Compose project, and verifies offline recovery and volume persistence in both browsers. Before reporting success, it removes and audits every verification-owned image, container, network, volume, builder, and build-cache volume. A later run also removes stale verification resources left by an ungraceful interruption; it never performs a global Docker prune or removes unrelated project cache.

The verifier writes a CycloneDX image inventory, raw Docker Scout SARIF report, and separate vulnerability applicability assessment under `.tmp/verify-docker/`. Critical findings fail unless the exact finding passes the documented, expiring [CVE-2026-52490 vulnerable-code-absence assessment](../../docs/security/CVE-2026-52490.md), including checks of the actual image filesystem and installed packages. This assessment does not suppress the raw finding or accept an exploitable critical vulnerability. A high finding with an available fix also fails; an unfixed high must match the package, CVE, rationale, and future expiry in `scout-high-exceptions.json`. That exception file is intentionally limited to FFmpeg's current Debian cJSON dependency and must be removed when Debian publishes a fixed package.
