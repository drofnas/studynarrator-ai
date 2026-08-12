import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { MigrationFailureError, migrateDatabase } from "@studynarrator/persistence";

export function parseDataDirectory(argumentsInput: readonly string[]): string {
  if (argumentsInput.length !== 2 || argumentsInput[0] !== "--data-dir" || !argumentsInput[1]) {
    throw new Error("Usage: npm run db:migrate -- --data-dir <directory>");
  }
  return resolve(process.env.INIT_CWD ?? process.cwd(), argumentsInput[1]);
}

export async function runMigrationCommand(argumentsInput: readonly string[]) {
  const dataDirectory = parseDataDirectory(argumentsInput);
  const databasePath = resolve(dataDirectory, "studynarrator.sqlite");
  const result = await migrateDatabase({ Database, databasePath });
  try {
    return {
      state: "ready" as const,
      databasePath: result.databasePath,
      databaseSchemaVersion: result.databaseSchemaVersion,
      appliedVersions: result.appliedVersions,
      backupPath: result.backupPath
    };
  } finally {
    result.database.close();
  }
}

async function main() {
  try {
    process.stdout.write(`${JSON.stringify(await runMigrationCommand(process.argv.slice(2)))}\n`);
  } catch (error) {
    if (error instanceof MigrationFailureError) {
      process.stderr.write(`${JSON.stringify({
        state: "unavailable",
        code: error.code,
        databasePath: error.databasePath,
        databaseSchemaVersion: error.databaseSchemaVersion,
        backupPath: error.backupPath,
        message: error.message
      })}\n`);
    } else {
      const usageError = error instanceof Error && error.message.startsWith("Usage:");
      process.stderr.write(`${JSON.stringify({
        state: "invalid",
        code: usageError ? "INVALID_ARGUMENTS" : "MIGRATION_COMMAND_FAILED",
        message: usageError ? error.message : "The migration command could not complete."
      })}\n`);
    }
    process.exitCode = 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
