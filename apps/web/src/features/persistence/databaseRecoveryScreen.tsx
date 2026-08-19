import { useRef, useState } from "react";
import type { FormEvent, MouseEvent } from "react";
import type {
  PersistenceBackupRestoreResult,
  PersistenceUnavailableStatus,
} from "@studynarrator/shared-types";
import styles from "./databaseRecoveryScreen.module.css";

type RestoreOutcome =
  | { kind: "idle" }
  | { kind: "confirming" }
  | { kind: "restoring" }
  | { kind: "done"; restored: PersistenceBackupRestoreResult }
  | { kind: "failed"; message: string };

function formatBytes(sizeBytes: number): string {
  if (sizeBytes < 1024) return `${sizeBytes} B`;
  if (sizeBytes < 1024 * 1024) return `${Math.round(sizeBytes / 1024)} KB`;
  return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
}

interface DatabaseRecoveryScreenProps {
  status: PersistenceUnavailableStatus;
  restoreBackup: (
    backupPath: string,
  ) => Promise<PersistenceBackupRestoreResult>;
  onRestart: () => void;
}

export function DatabaseRecoveryScreen({
  status,
  restoreBackup,
  onRestart,
}: DatabaseRecoveryScreenProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const pendingBackup = useRef<string | null>(null);
  const [outcome, setOutcome] = useState<RestoreOutcome>({ kind: "idle" });
  const busy = outcome.kind === "restoring";

  const requestRestore = (
    event: MouseEvent<HTMLButtonElement>,
    backupPath: string,
  ) => {
    event.preventDefault();
    pendingBackup.current = backupPath;
    setOutcome({ kind: "confirming" });
    dialogRef.current?.showModal();
  };

  const cancelRestore = () => {
    if (pendingBackup.current !== null) {
      pendingBackup.current = null;
      setOutcome({ kind: "idle" });
      dialogRef.current?.close();
    }
  };

  const confirmRestore = (event: FormEvent) => {
    event.preventDefault();
    const backupPath = pendingBackup.current;
    if (!backupPath || busy) return;
    dialogRef.current?.close();
    setOutcome({ kind: "restoring" });
    restoreBackup(backupPath)
      .then((restored) => {
        pendingBackup.current = null;
        setOutcome({ kind: "done", restored });
      })
      .catch((error: unknown) => {
        pendingBackup.current = null;
        setOutcome({
          kind: "failed",
          message:
            error instanceof Error
              ? error.message
              : "The backup restore failed.",
        });
      });
  };

  return (
    <main className={styles.recovery} data-outcome={outcome.kind}>
      <p className={styles.eyebrow}>study-narrator storage recovery</p>
      <h1>study-narrator storage is unavailable</h1>
      <p className={styles.lead}>
        {status.code === "SCHEMA_TOO_NEW" ? (
          <>
            The local study-narrator database uses schema{" "}
            <strong>{status.databaseSchemaVersion}</strong>, which was created
            by a <strong>newer version</strong> of study-narrator than the
            installed app supports (schema{" "}
            <strong>{status.targetDatabaseSchemaVersion}</strong>). The app
            cannot migrate a database backward, so this database is closed until
            you choose a path below.
          </>
        ) : (
          <>
            The local study-narrator database
            {Number.isFinite(status.databaseSchemaVersion) ? (
              <>
                {" "}
                (schema <strong>{status.databaseSchemaVersion}</strong>)
              </>
            ) : null}{" "}
            could not be opened or migrated to schema{" "}
            <strong>{status.targetDatabaseSchemaVersion}</strong>, so the app
            started with storage disabled.
          </>
        )}
      </p>

      <section className={styles.meta}>
        <div>
          <small>Database path</small>
          <code>{status.databasePath}</code>
        </div>
        <div>
          <small>Supported schema</small>
          <code>version {status.targetDatabaseSchemaVersion}</code>
        </div>
        {status.latestBackupPath ? (
          <div>
            <small>Latest schema-level backup</small>
            <code>{status.latestBackupPath}</code>
          </div>
        ) : null}
      </section>

      <section className={styles.backups} aria-labelledby="localBackupsTitle">
        <h2 id="localBackupsTitle">Local backups</h2>
        {status.availableBackups.length === 0 ? (
          <p>
            No local backups were found in the <code>backups/</code> directory.
            To continue,{" "}
            <strong>install a newer version of study-narrator</strong> or
            restore a backup you created elsewhere.
          </p>
        ) : (
          <table className={styles.backupTable}>
            <thead>
              <tr>
                <th scope="col">Backup</th>
                <th scope="col">Type</th>
                <th scope="col">From version</th>
                <th scope="col">Created</th>
                <th scope="col">Size</th>
                <th scope="col">
                  <span className={styles.srOnly}>Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {status.availableBackups.map((backup) => (
                <tr key={backup.path} data-backup-kind={backup.kind}>
                  <td>
                    <code>{backup.path}</code>
                  </td>
                  <td>
                    {backup.kind === "prerestore" ? "Safety copy" : "Migration"}
                  </td>
                  <td>version {backup.fromVersion}</td>
                  <td>{backup.createdAt}</td>
                  <td>{formatBytes(backup.sizeBytes)}</td>
                  <td>
                    <button
                      type="button"
                      className={styles.restore}
                      data-backup={backup.path}
                      disabled={busy}
                      onClick={(event) => requestRestore(event, backup.path)}
                    >
                      Restore from this backup
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {status.code === "SCHEMA_TOO_NEW" ? (
        <section
          className={styles.alternative}
          aria-labelledby="alternativeTitle"
        >
          <h2 id="alternativeTitle">Alternative</h2>
          <p>
            The newest study-narrator release can open this database without a
            restore. If you want to keep the latest data exactly as it is,{" "}
            <strong>install the newer version</strong> instead of restoring a
            backup.
          </p>
        </section>
      ) : null}

      {outcome.kind === "done" ? (
        <section className={styles.done} aria-live="polite">
          <h2>Backup restored</h2>
          <p>
            The restored database was written from{" "}
            <code>{outcome.restored.restoredFrom}</code>.
          </p>
          {outcome.restored.safetyCopyPath !== null ? (
            <p>
              A safety copy of the previous database was kept at{" "}
              <code>{outcome.restored.safetyCopyPath}</code>.
            </p>
          ) : (
            <p>
              No earlier database file was present, so there was nothing to keep
              aside.
            </p>
          )}
          <p>
            <strong>Restart study-narrator now</strong> to open the restored
            database.
          </p>
          <button type="button" className={styles.restart} onClick={onRestart}>
            Restart study-narrator
          </button>
        </section>
      ) : null}

      {outcome.kind === "failed" ? (
        <p className={styles.error} role="alert" aria-live="assertive">
          {outcome.message}
        </p>
      ) : null}

      {busy ? (
        <p className={styles.busy} role="status">
          Restoring the selected backup…
        </p>
      ) : null}

      <dialog
        ref={dialogRef}
        className={styles.dialog}
        aria-labelledby="restoreDialogTitle"
        aria-describedby="restoreDialogText"
        onCancel={cancelRestore}
      >
        <h2 id="restoreDialogTitle">Restore from local backup?</h2>
        <p id="restoreDialogText">
          This replaces the current local study-narrator database with the
          selected backup. A safety copy of the current database is kept in{" "}
          <code>backups/</code>. This action requires your explicit choice and
          is never performed automatically.
        </p>
        <div className={styles.dialogActions}>
          <button type="button" onClick={cancelRestore}>
            Cancel
          </button>
          <form method="dialog" onSubmit={confirmRestore}>
            <button type="submit" className={styles.danger}>
              Restore backup
            </button>
          </form>
        </div>
      </dialog>
    </main>
  );
}
