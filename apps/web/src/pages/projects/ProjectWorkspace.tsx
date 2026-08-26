import { Link } from "react-router";
import { AuditionIcon } from "@/shared/audio/AuditionIcon.js";
import { SharedAudioPlayer } from "@/shared/audio/SharedAudioPlayer.js";
import { StickyTabBar } from "@/shared/ui/StickyTabBar.js";
import styles from "./ProjectsPage.module.css";
import { ProjectScriptPanel } from "./ProjectScriptPanel.js";
import {
  ProjectConfigurationPanel,
  ProjectLexiconPanel,
} from "./ProjectSettingsPanel.js";
import {
  diagnosticKey,
  message,
  projectTabs,
  renderProgressLabel,
  storeDiskSpaceCheckEnabled,
  terminalRenderStates,
  type ProjectPageController,
} from "./useProjectsPageController.js";

export function ProjectWorkspace({
  controller,
}: {
  controller: ProjectPageController;
}) {
  const {
    activeTab,
    project,
    draft,
    errors,
    setErrors,
    notice,
    busy,
    updateDraft,
    saveNow,
    duplicateProject,
    deleteProject,
    tabRefs,
    selectTab,
    moveTabFocus,
    previewError,
    dryRun,
    analysisError,
    analysisState,
    activeDiagnosticsByKey,
    focusLine,
    ignoreDiagnostic,
    ignoredDiagnostics,
    restoreDiagnostic,
    segmentAudition,
    runPreview,
    renderClient,
    renderActive,
    startRender,
    diskSpaceCheckEnabled,
    setDiskSpaceCheckEnabled,
    renderError,
    setRenderError,
    renderStarting,
    selectedRenderJob,
    completedRenderJob,
    renderWaveform,
    pinBusy,
    toggleCompletedRenderPin,
  } = controller;

  return (
    <div className={styles.page}>
      <Link className={styles.backLink} to="/projects">
        ← Back to Projects
      </Link>
      <header className={styles.pageHeader}>
        <div>
          <p className={styles.kicker}>Project workspace</p>
          <h2>Project details</h2>
          <p>
            Shape the script, assign voices, inspect the narration score, then
            render and listen.
          </p>
        </div>
      </header>
      {errors.length > 0 ? (
        <div className={styles.alert} role="alert">
          <strong>Review these items</strong>
          <ul>
            {errors.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
          <button type="button" onClick={() => setErrors([])}>
            Dismiss
          </button>
        </div>
      ) : null}
      <p className={styles.notice} aria-live="polite">
        {notice}
      </p>

      {draft && project ? (
        <>
          <section
            className={styles.projectIdentity}
            aria-label="Project details"
          >
            <label>
              Project name
              <input
                value={draft.name}
                onChange={(event) =>
                  updateDraft((current) => ({
                    ...current,
                    name: event.target.value,
                  }))
                }
              />
            </label>
            <label>
              Description
              <input
                value={draft.description}
                onChange={(event) =>
                  updateDraft((current) => ({
                    ...current,
                    description: event.target.value,
                  }))
                }
              />
            </label>
            <div className={styles.projectActions}>
              <div className={styles.actionRow}>
                <button type="button" onClick={() => void saveNow()}>
                  Save now
                </button>
                <button
                  type="button"
                  className={styles.secondary}
                  onClick={() => void duplicateProject()}
                >
                  Duplicate
                </button>
                <button
                  type="button"
                  className={styles.danger}
                  onClick={() => void deleteProject()}
                >
                  Delete
                </button>
              </div>
            </div>
          </section>
          <StickyTabBar label="Project workspace">
            {projectTabs.map(({ id, label }) => (
              <button
                ref={(element) => {
                  tabRefs.current[id] = element;
                }}
                type="button"
                role="tab"
                id={`project-tab-${id}`}
                aria-controls={`project-panel-${id}`}
                aria-selected={activeTab === id}
                tabIndex={activeTab === id ? 0 : -1}
                key={id}
                onClick={() => selectTab(id)}
                onKeyDown={(event) => moveTabFocus(event, id)}
              >
                {label}
              </button>
            ))}
          </StickyTabBar>
        </>
      ) : null}

      <div
        className={styles.tabPanel}
        role={draft && project ? "tabpanel" : undefined}
        id={draft && project ? `project-panel-${activeTab}` : undefined}
        aria-labelledby={
          draft && project ? `project-tab-${activeTab}` : undefined
        }
      >
        <div className={styles.workspace}>
          {!draft || !project ? (
            <section className={styles.empty}>
              <h3>{busy ? "Loading project" : "Project unavailable"}</h3>
              <p>
                {busy
                  ? "Opening the saved project workspace…"
                  : "Return to the project index and choose another project."}
              </p>
            </section>
          ) : (
            <>
              {activeTab === "script" ? (
                <ProjectScriptPanel draft={draft} controller={controller} />
              ) : null}

              {activeTab === "settings" ? (
                <ProjectConfigurationPanel controller={controller} />
              ) : null}
            </>
          )}
        </div>

        {draft && project ? (
          <>
            {activeTab === "settings" ? (
              <ProjectLexiconPanel controller={controller} />
            ) : null}

            {previewError &&
            analysisState !== "parsing" &&
            activeTab === "details" ? (
              <p className={styles.previewError} role="alert">
                {previewError} Your project and preview selection are unchanged.
              </p>
            ) : null}

            {activeTab === "render" ? (
              <section
                className={styles.renderPlansPanel}
                aria-labelledby="render-listen-heading"
              >
                <div className={styles.sectionHeading}>
                  <div>
                    <span>Project audio</span>
                    <h3 id="render-listen-heading">Render and listen</h3>
                  </div>
                  {renderClient ? (
                    <button
                      type="button"
                      disabled={
                        !dryRun || dryRun.status === "blocked" || renderActive
                      }
                      onClick={() => void startRender()}
                    >
                      {renderActive
                        ? "Rendering…"
                        : selectedRenderJob?.state === "failed"
                          ? "Try again"
                          : "Render"}
                    </button>
                  ) : null}
                </div>
                <p>
                  Create your audio, then listen or download it here. The first
                  render may take longer while voice segments are generated;
                  later edits are faster when unchanged segments can be reused.
                </p>
                <label className={styles.check}>
                  <input
                    type="checkbox"
                    checked={diskSpaceCheckEnabled}
                    onChange={(event) => {
                      const enabled = event.target.checked;
                      setDiskSpaceCheckEnabled(enabled);
                      storeDiskSpaceCheckEnabled(enabled);
                    }}
                  />
                  Block renders when disk space is insufficient
                </label>
                {renderError ? (
                  <p className={styles.fieldError} role="alert">
                    {renderError}
                  </p>
                ) : null}
                {renderActive ? (
                  <div className={styles.renderProgress} aria-live="polite">
                    <div>
                      <strong>
                        {renderStarting &&
                        (!selectedRenderJob ||
                          terminalRenderStates.has(selectedRenderJob.state))
                          ? "Preparing render…"
                          : selectedRenderJob
                            ? renderProgressLabel(selectedRenderJob)
                            : "Preparing render…"}
                      </strong>
                      {selectedRenderJob &&
                      !terminalRenderStates.has(selectedRenderJob.state) &&
                      selectedRenderJob.progress.totalChunks > 0 ? (
                        <span>
                          {selectedRenderJob.progress.completedChunks.toLocaleString()}{" "}
                          of{" "}
                          {selectedRenderJob.progress.totalChunks.toLocaleString()}{" "}
                          chunks complete
                        </span>
                      ) : null}
                    </div>
                    {selectedRenderJob &&
                    !terminalRenderStates.has(selectedRenderJob.state) &&
                    selectedRenderJob.progress.totalChunks > 0 ? (
                      <progress
                        aria-label="Render chunk progress"
                        max={selectedRenderJob.progress.totalChunks}
                        value={selectedRenderJob.progress.completedChunks}
                      >
                        {Math.floor(
                          (selectedRenderJob.progress.completedChunks /
                            selectedRenderJob.progress.totalChunks) *
                            100,
                        )}
                        %
                      </progress>
                    ) : (
                      <progress aria-label="Render chunk progress">
                        Preparing render
                      </progress>
                    )}
                  </div>
                ) : null}
                {selectedRenderJob?.error ? (
                  <p className={styles.fieldError} role="alert">
                    {selectedRenderJob.error.message}
                  </p>
                ) : null}
                {renderClient && completedRenderJob ? (
                  <div className={styles.renderResult}>
                    <SharedAudioPlayer
                      label="Completed project render"
                      src={renderClient.renderAudioSource(
                        completedRenderJob.id,
                      )}
                      disabled={renderActive}
                      {...(renderWaveform ? { waveform: renderWaveform } : {})}
                    />
                    <div className={styles.renderDownloads}>
                      <button
                        type="button"
                        className={styles.textLinkButton}
                        aria-pressed={completedRenderJob.pinned}
                        disabled={renderActive || pinBusy}
                        onClick={() => void toggleCompletedRenderPin()}
                      >
                        {completedRenderJob.pinned
                          ? "Unpin completed output"
                          : "Pin completed output"}
                      </button>
                      <button
                        type="button"
                        className={styles.textLinkButton}
                        disabled={renderActive}
                        onClick={() =>
                          void renderClient
                            .exportDetails(completedRenderJob.id)
                            .catch((error: unknown) =>
                              setRenderError(message(error)),
                            )
                        }
                      >
                        Download Details
                      </button>
                      <button
                        type="button"
                        disabled={renderActive}
                        onClick={() =>
                          void renderClient
                            .exportAudio(completedRenderJob.id)
                            .catch((error: unknown) =>
                              setRenderError(message(error)),
                            )
                        }
                      >
                        Download
                      </button>
                    </div>
                  </div>
                ) : null}
              </section>
            ) : null}

            {activeTab === "details" ? (
              <section className={styles.validationPanel}>
                <div className={styles.sectionHeading}>
                  <div>
                    <span>Offline validation</span>
                    <h3>Narration score</h3>
                  </div>
                  <b>{dryRun?.rows.length ?? 0} ordered rows</b>
                </div>
                <div
                  className={`${styles.panelScrollBody} ${styles.detailsBody}`}
                  role="region"
                  aria-label="Narration score content"
                  tabIndex={0}
                >
                  {analysisError ? (
                    <p className={styles.fieldError}>{analysisError}</p>
                  ) : null}
                  <div
                    className={styles.validationSummary}
                    data-state={dryRun?.status ?? "blocked"}
                  >
                    <strong>
                      {analysisState === "parsing"
                        ? "Parsing…"
                        : dryRun?.status === "ready"
                          ? "Ready to render"
                          : dryRun?.status === "readyWithWarnings"
                            ? "Ready with warnings"
                            : "Blocked by errors"}
                    </strong>
                    <span>
                      Connection availability is shown separately. This
                      deterministic dry run still makes no TTS request.
                    </span>
                  </div>
                  {dryRun && dryRun.issues.length > 0 ? (
                    <ul className={styles.issues}>
                      {dryRun.issues.map((issue, index) => {
                        const diagnostic = issue.target
                          ? activeDiagnosticsByKey.get(
                              diagnosticKey({
                                code: issue.code,
                                pattern: issue.target.id,
                              }),
                            )
                          : undefined;
                        return (
                          <li
                            data-severity={issue.severity}
                            key={`${issue.code}:${issue.target?.id ?? String(index)}`}
                          >
                            <button
                              type="button"
                              onClick={() =>
                                issue.line && focusLine(issue.line)
                              }
                            >
                              {issue.code}
                            </button>
                            <span>{issue.message}</span>
                            {diagnostic ? (
                              <button
                                type="button"
                                className={styles.secondary}
                                onClick={() =>
                                  void ignoreDiagnostic(diagnostic)
                                }
                              >
                                Ignore this pattern
                              </button>
                            ) : null}
                          </li>
                        );
                      })}
                    </ul>
                  ) : null}
                  {ignoredDiagnostics.length > 0 ? (
                    <section aria-label="Ignored diagnostic patterns">
                      <h4>Ignored diagnostic patterns</h4>
                      <p>
                        These exact diagnostic patterns are suppressed across
                        projects.
                      </p>
                      <ul className={styles.issues}>
                        {ignoredDiagnostics.map((item) => (
                          <li key={diagnosticKey(item)}>
                            <code>{item.code}</code>
                            <span>{item.pattern}</span>
                            <button
                              type="button"
                              className={styles.secondary}
                              onClick={() => void restoreDiagnostic(item)}
                            >
                              Restore this pattern
                            </button>
                          </li>
                        ))}
                      </ul>
                    </section>
                  ) : null}
                  <div
                    className={styles.score}
                    aria-label="Dry run ordered segment table"
                  >
                    <div className={styles.scoreHeader}>
                      <span>#</span>
                      <span>Type</span>
                      <span>Speaker / cue</span>
                      <span>Original</span>
                      <span>Readable</span>
                      <span>TTS text</span>
                      <span>Audio</span>
                    </div>
                    {dryRun?.rows.map((row) => (
                      <div
                        className={styles.scoreRow}
                        data-type={row.type}
                        data-valid={row.validationStatus}
                        key={row.rowNumber}
                      >
                        <button
                          type="button"
                          className={styles.rowFocus}
                          aria-label={`Focus source line ${String(row.sourceRange.start.line)}`}
                          onClick={() => focusLine(row.sourceRange.start.line)}
                        >
                          {String(row.rowNumber).padStart(2, "0")}
                        </button>
                        <span className={styles.scoreType}>
                          {row.type === "pause"
                            ? `${row.origin} pause`
                            : row.type}
                        </span>
                        {row.type === "section" ? (
                          <>
                            <strong>{row.title}</strong>
                            <small>Line {row.sourceRange.start.line}</small>
                          </>
                        ) : row.type === "pause" ? (
                          <>
                            <strong>{row.pauseId}</strong>
                            <small>
                              {row.durationMs === null
                                ? "Missing duration"
                                : `${String(row.durationMs)} ms`}
                            </small>
                          </>
                        ) : (
                          <>
                            <span
                              className={styles.speakerChip}
                              aria-label={`Speaker ${row.speakerId}. ${row.voiceId ? `Voice ID ${row.voiceId}` : "Voice ID not configured"}`}
                              title={
                                row.voiceId
                                  ? `Voice ID: ${row.voiceId}`
                                  : "Voice ID not configured"
                              }
                            >
                              <span
                                className={styles.speakerLabel}
                                aria-hidden="true"
                              >
                                speaker
                              </span>
                              <span
                                className={styles.speakerName}
                                aria-hidden="true"
                              >
                                {row.speakerId}
                              </span>
                            </span>
                            <span>{row.originalText}</span>
                            <span>{row.readableText}</span>
                            <span>{row.ttsText}</span>
                            {row.validationStatus === "valid" ? (
                              (() => {
                                const phase =
                                  segmentAudition?.key === row.nodeOrdinal
                                    ? segmentAudition.phase
                                    : "normal";
                                const action =
                                  phase === "processing"
                                    ? "Preparing"
                                    : phase === "playing"
                                      ? "Playing"
                                      : "Play";
                                return (
                                  <button
                                    type="button"
                                    className={styles.previewButton}
                                    data-state={phase}
                                    aria-label={`${action} narration row ${String(row.rowNumber)}`}
                                    onClick={() =>
                                      void runPreview(row.nodeOrdinal)
                                    }
                                  >
                                    <AuditionIcon phase={phase} />
                                  </button>
                                );
                              })()
                            ) : (
                              <span className={styles.previewUnavailable}>
                                Unavailable
                              </span>
                            )}
                          </>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              </section>
            ) : null}
          </>
        ) : null}
      </div>
    </div>
  );
}
