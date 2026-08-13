import { useState } from "react";
import { useNavigate } from "react-router";
import { useConnections } from "@/features/connections/ConnectionProvider.js";
import styles from "./OnboardingPage.module.css";

const MODEL_ID = "speaches-ai/Kokoro-82M-v1.0-ONNX";

export function OnboardingPage() {
  const navigate = useNavigate();
  const workspace = useConnections();
  const [name, setName] = useState("Local Speaches");
  const [baseUrl, setBaseUrl] = useState("http://127.0.0.1:8000");
  const [modelId, setModelId] = useState(MODEL_ID);
  const [voiceId, setVoiceId] = useState("af_heart");
  const [apiKey, setApiKey] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const createAndTest = async () => {
    setBusy(true);
    setError("");
    try {
      const created = await workspace.create({
        profile: { name, baseUrl, defaultModelId: modelId, defaultVoiceId: voiceId },
        credential: apiKey && workspace.setup?.client === "electron" ? { action: "replace", apiKey } : { action: "keep" }
      });
      await workspace.setActive(created.id);
      const result = await workspace.test(created.id);
      if (result.overall === "connected") void navigate("/projects", { replace: true });
      else setError(`Connection test finished with ${result.overall}. Review the staged result in Settings.`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Setup could not be completed.");
    } finally {
      setApiKey("");
      setBusy(false);
    }
  };

  const continueOffline = async () => {
    await workspace.completeOnboarding();
    void navigate("/projects", { replace: true });
  };

  return (
    <div className={styles.page}>
      <header><p>G06 · First run</p><h2>Connect the voice workshop</h2><span>Verify Speaches now, or continue authoring offline and return from the connection indicator at any time.</span></header>
      <section className={styles.guide}>
        <div><span>01</span><h3>Choose an endpoint</h3><p>{workspace.setup?.client === "electron" ? "Desktop can connect to loopback, LAN, or HTTPS Speaches endpoints and store a key in the operating-system vault." : "Web endpoint settings are server-side. API keys must come from SPEACHES_API_KEY or another server secret injection."}</p></div>
        <code>{workspace.setup?.client === "electron" ? "http://127.0.0.1:8000 · http://speaches.home.arpa:8000/v1" : "SPEACHES_BASE_URL=https://speech.example.test/v1"}</code>
        <div className={styles.links}><a href="https://speaches.ai/installation/" target="_blank" rel="noreferrer">Official installation guide</a><a href="https://speaches.ai/usage/text-to-speech/" target="_blank" rel="noreferrer">Official TTS guide</a></div>
      </section>
      <form className={styles.form} onSubmit={(event) => { event.preventDefault(); void createAndTest(); }}>
        <div className={styles.heading}><span>02</span><div><h3>Create and test a profile</h3><p>The diagnostic asks for one short WAV and discards it after validation.</p></div></div>
        <label>Profile name<input value={name} onChange={(event) => setName(event.target.value)} required /></label>
        <label>HTTP(S) endpoint<input value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} required /></label>
        <label>Model ID<input value={modelId} onChange={(event) => setModelId(event.target.value)} required /></label>
        <label>Voice ID<input value={voiceId} onChange={(event) => setVoiceId(event.target.value)} required /></label>
        {workspace.setup?.client === "electron" ? <label>API key (one shot)<input type="password" autoComplete="off" value={apiKey} onChange={(event) => setApiKey(event.target.value)} /><small>Cleared from this form after submission.</small></label> : <p className={styles.managed}>API key: {workspace.profiles.some(({ apiKeyConfigured }) => apiKeyConfigured) ? "configured on server" : "not configured on server"}</p>}
        {error ? <p className={styles.error} role="alert">{error}</p> : null}
        <div className={styles.actions}><button type="submit" disabled={busy}>{busy ? "Testing…" : "Create + Test Connection"}</button><button className={styles.offline} type="button" disabled={busy} onClick={() => void continueOffline()}>Continue offline</button></div>
      </form>
      {workspace.profiles.length > 0 ? <section className={styles.existing}><h3>Existing profiles</h3>{workspace.profiles.map((profile) => <article key={profile.id}><div><strong>{profile.name}</strong><code>{profile.id}</code></div><span>{profile.configured ? profile.lastTestSummary?.overall ?? "unverified" : "configuration error"}</span><button type="button" disabled={busy || workspace.testingProfileId === profile.id} onClick={() => void workspace.test(profile.id).then((result) => { if (result.overall === "connected") void navigate("/projects", { replace: true }); })}>Test Connection</button></article>)}</section> : null}
    </div>
  );
}
