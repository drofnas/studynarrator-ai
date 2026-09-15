# R10a: Trivy Docker scanner

## Completion review — 2026-09-15

**Status:** Complete. The current checkout is `drofnas/studynarrator-ai`, on
`feature/complete-known-issues`, with source commit
`a3f43e84e97002bcbdd7867a23493f43c171b5c2`. Its index and working tree started
clean. No other repository is in scope. GitHub issue discovery returned no open
issues; [TASKS.md](../TASKS.md) and the accepted
[dependency table](../prd-work-items/local-only-simplification.md) supply the
work item and completion rules.

R10a has no dependencies. Complete requires acceptance, passing verification,
and staged changes. R10b depends on R10a and R07a; R07a was already Complete.
This review ran the Docker policy, audio evidence, cleanup, and tooling tests,
then the full verifier against the current source. It corrected the outdated
operational policy description and recorded current image evidence. The
existing implementation satisfied the scanner slice; this checkpoint changes
only documentation and tracker state, with no runtime or performance impact.

## Outcome

The local Docker verifier now uses the open-source Trivy CLI without a Docker
account or registry login. The repository pins Trivy in `.trivy-version`, creates
one JSON vulnerability report for policy evaluation, and converts that report to
CycloneDX and SARIF so all three artifacts describe the same scan.

The policy rejects malformed reports, every critical finding, and every fixable
high. An unfixed high requires either a narrow current exception or the existing
[audio build applicability assessment](../security/docker-audio-build.md).
That assessment binds the exact image, source, installed package, SBOM,
configuration, binary checksums, and expiry. The exception file is now empty;
the historical TIFF assessment and cJSON exceptions were retired when the image
stopped including those components.

## Current validation

All application tooling ran in Docker with Node 24.19.0, npm 11.19.0, and Trivy
0.74.0. The workstation's missing Buildx was handled by the
[documented legacy-builder fallback](../../deploy/development/README.md#full-verification);
the nested verifier used its bundled Buildx.

```sh
DOCKER_BUILDKIT=0 docker compose -f compose.development.yaml build verify
docker compose -f compose.development.yaml run --rm tools npm test -- scripts/verify-docker-vulnerabilities.test.ts scripts/verify-docker-audio.test.ts scripts/verify-docker.test.ts scripts/development.test.ts
docker compose -f compose.development.yaml up --abort-on-container-exit --exit-code-from verify verify
```

- Focused policy, audio evidence, cleanup, and tooling suites: 51 tests passed.
- Full verifier: Knip within its existing three-finding allowance, formatting,
  lint, typecheck, 750 tests across 86 files with coverage, all builds, Electron
  native rebuild, 34 Web/Electron acceptance tests, and three runtime smokes
  passed. Coverage: 86.92% statements, 76.30% branches, 87.16% functions,
  88.76% lines.
- Fresh amd64 image:
  `sha256:a3eec2abb7c880356792382a12ce59125ab88be58c5bd061ebd471a6f7486732`.
  The high/critical scan reported zero critical findings, 16 highs, and zero
  findings with a fixed version. All 16 highs passed the existing exact-build
  applicability assessment, which expires on 2026-10-14 UTC. Raw findings remain
  in the report; this is not a claim that the image has no vulnerabilities.
- CycloneDX inventory: 103 components. SARIF output: version 2.1.0. Docker
  hardening, Chromium and Firefox acceptance, persistence/restart, offline
  recovery, cleanup, and the final leftover-resource audit all passed.
- Ignored evidence: `.tmp/r10a-completion/`, including `focused.log`, `verify.log`,
  `image-summary.json`, coverage/Playwright reports, and Docker run `run-OhKj93`.

## Initial implementation evidence

- The Trivy 0.74.0 macOS arm64 release archive matched Aqua Security's published
  SHA-256 checksum, and its CLI confirmed JSON-to-CycloneDX and JSON-to-SARIF
  conversion support.
- The focused Docker policy and resource lifecycle suites passed: 44 tests.
- Ponytail review removed the redundant `--list-all-pkgs` flag because it is the
  pinned Trivy release's default. Net reduction: two lines.
- A fresh `npm run verify:docker` built and scanned the exact local image, wrote
  valid Trivy JSON, CycloneDX, and SARIF files, collected the TIFF image evidence,
  then removed and audited its disposable Docker resources.
- The full `npm run verify` cleared dependency, formatting, lint, type, coverage,
  build, Web Playwright (30 tests), server smoke, Electron smoke, and server reopen
  gates before reaching the Docker vulnerability policy.
- The initial full Docker run correctly stopped at the vulnerability policy.
  Its Debian image produced 205 findings: one unassessed critical, 204 highs, and
  five fixable highs. Those findings required remediation or separately reviewed
  narrow exceptions; the scanner migration did not weaken the policy.

## Tracker state

The original scanner checkpoint left R10a **In progress** and R10b **Waiting**
because its image vulnerability gate failed. Current validation clears that
blocker. The staged slice contains this report, the corrected Docker policy
guide, the canonical R10 slice status, and the dependency table.

| Item | Transition             | Evidence                                              |
| ---- | ---------------------- | ----------------------------------------------------- |
| R10a | In progress → Complete | Scanner acceptance, full verification, staged changes |
| R10b | Waiting → Ready        | R10a and R07a complete; existing CI scope and tools   |

The complete dependency table has one R10a successor, R10b, in this repository.
Its acceptance criteria and secret-free Docker tooling are available; no owner
decision or other readiness gate blocks it. Historical dependency links remain.
The parent R10 stays In progress for R10b; no second story is implemented here.

The staged candidate contains no unrelated work. Local mandatory gates pass;
GitHub Actions `check` remains required on any future PR submission. This request
authorizes a local checkpoint only.

## Ponytail review

Lean already. Ship.
