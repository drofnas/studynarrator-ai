import { Link } from "react-router";
import { VoiceSelect } from "@/features/connections/VoiceSelect.js";
import { LexiconEditor } from "@/features/lexicon/LexiconEditor.js";
import styles from "./ProjectsPage.module.css";
import type { ProjectPageController } from "./useProjectsPageController.js";

export function ProjectConfigurationPanel({
  controller,
}: {
  controller: ProjectPageController;
}) {
  const {
    configuration,
    updateSpeaker,
    enabledVoices,
    presentedEnabledVoices,
    voiceSelectionState,
    selectedConnection,
    speechCatalogState,
    discover,
    navigate,
  } = controller;

  return (
    <aside className={styles.configRail} aria-label="Project configuration">
      <section>
        <div className={styles.sectionHeading}>
          <div>
            <span>Discovered</span>
            <h3>Speakers</h3>
          </div>
          <b>
            {
              configuration.speakers.filter(({ discovered }) => discovered)
                .length
            }
          </b>
        </div>
        <div
          className={styles.speakerTableScroll}
          role="region"
          aria-label="Project speakers"
          tabIndex={0}
        >
          <table className={styles.speakerTable}>
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">Voice</th>
                <th scope="col">Speed</th>
                <th scope="col">Gain dB</th>
              </tr>
            </thead>
            <tbody>
              {configuration.speakers.length === 0 ? (
                <tr>
                  <td colSpan={4}>No speakers discovered.</td>
                </tr>
              ) : (
                configuration.speakers.map((row) => (
                  <tr
                    className={!row.discovered ? styles.unused : ""}
                    key={row.speakerId}
                  >
                    <td>
                      <input
                        aria-label={`Name for speaker ${row.speakerId}`}
                        value={row.displayName}
                        onChange={(event) =>
                          updateSpeaker(row.speakerId, {
                            displayName: event.target.value,
                          })
                        }
                      />
                    </td>
                    <td>
                      <VoiceSelect
                        aria-label={`Voice for speaker ${row.speakerId}`}
                        disabled={enabledVoices.length === 0}
                        value={
                          enabledVoices.some(
                            ({ voiceId }) => voiceId === row.voiceId,
                          )
                            ? (row.voiceId ?? "")
                            : ""
                        }
                        voices={presentedEnabledVoices}
                        emptyOption={
                          enabledVoices.length === 0
                            ? voiceSelectionState === "loading"
                              ? "Loading supported voices…"
                              : "No supported voices"
                            : undefined
                        }
                        onChange={(voiceId) =>
                          updateSpeaker(row.speakerId, { voiceId })
                        }
                      />
                    </td>
                    <td>
                      <input
                        aria-label={`Speed for speaker ${row.speakerId}`}
                        type="number"
                        step="0.05"
                        min="0.01"
                        max="4"
                        value={row.speed}
                        onChange={(event) =>
                          updateSpeaker(row.speakerId, {
                            speed: Number(event.target.value),
                          })
                        }
                      />
                    </td>
                    <td>
                      <input
                        aria-label={`Gain dB for speaker ${row.speakerId}`}
                        type="number"
                        min="-60"
                        max="24"
                        value={row.gainDb}
                        onChange={(event) =>
                          updateSpeaker(row.speakerId, {
                            gainDb: Number(event.target.value),
                          })
                        }
                      />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {enabledVoices.length === 0 ? (
          <p className={styles.voiceFieldMessage}>
            {!selectedConnection?.configured && voiceSelectionState === "ready"
              ? "The global voice catalog has no enabled voices."
              : voiceSelectionState === "failed"
                ? speechCatalogState?.status === "failed"
                  ? speechCatalogState.error
                  : "The global voice catalog could not be loaded."
                : voiceSelectionState === "modelUnavailable"
                  ? "The selected model was not reported by Speaches."
                  : voiceSelectionState === "noSupportedVoices"
                    ? "Speaches reported no voices for the selected model."
                    : voiceSelectionState === "ready"
                      ? "The supported voices are disabled in Settings."
                      : "Loading the selected model's supported voices."}{" "}
            {selectedConnection?.baseUrl ? (
              <button
                type="button"
                onClick={() =>
                  void discover({
                    baseUrl: selectedConnection.baseUrl!,
                    timeoutSeconds: selectedConnection.timeoutSeconds,
                    retryCount: selectedConnection.retryCount,
                  }).catch(() => undefined)
                }
              >
                Retry supported voices
              </button>
            ) : null}{" "}
            <button
              type="button"
              onClick={() => void navigate("/settings/voices")}
            >
              Open Settings
            </button>
          </p>
        ) : null}
      </section>
    </aside>
  );
}

export function ProjectLexiconPanel({
  controller,
}: {
  controller: ProjectPageController;
}) {
  const { projectLexicon, changeProjectLexicon } = controller;

  return (
    <section
      className={styles.lexiconPanel}
      aria-labelledby="project-lexicon-heading"
    >
      <div className={styles.sectionHeading}>
        <div>
          <span>Project pronunciation</span>
          <h3 id="project-lexicon-heading">Project lexicon</h3>
        </div>
        <b>{projectLexicon.length} entries</b>
      </div>
      <p className={styles.lexiconNote}>
        Script Text matches complete words regardless of capitalization. These
        pronunciations apply only to this project.{" "}
        <Link to="/settings/lexicon">
          Manage global lexicon in application Settings.
        </Link>
      </p>
      <LexiconEditor
        value={projectLexicon.map(
          ({ id, displayText, spokenText, enabled }) => ({
            ...(id ? { id } : {}),
            displayText,
            spokenText,
            enabled: enabled ?? true,
          }),
        )}
        onChange={changeProjectLexicon}
        searchLabel="Search project lexicon"
        emptyMessage="No matching project lexicon entries."
        hideSearchWhenEmpty
      />
    </section>
  );
}
