import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import {
  transformScratchpadPassage,
  type LexiconEntry,
} from "@studynarrator/core";
import type {
  PersistenceClient,
  ScratchpadClient,
  VoiceCatalog,
} from "@studynarrator/shared-types";
import { queryKeys } from "@/app/queryKeys.js";
import { useConnections } from "@/features/connections/ConnectionProvider.js";
import { VoiceSelect } from "@/features/connections/VoiceSelect.js";
import { presentVoices } from "@/features/connections/voicePresentation.js";
import { supportedProjectVoices } from "@/features/projects/projectAuthoring.js";
import { useAudioAudition } from "@/shared/audio/useAudioAudition.js";
import { ErrorNotice } from "@/shared/ui/ErrorNotice.js";
import styles from "./ScratchpadPage.module.css";

const LAST_PASSAGE_STORAGE_KEY = "studynarrator.scratchpad.lastPassage";

function readLastPassage(): string {
  try {
    return window.sessionStorage.getItem(LAST_PASSAGE_STORAGE_KEY) ?? "";
  } catch {
    return "";
  }
}

function message(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "StudyNarrator could not complete speech synthesis.";
}

export function ScratchpadPage({
  client,
  persistence,
}: {
  client: ScratchpadClient;
  persistence: PersistenceClient;
}) {
  const connections = useConnections();
  const globalLexiconQuery = useQuery({
    queryKey: queryKeys.persistence.globalLexicon(),
    queryFn: () => persistence.globalLexicon.list(),
    retry: false,
  });
  const { play: playAudition } = useAudioAudition<"scratchpad">();
  const [modelId, setModelId] = useState("");
  const [voiceId, setVoiceId] = useState("");
  const [speed, setSpeed] = useState(1);
  const [text, setText] = useState(readLastPassage);
  const [applyGlobalLexicon, setApplyGlobalLexicon] = useState(false);
  const globalLexicon: LexiconEntry[] = globalLexiconQuery.data
    ? [
        ...globalLexiconQuery.data.builtIns,
        ...globalLexiconQuery.data.custom,
      ].map(({ entryKind: _entryKind, ...entry }) => entry)
    : [];
  const [catalog, setCatalog] = useState<VoiceCatalog | null>(null);
  const [catalogState, setCatalogState] = useState<
    "idle" | "loading" | "ready" | "failed"
  >("idle");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const previewMutation = useMutation({
    mutationFn: async ({
      input,
      signal,
    }: {
      input: Parameters<ScratchpadClient["preview"]>[0];
      signal: AbortSignal;
    }) => await client.preview(input, signal),
    retry: false,
  });

  useEffect(() => {
    let current = true;
    if (!modelId) {
      setCatalog(null);
      setCatalogState("idle");
      return;
    }
    setCatalog(null);
    setCatalogState("loading");
    void connections
      .getCatalog(modelId)
      .then((value) => {
        if (current) {
          setCatalog(value);
          setCatalogState("ready");
        }
      })
      .catch(() => {
        if (current) {
          setCatalog(null);
          setCatalogState("failed");
        }
      });
    return () => {
      current = false;
    };
  }, [connections, modelId]);

  useEffect(() => {
    const connection = connections.connection;
    if (!connection?.baseUrl || connections.catalog.status !== "idle") return;
    void connections
      .discover({
        baseUrl: connection.baseUrl,
        timeoutSeconds: connection.timeoutSeconds,
        retryCount: connection.retryCount,
      })
      .catch(() => undefined);
  }, [connections]);

  useEffect(() => {
    try {
      if (text) window.sessionStorage.setItem(LAST_PASSAGE_STORAGE_KEY, text);
      else window.sessionStorage.removeItem(LAST_PASSAGE_STORAGE_KEY);
    } catch {
      /* Session storage can be unavailable in restricted browser contexts. */
    }
  }, [text]);

  const connection = connections.connection;
  const speechCatalogState = connections.catalog;
  const modelOptions =
    speechCatalogState.status === "ready"
      ? speechCatalogState.catalog.models
      : [];
  const speechModel = modelOptions.find((item) => item.modelId === modelId);
  const voiceOptions = useMemo(() => {
    if (!catalog || catalogState !== "ready" || !speechModel) return [];
    return supportedProjectVoices(catalog.entries, speechModel.voices);
  }, [catalog, catalogState, speechModel]);
  const presentedVoiceOptions = useMemo(() => {
    const selectableIds = new Set(voiceOptions.map(({ voiceId }) => voiceId));
    return presentVoices(
      speechModel?.voices.filter(({ voiceId }) => selectableIds.has(voiceId)) ??
        [],
      voiceOptions,
    );
  }, [speechModel, voiceOptions]);

  useEffect(() => {
    if (speechCatalogState?.status !== "ready") return;
    const available = new Set(modelOptions.map((item) => item.modelId));
    setModelId((current) => {
      if (available.has(current)) return current;
      if (
        connection?.defaultModelId &&
        available.has(connection.defaultModelId)
      )
        return connection.defaultModelId;
      return modelOptions[0]?.modelId ?? "";
    });
  }, [connection?.defaultModelId, modelOptions, speechCatalogState.status]);

  useEffect(() => {
    if (catalogState !== "ready" || !speechModel) return;
    const available = new Set(voiceOptions.map((item) => item.voiceId));
    setVoiceId((current) => {
      if (available.has(current)) return current;
      if (
        connection?.defaultVoiceId &&
        available.has(connection.defaultVoiceId)
      )
        return connection.defaultVoiceId;
      return voiceOptions[0]?.voiceId ?? "";
    });
  }, [catalogState, connection?.defaultVoiceId, speechModel, voiceOptions]);
  const projection = useMemo(() => {
    if (!text.trim()) return { result: null, error: "" };
    try {
      return {
        result: transformScratchpadPassage({
          text,
          entries: globalLexicon,
          applyGlobalLexicon,
        }),
        error: "",
      };
    } catch (reason) {
      return { result: null, error: message(reason) };
    }
  }, [applyGlobalLexicon, globalLexicon, text]);
  const validSpeed = Number.isFinite(speed) && speed > 0 && speed <= 4;
  const ready = Boolean(
    connection?.baseUrl &&
    modelId.trim() &&
    voiceId.trim() &&
    text.trim() &&
    validSpeed &&
    projection.result,
  );

  const synthesize = async () => {
    if (!ready) return;
    setBusy(true);
    setError("");
    try {
      await playAudition(
        "scratchpad",
        async (signal) =>
          (
            await previewMutation.mutateAsync({
              input: { modelId, voiceId, speed, text, applyGlobalLexicon },
              signal,
            })
          ).audio,
      );
    } catch (reason) {
      setError(message(reason));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={styles.page}>
      <header className={styles.pageHeader}>
        <div>
          <p className={styles.kicker}>One passage · one request</p>
          <h2>Quick Scratchpad</h2>
          <p>Test a voice or pronunciation without touching a project.</p>
        </div>
      </header>

      <section
        className={styles.controls}
        aria-label="Scratchpad synthesis controls"
      >
        <div className={styles.setupHeading}>
          <span className={styles.step}>Signal path</span>
          <h3>Voice setup</h3>
        </div>
        <div className={styles.setupGrid}>
          <label htmlFor="scratchpad-model">
            Model
            <select
              id="scratchpad-model"
              value={modelId}
              disabled={
                speechCatalogState?.status !== "ready" ||
                modelOptions.length === 0
              }
              onChange={(event) => {
                setModelId(event.target.value);
                setVoiceId("");
              }}
            >
              <option value="">Choose a model</option>
              {modelOptions.map((item) => (
                <option key={item.modelId} value={item.modelId}>
                  {item.modelId}
                </option>
              ))}
            </select>
          </label>
          <label htmlFor="scratchpad-voice">
            Voice
            <VoiceSelect
              id="scratchpad-voice"
              value={voiceId}
              voices={presentedVoiceOptions}
              disabled={catalogState !== "ready" || voiceOptions.length === 0}
              emptyOption="Choose a voice"
              onChange={setVoiceId}
            />
          </label>
          <label htmlFor="scratchpad-speed">
            Speed
            <input
              id="scratchpad-speed"
              type="number"
              min="0.01"
              max="4"
              step="0.05"
              value={speed}
              onChange={(event) => setSpeed(Number(event.target.value))}
            />
          </label>
        </div>
        {!connection?.baseUrl ? (
          <p className={styles.fieldError}>
            Configure the Speaches server in Settings before synthesis.
          </p>
        ) : null}
        {speechCatalogState?.status === "loading" ? (
          <p className={styles.catalogNotice}>Loading available models…</p>
        ) : null}
        {speechCatalogState?.status === "failed" ? (
          <p className={styles.fieldError}>{speechCatalogState.error}</p>
        ) : null}
        {speechCatalogState?.status === "ready" && modelOptions.length === 0 ? (
          <p className={styles.fieldError}>
            This connection did not report any speech models.
          </p>
        ) : null}
        {modelId && catalogState === "loading" ? (
          <p className={styles.catalogNotice}>Loading available voices…</p>
        ) : null}
        {catalogState === "failed" ? (
          <p className={styles.fieldError}>
            The configured voice catalog could not be loaded.
          </p>
        ) : null}
        {catalogState === "ready" &&
        speechModel &&
        voiceOptions.length === 0 ? (
          <p className={styles.fieldError}>
            This model has no enabled, supported voices.
          </p>
        ) : null}
      </section>

      <main className={styles.composer}>
        <section className={styles.passagePanel}>
          <div className={styles.sectionHeading}>
            <div>
              <span className={styles.step}>Source</span>
              <h3>Short passage</h3>
            </div>
            <b>{text.length} / 1200</b>
          </div>
          <label htmlFor="scratchpad-text">Passage</label>
          <textarea
            id="scratchpad-text"
            maxLength={1200}
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder="SQL indexes can improve database reads."
          />
          <label className={styles.lexiconToggle}>
            <input
              type="checkbox"
              checked={applyGlobalLexicon}
              onChange={(event) => setApplyGlobalLexicon(event.target.checked)}
            />
            Apply global lexicon
          </label>
          {projection.error ? (
            <p className={styles.fieldError} role="alert">
              {projection.error}
            </p>
          ) : null}
          <div className={styles.passageActions}>
            <button
              type="button"
              aria-busy={busy}
              onClick={() => void synthesize()}
              disabled={!ready || busy}
            >
              Render and Play
            </button>
          </div>
        </section>

        {projection.result?.warnings.length ? (
          <ul className={styles.warnings}>
            {projection.result.warnings.map((item) => (
              <li
                key={`${item.code}:${String(item.line ?? 0)}:${item.message}`}
              >
                {item.message}
              </li>
            ))}
          </ul>
        ) : null}
        {error ? (
          <ErrorNotice title="Synthesis did not complete">
            {error} Your passage and selections are ready to retry.
          </ErrorNotice>
        ) : null}
      </main>
    </div>
  );
}
