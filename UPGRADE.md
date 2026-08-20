# StudyNarrator — Upgrading, Downgrading, and Your Data

This guide explains what happens to your projects, renders, caches, and other persisted data when you change application versions.

## Compatibility table

One row per released version.

| Application version | Database schema version | Data directory layout version |
| ------------------- | ----------------------- | ----------------------------- |
| 0.1.0               | 4                       | 1                             |

## Upgrading

Upgrading is automatic. StudyNarrator migrates the database forward when it starts:

- If the database is behind the schema version the application supports, it migrates forward automatically.
- Before applying a schema upgrade, StudyNarrator takes a full backup of the current database in the `backups/` directory next to the database file, for example `<dataDir>/backups/`.
- One-time data directory layout steps run on startup where needed and are recorded in `<dataDir>/manifest.json` so they never run twice.
- Old backups are pruned automatically: the newest backup for each source schema version, plus the three most recent backup files, plus the two most recent pre-restore safety copies always survive.
- If the data directory was created by a **newer** version of this application than the one you are starting, a recovery screen appears offering a restore from one of the saved backups. Nothing is ever deleted or converted automatically.

To upgrade a Docker Web deployment, pull the new revision and rebuild the application container. The `studynarrator-data` volume is left intact, so projects, renders, caches, and backups survive the upgrade.

## Downgrading

An older application cannot read a newer database. There are no down migrations and there cannot be any: a version that shipped before a migration has no code to reverse it, and StudyNarrator never converts data in place.

If you must return to an older release, the supported paths are:

1. **Restore from backup.** Start the older application against the newer data directory; the recovery screen offers a restore from a backup the newer version took before its own upgrade.
2. **Reinstall the newer version.** Keep running the newer release instead of downgrading.

Do not copy a newer database file over an older installation in the hope that it will work.

## Where the data lives

The database, backups, speech cache, and render artifacts all live under one data directory. Its location depends on how you run StudyNarrator:

| Runtime                        | Data directory                                                            |
| ------------------------------ | ------------------------------------------------------------------------- |
| Docker Web                     | `/data` inside the container, backed by the `studynarrator-data` volume   |
| Node server from source (Web)  | `STUDYNARRATOR_DATA_DIR` if set, otherwise `<repository>/.tmp/dev/web`    |
| Electron from source           | The Electron `userData` directory for the operating system, unless `STUDYNARRATOR_DATA_DIR` overrides it |

`STUDYNARRATOR_DATA_DIR` may be an absolute path; a relative value is resolved against the server's working directory (for Electron, against the process `INIT_CWD`).

## Manual backup and restore

The built-in backup lives beside the database in `backups/`. You can also take your own copy of the data directory at any time, while the application is stopped.

When replacing a database file by hand (manual restore, copying between machines), you **must** remove the WAL sidecar files alongside it:

```sh
rm <path/to/studynarrator.sqlite>-wal <path/to/studynarrator.sqlite>-shm
```

Leaving stale `-wal` and `-shm` files behind can silently corrupt the restored database on the next start, because SQLite will replay them against the new file.

For Docker Web, back up the named volume, for example:

```sh
docker run --rm --volume studynarrator_studynarrator-data:/data:ro --volume "$PWD:/backup" alpine \
  tar -C /data -czf /backup/studynarrator-data.tgz .
```

## Version policy

- Patch and minor releases never require you to delete or reset your data.
- The database schema only moves forward. There are no down migrations.
- Every schema change ships with a backup step, so the previous database state is recoverable after an upgrade.

## Known vestigial state

`render_jobs.plan_id` is unused as of the frozen-plan removal and will be dropped in a future migration. It is not something you should inspect or depend on.
