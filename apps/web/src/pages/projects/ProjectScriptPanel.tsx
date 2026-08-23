import { ScriptSourceEditor } from "@/features/projects/ScriptSourceEditor.js";
import { EstimateStrip } from "@/features/projects/estimateStrip.js";
import styles from "./ProjectsPage.module.css";
import {
  countWords,
  type ProjectPageController,
} from "./useProjectsPageController.js";

function ScriptStatistics({
  source,
  label,
}: {
  source: string;
  label: string;
}) {
  return (
    <div className={styles.sourceMetrics} role="group" aria-label={label}>
      <span>{countWords(source).toLocaleString()} words</span>
      <span>{source.length.toLocaleString()} characters</span>
    </div>
  );
}

export function ProjectScriptPanel({
  draft,
  controller,
}: {
  draft: NonNullable<ProjectPageController["draft"]>;
  controller: ProjectPageController;
}) {
  const {
    activeTab,
    renderEstimates,
    estimateContextState,
    editorRef,
    updateDraft,
    cleanedFencedSource,
    cleanupUndo,
    setCleanupUndo,
  } = controller;

  return (
    <main className={styles.editorColumn}>
      {activeTab === "script" ? (
        <section className={styles.scriptPanel}>
          <div className={styles.sectionHeading}>
            <div>
              <span>Source</span>
              <h3>Script editor</h3>
            </div>
            <ScriptStatistics
              source={draft.scriptSource}
              label="Script statistics above editor"
            />
          </div>
          <EstimateStrip
            wordCount={countWords(draft.scriptSource)}
            allVoicesCalibrated={renderEstimates?.allVoicesCalibrated ?? false}
            {...(renderEstimates
              ? {
                  durationMs: renderEstimates.durationMs,
                  mp3Bytes: renderEstimates.mp3Bytes,
                  cacheBytes: renderEstimates.cacheBytes,
                  peakDiskBytes: renderEstimates.peakDiskBytes,
                }
              : {})}
            {...(estimateContextState.status === "ready"
              ? {
                  freeSpaceBytes: estimateContextState.value.freeSpaceBytes,
                }
              : estimateContextState.status === "unavailable"
                ? { freeSpaceBytes: null }
                : {})}
          />
          <div
            className={styles.panelScrollBody}
            role="region"
            aria-label="Script editor content"
            tabIndex={0}
          >
            <ScriptSourceEditor
              ref={editorRef}
              value={draft.scriptSource}
              onChange={(scriptSource) =>
                updateDraft((current) => ({
                  ...current,
                  scriptSource,
                }))
              }
            />
            <div className={styles.sourceActions}>
              <ScriptStatistics
                source={draft.scriptSource}
                label="Script statistics below editor"
              />
              {cleanedFencedSource !== undefined ? (
                <button
                  type="button"
                  className={styles.secondary}
                  onClick={() => {
                    setCleanupUndo(draft.scriptSource);
                    updateDraft((current) => ({
                      ...current,
                      scriptSource: cleanedFencedSource,
                    }));
                  }}
                >
                  Remove surrounding code fence
                </button>
              ) : null}
              {cleanupUndo !== undefined ? (
                <button
                  type="button"
                  className={styles.secondary}
                  onClick={() => {
                    updateDraft((current) => ({
                      ...current,
                      scriptSource: cleanupUndo,
                    }));
                    setCleanupUndo(undefined);
                  }}
                >
                  Restore fenced source
                </button>
              ) : null}
            </div>
          </div>
        </section>
      ) : null}
    </main>
  );
}
