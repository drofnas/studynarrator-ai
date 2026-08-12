PRAGMA user_version = 1;

CREATE TABLE schema_migrations (
  version INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL
);

CREATE TABLE diagnostic_kv (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  created_at TEXT NOT NULL
);

INSERT INTO schema_migrations (version, applied_at)
VALUES (1, '2026-08-11T12:00:00.000Z');

INSERT INTO diagnostic_kv (key, value, created_at)
VALUES ('fixture', 'preserved', '2026-08-11T12:00:00.000Z');
