import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import type {
  PersistenceClient,
  PersistenceUnavailableStatus,
} from "@studynarrator/shared-types";
import { DatabaseRecoveryScreen } from "./databaseRecoveryScreen.js";

interface PersistenceGateProps {
  persistence: PersistenceClient;
  children: ReactNode;
}

/**
 * Renders the normal application immediately. If the persistence service reports
 * an unavailable database (for example after downgrading study-narrator over a
 * newer local backup), the gate replaces the app with the database recovery
 * screen. Transport-level failures keep the normal app: every page already
 * degrades to read-only mode when persistence is unreachable.
 */
export function PersistenceGate({
  persistence,
  children,
}: PersistenceGateProps) {
  const [unavailable, setUnavailable] =
    useState<PersistenceUnavailableStatus | null>(null);

  useEffect(() => {
    let active = true;
    try {
      Promise.resolve(persistence.status())
        .then((status: unknown) => {
          if (
            active &&
            status &&
            (status as { state?: string }).state === "unavailable"
          ) {
            setUnavailable(status as PersistenceUnavailableStatus);
          }
        })
        .catch(() => {
          // Unreachable backend, partial mocks, or older builds without the
          // status endpoint: the normal app already handles the degraded mode.
        });
    } catch {
      // A missing (non-function) status implementation must never block the app.
    }
    return () => {
      active = false;
    };
  }, [persistence]);

  if (unavailable) {
    const backups = persistence.backups;
    return (
      <DatabaseRecoveryScreen
        status={unavailable}
        restoreBackup={(backupPath) =>
          backups
            ? backups.restore({ backupPath })
            : Promise.reject(
                new Error(
                  "This study-narrator build does not expose backup restore.",
                ),
              )
        }
        onRestart={() => window.location.reload()}
      />
    );
  }

  return <>{children}</>;
}
