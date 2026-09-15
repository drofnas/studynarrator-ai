# R09: Production Web Content Security Policy

**Status:** Complete, validated on 2026-09-14.
**Source:** `c3924e12a2ef9648f4ce78a322b191ba4cb2f976` on
`feature/complete-known-issues`, current `drofnas/studynarrator-ai` checkout.
The working tree and index started clean; no other repository is authorized.

## Plan and readiness

R08 is Complete in the canonical [task list](../TASKS.md) and accepted
[dependency table](../prd-work-items/local-only-simplification.md). It is R09's
only dependency. No open GitHub issues were returned during selection. R09 moves
Ready → In progress → Complete on acceptance, full-verifier, and staged-change
evidence. R09 has no dependents.

Add a fixed CSP only when Express serves the compiled Web application. Test the
exact response policy and development isolation, watch for unexpected CSP
console messages across Web and Docker acceptance, and prove forbidden browser
behavior is blocked. Keep public contracts, persistence, and dependency versions
intact.

## Resource inventory

- Vite emits local module scripts, compiled CSS, and a separate parser worker.
  Their loads and the API/SSE connections use the application's origin.
- Zod's browser and worker startup uses its supported `jitless` configuration
  before shared or core schemas initialize. The Web workspace declares the same
  `zod@4.4.3` already used by those packages so it can call the public API. No
  package version changes. Server-side validation keeps its existing behavior.
  The entry point configures validation before dynamically importing the
  unchanged application bootstrap: a static import alone lets bundled schema
  chunks execute too early. The standalone worker initializes its own realm.
- Fonts come from the operating system; the app's SVG graphics use no remote
  images. CodeMirror inserts a runtime stylesheet.
- Completed MP3 playback uses same-origin REST URLs. Previews decode API-returned
  bytes through Web Audio, requiring no `data:` or `blob:` media source.
- Export adapters fetch local APIs, create Blob URLs, and activate download
  links. Downloads do not need a broad `blob:` resource allowance.
- React sets playback widths through DOM style properties, which remain allowed
  with `style-src-attr 'none'`. Browser playback/seek checks verify the visual
  progress width under the policy; a markup rewrite is unnecessary.

The policy starts with `default-src 'self'`, disables objects, base URLs, and
framing, restricts forms to the origin, and blocks style attributes. The sole
inline exception is for style elements, documented in the
[technical debt register](../technical-debt.md). Nonces can remove that exception
if HTML delivery later gains per-response templating; they are not added here.

## Validation

All application tooling ran in Docker with Node 24.19.0 and npm 11.19.0. The
[documented legacy-builder fallback](../../deploy/development/README.md#full-verification)
handles this workstation's missing Buildx; the nested verifier has Buildx.

```sh
DOCKER_BUILDKIT=0 docker compose -f compose.development.yaml build verify
docker compose -f compose.development.yaml run --rm tools npm run test:api -- apps/server/src/app.test.ts
docker compose -f compose.development.yaml run --rm tools npm test -- apps/web/src/shared/validation.test.ts
docker compose -f compose.development.yaml run --rm tools npm run check:package-dependencies
docker compose -f compose.development.yaml up --abort-on-container-exit --exit-code-from verify verify
```

- Focused server tests: 22 passed. The exact CSP covers HTML, SPA routes, and
  assets; API-only development is unaffected. Express's final 404 handler keeps
  its stricter `default-src 'none'`. Sentinel queries never enter the header.
- The startup regression test verifies both workspace schema sets reject bad
  inputs and accept good inputs without probing dynamic code generation. Zod's
  [supported CSP configuration](https://github.com/colinhacks/zod/issues/4461)
  avoids the eval warnings that Firefox exposes.
- Full verifier: Knip within its existing three-finding allowance, formatting,
  lint, typecheck, 750 tests across 86 files with coverage, all builds, Electron
  native rebuild, 34 Web/Electron acceptance tests, and three runtime smokes
  passed. Coverage: 86.92% statements, 76.30% branches, 87.16% functions,
  88.76% lines.
- Browser probes block inline code, style attributes, cross-origin requests,
  plugin objects, and framing. Normal workflows pass without unexpected CSP
  messages, including parsing, previews, navigation, and downloads. MP3 playback
  advances, and seeking updates the visible waveform fill to its end.
- Docker image build, inventory, vulnerability policy, Chromium and Firefox
  acceptance, persistence/restart, and audited cleanup passed. All 16 raw Trivy
  findings were assessed under the existing policy; no gate was weakened.
- An additional run of 14 normally Chromium-only tests in Firefox passed 13,
  including playback and parser workflows, without CSP violations. The existing
  voice-audition test misses its `Stop Heart` state in Firefox. An isolated run
  with the original server, main entry point, and worker sources, with CSP absent,
  reproduced the same failure. This is a follow-up for Firefox audition coverage;
  the configured Chromium audition test and both Docker browser gates pass.
- Ignored evidence: `.tmp/r09-verification/`, including `verify-bootstrap.log`,
  `firefox-bootstrap.log`, `firefox-audition-baseline.log`, exported coverage and
  Playwright reports, and Docker run `run-5N6eik`.

## Performance baseline

- The CSP value is 160 bytes, or 187 bytes including an uncompressed HTTP/1
  header name and line ending. It adds no per-request I/O or HTML templating.
- The Vite entry/bootstrap/preload-helper total is 231.19 kB (71.62 kB gzip),
  compared with the original 229.18 kB entry (70.41 kB gzip). The necessary
  startup ordering adds two small module requests on the local origin. The
  worker grows from 90.17 kB to 90.34 kB. Reproduce with the Web build command;
  its emitted size report is retained in the browser logs.
- Docker/Node 24.19.0 measurement of `handleParserWorkerRequest`: repeat
  `[speaker_teacher] A deterministic paragraph for validation.` followed by
  two newlines, with an empty lexicon and a 500 ms enabled paragraph pause.
  Measure one cold call, three warm-ups, then ten calls in a fresh process for
  each JIT setting. This covers parsing, pacing, transformation, and validation.

| Paragraphs | Source bytes | JIT cold / median | No JIT cold / median |
| ---------- | ------------ | ----------------- | -------------------- |
| 1,000      | 61,000       | 96.8 / 41.0 ms    | 119.8 / 55.8 ms      |
| 5,000      | 305,000      | 201.5 / 165.0 ms  | 276.7 / 260.7 ms     |

These are local diagnostic measurements, not new pass thresholds or browser
latency claims. Strict CSP already forces the interpreted path after a failed
probe; configuring it ahead of time avoids that violation. Interpretation costs
more than unrestricted JIT, and the script analysis remains in the parser worker.
Local reproduction script and raw results are in
`.tmp/r09-verification/validation-benchmark.mts` and
`.tmp/r09-verification/validation-benchmark.jsonl`.

## Completion and review

The staged slice contains the server policy and tests, Web startup configuration
and matching dependency declaration, browser acceptance, and documentation.
Both local tracker entries move to Complete on validated, staged implementation.
The full dependency table has no R09 successors; no other status changes or
second story are needed. The initial index was empty, and all staged hunks belong
to R09. Public contracts and persistence are unchanged.

The local mandatory gates pass. Only a local commit is requested; GitHub Actions
`check` remains required for any future PR submission. The CodeMirror exception
and baseline Firefox audition-test failure above remain explicit limitations.

### Ponytail review

Lean already. Ship.
