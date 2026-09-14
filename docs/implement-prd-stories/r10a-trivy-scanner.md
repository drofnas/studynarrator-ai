# R10a: Trivy Docker scanner

## Outcome

The local Docker verifier now uses the open-source Trivy CLI without a Docker
account or registry login. The repository pins Trivy in `.trivy-version`, creates
one JSON vulnerability report for policy evaluation, and converts that report to
CycloneDX and SARIF so all three artifacts describe the same scan.

The policy reads Trivy's documented JSON fields and fails closed on malformed
reports. It rejects every unassessed critical, every fixable high, every unfixed
high without a narrow current exception, and every stale exception. The existing
TIFF vulnerable-code assessment remains bound to the exact image, installed
package, SBOM, filesystem evidence, and expiry. The cJSON exceptions now match
Trivy's installed `libcjson1` package PURL.

## Validation

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
- The full Docker run correctly stopped at the vulnerability policy. The current
  Debian image produced 205 findings: one unassessed critical, 204 highs, and five
  fixable highs. Those findings require remediation or separately reviewed narrow
  exceptions; this scanner migration does not weaken the policy to make the run
  pass.

## Tracker state

R10a remains **In progress** because the full Docker gate is red on current image
vulnerabilities. R10b remains **Waiting** and is not unblocked by this checkpoint.
