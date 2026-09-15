# Develop and verify inside Docker

## Requirements

Use Docker Engine or Docker Desktop with Compose 2.38.2 or newer and Buildx.
Keep your editor and browser on the workstation. All application tooling runs
inside containers: Node, npm, native compilers, FFmpeg, Trivy, Playwright, and
Linux Electron. Run the following commands from the repository root.

The image checks its Node and Trivy versions against `.nvmrc` and `.trivy-version`
and installs npm from `packageManager`. `npm ci` installs the unchanged lockfile.
The narrow `.npmrc` install-script list permits the pinned SQLite, esbuild, and
Windows packager setup scripts; dependency updates must review that list too.

The first build downloads tools and browsers. Later builds reuse dependency
layers until their inputs change. The production image remains separate and
contains none of these developer tools.

## Full verification

```sh
docker compose -f compose.development.yaml up --build --abort-on-container-exit --exit-code-from verify verify
```

This runs the existing `npm run verify` and returns its failure status. It covers
Knip, formatting, lint, typecheck, all default/API tests with coverage, builds,
Web and Linux Electron acceptance, three runtime smoke checks, and the Docker
distribution gate. No check is skipped to accommodate containers.

If an existing Docker Engine 29 installation lacks the Buildx plugin, its legacy
builder can bootstrap the tooling image without installing another host tool:

```sh
DOCKER_BUILDKIT=0 docker compose -f compose.development.yaml build verify
docker compose -f compose.development.yaml up --abort-on-container-exit --exit-code-from verify verify
```

For that installation, rebuild with the first command after source changes and
omit `--build` from subsequent commands. The tooling image still includes Buildx
for the isolated distribution checks. Newer Docker versions may require Buildx.

The `docker` service is a privileged Docker-in-Docker daemon. The non-root
verification runner shares that daemon's network namespace and Unix socket.
Consequently, its loopback URLs refer to the nested Docker host, including the
test application's published port and the fake Speaches service. The daemon
exposes no TCP API or workstation port. The workstation's Docker socket and user
data directories are never mounted. The checkout's `.git` directory is mounted
read-only for revision metadata; use a regular checkout for full verification.

Docker must support privileged nested containers. This setup is intended for
trusted repository code on a developer machine or disposable CI worker. The
privileged daemon is an infrastructure requirement, not a production service.

Generated files stay in the verification container. After it stops, copy any
needed reports before cleanup:

```sh
mkdir -p .tmp/docker-reports
docker compose -f compose.development.yaml cp verify:/workspace/coverage .tmp/docker-reports/
docker compose -f compose.development.yaml cp verify:/workspace/playwright-report .tmp/docker-reports/
docker compose -f compose.development.yaml cp verify:/workspace/test-results .tmp/docker-reports/
docker compose -f compose.development.yaml cp verify:/workspace/.tmp/verify-docker .tmp/docker-reports/
```

A report is absent if verification failed before producing it. Logs remain
available with `docker compose -f compose.development.yaml logs`.

## Focused commands and source edits

```sh
docker compose -f compose.development.yaml run --build --rm tools npm test -- scripts/development.test.ts
docker compose -f compose.development.yaml run --build --rm tools npm run test:api -- apps/server/src/app.test.ts
docker compose -f compose.development.yaml run --build --rm tools npm run test:e2e:web
docker compose -f compose.development.yaml run --build --rm tools npm run test:e2e:electron
docker compose -f compose.development.yaml run --build --rm verify npm run verify:docker
```

`tools` does not start a Docker daemon. `verify` starts the isolated daemon because
the distribution checks need one. Xvfb supplies a virtual display for Electron;
`tools` and `verify` grant the container `SYS_ADMIN` capability so Chromium's
setuid helper can create its sandbox namespaces. The Web development service
does not receive that capability. No `--no-sandbox` flag is used, and
the renderer sandbox, context isolation, and disabled Node integration remain
acceptance requirements. Container tests cover Linux, not actual Windows/macOS
desktop integration or native signing; those remain separate release work on
matching CI hosts.

The image contains a source snapshot. Use `--build` after source changes. For
formatting, explicitly mount the checkout at `/source` and use the image's tools:

```sh
docker compose -f compose.development.yaml run --build --rm -v "$PWD:/source" tools npm exec prettier -- --write /source/path/to/file
```

For a dependency update, run npm in the image, then copy the changed manifest
and root lockfile back with `docker cp` before removing the container. For
example, replace the package and workspace below with the intended change:

```sh
docker compose -f compose.development.yaml run --build --name studynarrator-dependency-update tools npm install package@version --workspace @studynarrator/web
docker cp studynarrator-dependency-update:/workspace/apps/web/package.json apps/web/package.json
docker cp studynarrator-dependency-update:/workspace/package-lock.json package-lock.json
docker rm studynarrator-dependency-update
```

Review the complete manifest and lockfile diff, including any install scripts,
then rebuild and verify. Never copy container `node_modules` onto the workstation.

## Live Web development

```sh
docker compose -f compose.development.yaml up --build --force-recreate --watch web
```

Open <http://127.0.0.1:5173>. Set `STUDYNARRATOR_DEV_PORT` in the command environment
to choose another host port. Only Vite's port is published, always on loopback;
the API stays inside the container and Vite proxies requests to it.

Compose Watch syncs source changes and rebuilds for dependency/toolchain inputs.
Keep `--build --force-recreate` when starting each watch session. The rebuilt
image supplies the initial source snapshot; recreating the container discards
edits synchronized during an earlier session, even when Docker reuses a cached
image. Development projects remain in the named volume.
It honors `.dockerignore`, keeping host dependencies, private environment files,
Git metadata, and generated artifacts out of the image and sync. Development
projects live in the `web-data` Docker volume, separate from the production data
volume. Use `host.docker.internal` to reach Speaches on the workstation's Docker
host. The fake speech server is used only for automated tests.

## Linux packaging

Linux packaging also runs in the tooling image. The release workflow uses this
command to produce unsigned AppImage and Debian installers:

```sh
docker compose -f compose.development.yaml run --build --name studynarrator-package-linux tools sh -c 'npm run rebuild:native --workspace @studynarrator/desktop && npm run package --workspace @studynarrator/desktop -- --linux --publish never'
docker cp studynarrator-package-linux:/workspace/apps/desktop/release apps/desktop/
docker rm studynarrator-package-linux
```

Exported installers are ignored by Git and Docker builds. macOS and Windows
packaging runs on matching GitHub Actions hosts.

## Stop and clean up

Stop and remove development containers while retaining development data:

```sh
docker compose -f compose.development.yaml --profile '*' down
```

After exporting reports, remove the entire disposable environment, including
development projects and the nested Docker cache, only when those are unwanted:

```sh
docker compose -f compose.development.yaml --profile '*' down --volumes
```

This uses the distinct `studynarrator-development` Compose project. The regular
`compose.yaml` application, its `studynarrator-data` volume, other Docker projects,
and the separately managed Speaches installation are unaffected.
