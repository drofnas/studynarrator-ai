import {
  LexiconEntrySchema,
  type LexiconEntry,
  type LexiconEntryAuthoring,
} from "@studynarrator/core";
import {
  CustomGlobalLexiconReplaceInputSchema,
  GLOBAL_LEXICON_BUILT_INS,
  GlobalLexiconBuiltInEnabledInputSchema,
  GlobalLexiconEntryCollectionSchema,
  GlobalLexiconStateSchema,
  IgnoredDiagnosticCollectionSchema,
  type GlobalLexiconState,
} from "@studynarrator/shared-types";
import {
  PersistenceConflictError,
  PersistenceNotFoundError,
} from "./errors.js";
import type { DatabaseLike } from "./migrations.js";
import type { StudyNarratorRepository } from "./repository.js";
import { booleanToSql, lexiconFromRow, type LexiconRow } from "./rowMappers.js";

type GlobalEntryKind = "builtIn" | "custom";
type LexiconRepositoryMethods = Pick<
  StudyNarratorRepository,
  | "getIgnoredDiagnostics"
  | "replaceIgnoredDiagnostics"
  | "listGlobalLexicon"
  | "getGlobalLexiconState"
  | "replaceCustomGlobalLexicon"
  | "setBuiltInGlobalLexiconEnabled"
  | "reimportBuiltInGlobalLexicon"
>;

type ReadLexicon = (
  scope: "global" | "project",
  projectId: string | null,
) => LexiconEntry[];

type ReplaceLexicon = (
  scope: "global" | "project",
  projectId: string | null,
  authoredEntries: readonly LexiconEntryAuthoring[],
  timestamp: string,
) => LexiconEntry[];

interface LexiconOwnerRow {
  scope: "global" | "project";
  project_id: string | null;
  entry_kind: GlobalEntryKind;
}

export function createLexiconRepository(dependencies: {
  database: DatabaseLike;
  now: () => Date;
  assertOpen: () => void;
  transaction: <T>(operation: () => T) => T;
  nextId: () => string;
}): LexiconRepositoryMethods & {
  readLexicon: ReadLexicon;
  replaceLexicon: ReplaceLexicon;
} {
  const { database, now, assertOpen, transaction, nextId } = dependencies;

  const readLexicon: ReadLexicon = (scope, projectId) => {
    const rows =
      scope === "global"
        ? database
            .prepare(
              "SELECT * FROM lexicon_entries WHERE scope = 'global' ORDER BY ordinal ASC, id ASC",
            )
            .all()
        : database
            .prepare(
              "SELECT * FROM lexicon_entries WHERE scope = 'project' AND project_id = ? ORDER BY ordinal ASC, id ASC",
            )
            .all(projectId);
    return rows.map((row) => lexiconFromRow(row as LexiconRow));
  };

  const readGlobalLexiconByKind = (entryKind: GlobalEntryKind) =>
    database
      .prepare(
        "SELECT * FROM lexicon_entries WHERE scope = 'global' AND entry_kind = ? ORDER BY ordinal ASC, id ASC",
      )
      .all(entryKind)
      .map((row) => lexiconFromRow(row as LexiconRow));

  const globalLexiconState = (): GlobalLexiconState =>
    GlobalLexiconStateSchema.parse({
      builtIns: readGlobalLexiconByKind("builtIn").map((entry) => ({
        ...entry,
        entryKind: "builtIn" as const,
      })),
      custom: readGlobalLexiconByKind("custom").map((entry) => ({
        ...entry,
        entryKind: "custom" as const,
      })),
    });

  const normalizeEntries = (
    scope: "global" | "project",
    projectId: string | null,
    entryKind: GlobalEntryKind,
    authoredEntries: readonly LexiconEntryAuthoring[],
    existing: readonly LexiconEntry[],
    timestamp: string,
  ) => {
    const existingById = new Map(existing.map((entry) => [entry.id, entry]));
    return authoredEntries.map((authored) => {
      const id = authored.id ?? nextId();
      const owner = database
        .prepare(
          "SELECT scope, project_id, entry_kind FROM lexicon_entries WHERE id = ?",
        )
        .get(id) as LexiconOwnerRow | undefined;
      if (
        owner &&
        (owner.scope !== scope ||
          owner.project_id !== projectId ||
          owner.entry_kind !== entryKind)
      ) {
        throw new PersistenceConflictError(
          `Lexicon entry ID ${id} belongs to another lexicon collection.`,
        );
      }
      const prior = existingById.get(id);
      return LexiconEntrySchema.parse({
        ...authored,
        id,
        createdAt: prior?.createdAt ?? timestamp,
        updatedAt:
          prior && lexiconBehaviorMatches(prior, authored)
            ? prior.updatedAt
            : timestamp,
      });
    });
  };

  const replaceEntries = (
    scope: "global" | "project",
    projectId: string | null,
    entryKind: GlobalEntryKind,
    authoredEntries: readonly LexiconEntryAuthoring[],
    timestamp: string,
  ) => {
    const existing =
      scope === "global"
        ? readGlobalLexiconByKind(entryKind)
        : readLexicon(scope, projectId);
    const normalized = normalizeEntries(
      scope,
      projectId,
      entryKind,
      authoredEntries,
      existing,
      timestamp,
    );

    if (scope === "global")
      database
        .prepare(
          "DELETE FROM lexicon_entries WHERE scope = 'global' AND entry_kind = ?",
        )
        .run(entryKind);
    else
      database
        .prepare(
          "DELETE FROM lexicon_entries WHERE scope = 'project' AND project_id = ?",
        )
        .run(projectId);

    const insert = database.prepare(`
      INSERT INTO lexicon_entries (
        id, scope, project_id, entry_kind, ordinal, entry_type, display_text, sense_id, spoken_text,
        case_sensitive, whole_word, priority, enabled, notes, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    normalized.forEach((entry, ordinal) =>
      insert.run(
        entry.id,
        entry.scope,
        projectId,
        entryKind,
        ordinal,
        entry.entryType,
        entry.displayText,
        entry.senseId ?? null,
        entry.spokenText,
        booleanToSql(entry.caseSensitive),
        booleanToSql(entry.wholeWord),
        entry.priority,
        booleanToSql(entry.enabled),
        entry.notes,
        entry.createdAt,
        entry.updatedAt,
      ),
    );
    return normalized;
  };

  const replaceLexicon: ReplaceLexicon = (
    scope,
    projectId,
    authoredEntries,
    timestamp,
  ) => {
    if (scope === "global")
      throw new PersistenceConflictError(
        "Global lexicon entries must be managed by their built-in or custom collection.",
      );
    return replaceEntries(
      scope,
      projectId,
      "custom",
      authoredEntries,
      timestamp,
    );
  };

  const methods: LexiconRepositoryMethods = {
    getIgnoredDiagnostics() {
      assertOpen();
      return IgnoredDiagnosticCollectionSchema.parse(
        database
          .prepare(
            "SELECT code, pattern FROM ignored_diagnostic_patterns ORDER BY ordinal ASC, code ASC, pattern ASC",
          )
          .all(),
      );
    },
    replaceIgnoredDiagnostics(inputValue) {
      assertOpen();
      const input = IgnoredDiagnosticCollectionSchema.parse(inputValue);
      const timestamp = now().toISOString();
      transaction(() => {
        database.prepare("DELETE FROM ignored_diagnostic_patterns").run();
        const insert = database.prepare(
          "INSERT INTO ignored_diagnostic_patterns (code, pattern, ordinal, created_at) VALUES (?, ?, ?, ?)",
        );
        input.forEach((item, ordinal) =>
          insert.run(item.code, item.pattern, ordinal, timestamp),
        );
      });
      return this.getIgnoredDiagnostics();
    },
    listGlobalLexicon() {
      assertOpen();
      return GlobalLexiconEntryCollectionSchema.parse(
        readLexicon("global", null),
      );
    },
    getGlobalLexiconState() {
      assertOpen();
      return globalLexiconState();
    },
    replaceCustomGlobalLexicon(inputValue) {
      assertOpen();
      const input = CustomGlobalLexiconReplaceInputSchema.parse(inputValue);
      transaction(() => {
        replaceEntries("global", null, "custom", input, now().toISOString());
      });
      return globalLexiconState();
    },
    setBuiltInGlobalLexiconEnabled(inputValue) {
      assertOpen();
      const input = GlobalLexiconBuiltInEnabledInputSchema.parse(inputValue);
      const result = transaction(() =>
        database
          .prepare(
            `UPDATE lexicon_entries
             SET enabled = ?, updated_at = ?
             WHERE id = ? AND scope = 'global' AND entry_kind = 'builtIn'`,
          )
          .run(booleanToSql(input.enabled), now().toISOString(), input.id),
      );
      if (Number(result.changes ?? 0) !== 1)
        throw new PersistenceNotFoundError(
          `Built-in global lexicon entry ${input.id} was not found.`,
        );
      return globalLexiconState();
    },
    reimportBuiltInGlobalLexicon() {
      assertOpen();
      transaction(() => {
        replaceEntries(
          "global",
          null,
          "builtIn",
          GLOBAL_LEXICON_BUILT_INS,
          now().toISOString(),
        );
      });
      return globalLexiconState();
    },
  };

  return { ...methods, readLexicon, replaceLexicon };
}

function lexiconBehaviorMatches(
  existing: LexiconEntry,
  authored: LexiconEntryAuthoring,
): boolean {
  return (
    existing.scope === authored.scope &&
    existing.entryType === authored.entryType &&
    existing.displayText === authored.displayText &&
    existing.senseId === authored.senseId &&
    existing.spokenText === authored.spokenText &&
    existing.caseSensitive === authored.caseSensitive &&
    existing.wholeWord === authored.wholeWord &&
    existing.priority === authored.priority &&
    existing.enabled === authored.enabled &&
    existing.notes === authored.notes
  );
}
