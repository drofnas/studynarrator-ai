# StudyNarrator AI Docker Web

This package runs StudyNarrator AI only. It does not install, start, update, or otherwise manage Speaches, model files, Python, or GPU drivers.

## Distribution support

Docker Web is a supported single-user distribution. Its supported Docker upgrade path retains the `studynarrator-data` named volume mounted at `/data`; application migrations run at startup.

## Start

Requirements: Docker Engine or Docker Desktop with Docker Compose.

1. Copy `.env.example` to `.env`.
2. Run `docker compose up --build -d`.
3. Open <http://127.0.0.1:8080> and enter the separately installed Speaches address during onboarding.
4. Load the catalog, review the selected model and default voice, then choose **Save and Test**.

The supplied Compose package publishes the Web UI on `127.0.0.1` only. Its `.env` file configures the host port and image metadata; Speaches connection settings are entered inside StudyNarrator AI.

## Connect to Speaches

- Docker host: `http://host.docker.internal:8000`
- Private server: `http://192.168.1.50:8000`
- Private DNS: `http://speaches.home.arpa:8000`

`localhost` inside the StudyNarrator AI container refers to StudyNarrator AI's container, not the Docker host. The Compose file supplies the Linux `host-gateway` mapping used by `host.docker.internal`.

Follow the official [Speaches installation guide](https://speaches.ai/installation/) and [text-to-speech guide](https://speaches.ai/usage/text-to-speech/) for Speaches installation, hardware, model, and voice setup.

### Releasing Speaches memory

Speaches keeps model memory after requests finish. On the Speaches Docker host, `scripts/speaches/speaches-idle-restart.sh` restarts the Speaches container once its CPU use has stayed below the idle threshold for 10 minutes while it still holds memory. Each check takes one CPU sample, records the last active time, and prints one log line. Open connections are ignored, because a reverse proxy such as Tailscale Serve keeps its connection to Speaches open while idle. Pass `--dry-run` to see the decision without restarting.

Install it as a systemd service:

```sh
sudo install -m 755 scripts/speaches/speaches-idle-restart.sh /usr/local/bin/
sudo install -m 644 scripts/speaches/speaches-idle-restart.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now speaches-idle-restart.service
journalctl -u speaches-idle-restart.service -f
```

To run it from cron instead, call it without `--watch` once a minute. Only one copy runs at a time.

Override the defaults with `Environment=` lines in the unit: `SPEACHES_CONTAINER` (`speaches`), `SPEACHES_IDLE_MINUTES` (`10`), `SPEACHES_IDLE_CPU_THRESHOLD` (`2`, percent), `SPEACHES_RESTART_MEMORY_THRESHOLD` (`5`, percent), `SPEACHES_CHECK_INTERVAL_SECONDS` (`60`), and `SPEACHES_STATE_DIR`.

StudyNarrator AI starts and remains healthy while Speaches is offline. Project editing, parsing, lexicon work, dry runs, and prompt exports remain available. Preview and rendering recover after the configured Speaches endpoint becomes reachable; the StudyNarrator AI container does not need to restart.

## Data and upgrades

The named `studynarrator-data` volume is mounted at `/data` and contains the SQLite database, cache, render artifacts, and generated exports. Recreating or upgrading the application container leaves this volume intact.

Before an upgrade, stop StudyNarrator AI and back up the volume:

```sh
docker compose stop study-narrator
docker run --rm --volume studynarrator_studynarrator-data:/data:ro --volume "$PWD:/backup" alpine \
  tar -C /data -czf /backup/studynarrator-data.tgz .
docker compose start study-narrator
```

Restore only into an empty replacement volume while StudyNarrator AI is stopped. Confirm the actual Compose volume name with `docker volume ls`; a custom Compose project name changes the prefix.

The default named volume inherits the image's non-root ownership. For a bind mount, create the host directory for container UID/GID `10001:10001` and grant only that identity read/write access. Do not make the directory world-writable.

`docker compose down` preserves the named volume. `docker compose down --volumes` deletes it and is therefore not an upgrade command.

## Distribution contents and security

The compiled Web application carries a Content Security Policy that restricts
resource loads to its own origin, blocks plugins and framing, and rejects inline
scripts and markup style attributes. CodeMirror's generated stylesheet has a
documented [style-element exception](../../docs/technical-debt.md#production-csp--inline-style-elements-for-codemirror).
Speaches requests still run through the server. Vite and Electron development
loading do not receive this production Web policy.

The image contains Node.js, the compiled StudyNarrator AI Web/server application, FFmpeg, CA certificates, the Apache-2.0 `LICENSE`, and `ACKNOWLEDGMENTS.md`. It runs as UID/GID 10001, drops Linux capabilities, prevents privilege escalation, uses a read-only root filesystem, and writes persistent application state only under `/data`.

StudyNarrator AI supports unauthenticated Speaches servers. Connection settings are stored in the application data volume and are not supplied through Compose environment variables. The local-only boundary applies to the StudyNarrator AI Web UI; Speaches may run on the Docker host or another private-network machine.

## Release verification

Run the Docker acceptance suite from the repository root:

```sh
docker compose -f compose.development.yaml run --build --rm verify npm run verify:docker
```

The [development environment](../development/README.md) supplies Node, npm,
Buildx, Compose, Trivy, and Playwright inside Docker. It uses a dedicated nested
Docker daemon; no host Node, FFmpeg, compiler, or scanner installation is needed.
The verifier builds with a disposable Buildx builder, exercises a disposable
one-service Compose project, and verifies offline recovery and volume persistence
in Chromium and Firefox. It removes and audits every verification-owned image,
container, network, volume, builder, and build-cache volume before success. A
later run also removes stale verification resources left by an interruption; it
never performs a global Docker prune.

The verifier writes a Trivy JSON vulnerability report, a CycloneDX image
inventory, and a separate vulnerability applicability
assessment under `.tmp/verify-docker/`. Critical findings and highs with an
available fix fail. An unfixed high requires a package-and-CVE-specific,
justified, unexpired entry in `container-high-exceptions.json`, or the documented
[audio build applicability assessment](../../docs/security/docker-audio-build.md).
The exception file is currently empty. The audio assessment requires evidence
that the affected code is absent from the exact scanned build and preserves the
raw findings. Malformed reports, stale exceptions, and changed or expired
assessment evidence fail verification.

The [reusable Docker workflow](../../.github/workflows/docker-verification.yml)
runs this full verification through CI for pull requests into the `integration`
and `release` branches, and directly on manual dispatch. It does not run for
pull requests into the default branch, default-branch pushes, tags, or a
schedule. Checkout uses the triggering revision.
The job requires no registry login or repository secret, has a 30-minute timeout,
cancels obsolete runs for the same workflow/ref, and always removes its disposable
environment. Only the inventory, Trivy JSON, and applicability assessment are
uploaded on failure, with seven-day retention. Local browser/coverage reports
remain available through the development guide's export commands.
