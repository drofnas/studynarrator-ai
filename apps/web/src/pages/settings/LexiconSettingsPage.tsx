import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import type { PersistenceClient } from "@studynarrator/shared-types";
import {
  LexiconEditor,
  type LexiconEditorChange,
  type LexiconEditorValue,
} from "@/features/lexicon/LexiconEditor.js";
import { queryKeys } from "@/app/queryKeys.js";
import styles from "./SettingsPage.module.css";

type SimplifiedGlobalEntry = {
  id?: string;
  scope: "global";
  displayText: string;
  spokenText: string;
  caseSensitive: false;
  wholeWord: true;
  priority: 0;
  enabled: boolean;
  notes: "";
} & ({ entryType: "exactTerm" } | { entryType: "namedSense"; senseId: string });
type GlobalLexiconRow = {
  id?: string;
  alias: string;
  spokenText: string;
  enabled: boolean;
};
type LexiconRowState = "saving" | "saved" | "error";

function rowFromEntry(entry: {
  id?: string | undefined;
  entryType: string;
  displayText: string;
  senseId?: string | undefined;
  spokenText: string;
  enabled: boolean;
}): GlobalLexiconRow {
  return {
    ...(entry.id ? { id: entry.id } : {}),
    alias:
      entry.entryType === "namedSense" && entry.senseId
        ? `${entry.displayText}/${entry.senseId}`
        : entry.displayText,
    spokenText: entry.spokenText,
    enabled: entry.enabled,
  };
}

function entryFromRow(row: GlobalLexiconRow): SimplifiedGlobalEntry {
  const alias = row.alias.trim();
  const parts = alias.split("/");
  if (!alias || !row.spokenText.trim())
    throw new Error("Alias and Spoken Text are required.");
  if (parts.length === 1) {
    return {
      ...(row.id ? { id: row.id } : {}),
      scope: "global",
      entryType: "exactTerm",
      displayText: alias,
      spokenText: row.spokenText,
      caseSensitive: false,
      wholeWord: true,
      priority: 0,
      enabled: row.enabled,
      notes: "",
    };
  }
  if (parts.length !== 2 || !parts[0]?.trim() || !parts[1]?.trim())
    throw new Error("Alias must be a term or one term/sense pair.");
  const senseId = parts[1].trim();
  if (!/^[A-Za-z0-9_-]+$/u.test(senseId)) {
    throw new Error(
      "The sense in an Alias may use only letters, numbers, underscores, and hyphens.",
    );
  }
  return {
    ...(row.id ? { id: row.id } : {}),
    scope: "global",
    entryType: "namedSense",
    displayText: parts[0].trim(),
    senseId,
    spokenText: row.spokenText,
    caseSensitive: false,
    wholeWord: true,
    priority: 0,
    enabled: row.enabled,
    notes: "",
  };
}

export function LexiconSettingsPage({ client }: { client: PersistenceClient }) {
  const queryClient = useQueryClient();
  const globalLexiconQuery = useQuery({
    queryKey: queryKeys.persistence.globalLexicon(),
    queryFn: () => client.globalLexicon.list(),
    retry: false,
  });
  const [customLexicon, setCustomLexicon] = useState<GlobalLexiconRow[]>([]);
  const [lexiconRowState, setLexiconRowState] = useState<
    Record<string, LexiconRowState>
  >({});
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [builtInBusy, setBuiltInBusy] = useState(false);
  const [reimporting, setReimporting] = useState(false);
  const customLexiconRef = useRef(customLexicon);
  const customLexiconDirtyRef = useRef(false);
  const lexiconRevisionRef = useRef(0);
  const lexiconQueueRef = useRef<Promise<void>>(Promise.resolve());
  const lexiconTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const pendingLexiconRowsRef = useRef(new Set<string>());

  useEffect(() => {
    if (!globalLexiconQuery.data || customLexiconDirtyRef.current) return;
    const loaded = globalLexiconQuery.data.custom.map(rowFromEntry);
    customLexiconRef.current = loaded;
    setCustomLexicon(loaded);
  }, [globalLexiconQuery.data]);

  const loadError = globalLexiconQuery.isError
    ? globalLexiconQuery.error instanceof Error
      ? globalLexiconQuery.error.message
      : "The lexicon could not be loaded."
    : "";
  const builtInLexicon = (globalLexiconQuery.data?.builtIns ?? []).map(
    rowFromEntry,
  );

  useEffect(
    () => () => {
      if (lexiconTimerRef.current) clearTimeout(lexiconTimerRef.current);
    },
    [],
  );

  const applyGlobalLexiconState = useCallback(
    (
      state: Awaited<ReturnType<PersistenceClient["globalLexicon"]["list"]>>,
    ) => {
      queryClient.setQueryData(queryKeys.persistence.globalLexicon(), state);
      const custom = state.custom.map(rowFromEntry);
      customLexiconRef.current = custom;
      setCustomLexicon(custom);
    },
    [queryClient],
  );

  const persistCustomLexicon = useCallback(
    (entries: GlobalLexiconRow[], affectedIds: string[], success?: string) => {
      let snapshot: SimplifiedGlobalEntry[];
      try {
        snapshot = entries.map(entryFromRow);
      } catch (reason) {
        setLexiconRowState((current) => ({
          ...current,
          ...Object.fromEntries(
            affectedIds.map((id) => [id, "error" as const]),
          ),
        }));
        setError(
          reason instanceof Error
            ? reason.message
            : "The Custom Lexicon Alias is invalid.",
        );
        return Promise.resolve(false);
      }
      const seenAliases = new Set<string>();
      const duplicateEntry = entries.find((entry) => {
        const key = entry.alias.trim().toLocaleLowerCase("en-US");
        if (!key || !seenAliases.has(key)) {
          seenAliases.add(key);
          return false;
        }
        return true;
      });
      if (duplicateEntry) {
        const ids = duplicateEntry.id ? [duplicateEntry.id] : affectedIds;
        setLexiconRowState((current) => ({
          ...current,
          ...Object.fromEntries(ids.map((id) => [id, "error" as const])),
        }));
        setError("Alias must be unique regardless of capitalization.");
        return Promise.resolve(false);
      }
      const revision = lexiconRevisionRef.current;
      setLexiconRowState((current) => ({
        ...current,
        ...Object.fromEntries(affectedIds.map((id) => [id, "saving" as const])),
      }));
      const task = lexiconQueueRef.current.then(async () => {
        try {
          const state = await client.globalLexicon.replaceCustom(snapshot);
          if (revision === lexiconRevisionRef.current) {
            applyGlobalLexiconState(state);
            setLexiconRowState((current) => ({
              ...current,
              ...Object.fromEntries(
                affectedIds.map((id) => [id, "saved" as const]),
              ),
            }));
            customLexiconDirtyRef.current = false;
            if (success) setStatus(success);
            setError("");
          }
          return true;
        } catch (reason) {
          if (revision === lexiconRevisionRef.current) {
            setLexiconRowState((current) => ({
              ...current,
              ...Object.fromEntries(
                affectedIds.map((id) => [id, "error" as const]),
              ),
            }));
            setError(
              reason instanceof Error
                ? reason.message
                : "The custom lexicon could not be saved. Your edits are still here; try again.",
            );
          }
          return false;
        }
      });
      lexiconQueueRef.current = task.then(
        () => undefined,
        () => undefined,
      );
      return task;
    },
    [applyGlobalLexiconState, client],
  );

  const flushCustomLexicon = useCallback(() => {
    if (lexiconTimerRef.current) clearTimeout(lexiconTimerRef.current);
    lexiconTimerRef.current = undefined;
    const affectedIds = [...pendingLexiconRowsRef.current];
    pendingLexiconRowsRef.current.clear();
    if (affectedIds.length === 0) return Promise.resolve(true);
    return persistCustomLexicon(
      customLexiconRef.current,
      affectedIds,
      "Custom pronunciation saved.",
    );
  }, [persistCustomLexicon]);

  const changeCustomLexicon = (
    value: LexiconEditorValue[],
    change: LexiconEditorChange,
  ) => {
    const next = value.map((entry) => ({
      ...(entry.id ? { id: entry.id } : {}),
      alias: entry.displayText,
      spokenText: entry.spokenText,
      enabled: entry.enabled,
    }));
    if (change.kind === "add" || change.kind === "delete") {
      customLexiconDirtyRef.current = true;
      void flushCustomLexicon();
      lexiconRevisionRef.current += 1;
      return persistCustomLexicon(
        next,
        [change.id],
        change.kind === "add"
          ? "Custom pronunciation added."
          : "Custom pronunciation deleted.",
      );
    }
    if (change.kind === "commit") {
      pendingLexiconRowsRef.current.add(change.id);
      void flushCustomLexicon();
      return;
    }
    customLexiconDirtyRef.current = true;
    lexiconRevisionRef.current += 1;
    customLexiconRef.current = next;
    setCustomLexicon(next);
    pendingLexiconRowsRef.current.add(change.id);
    setLexiconRowState((current) => ({ ...current, [change.id]: "saving" }));
    if (change.kind === "toggle") void flushCustomLexicon();
    else {
      if (lexiconTimerRef.current) clearTimeout(lexiconTimerRef.current);
      lexiconTimerRef.current = setTimeout(() => {
        void flushCustomLexicon();
      }, 500);
    }
  };

  const changeBuiltInLexicon = async (
    value: LexiconEditorValue[],
    change: LexiconEditorChange,
  ) => {
    if (change.kind !== "toggle") return false;
    const entry = value.find((candidate) => candidate.id === change.id);
    if (!entry?.id) return false;
    setBuiltInBusy(true);
    try {
      applyGlobalLexiconState(
        await client.globalLexicon.setBuiltInEnabled({
          id: entry.id,
          enabled: entry.enabled,
        }),
      );
      setStatus("Global pronunciation updated.");
      setError("");
      return true;
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "The global lexicon entry could not be updated.",
      );
      return false;
    } finally {
      setBuiltInBusy(false);
    }
  };

  const reimportBuiltIns = async () => {
    if (
      !window.confirm(
        "Reimport every built-in global lexicon entry from the bundled catalog? Your custom lexicon entries will not be changed.",
      )
    )
      return;
    if (!(await flushCustomLexicon())) return;
    setReimporting(true);
    try {
      applyGlobalLexiconState(await client.globalLexicon.reimportBuiltIns());
      customLexiconDirtyRef.current = false;
      setStatus("Global lexicon reimported. Custom entries were preserved.");
      setError("");
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "The global lexicon could not be reimported.",
      );
    } finally {
      setReimporting(false);
    }
  };

  return (
    <div className={`${styles.page} ${styles.singleColumnPage}`}>
      <header>
        <p>Shared pronunciation</p>
        <h2>Lexicon</h2>
        <span>
          Manage pronunciation rules that apply to every project and preview.
        </span>
      </header>
      {error || loadError ? (
        <p className={styles.error} role="alert">
          {error || loadError}
        </p>
      ) : null}
      {status ? (
        <p className={styles.status} aria-live="polite">
          {status}
        </p>
      ) : null}

      <section
        className={styles.globalLexicon}
        aria-labelledby="global-lexicon-heading"
      >
        <div className={styles.sectionHeading}>
          <div>
            <p>Built in</p>
            <h3 id="global-lexicon-heading">Global lexicon</h3>
          </div>
          <span>{builtInLexicon.length} entries</span>
        </div>
        <p>
          Built-in aliases such as <code>resume/cv</code> are fixed. You may
          enable or disable them, but only the bundled catalog can change their
          spelling or pronunciation.
        </p>
        <LexiconEditor
          value={builtInLexicon.map(({ id, alias, spokenText, enabled }) => ({
            ...(id ? { id } : {}),
            displayText: alias,
            spokenText,
            enabled,
          }))}
          onChange={changeBuiltInLexicon}
          searchLabel="Search global lexicon"
          emptyMessage="No matching global lexicon entries."
          displayTextLabel="Alias"
          allowAdd={false}
          allowEdit={false}
          allowDelete={false}
          disabled={builtInBusy || reimporting}
        />
      </section>

      <section
        className={styles.globalLexicon}
        aria-labelledby="custom-lexicon-heading"
      >
        <div className={styles.sectionHeading}>
          <div>
            <p>User defined</p>
            <h3 id="custom-lexicon-heading">Custom lexicon</h3>
          </div>
          <span>{customLexicon.length} entries</span>
        </div>
        <p>
          Add, edit, delete, or enable custom pronunciation rules without
          changing the built-in global catalog.
        </p>
        <LexiconEditor
          value={customLexicon.map(({ id, alias, spokenText, enabled }) => ({
            ...(id ? { id } : {}),
            displayText: alias,
            spokenText,
            enabled,
          }))}
          onChange={changeCustomLexicon}
          searchLabel="Search custom lexicon"
          emptyMessage="No matching custom lexicon entries."
          displayTextLabel="Alias"
          disabled={reimporting}
          rowErrors={Object.fromEntries(
            Object.entries(lexiconRowState)
              .filter(([, state]) => state === "error")
              .map(([id]) => [id, "Not saved — edit or blur to retry"]),
          )}
        />
      </section>

      <section
        className={styles.globalLexicon}
        aria-labelledby="reimport-heading"
      >
        <div className={styles.sectionHeading}>
          <div>
            <p>Restore built-ins</p>
            <h3 id="reimport-heading">Reimport global lexicon</h3>
          </div>
        </div>
        <p>
          Restore every built-in global entry from the bundled JSON catalog.
          Custom entries are preserved.
        </p>
        <button
          type="button"
          onClick={() => void reimportBuiltIns()}
          disabled={reimporting || builtInBusy}
        >
          {reimporting ? "Reimporting…" : "Reimport global lexicon"}
        </button>
      </section>
    </div>
  );
}
