# R11 implementation report

**Story:** [R11 — Contributor documentation](../prd-work-items/local-only-simplification.md#order-and-dependencies)
**Baseline:** `main` at `75a07a4f89cd`
**Status:** Complete. The documentation-only acceptance criteria passed, and R11
has no dependents.

## Outcome

- `CONTRIBUTING.md` gives contributors the pinned setup, focused and standard
  verification commands, current package boundaries, append-only migration rule,
  and commit hygiene in one page.
- `SECURITY.md` links directly to GitHub Private Vulnerability Reporting, states
  the pre-release and latest-release support policy, lists useful report details,
  and excludes private application data.
- The README links both guides from its documentation section.

## Validation

- Prettier passed for every changed Markdown file, and `git diff --check` passed.
- All six referenced npm scripts, the pinned Node/npm versions, local links, and
  repository identity were checked against the current checkout.
- GitHub's repository API confirmed Private Vulnerability Reporting is enabled.
- The security guide makes no response-time or remediation-time promise.

## Ponytail review

`CONTRIBUTING.md:L34-41: shrink:` five checks duplicated work already performed
by `npm run verify`. Keep targeted formatting plus the full verifier.

Applied. Net reduction: five lines.
