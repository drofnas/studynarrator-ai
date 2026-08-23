import {
  LexiconEntrySchema,
  type LexiconEntry,
  type LexiconEntryAuthoring,
} from "@studynarrator/core";
import {
  GlobalLexiconEntryCollectionSchema,
  GlobalLexiconReplaceInputSchema,
  IgnoredDiagnosticCollectionSchema,
} from "@studynarrator/shared-types";
import { PersistenceConflictError } from "./errors.js";
import type { DatabaseLike } from "./migrations.js";
import type { StudyNarratorRepository } from "./repository.js";
import { booleanToSql, lexiconFromRow, type LexiconRow } from "./rowMappers.js";

type LexiconRepositoryMethods = Pick<
  StudyNarratorRepository,
  | "getIgnoredDiagnostics"
  | "replaceIgnoredDiagnostics"
  | "listGlobalLexicon"
  | "replaceGlobalLexicon"
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

  const replaceLexicon: ReplaceLexicon = (
    scope,
    projectId,
    authoredEntries,
    timestamp,
  ) => {
    const existing = readLexicon(scope, projectId);
    const existingById = new Map(existing.map((entry) => [entry.id, entry]));
    const normalized = authoredEntries.map((authored) => {
      const id = authored.id ?? nextId();
      const owner = database
        .prepare("SELECT scope, project_id FROM lexicon_entries WHERE id = ?")
        .get(id) as { scope: string; project_id: string | null } | undefined;
      if (owner && (owner.scope !== scope || owner.project_id !== projectId)) {
        throw new PersistenceConflictError(
          `Lexicon entry ID ${id} belongs to another scope.`,
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

    if (scope === "global")
      database
        .prepare("DELETE FROM lexicon_entries WHERE scope = 'global'")
        .run();
    else
      database
        .prepare(
          "DELETE FROM lexicon_entries WHERE scope = 'project' AND project_id = ?",
        )
        .run(projectId);

    const insert = database.prepare(`
      INSERT INTO lexicon_entries (
        id, scope, project_id, ordinal, entry_type, display_text, sense_id, spoken_text,
        case_sensitive, whole_word, priority, enabled, notes, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    normalized.forEach((entry, ordinal) =>
      insert.run(
        entry.id,
        entry.scope,
        projectId,
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
    replaceGlobalLexicon(inputValue) {
      assertOpen();
      const input = GlobalLexiconReplaceInputSchema.parse(inputValue);
      const result = transaction(() =>
        replaceLexicon("global", null, input, now().toISOString()),
      );
      return GlobalLexiconEntryCollectionSchema.parse(result);
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
