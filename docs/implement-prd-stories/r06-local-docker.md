# R06 implementation report

**Story:** [R06 — Local Docker launcher](../prd-work-items/local-only-simplification.md#order-and-dependencies)
**Baseline:** `main` at `6e3846d6b4a2`
**Status:** In progress because the mandatory Docker vulnerability gate failed. R06 has no dependents.

## Outcome

- The existing Compose command remains the launcher; no wrapper script was added.
- Compose now publishes Docker Web on `127.0.0.1` only while retaining the configurable host port.
- The environment template and current setup guides no longer offer LAN access controls.
- Docker-to-host and private-network Speaches connections remain supported.

## Validation

- `docker compose config` rendered `host_ip: 127.0.0.1` and published port `8080`.
- The focused Docker verifier tests passed: 16 tests.
- Formatting, lint, typechecking, 703 coverage tests, builds, 30 Web/Electron acceptance tests, and runtime smoke checks passed.
- Docker Scout stopped the full verifier on fixable high-severity vulnerabilities in the current image; cleanup passed.

## Next action

Resolve the image findings in R10a and rerun `npm run verify` before completing R06.
