// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  PersistenceBackupRestoreResult,
  PersistenceClient,
  PersistenceUnavailableStatus,
} from "@studynarrator/shared-types";
import { DatabaseRecoveryScreen } from "./databaseRecoveryScreen.js";
import { PersistenceGate } from "./persistenceGate.js";

dialogElementPolyfill();

function dialogElementPolyfill() {
  if (typeof HTMLDialogElement === "undefined") return;
  const prototype = HTMLDialogElement.prototype;
  if (typeof prototype.showModal !== "function") {
    prototype.showModal = function showModal(this: HTMLDialogElement) {
      this.setAttribute("open", "");
      this.open = true;
    };
  }
  if (typeof prototype.close !== "function") {
    prototype.close = function close(this: HTMLDialogElement) {
      this.removeAttribute("open");
      this.open = false;
    };
  }
}

const backupRestoredFrom =
  "/data/studynarrator/backups/studynarrator-v3-to-v3-2026-08-17T12-00-00-000Z.sqlite";
const safetyCopy =
  "/data/studynarrator/backups/studynarrator-prerestore-v0099-to-v0099-2026-08-18T10-00-00-000Z.sqlite";

const migrationBackup: PersistenceUnavailableStatus["availableBackups"][number] =
  {
    path: backupRestoredFrom,
    fromVersion: 3,
    createdAt: "2026-08-17T12:00:00.000Z",
    sizeBytes: 40 * 1024,
    kind: "migration",
  };

const unavailableStatus: PersistenceUnavailableStatus = {
  contractVersion: 1,
  state: "unavailable",
  code: "SCHEMA_TOO_NEW",
  message: "The database is from a newer study-narrator version.",
  databaseSchemaVersion: 99,
  targetDatabaseSchemaVersion: 3,
  databasePath: "/data/studynarrator/studynarrator.sqlite",
  latestBackupPath: backupRestoredFrom,
  availableBackups: [migrationBackup],
};

function gateClient(
  status: unknown,
  restore: (input: {
    backupPath: string;
  }) => Promise<PersistenceBackupRestoreResult>,
) {
  const statusMock = vi.fn(async () => status);
  return {
    status: statusMock,
    backups: { list: vi.fn(async () => []), restore },
    projects: {
      list: vi.fn(async () => []),
      create: vi.fn(),
      get: vi.fn(),
      replace: vi.fn(),
      duplicate: vi.fn(),
      delete: vi.fn(),
    },
    settings: { getPacing: vi.fn(), updatePacing: vi.fn() },
    preferences: {
      getIgnoredDiagnostics: vi.fn(),
      replaceIgnoredDiagnostics: vi.fn(),
    },
    globalLexicon: { list: vi.fn(), replace: vi.fn() },
  } as unknown as PersistenceClient;
}

afterEach(cleanup);

describe("PersistenceGate", () => {
  it("renders the normal application when persistence is ready", async () => {
    const status = {
      state: "ready" as const,
      contractVersion: 1 as const,
      databasePath: "/db",
      databaseSchemaVersion: 3,
      targetDatabaseSchemaVersion: 3,
    };
    render(
      <PersistenceGate persistence={gateClient(status, vi.fn())}>
        <nav aria-label="app navigation">app</nav>
      </PersistenceGate>,
    );
    expect(await screen.findByText("app")).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", {
        name: "study-narrator storage is unavailable",
      }),
    ).not.toBeInTheDocument();
  });

  it("keeps the app when the persistence backend is unreachable", async () => {
    const client = {
      ...gateClient(undefined, vi.fn()),
      status: vi.fn(() => Promise.reject(new Error("server down"))),
    } as unknown as PersistenceClient;
    render(
      <PersistenceGate persistence={client}>
        <nav aria-label="app navigation">app</nav>
      </PersistenceGate>,
    );
    expect(await screen.findByText("app")).toBeInTheDocument();
  });

  it("swaps in the recovery screen when storage is unavailable", async () => {
    render(
      <PersistenceGate persistence={gateClient(unavailableStatus, vi.fn())}>
        <nav aria-label="app navigation">app</nav>
      </PersistenceGate>,
    );
    expect(
      await screen.findByRole("heading", {
        name: "study-narrator storage is unavailable",
      }),
    ).toBeInTheDocument();
    expect(screen.queryByText("app")).not.toBeInTheDocument();
  });
});

describe("DatabaseRecoveryScreen", () => {
  function renderScreen(
    restore: (
      backupPath: string,
    ) => Promise<PersistenceBackupRestoreResult> = vi.fn(() =>
      Promise.resolve({
        restoredFrom: backupRestoredFrom,
        safetyCopyPath: safetyCopy,
      }),
    ) as (backupPath: string) => Promise<PersistenceBackupRestoreResult>,
    status: PersistenceUnavailableStatus = unavailableStatus,
  ) {
    const restart = vi.fn();
    render(
      <DatabaseRecoveryScreen
        status={status}
        restoreBackup={restore}
        onRestart={restart}
      />,
    );
    return { restart };
  }

  it("explains the newer-local-database situation and the install-newer alternative", async () => {
    renderScreen();
    const heading = screen.getByRole("heading", {
      name: "study-narrator storage is unavailable",
    });
    expect(heading).toBeInTheDocument();
    expect(
      screen.getByText(/than the installed app supports/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText("install the newer version", { exact: true }),
    ).toBeInTheDocument();
    expect(screen.getByText("99")).toBeInTheDocument();
    expect(
      within(
        screen.getByText("Supported schema").parentElement as HTMLElement,
      ).getByText("version 3"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("/data/studynarrator/studynarrator.sqlite"),
    ).toBeInTheDocument();
  });

  it("lists every local backup with its derived version, creation time, and size", async () => {
    renderScreen();
    const table = screen.getByRole("table");
    const rows = within(table).getAllByRole("row");
    expect(rows).toHaveLength(2);
    const row = rows[1] as HTMLElement;
    expect(row).toHaveTextContent(/version 3/);
    expect(row).toHaveTextContent(/2026-08-17T12:00:00\.000Z/);
    expect(row).toHaveTextContent(/KB/);
    expect(
      within(row).getByRole("button", { name: "Restore from this backup" }),
    ).toBeInTheDocument();
  });

  it("labels pre-restore safety copies distinctly from migration backups", async () => {
    const withSafetyCopy: PersistenceUnavailableStatus = {
      ...unavailableStatus,
      availableBackups: [
        migrationBackup,
        {
          path: "/data/studynarrator/backups/studynarrator-prerestore-v0099-to-v0099-2026-08-18T10-00-00-000Z.sqlite",
          fromVersion: 99,
          createdAt: "2026-08-18T09:00:00.000Z",
          sizeBytes: 40 * 1024,
          kind: "prerestore",
        },
      ],
    };
    renderScreen(
      vi.fn() as (
        backupPath: string,
      ) => Promise<PersistenceBackupRestoreResult>,
      withSafetyCopy,
    );
    const rows = within(screen.getByRole("table")).getAllByRole("row");
    const migration = rows[1] as HTMLElement;
    const safety = rows[2] as HTMLElement;
    expect(migration).toHaveAttribute("data-backup-kind", "migration");
    expect(within(migration).getByText("Migration")).toBeInTheDocument();
    expect(safety).toHaveAttribute("data-backup-kind", "prerestore");
    expect(within(safety).getByText("Safety copy")).toBeInTheDocument();
  });

  it("restores the chosen backup only after explicit confirmation", async () => {
    const user = userEvent.setup();
    const result: PersistenceBackupRestoreResult = {
      restoredFrom: backupRestoredFrom,
      safetyCopyPath: safetyCopy,
    };
    const restore = vi.fn(async () => result);
    const { restart } = renderScreen(restore);
    await user.click(
      screen.getByRole("button", { name: "Restore from this backup" }),
    );
    expect(restore).not.toHaveBeenCalled();
    const dialog = screen.getByRole("dialog");
    await user.click(
      within(dialog).getByRole("button", { name: "Restore backup" }),
    );
    await vi.waitFor(() =>
      expect(restore).toHaveBeenCalledWith(backupRestoredFrom),
    );
    const doneHeading = await screen.findByRole("heading", {
      name: "Backup restored",
    });
    const section = doneHeading.closest("section") as HTMLElement;
    expect(section).toHaveTextContent(/Backup restored/);
    expect(section).toHaveTextContent(safetyCopy);
    expect(section).toHaveTextContent(/restart study-narrator/i);
    await user.click(
      within(section).getByRole("button", { name: "Restart study-narrator" }),
    );
    expect(restart).toHaveBeenCalled();
  });

  it("cancels the restore dialog without calling restore", async () => {
    const user = userEvent.setup();
    const restore = vi.fn();
    renderScreen(restore);
    await user.click(
      screen.getByRole("button", { name: "Restore from this backup" }),
    );
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Cancel",
      }),
    );
    expect(restore).not.toHaveBeenCalled();
  });

  it("shows the restore failure and keeps letting the user try again", async () => {
    const user = userEvent.setup();
    const restore = vi.fn(async () => {
      throw new Error("RESTORE_REJECTED: backup rejected");
    });
    renderScreen(restore);
    await user.click(
      screen.getByRole("button", { name: "Restore from this backup" }),
    );
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Restore backup",
      }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      /RESTORE_REJECTED/,
    );
    expect(
      screen.getByRole("button", { name: "Restore from this backup" }),
    ).toBeEnabled();
  });

  it("tells the user to install a newer version or restore when no backups exist", async () => {
    renderScreen(vi.fn(), {
      ...unavailableStatus,
      availableBackups: [],
    });
    expect(
      screen.getByText(/no local backups were found/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/install a newer version of study-narrator/i),
    ).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("describes a failed migration distinctly from a newer-schema database", async () => {
    renderScreen(vi.fn(), {
      ...unavailableStatus,
      code: "MIGRATION_FAILED",
      latestBackupPath: null,
    });
    expect(
      screen.getByText(/could not be opened or migrated/i),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/install the newer version/i, { exact: false }),
    ).not.toBeInTheDocument();
  });
});
