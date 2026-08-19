export class PersistenceNotFoundError extends Error {
  readonly code = "PERSISTENCE_NOT_FOUND";
}

export class PersistenceConflictError extends Error {
  readonly code = "PERSISTENCE_CONFLICT";
}

export class MigrationFailureError extends Error {
  readonly code = "MIGRATION_FAILED";

  constructor(
    message: string,
    readonly databasePath: string,
    readonly backupPath: string | null,
    readonly databaseSchemaVersion: number | null,
    readonly failedMigration: { version: number; name: string } | null = null,
    options: { cause?: unknown } = {},
  ) {
    super(message, options);
  }
}

export class SchemaTooNewError extends Error {
  readonly code = "SCHEMA_TOO_NEW";

  constructor(
    readonly databasePath: string,
    readonly databaseSchemaVersion: number,
    readonly supportedSchemaVersion: number,
    readonly backups: readonly {
      path: string;
      fromVersion: number;
      createdAt: string;
    }[],
  ) {
    super(
      `This data was created by a newer version of StudyNarrator (database format ${String(databaseSchemaVersion)}). ` +
        `This version supports format ${String(supportedSchemaVersion)}.`,
    );
  }
}

export class BackupRestoreError extends Error {
  readonly code = "BACKUP_RESTORE_FAILED";
}
