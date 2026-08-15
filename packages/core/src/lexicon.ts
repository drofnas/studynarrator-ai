import { z } from "zod";
import {
  LexiconEntryAuthoringCollectionSchema,
  LexiconEntrySchema,
  type LexiconEntry,
  type LexiconEntryAuthoring
} from "./schemas.js";

interface NormalizeLexiconEntriesOptions {
  existingEntries?: readonly LexiconEntry[];
  idPrefix?: string;
  nextId: number;
  timestamp: string;
}

interface NormalizeLexiconEntriesResult {
  entries: LexiconEntry[];
  nextId: number;
}

const TimestampSchema = z.iso.datetime({ offset: true });
const IdPrefixSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/u);

function behaviorMatches(existing: LexiconEntry, authored: LexiconEntryAuthoring): boolean {
  return existing.scope === authored.scope
    && existing.entryType === authored.entryType
    && existing.displayText === authored.displayText
    && existing.senseId === authored.senseId
    && existing.spokenText === authored.spokenText
    && existing.caseSensitive === authored.caseSensitive
    && existing.wholeWord === authored.wholeWord
    && existing.priority === authored.priority
    && existing.enabled === authored.enabled
    && existing.notes === authored.notes;
}

export function normalizeLexiconEntries(
  value: unknown,
  options: NormalizeLexiconEntriesOptions
): NormalizeLexiconEntriesResult {
  const authoredEntries = LexiconEntryAuthoringCollectionSchema.parse(value);
  const timestamp = TimestampSchema.parse(options.timestamp);
  const idPrefix = IdPrefixSchema.parse(options.idPrefix ?? "lexicon");
  if (!Number.isSafeInteger(options.nextId) || options.nextId < 1) {
    throw new Error("The next lexicon entry ID must be a positive safe integer.");
  }

  const existingById = new Map((options.existingEntries ?? []).map((entry) => [entry.id, entry]));
  const usedIds = new Set(authoredEntries.flatMap((entry) => entry.id ? [entry.id] : []));
  let nextId = options.nextId;

  function generateId(scope: LexiconEntry["scope"]): string {
    while (true) {
      const candidate = `${idPrefix}-${scope}-${String(nextId).padStart(3, "0")}`;
      nextId += 1;
      if (!usedIds.has(candidate)) {
        usedIds.add(candidate);
        return candidate;
      }
    }
  }

  const entries = authoredEntries.map((authored) => {
    const id = authored.id ?? generateId(authored.scope);
    const existing = existingById.get(id);
    return LexiconEntrySchema.parse({
      ...authored,
      id,
      createdAt: existing?.createdAt ?? timestamp,
      updatedAt: existing && behaviorMatches(existing, authored) ? existing.updatedAt : timestamp
    });
  });

  return { entries, nextId };
}
