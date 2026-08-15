import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router";
import type { PersistenceClient, ProjectDetail, PromptDocument, ScriptGenerationClient, ScriptPromptKind } from "@studynarrator/shared-types";
import styles from "./ScriptGenerationPage.module.css";

function message(error: unknown): string {
  return error instanceof Error ? error.message : "StudyNarrator could not prepare the script prompts.";
}

const promptLabels: Record<ScriptPromptKind, { eyebrow: string; title: string; description: string }> = {
  creation: {
    eyebrow: "Blank page",
    title: "Create a script",
    description: "Add your topic, goals, and trusted sources to a complete script-authoring contract."
  },
  update: {
    eyebrow: "Red pen",
    title: "Update a script",
    description: "Paste the current script and requested changes into a compact format-preserving contract."
  }
};

export function ScriptGenerationPage({ persistence, generation }: {
  persistence: PersistenceClient;
  generation: ScriptGenerationClient;
}) {
  const { projectId: routeProjectId } = useParams();
  const projectId = routeProjectId ?? null;
  const [project, setProject] = useState<ProjectDetail>();
  const [globalLexiconCount, setGlobalLexiconCount] = useState(0);
  const [documents, setDocuments] = useState<Partial<Record<ScriptPromptKind, PromptDocument>>>({});
  const [selected, setSelected] = useState<ScriptPromptKind>("creation");
  const [loadingError, setLoadingError] = useState("");
  const [operationError, setOperationError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState<"copy" | "prompt" | "skill" | null>(null);

  useEffect(() => {
    let active = true;
    setProject(undefined);
    setDocuments({});
    setLoadingError("");
    setOperationError("");
    setNotice("");
    void Promise.all([
      projectId ? persistence.projects.get(projectId) : Promise.resolve(undefined),
      persistence.globalLexicon.list(),
      generation.previewPrompt(projectId, "creation"),
      generation.previewPrompt(projectId, "update")
    ]).then(([loadedProject, globalLexicon, creation, update]) => {
      if (!active) return;
      setProject(loadedProject);
      setGlobalLexiconCount(globalLexicon.filter(({ enabled }) => enabled).length);
      setDocuments({ creation, update });
    }).catch((error: unknown) => { if (active) setLoadingError(message(error)); });
    return () => { active = false; };
  }, [generation, persistence, projectId]);

  const document = documents[selected];
  const enabledProjectLexicon = useMemo(() => project?.lexiconEntries.filter(({ enabled }) => enabled).length ?? 0, [project]);

  const copyPrompt = async () => {
    if (!document) return;
    setBusy("copy"); setOperationError("");
    try {
      await navigator.clipboard.writeText(document.content);
      setNotice(`${promptLabels[selected].title} prompt copied. Add your material in the marked block before sending it to an LLM.`);
    } catch { setOperationError("Clipboard access was denied. Download the prompt or copy it from the preview."); }
    finally { setBusy(null); }
  };

  const exportPrompt = async () => {
    setBusy("prompt"); setOperationError("");
    try {
      const result = await generation.exportPrompt(projectId, selected);
      setNotice(result.disposition === "canceled" ? "Prompt export canceled." : `${result.fileName} ${result.disposition === "saved" ? "saved" : "downloaded"}.`);
    } catch (error) { setOperationError(message(error)); }
    finally { setBusy(null); }
  };

  const exportSkill = async () => {
    setBusy("skill"); setOperationError("");
    try {
      const result = await generation.exportSkillPackage(projectId);
      setNotice(result.disposition === "canceled" ? "Prompt-kit export canceled." : `${result.fileName} ${result.disposition === "saved" ? "saved" : "downloaded"}. It contains both templates and no saved script.`);
    } catch (error) { setOperationError(message(error)); }
    finally { setBusy(null); }
  };

  if (loadingError) return <section className={styles.loadingState} role="alert"><h2>Prompt kit unavailable</h2><p>{loadingError}</p><Link to="/projects">Return to Projects</Link></section>;
  if (!documents.creation || !documents.update || !document || (projectId && !project)) return <section className={styles.loadingState} aria-live="polite"><h2>Preparing prompt kit</h2><p>Reading the script format and pronunciation lexicon…</p></section>;

  return <div className={styles.page}>
    <header className={styles.header}>
      <div><p className={styles.kicker}>External-LLM handoff</p><h2>Script prompt kit</h2><p>Copy a starting contract, add your subject matter or edit request, then use it with the LLM of your choice.</p></div>
      <Link className={styles.backLink} to={project ? `/projects/${project.id}` : "/projects"}>{project ? `Back to ${project.name}` : "View Projects"}</Link>
    </header>

    <aside className={styles.selector} aria-label="Choose a prompt template">
      <div className={styles.selectorHeading}><span>Choose one</span><h3>Where are you starting?</h3></div>
      {(Object.keys(promptLabels) as ScriptPromptKind[]).map((kind) => <button
        key={kind}
        type="button"
        className={selected === kind ? styles.selectedTemplate : styles.template}
        aria-pressed={selected === kind}
        onClick={() => { setSelected(kind); setNotice(""); setOperationError(""); }}
      ><span>{promptLabels[kind].eyebrow}</span><strong>{promptLabels[kind].title}</strong><small>{promptLabels[kind].description}</small></button>)}

      <section className={styles.context} aria-labelledby="included-heading">
        <h3 id="included-heading">Included automatically</h3>
        <dl>
          <div><dt>Speakers</dt><dd>{project?.speakerMappings.length || 1}</dd></div>
          <div><dt>Pauses</dt><dd>3 global presets</dd></div>
          <div><dt>Lexicon</dt><dd>{enabledProjectLexicon + globalLexiconCount}</dd></div>
        </dl>
        <p>{project ? "This kit uses the project’s format plus enabled project and global lexicon entries." : "This kit uses StudyNarrator’s default narrator and pause commands plus enabled global lexicon entries."} You do not need to configure them again here.</p>
      </section>

      <button type="button" className={styles.packageButton} disabled={busy !== null} onClick={() => void exportSkill()}>{window.studyNarrator ? "Save both prompts as a kit" : "Download both prompts as a kit"}</button>
    </aside>

    <main className={styles.previewPanel}>
      <div className={styles.previewHeading}>
        <div><span>{promptLabels[selected].eyebrow}</span><h3>{promptLabels[selected].title}</h3></div>
        <code>{document.checksum.slice(0, 12)}</code>
      </div>
      <p className={styles.instructions}>{selected === "creation"
        ? "Replace the KNOWLEDGE TO GATHER AND TEACH block with your topic, learning goals, sources, and constraints."
        : "Replace the SCRIPT AND CHANGE REQUEST block with the current script and the exact edits you want."}</p>
      <div className={styles.actions}>
        <button type="button" disabled={busy !== null} onClick={() => void copyPrompt()}>{busy === "copy" ? "Copying…" : `Copy ${selected} prompt`}</button>
        <button type="button" className={styles.secondary} disabled={busy !== null} onClick={() => void exportPrompt()}>{window.studyNarrator ? `Save ${selected} prompt` : `Download ${selected} prompt`}</button>
      </div>
      {operationError ? <p className={styles.error} role="alert">{operationError}</p> : null}
      <p className={styles.notice} aria-live="polite">{notice}</p>
      <div className={styles.tape}>
        <div aria-hidden="true">{selected.toUpperCase()} / MARKDOWN / {document.content.split("\n").length} LINES</div>
        <pre tabIndex={0} aria-label={`${promptLabels[selected].title} prompt preview`}>{document.content}</pre>
      </div>
    </main>
  </div>;
}
