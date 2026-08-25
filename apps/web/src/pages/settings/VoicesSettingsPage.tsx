import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import type {
  ScratchpadClient,
  VoiceCatalog,
} from "@studynarrator/shared-types";
import { queryKeys } from "@/app/queryKeys.js";
import { useConnections } from "@/features/connections/ConnectionProvider.js";
import {
  filterPresentedVoices,
  groupPresentedVoices,
  presentVoices,
  type PresentedVoice,
} from "@/features/connections/voicePresentation.js";
import { AuditionIcon } from "@/shared/audio/AuditionIcon.js";
import { useAudioAudition } from "@/shared/audio/useAudioAudition.js";
import styles from "./SettingsPage.module.css";

const VOICE_TEST_SCRIPT =
  "This short sample lets you hear how this voice handles clear narration.";

export function VoicesSettingsPage({
  scratchpadClient,
}: {
  scratchpadClient: ScratchpadClient;
}) {
  const workspace = useConnections();
  const modelId = workspace.connection?.defaultModelId ?? "";
  const catalogQuery = useQuery({
    queryKey: queryKeys.connection.voiceCatalog(modelId),
    queryFn: () => workspace.getCatalog(modelId),
    enabled: Boolean(modelId),
    retry: false,
  });
  const [catalog, setCatalog] = useState<VoiceCatalog | null>(null);
  const [catalogSearch, setCatalogSearch] = useState("");
  const [voiceTestScript, setVoiceTestScript] = useState(VOICE_TEST_SCRIPT);
  const {
    audition,
    play: playAudition,
    stop: stopAudition,
  } = useAudioAudition<string>();
  const [auditionError, setAuditionError] = useState("");
  const [favoriteSaving, setFavoriteSaving] = useState("");
  const [favoriteError, setFavoriteError] = useState("");

  useEffect(() => {
    if (!workspace.connection?.baseUrl || workspace.catalog.status !== "idle")
      return;
    void workspace
      .discover({
        baseUrl: workspace.connection.baseUrl,
        timeoutSeconds: workspace.connection.timeoutSeconds,
        retryCount: workspace.connection.retryCount,
      })
      .catch(() => undefined);
  }, [workspace]);

  useEffect(() => {
    setCatalog(catalogQuery.isError ? null : (catalogQuery.data ?? null));
  }, [catalogQuery.data, catalogQuery.isError, modelId]);

  const speechModels =
    workspace.catalog.status === "ready"
      ? workspace.catalog.catalog.models
      : [];
  const selectedSpeechModel = speechModels.find(
    (model) => model.modelId === modelId,
  );
  const presentedVoices = useMemo(
    () =>
      presentVoices(selectedSpeechModel?.voices ?? [], catalog?.entries ?? []),
    [catalog, selectedSpeechModel],
  );
  const filteredVoices = useMemo(
    () => filterPresentedVoices(presentedVoices, catalogSearch),
    [catalogSearch, presentedVoices],
  );
  const voiceGroups = useMemo(
    () => groupPresentedVoices(filteredVoices.slice(0, 100)),
    [filteredVoices],
  );
  const auditionReady = Boolean(
    workspace.connection?.configured &&
    workspace.connection.baseUrl &&
    modelId &&
    voiceTestScript.trim(),
  );

  const auditionVoice = async (voiceId: string) => {
    setAuditionError("");
    try {
      await playAudition(
        voiceId,
        async (signal) =>
          (
            await scratchpadClient.preview(
              {
                modelId,
                voiceId,
                speed: 1,
                text: voiceTestScript.trim(),
                applyGlobalLexicon: false,
              },
              signal,
            )
          ).audio,
      );
    } catch (reason) {
      setAuditionError(
        reason instanceof Error
          ? reason.message
          : "This voice sample could not be played. Check the connection and try again.",
      );
    }
  };

  const toggleVoiceFavorite = async (voice: PresentedVoice) => {
    if (!catalog || favoriteSaving) return;
    const currentModelId = catalog.modelId;
    const previous = catalog;
    const nextFavorite = !voice.favorite;
    const includesVoice = catalog.entries.some(
      ({ voiceId }) => voiceId === voice.voiceId,
    );
    const optimistic: VoiceCatalog = {
      ...catalog,
      entries: includesVoice
        ? catalog.entries.map((entry) =>
            entry.voiceId === voice.voiceId
              ? { ...entry, favorite: nextFavorite }
              : entry,
          )
        : [
            ...catalog.entries,
            { ...voice.catalogEntry, favorite: nextFavorite },
          ],
    };
    setFavoriteSaving(voice.voiceId);
    setFavoriteError("");
    setCatalog(optimistic);
    try {
      const saved = await workspace.replaceCatalog(optimistic);
      setCatalog((current) =>
        current?.modelId === currentModelId ? saved : current,
      );
    } catch (reason) {
      setCatalog((current) =>
        current?.modelId === currentModelId ? previous : current,
      );
      setFavoriteError(
        reason instanceof Error
          ? reason.message
          : "This favorite could not be saved. Try the heart again.",
      );
    } finally {
      setFavoriteSaving("");
    }
  };

  return (
    <div className={`${styles.page} ${styles.singleColumnPage}`}>
      <header>
        <p>Catalog + audition</p>
        <h2>Voices</h2>
        <span>
          Browse the saved model’s voices, keep favorites close, and audition
          narration samples.
        </span>
      </header>
      {workspace.error ? (
        <p className={styles.error} role="alert">
          {workspace.error}
        </p>
      ) : null}

      <section className={styles.catalog}>
        <div className={styles.sectionHeading}>
          <div>
            <p>Versioned local catalog</p>
            <h3>Voice browser</h3>
          </div>
          <div className={styles.catalogMeta}>
            {catalog && catalog.modelId === modelId ? (
              <>
                <span className={styles.defaultModelBadge}>Default model</span>
                <code>{catalog.modelId}</code>
              </>
            ) : null}
            <span>{filteredVoices.length} matching voices</span>
          </div>
        </div>
        <label className={styles.voiceTestScript}>
          Voice test script
          <textarea
            rows={3}
            maxLength={1200}
            value={voiceTestScript}
            onChange={(event) => {
              setVoiceTestScript(event.target.value);
              setAuditionError("");
            }}
          />
        </label>
        {auditionError ? (
          <p className={styles.auditionError} role="alert">
            Voice test failed: {auditionError}
          </p>
        ) : null}
        {favoriteError ? (
          <p className={styles.favoriteError} role="alert">
            Favorite not saved: {favoriteError}
          </p>
        ) : null}
        <input
          aria-label="Search voice catalog"
          placeholder="Search name, ID, language, or locale"
          value={catalogSearch}
          onChange={(event) => setCatalogSearch(event.target.value)}
        />
        <div
          className={styles.voiceList}
          role="region"
          aria-label="Voice catalog results"
        >
          {voiceGroups.map((group) => (
            <section
              className={styles.voiceGroup}
              data-group={group.key === "favorites" ? "favorites" : "locale"}
              aria-label={`${group.label} voices`}
              key={group.key}
            >
              <div className={styles.voiceGroupRibbon}>
                <strong>{group.label}</strong>
                <span>{group.voices.length}</span>
              </div>
              <div className={styles.voiceGroupEntries}>
                {group.voices.map((entry) => {
                  const phase =
                    audition?.key === entry.voiceId ? audition.phase : "normal";
                  const action =
                    phase === "processing"
                      ? "Preparing"
                      : phase === "playing"
                        ? "Stop"
                        : "Test";
                  return (
                    <article data-enabled={entry.enabled} key={entry.voiceId}>
                      <div>
                        <strong>{entry.friendlyName}</strong>
                        <code>
                          {entry.voiceId} | {entry.localeLabel}
                        </code>
                      </div>
                      <div className={styles.voiceActions}>
                        <button
                          type="button"
                          className={styles.favoriteButton}
                          data-active={entry.favorite}
                          disabled={Boolean(favoriteSaving)}
                          aria-pressed={entry.favorite}
                          aria-label={`${entry.favorite ? "Remove" : "Add"} ${entry.friendlyName} ${entry.favorite ? "from" : "to"} favorites`}
                          onClick={() => void toggleVoiceFavorite(entry)}
                        >
                          <svg aria-hidden="true" viewBox="0 0 24 24">
                            <path d="M12 20.5 4.4 13A5.1 5.1 0 0 1 11.6 5.8L12 6.2l.4-.4A5.1 5.1 0 0 1 19.6 13L12 20.5Z" />
                          </svg>
                        </button>
                        <button
                          type="button"
                          className={styles.auditionButton}
                          data-state={phase}
                          disabled={
                            phase === "playing" ? false : !auditionReady
                          }
                          aria-label={`${action} ${entry.friendlyName}`}
                          onClick={() => {
                            if (phase === "playing") stopAudition();
                            else void auditionVoice(entry.voiceId);
                          }}
                        >
                          <AuditionIcon phase={phase} />
                        </button>
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
        <p className={styles.attribution}>
          Bundled Kokoro identifiers: hexgrad/Kokoro-82M VOICES.md · Apache-2.0.
          Labels omit subjective quality claims.
        </p>
      </section>
    </div>
  );
}
