# Docker development and verification

## Scope and authorization

The owner requested planning, implementation, Ponytail review, useful
simplifications, validation, and a local commit on
`feature/complete-known-issues`. The starting commit is `7684bb4`; the worktree
and index were clean. All repository edits stay in `studynarrator-ai`.

## Plan

1. Build a separate tooling image containing the pinned Node/npm versions,
   compilers, FFmpeg, Playwright browsers, Xvfb, Docker CLI plugins, and Trivy.
   Install the unchanged lockfile with `npm ci` inside the image.
2. Run the existing full verifier against an isolated Docker-in-Docker daemon.
   Share its network namespace so existing loopback acceptance, ephemeral ports,
   and Docker-to-host fake Speaches connections retain their meaning. Share only
   its Unix socket; never mount the workstation's Docker socket into the runner.
3. Provide a Web development service with Compose Watch and Docker-managed data.
   Keep source dependencies and generated build/test files inside containers.
4. Move Linux CI and contributor commands to the same environment. Native macOS
   and Windows release validation stays on matching CI hosts; it is not required
   on the contributor's workstation.
5. Review the complete diff with Ponytail, apply justified simplifications,
   verify the exact candidate, and create the requested local commit.

## Acceptance

- A workstation needs Docker with Compose and Buildx, an editor, and a browser;
  Node, npm, compilers, FFmpeg, test browsers, and Trivy run in containers.
- Existing format, lint, type, coverage, build, Web/Electron acceptance, runtime
  smoke, Docker vulnerability, persistence, and cleanup gates remain enforced.
- Electron runs as a non-root user with its renderer sandbox enabled.
- Production Compose remains loopback-only. Development Web is also published
  only on loopback; the isolated verification daemon exposes no TCP API.
- Failed verification returns a failing exit code and leaves inspectable
  container artifacts. Cleanup affects only the dedicated development project
  and verification-owned resources, never application data or other projects.
- Web source edits appear through Compose Watch; dependency changes rebuild the
  tooling image. Development data survives service recreation.

## Validation

Render both Compose configurations, build the tooling image, run focused
configuration and Docker lifecycle tests, then run `npm run verify` inside the
verification container. Exercise Web startup, source sync, loopback publication,
and data persistence. Review formatting, links, status, and the full staged diff
before committing. Keep generated evidence outside the Git candidate.
