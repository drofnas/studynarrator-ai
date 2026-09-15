# PR 28: Hosted Compose compatibility

## Scope

The first hosted PR run failed before application tests because Docker Compose
2.38.2 rejects `develop.watch.initial_sync`. The workstation's Compose 2.40.3
accepted it, so local verification did not catch the incompatibility. The same
failure reproduces with the formerly documented minimum, Compose 2.32.2, which
also rejects the existing Watch `include` setting. The tested minimum is now
Compose 2.38.2; keep the dependency-triggered rebuild rules intact.

Remove that optional setting. The documented
`up --build --force-recreate --watch web` command starts each session from the
rebuilt image, including when the image is cached and the previous container
held synchronized edits. Named-volume data survives recreation. Source
synchronization and dependency-triggered rebuilds remain configured. No installed dependency,
verification gate, or branch rule changes. There is no application hot-path or
runtime performance change.

## Validation

Official Linux amd64 Compose 2.32.2 and 2.38.2 binaries matched their release
SHA-256 checksums and ran inside the Docker tooling image. Before the fix, both
reject the actual development configuration at `initial_sync`. After the fix,
the complete development configuration and all three existing development tests
pass using Compose 2.38.2 as the Docker CLI plugin. Compose 2.32.2 still rejects
`include`, establishing why its previous support claim was incorrect. Logs and
downloaded tools stay ignored under `.tmp/compose-compat/`.

- Full Docker verification passed on implementation tree
  `ff1f06515ff28c97b193d37a16704ebbacc46ea2`: formatting, lint, typecheck,
  Knip, 769 tests across 86 files, coverage, builds, 35 Web/Electron acceptance
  tests, three runtime smokes, and all Docker security, browser, and cleanup
  checks. Only documentation changes followed that run.
- A disposable Web startup probe verified that `--force-recreate` restores the
  image's source after a previous container's files were modified, preserves
  the named-volume data, and starts the Web server. Its containers, volume, and
  network were removed. No user application data was used.
- Final changed-document formatting and diff hygiene pass. The runtime fix is
  one removed optional setting. Ponytail review: **Lean already. Ship.**

The full check used the documented legacy-builder fallback:

```sh
DOCKER_BUILDKIT=0 docker compose -f compose.development.yaml build verify
docker compose -f compose.development.yaml up --abort-on-container-exit --exit-code-from verify verify
```

The remaining PR gate-name mismatch (`check` versus `check / check`) is separate
from this Compose parser correction; branch protection stays enforced.
