# Technical debt register

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
