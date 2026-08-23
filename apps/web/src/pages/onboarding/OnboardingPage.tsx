import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { queryKeys } from "@/app/queryKeys.js";
import { useConnections } from "@/features/connections/ConnectionProvider.js";
import { VoiceSelect } from "@/features/connections/VoiceSelect.js";
import { presentVoices } from "@/features/connections/voicePresentation.js";
import styles from "./OnboardingPage.module.css";

export function OnboardingPage() {
  const navigate = useNavigate();
  const workspace = useConnections();
  const [baseUrl, setBaseUrl] = useState("");
  const [modelId, setModelId] = useState("");
  const [voiceId, setVoiceId] = useState("");
  const [catalogAddress, setCatalogAddress] = useState("");
  const localCatalogQuery = useQuery({
    queryKey: queryKeys.connection.voiceCatalog(modelId),
    queryFn: () => workspace.getCatalog(modelId),
    enabled: Boolean(modelId),
    retry: false,
  });
  const localCatalog = localCatalogQuery.data ?? null;
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const catalog =
    workspace.catalog.status === "ready" && catalogAddress === baseUrl
      ? workspace.catalog.catalog
      : null;
  const selectedModel = useMemo(
    () => catalog?.models.find((model) => model.modelId === modelId) ?? null,
    [catalog, modelId],
  );
  const voiceOptions = useMemo(
    () =>
      presentVoices(
        selectedModel?.voices ?? [],
        localCatalog?.modelId === modelId ? localCatalog.entries : [],
      ).filter(({ availableOnServer }) => availableOnServer),
    [localCatalog, modelId, selectedModel],
  );

  const addressChanged = (value: string) => {
    setBaseUrl(value);
    setModelId("");
    setVoiceId("");
    setCatalogAddress("");
    setError("");
  };

  const loadCatalog = async () => {
    setBusy(true);
    setError("");
    try {
      const discovered = await workspace.discover({ baseUrl });
      setCatalogAddress(baseUrl);
      const firstModel = discovered.models[0];
      if (!firstModel)
        throw new Error(
          "This Speaches server did not report any speech models.",
        );
      const firstVoice = firstModel.voices[0];
      if (!firstVoice)
        throw new Error(
          `Model ${firstModel.modelId} did not report any voices.`,
        );
      setModelId(firstModel.modelId);
      setVoiceId(firstVoice.voiceId);
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "The server catalog could not be loaded.",
      );
    } finally {
      setBusy(false);
    }
  };

  const modelChanged = (nextModelId: string) => {
    setModelId(nextModelId);
    setVoiceId(
      catalog?.models.find(
        ({ modelId: candidate }) => candidate === nextModelId,
      )?.voices[0]?.voiceId ?? "",
    );
  };

  const saveAndTest = async () => {
    setBusy(true);
    setError("");
    try {
      await workspace.update({
        baseUrl,
        defaultModelId: modelId,
        defaultVoiceId: voiceId,
      });
      const result = await workspace.test();
      if (result.overall !== "connected") {
        setError(
          `Connection test finished with ${result.overall}. Review the staged result and try again.`,
        );
        return;
      }
      void navigate("/projects", { replace: true });
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Setup could not be completed.",
      );
    } finally {
      setBusy(false);
    }
  };

  const continueOffline = async () => {
    await workspace.completeOnboarding();
    void navigate("/projects", { replace: true });
  };

  return (
    <div className={styles.page}>
      <header>
        <p>First run</p>
        <h2>Connect the voice workshop</h2>
        <span>
          Enter your Speaches server, review its first available model and
          voice, then save and test.
        </span>
      </header>
      <section className={styles.guide}>
        <div>
          <span>01</span>
          <h3>Enter the server address</h3>
          <p>
            StudyNarrator supports unauthenticated HTTP(S) Speaches servers on
            loopback, your LAN, or HTTPS.
          </p>
        </div>
        <code>http://127.0.0.1:8000 · http://speaches.home.arpa:8000/v1</code>
        <div className={styles.links}>
          <a
            href="https://speaches.ai/installation/"
            target="_blank"
            rel="noreferrer"
          >
            Official installation guide
          </a>
          <a
            href="https://speaches.ai/usage/text-to-speech/"
            target="_blank"
            rel="noreferrer"
          >
            Official TTS guide
          </a>
        </div>
      </section>
      <form
        className={styles.form}
        onSubmit={(event) => {
          event.preventDefault();
          void (catalog ? saveAndTest() : loadCatalog());
        }}
      >
        <div className={styles.heading}>
          <span>02</span>
          <div>
            <h3>Load and review the catalog</h3>
            <p>The address is not saved until you choose Save and Test.</p>
          </div>
        </div>
        <label>
          Speaches address
          <input
            type="url"
            value={baseUrl}
            onChange={(event) => addressChanged(event.target.value)}
            placeholder="http://127.0.0.1:8000"
            required
          />
        </label>
        {catalog ? (
          <button
            type="button"
            disabled={busy || !baseUrl}
            onClick={() => void loadCatalog()}
          >
            {workspace.catalog.status === "loading"
              ? "Loading catalog…"
              : "Refresh catalog"}
          </button>
        ) : null}
        {catalog ? (
          <>
            <label>
              Model
              <select
                value={modelId}
                onChange={(event) => modelChanged(event.target.value)}
              >
                {catalog.models.map((model) => (
                  <option key={model.modelId} value={model.modelId}>
                    {model.modelId}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Default Voice
              <VoiceSelect
                value={voiceId}
                voices={voiceOptions}
                onChange={setVoiceId}
              />
            </label>
          </>
        ) : null}
        {error || workspace.catalog.status === "failed" ? (
          <p className={styles.error} role="alert">
            {error || workspace.catalog.error}
          </p>
        ) : null}
        <div className={styles.actions}>
          <button
            type="submit"
            disabled={busy || (catalog !== null && (!modelId || !voiceId))}
          >
            {busy ? "Working…" : catalog ? "Save and Test" : "Load catalog"}
          </button>
          <button
            className={styles.offline}
            type="button"
            disabled={busy}
            onClick={() => void continueOffline()}
          >
            Continue offline
          </button>
        </div>
      </form>
    </div>
  );
}
