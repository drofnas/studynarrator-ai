import { describe, expect, it } from "vitest";
import {
  LexiconEntryAuthoringCollectionSchema,
  LexiconEntryAuthoringSchema,
  LexiconEntrySchema,
  normalizeLexiconEntries,
  type LexiconEntry
} from "./index.js";

const earlier = "2026-08-11T00:00:00.000Z";
const now = "2026-08-12T00:00:00.000Z";

function entry(overrides: Partial<LexiconEntry> = {}): LexiconEntry {
  return LexiconEntrySchema.parse({
    id: "g03-global-001",
    scope: "global",
    entryType: "exactTerm",
    displayText: "SQL",
    spokenText: "sequel",
    caseSensitive: true,
    wholeWord: true,
    priority: 0,
    enabled: true,
    notes: "",
    createdAt: earlier,
    updatedAt: earlier,
    ...overrides
  });
}

describe("G03 lexicon JSON authoring", () => {
  it("applies authoring defaults while preserving required behavior", () => {
    expect(LexiconEntryAuthoringSchema.parse({
      scope: "global",
      entryType: "exactTerm",
      displayText: "SQL",
      spokenText: "sequel"
    })).toEqual({
      scope: "global",
      entryType: "exactTerm",
      displayText: "SQL",
      spokenText: "sequel",
      caseSensitive: true,
      wholeWord: true,
      priority: 0,
      enabled: true,
      notes: ""
    });
  });

  it("enforces named-sense fields and rejects unknown properties", () => {
    expect(() => LexiconEntryAuthoringSchema.parse({ scope: "project", entryType: "namedSense", displayText: "resume", spokenText: "rez-oo-may" })).toThrow();
    expect(() => LexiconEntryAuthoringSchema.parse({ scope: "global", entryType: "exactTerm", displayText: "SQL", senseId: "sql", spokenText: "sequel" })).toThrow();
    expect(() => LexiconEntryAuthoringSchema.parse({ scope: "global", entryType: "exactTerm", displayText: "SQL", spokenText: "sequel", extra: true })).toThrow();
  });

  it("rejects duplicate supplied IDs with an indexed path", () => {
    const result = LexiconEntryAuthoringCollectionSchema.safeParse([
      { id: "same", scope: "global", entryType: "exactTerm", displayText: "SQL", spokenText: "sequel" },
      { id: "same", scope: "project", entryType: "exactTerm", displayText: "API", spokenText: "A P I" }
    ]);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.path).toEqual([1, "id"]);
  });

  it("generates deterministic collision-free IDs and preserves array order", () => {
    const result = normalizeLexiconEntries([
      { id: "g03-global-001", scope: "global", entryType: "exactTerm", displayText: "SQL", spokenText: "sequel" },
      { scope: "global", entryType: "exactTerm", displayText: "API", spokenText: "A P I" },
      { scope: "project", entryType: "namedSense", displayText: "resume", senseId: "cv", spokenText: "rez-oo-may" }
    ], { nextId: 1, timestamp: now });

    expect(result.entries.map(({ id, displayText }) => [id, displayText])).toEqual([
      ["g03-global-001", "SQL"],
      ["g03-global-002", "API"],
      ["g03-project-003", "resume"]
    ]);
    expect(result.nextId).toBe(4);
  });

  it("preserves timestamps for unchanged IDs and updates changed entries", () => {
    const existing = [entry(), entry({ id: "g03-project-002", scope: "project", displayText: "API", spokenText: "old" })];
    const result = normalizeLexiconEntries([
      { id: "g03-global-001", scope: "global", entryType: "exactTerm", displayText: "SQL", spokenText: "sequel" },
      { id: "g03-project-002", scope: "project", entryType: "exactTerm", displayText: "API", spokenText: "new" }
    ], { existingEntries: existing, nextId: 3, timestamp: now });

    expect(result.entries[0]).toMatchObject({ createdAt: earlier, updatedAt: earlier });
    expect(result.entries[1]).toMatchObject({ createdAt: earlier, updatedAt: now, spokenText: "new" });
  });

  it("accepts empty collections and empty spoken text", () => {
    expect(normalizeLexiconEntries([], { nextId: 4, timestamp: now })).toEqual({ entries: [], nextId: 4 });
    expect(normalizeLexiconEntries([
      { scope: "global", entryType: "exactTerm", displayText: "SQL", spokenText: "" }
    ], { nextId: 1, timestamp: now }).entries[0]?.spokenText).toBe("");
  });
});
