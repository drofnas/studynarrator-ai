# Technical debt register

## Production CSP — inline style elements for CodeMirror

- The production Web policy permits inline style elements because CodeMirror
  generates its editor stylesheet at runtime. This exception is limited to
  `style-src-elem`; inline scripts and markup style attributes stay blocked.
  Resource requests from CSS still follow the same-origin default policy.
- React's playback widths use direct DOM style properties, so they do not need
  an inline-style-attribute exception. Browser acceptance verifies playback and
  progress rendering with `style-src-attr 'none'`.
- Revisit when changing the editor or HTML delivery. CodeMirror supports a
  [stylesheet nonce](https://codemirror.net/docs/ref/#view.EditorView^cspNonce),
  but removing this exception would require a fresh response nonce in both HTML
  and the CSP header, plus passing it to each editor instance. Keep that delivery
  change scoped separately; never broaden script or network permissions to fix
  an editor style violation.
- Policy semantics: [CSP style directives](https://www.w3.org/TR/CSP3/#directive-style-src-attr).
  Inventory and validation: [R09 report](implement-prd-stories/r09-production-csp.md).

## CVE-2026-70632 — accepted low risk for trusted local speech

- Owner decision on 2026-09-14: accept low contextual risk for a trusted,
  same-machine Speaches service pending a compatible FFmpeg update. App-managed
  Speaches inside the Electron distribution is planned, not implemented.
- Potential exploit impact remains significant; remote or untrusted endpoints
  are outside this acceptance. The restricted Docker audio build excludes CFHD;
  its separate [code-absence assessment](security/docker-audio-build.md) does not
  assess native host-installed FFmpeg. Scanner severity is unchanged.
- Follow up on compatible upstream/Debian fixes and review by 2026-10-14 or on
  changed exposure evidence. A daily package-fix monitor is active in the task
  that recorded this decision.
- Evidence, limits, and update requirements:
  [CVE-2026-70632 risk decision](security/CVE-2026-70632.md).

## `render_jobs.plan_id` — vestigial column

- Since the frozen-plan removal, `render_jobs.plan_id` is unused: each render
  generates a fresh plan id that nothing looks up, so the column carries no
  meaning.
- The column still has a `NOT NULL` constraint and existing rows depend on it,
  so the value must keep being written until the column is dropped.
- It will be dropped in a future migration.
- Dropping it requires SQLite's table-rebuild pattern (create the replacement
  table, copy data, drop the original, rename), because older SQLite versions
  do not support `DROP COLUMN` on a table with constraints referencing it.
  Verify the behaviour against the SQLite version bundled with
  `better-sqlite3` before writing that migration.
