import { useEffect, useState, type KeyboardEvent } from "react";
import { Link, useParams } from "react-router";
import type { PersistenceClient, ProjectDetail, PromptDocument, ScriptGenerationClient, ScriptPromptKind } from "@studynarrator/shared-types";
import { ScriptSourceEditor } from "@/features/projects/ScriptSourceEditor.js";
import styles from "./ScriptGenerationPage.module.css";

function message(error: unknown): string {
  return error instanceof Error ? error.message : "StudyNarrator could not prepare the script prompts.";
}

const promptLabels: Record<ScriptPromptKind, { eyebrow: string; title: string; description: string }> = {
  creation: {
    eyebrow: "New script",
    title: "Create a script",
    description: "Add your topic, goals, and trusted sources to a complete script-authoring contract."
  },
  update: {
    eyebrow: "Existing script",
    title: "Update a script",
    description: "Paste the current script and requested changes into a compact format-preserving contract."
  }
};
const promptKinds = Object.keys(promptLabels) as ScriptPromptKind[];

export function ScriptGenerationPage({ persistence, generation }: {
  persistence: PersistenceClient;
  generation: ScriptGenerationClient;
}) {
  const { projectId: routeProjectId } = useParams();
  const projectId = routeProjectId ?? null;
  const [project, setProject] = useState<ProjectDetail>();
  const [documents, setDocuments] = useState<Partial<Record<ScriptPromptKind, PromptDocument>>>({});
  const [drafts, setDrafts] = useState<Partial<Record<ScriptPromptKind, string>>>({});
  const [selected, setSelected] = useState<ScriptPromptKind>("creation");
  const [loadingError, setLoadingError] = useState("");
  const [operationError, setOperationError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState<"copy" | "prompt" | null>(null);

  useEffect(() => {
    let active = true;
    setProject(undefined);
    setDocuments({});
    setDrafts({});
    setLoadingError("");
    setOperationError("");
    setNotice("");
    void Promise.all([
      projectId ? persistence.projects.get(projectId) : Promise.resolve(undefined),
      generation.previewPrompt(projectId, "creation"),
      generation.previewPrompt(projectId, "update")
    ]).then(([loadedProject, creation, update]) => {
      if (!active) return;
      setProject(loadedProject);
      setDocuments({ creation, update });
      setDrafts({ creation: creation.content, update: update.content });
    }).catch((error: unknown) => { if (active) setLoadingError(message(error)); });
    return () => { active = false; };
  }, [generation, persistence, projectId]);

  const promptDocument = documents[selected];
  const draft = drafts[selected] ?? "";

  const selectPrompt = (kind: ScriptPromptKind) => {
    setSelected(kind);
    setNotice("");
    setOperationError("");
  };

  const movePromptTab = (event: KeyboardEvent<HTMLButtonElement>, kind: ScriptPromptKind) => {
    const currentIndex = promptKinds.indexOf(kind);
    const targetIndex = event.key === "Home" ? 0
      : event.key === "End" ? promptKinds.length - 1
        : event.key === "ArrowRight" ? (currentIndex + 1) % promptKinds.length
          : event.key === "ArrowLeft" ? (currentIndex - 1 + promptKinds.length) % promptKinds.length
            : undefined;
    if (targetIndex === undefined) return;
    event.preventDefault();
    const target = promptKinds[targetIndex]!;
    selectPrompt(target);
    document.getElementById(`prompt-tab-${target}`)?.focus();
  };

  const copyPrompt = async () => {
    if (!promptDocument || draft.length === 0) return;
    setBusy("copy"); setOperationError("");
    try {
      await navigator.clipboard.writeText(draft);
      setNotice(`${promptLabels[selected].title} prompt copied. Add your material in the marked block before sending it to an LLM.`);
    } catch { setOperationError("Clipboard access was denied. Download the prompt or copy it from the preview."); }
    finally { setBusy(null); }
  };

  const exportPrompt = async () => {
    if (draft.length === 0) return;
    setBusy("prompt"); setOperationError("");
    try {
      const result = await generation.exportPrompt(projectId, selected, draft);
      setNotice(result.disposition === "canceled" ? "Prompt export canceled." : `${result.fileName} ${result.disposition === "saved" ? "saved" : "downloaded"}.`);
    } catch (error) { setOperationError(message(error)); }
    finally { setBusy(null); }
  };

  if (loadingError) return <section className={styles.loadingState} role="alert"><h2>Prompt kit unavailable</h2><p>{loadingError}</p><Link to="/projects">Return to Projects</Link></section>;
  if (!documents.creation || !documents.update || drafts.creation === undefined || drafts.update === undefined || !promptDocument || (projectId && !project)) return <section className={styles.loadingState} aria-live="polite"><h2>Preparing prompt kit</h2><p>Reading the script format and pronunciation lexicon…</p></section>;

  return <div className={styles.page}>
    <header className={styles.header}>
      <div><p className={styles.kicker}>External-LLM handoff</p><h2>Script prompt kit</h2><p>Copy a starting contract, add your subject matter or edit request, then use it with the LLM of your choice.</p></div>
      {project ? <Link className={styles.backLink} to={`/projects/${project.id}`}>Back to {project.name}</Link> : null}
    </header>

    <div className={styles.workspace}>
      <div className={styles.templateTabs} role="tablist" aria-label="Choose a prompt template">
        {promptKinds.map((kind) => <button
          key={kind}
          type="button"
          role="tab"
          id={`prompt-tab-${kind}`}
          aria-controls="prompt-panel"
          aria-selected={selected === kind}
          tabIndex={selected === kind ? 0 : -1}
          onClick={() => selectPrompt(kind)}
          onKeyDown={(event) => movePromptTab(event, kind)}
        ><span>{promptLabels[kind].eyebrow}</span><strong>{promptLabels[kind].title}</strong><small>{promptLabels[kind].description}</small></button>)}
      </div>
      <main className={styles.previewPanel} role="tabpanel" id="prompt-panel" aria-labelledby={`prompt-tab-${selected}`}>
        <div className={styles.previewHeading}><span>{promptLabels[selected].eyebrow}</span><h3>{promptLabels[selected].title}</h3></div>
        <p className={styles.instructions}>{selected === "creation"
          ? "Replace the KNOWLEDGE TO GATHER AND TEACH block with your topic, learning goals, sources, and constraints."
          : "Replace the SCRIPT AND CHANGE REQUEST block with the current script and the exact edits you want."}</p>
        <div className={styles.actions}>
          <button type="button" disabled={busy !== null || draft.length === 0} onClick={() => void copyPrompt()}>{busy === "copy" ? "Copying…" : `Copy ${selected} prompt`}</button>
          <button type="button" className={styles.secondary} disabled={busy !== null || draft.length === 0} onClick={() => void exportPrompt()}>{window.studyNarrator ? `Save ${selected} prompt` : `Download ${selected} prompt`}</button>
        </div>
        {operationError ? <p className={styles.error} role="alert">{operationError}</p> : null}
        <p className={styles.notice} aria-live="polite">{notice}</p>
        <ScriptSourceEditor
          key={selected}
          value={draft}
          ariaLabel={`${promptLabels[selected].title} prompt editor`}
          onChange={(content) => setDrafts((current) => ({ ...current, [selected]: content }))}
        />
        <div className={styles.editorMeta}><span>{draft.length.toLocaleString()} characters</span><span>{draft.split("\n").length.toLocaleString()} lines</span></div>
      </main>
    </div>
  </div>;
}
