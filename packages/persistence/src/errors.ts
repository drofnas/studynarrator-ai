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
    readonly databaseSchemaVersion: number | null
  ) {
    super(message);
  }
}
