# R06 implementation report

**Story:** [R06 — Local Docker launcher](../prd-work-items/local-only-simplification.md#order-and-dependencies)
**Baseline:** `main` at `6e3846d6b4a2`
**Status:** Complete at the validated local checkpoint on 2026-09-14.

## Completion plan

- Current repository: `drofnas/studynarrator-ai`, branch
  `feature/complete-known-issues`, starting commit `8ec81ef`. The worktree and
  index were clean; no other repository is authorized.
- GitHub's open-issue queue is empty. The accepted local work-item table
  recommends R06 after the completed R04 and R07 slices. R06 entered review In progress
  with no dependencies. Its implementation is checkpoint `85b5c91`; the old
  Docker vulnerability failure was its remaining completion gate.
- Review the launcher, environment template, current guides, and verifier
  against all four acceptance criteria. Verify default and alternate ports,
  ignored obsolete LAN settings, and external fake-Speaches connectivity.
- Run focused checks and the full verifier through `compose.development.yaml`,
  review the implementation with Ponytail, then stage the completion records
  and create the requested local commit. Complete means all required gates
  pass and the reviewed changes form the local checkpoint; no push is requested.

## Outcome

- The existing Compose command remains the launcher; no wrapper script was added.
- Compose now publishes Docker Web on `127.0.0.1` only while retaining the configurable host port.
- The environment template and current setup guides no longer offer LAN access controls.
- Docker-to-host and private-network Speaches connections remain supported.

## Initial validation (before Docker verification was restored)

- `docker compose config` rendered `host_ip: 127.0.0.1` and published port `8080`.
- The focused Docker verifier tests passed: 16 tests.
- Formatting, lint, typechecking, 703 coverage tests, builds, 30 Web/Electron acceptance tests, and runtime smoke checks passed.
- Docker Scout stopped the full verifier on fixable high-severity vulnerabilities in the current image; cleanup passed.

## Completion review

- `compose.yaml` and `.env.example` are identical to the R06 implementation in
  `85b5c91`. The launcher uses Compose directly, publishes on loopback, and
  preserves the host-gateway mapping. The current verifier still uses an
  ephemeral loopback port and does not set the obsolete bind-address variable.
- Rendering Compose inside the tooling container with host ports 8080, 18080,
  and 49152 kept `host_ip: 127.0.0.1` and target port 4310. Supplying the old
  bind-address and Host-allowlist variables did not expose another interface or
  forward the sentinel host value. The environment template contains neither
  obsolete setting; the service receives only its data-directory setting.
- README, SETUP, and the Docker operations guide retain one local application
  launcher and distinguish the local Web UI from its supported external
  Speaches connection. Chromium and Firefox acceptance verified catalog
  discovery, offline authoring, reconnect, and rendering against the separate
  fake service through `host.docker.internal`.
- Ponytail review of the implementation and completion diff: **Lean already.
  Ship.** No additional source change is warranted. This checkpoint changes
  completion records only and adds no application runtime cost.

## Completion validation

All application tooling ran inside Docker using Node 24.19.0 and npm 11.19.0.
The workstation's documented legacy-builder fallback built the tooling image;
Buildx, Trivy, FFmpeg, test browsers, and Electron ran inside containers.

```sh
DOCKER_BUILDKIT=0 docker compose -f compose.development.yaml build verify
docker compose -f compose.development.yaml run --rm tools npm test -- scripts/development.test.ts scripts/verify-docker.test.ts
docker compose -f compose.development.yaml up --abort-on-container-exit --exit-code-from verify verify
```

- Focused tests: 19 passed, plus the three-port Compose acceptance probe.
- Full verifier: Knip within its existing allowance, formatting, lint,
  typecheck, 748 tests across 85 files with coverage, all builds, the Electron
  native rebuild, 33 Web/Electron acceptance tests, and three runtime smoke
  checks passed.
- Coverage: 86.92% statements, 76.30% branches, 87.15% functions, and 88.75%
  lines. No threshold, assertion, or security gate was weakened.
- Docker image construction, inventory, vulnerability policy, both browser
  acceptance tests, volume persistence/restart, and audited cleanup passed.
- Evidence remains uncommitted under `.tmp/r06-completion/`: the focused/full
  verifier logs and exported reports, including Docker run `run-uVJssG`.

## Completion and dependency sweep

Canonical R06 and its accepted dependency-table row move In progress → Complete.
The accepted graph has no active successor for R06. The historical R16 proposal
in FUTURE_WORK mentions R06 but remains explicitly deferred; this completion
does not authorize that work. No Ready transition or cross-repository edit is
required. GitHub's open-issue queue was refreshed and remains empty.

The checkpoint contains this report, R06's canonical task entry, and its local
dependency-table status. The next recommended unblocked item is R05. Only a
local commit was requested; hosted PR checks must run on any future submission.
