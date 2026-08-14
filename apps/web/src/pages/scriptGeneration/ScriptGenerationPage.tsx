import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router";
import {
  SCRIPT_GENERATION_SCHEMA_VERSION,
  ScriptGenerationBriefSchema,
  ScriptGenerationConfigurationSchema,
  type PromptDocument,
  type ScriptGenerationClient,
  type ScriptGenerationPause,
  type ScriptGenerationSpeaker
} from "@studynarrator/shared-types";
import type { PersistenceClient, ProjectDetail } from "@studynarrator/shared-types";
import styles from "./ScriptGenerationPage.module.css";

type DetailLevel = "concise" | "balanced" | "comprehensive";
type SectionMode = "required" | "optional" | "omit";
type CodeHandling = "explain" | "spell" | "omit";

function message(error: unknown): string {
  return error instanceof Error ? error.message : "StudyNarrator could not complete the script generation operation.";
}

function speakerSeed(project: ProjectDetail): ScriptGenerationSpeaker[] {
  if (project.speakerMappings.length === 0) return [{ speakerId: "narrator", roleDescription: "Explains the material clearly and accurately." }];
  return project.speakerMappings.map((speaker) => ({
    speakerId: speaker.speakerId,
    roleDescription: speaker.roleDescription.trim() || `${speaker.displayName} explains the material clearly and accurately.`
  }));
}

function pauseSeed(project: ProjectDetail): ScriptGenerationPause[] {
  return project.pausePresets.map((pause) => ({
    pauseId: pause.pauseId,
    description: pause.description.trim() || `${String(pause.durationMs)} millisecond pause.`
  }));
}

export function ScriptGenerationPage({ persistence, generation }: {
  persistence: PersistenceClient;
  generation: ScriptGenerationClient;
}) {
  const { projectId } = useParams();
  const [project, setProject] = useState<ProjectDetail>();
  const [loadingError, setLoadingError] = useState("");
  const [purpose, setPurpose] = useState("");
  const [targetAudience, setTargetAudience] = useState("Learners studying this material.");
  const [detailLevel, setDetailLevel] = useState<DetailLevel>("balanced");
  const [sectionMode, setSectionMode] = useState<SectionMode>("required");
  const [codeHandling, setCodeHandling] = useState<CodeHandling>("explain");
  const [additionalGuidance, setAdditionalGuidance] = useState("");
  const [sourceMaterial, setSourceMaterial] = useState("");
  const [speakers, setSpeakers] = useState<ScriptGenerationSpeaker[]>([]);
  const [pauses, setPauses] = useState<ScriptGenerationPause[]>([]);
  const [document, setDocument] = useState<PromptDocument>();
  const [busy, setBusy] = useState<"preview" | "prompt" | "skill" | null>(null);
  const [notice, setNotice] = useState("");
  const [operationError, setOperationError] = useState("");

  useEffect(() => {
    if (!projectId) { setLoadingError("Choose a project before opening script generation."); return; }
    let active = true;
    void persistence.projects.get(projectId).then((loaded) => {
      if (!active) return;
      setProject(loaded);
      setPurpose(loaded.description.trim() || `Create an accurate spoken study guide for ${loaded.name}.`);
      setSourceMaterial(loaded.scriptSource);
      setSpeakers(speakerSeed(loaded));
      setPauses(pauseSeed(loaded));
    }).catch((error: unknown) => { if (active) setLoadingError(message(error)); });
    return () => { active = false; };
  }, [persistence, projectId]);

  const configurationInput = useMemo(() => ({
    schemaVersion: SCRIPT_GENERATION_SCHEMA_VERSION,
    purpose, targetAudience, detailLevel, sectionMode, codeHandling, additionalGuidance, speakers, pauses
  }), [additionalGuidance, codeHandling, detailLevel, pauses, purpose, sectionMode, speakers, targetAudience]);
  const configuration = ScriptGenerationConfigurationSchema.safeParse(configurationInput);
  const brief = ScriptGenerationBriefSchema.safeParse({ ...configurationInput, sourceMaterial });
  const validationMessages = brief.success ? [] : [...new Set(brief.error.issues.map((issue) => issue.message))];

  const updateSpeaker = (index: number, patch: Partial<ScriptGenerationSpeaker>) => {
    setSpeakers((current) => current.map((speaker, speakerIndex) => speakerIndex === index ? { ...speaker, ...patch } : speaker));
    setDocument(undefined);
  };
  const updatePause = (index: number, patch: Partial<ScriptGenerationPause>) => {
    setPauses((current) => current.map((pause, pauseIndex) => pauseIndex === index ? { ...pause, ...patch } : pause));
    setDocument(undefined);
  };

  const preview = async () => {
    if (!projectId || !brief.success) return;
    setBusy("preview"); setOperationError(""); setNotice("");
    try { setDocument(await generation.previewPrompt(projectId, brief.data)); setNotice("Prompt assembled locally. Review the exact contract before copying it."); }
    catch (error) { setOperationError(message(error)); }
    finally { setBusy(null); }
  };
  const exportPrompt = async () => {
    if (!projectId || !brief.success) return;
    setBusy("prompt"); setOperationError("");
    try {
      const result = await generation.exportPrompt(projectId, brief.data);
      setNotice(result.disposition === "canceled" ? "Prompt export canceled." : `${result.fileName} ${result.disposition === "saved" ? "saved" : "downloaded"}.`);
    } catch (error) { setOperationError(message(error)); }
    finally { setBusy(null); }
  };
  const exportSkill = async () => {
    if (!projectId || !configuration.success) return;
    setBusy("skill"); setOperationError("");
    try {
      const result = await generation.exportSkillPackage(projectId, configuration.data);
      setNotice(result.disposition === "canceled" ? "Skill-package export canceled." : `${result.fileName} ${result.disposition === "saved" ? "saved" : "downloaded"}. Source material was not included.`);
    } catch (error) { setOperationError(message(error)); }
    finally { setBusy(null); }
  };
  const copyPrompt = async () => {
    if (!document) return;
    setOperationError("");
    try {
      await navigator.clipboard.writeText(document.content);
      setNotice("Prompt copied. Paste it into the external LLM of your choice.");
    } catch { setOperationError("Clipboard access was denied. Download the prompt or copy it from the preview."); }
  };

  if (loadingError) return <section className={styles.loadingState} role="alert"><h2>Script generation unavailable</h2><p>{loadingError}</p><Link to="/projects">Return to Projects</Link></section>;
  if (!project) return <section className={styles.loadingState} aria-live="polite"><h2>Opening instruction workbench</h2><p>Loading the project contract…</p></section>;

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div><p className={styles.kicker}>External-LLM handoff</p><h2>Instruction workbench</h2><p>Turn local source material into a precise, portable script contract. StudyNarrator generates instructions; it never sends them to an LLM.</p></div>
        <Link className={styles.backLink} to={`/projects/${project.id}`}>Back to {project.name}</Link>
      </header>

      <ol className={styles.sequence} aria-label="Script generation sequence">
        <li><b>01</b><span>Shape the brief</span></li><li><b>02</b><span>Lock the contract</span></li><li><b>03</b><span>Export by choice</span></li>
      </ol>

      <section className={styles.briefPanel} aria-labelledby="brief-heading">
        <div className={styles.sectionHeading}><div><span>Session-only</span><h3 id="brief-heading">Generation brief</h3></div><b>{sourceMaterial.length.toLocaleString()} chars</b></div>
        <p className={styles.helper}>These fields reset when this page closes. Nothing here changes the saved project.</p>
        <label>Purpose<textarea value={purpose} onChange={(event) => { setPurpose(event.target.value); setDocument(undefined); }} /></label>
        <label>Target audience<input value={targetAudience} onChange={(event) => { setTargetAudience(event.target.value); setDocument(undefined); }} /></label>
        <div className={styles.choiceGrid}>
          <label>Detail level<select value={detailLevel} onChange={(event) => { setDetailLevel(event.target.value as DetailLevel); setDocument(undefined); }}><option value="concise">Concise</option><option value="balanced">Balanced</option><option value="comprehensive">Comprehensive</option></select></label>
          <label>Sections<select value={sectionMode} onChange={(event) => { setSectionMode(event.target.value as SectionMode); setDocument(undefined); }}><option value="required">Required</option><option value="optional">When useful</option><option value="omit">Omit</option></select></label>
          <label>Code handling<select value={codeHandling} onChange={(event) => { setCodeHandling(event.target.value as CodeHandling); setDocument(undefined); }}><option value="explain">Explain in prose</option><option value="spell">Read precisely</option><option value="omit">Omit code</option></select></label>
        </div>
        <label>Additional guidance<textarea value={additionalGuidance} placeholder="Optional constraints for tone, structure, or emphasis." onChange={(event) => { setAdditionalGuidance(event.target.value); setDocument(undefined); }} /></label>
        <label>Source material<textarea className={styles.source} value={sourceMaterial} onChange={(event) => { setSourceMaterial(event.target.value); setDocument(undefined); }} /></label>
      </section>

      <section className={styles.contractPanel} aria-labelledby="contract-heading">
        <div className={styles.sectionHeading}><div><span>Exact vocabulary</span><h3 id="contract-heading">Output contract</h3></div><b>{speakers.length + pauses.length} cues</b></div>
        <div className={styles.contractGroup}>
          <div className={styles.groupHeading}><h4>Speakers</h4><button type="button" className={styles.smallButton} onClick={() => setSpeakers((current) => [...current, { speakerId: `speaker${String(current.length + 1)}`, roleDescription: "Describes a distinct role in the conversation." }])}>Add speaker</button></div>
          {speakers.map((speaker, index) => <article key={String(index)}>
            <label>Speaker {index + 1} ID<input aria-label={`Speaker ${String(index + 1)} ID`} value={speaker.speakerId} onChange={(event) => updateSpeaker(index, { speakerId: event.target.value })} /></label>
            <label>Role description<textarea aria-label={`Speaker ${String(index + 1)} role`} value={speaker.roleDescription} onChange={(event) => updateSpeaker(index, { roleDescription: event.target.value })} /></label>
            <button type="button" className={styles.removeButton} disabled={speakers.length === 1} onClick={() => { setSpeakers((current) => current.filter((_value, itemIndex) => itemIndex !== index)); setDocument(undefined); }}>Remove</button>
          </article>)}
        </div>
        <div className={styles.contractGroup}>
          <div className={styles.groupHeading}><h4>Pauses</h4><button type="button" className={styles.smallButton} onClick={() => setPauses((current) => [...current, { pauseId: `pause_${String(current.length + 1)}`, description: "A deliberate spoken transition." }])}>Add pause</button></div>
          {pauses.length === 0 ? <p className={styles.empty}>No pause directives will be allowed.</p> : pauses.map((pause, index) => <article key={String(index)}>
            <label>Pause {index + 1} ID<input aria-label={`Pause ${String(index + 1)} ID`} value={pause.pauseId} onChange={(event) => updatePause(index, { pauseId: event.target.value })} /></label>
            <label>Description<textarea aria-label={`Pause ${String(index + 1)} description`} value={pause.description} onChange={(event) => updatePause(index, { description: event.target.value })} /></label>
            <button type="button" className={styles.removeButton} onClick={() => { setPauses((current) => current.filter((_value, itemIndex) => itemIndex !== index)); setDocument(undefined); }}>Remove</button>
          </article>)}
        </div>
        {validationMessages.length > 0 ? <div className={styles.validation} role="alert"><strong>Finish the contract</strong><ul>{validationMessages.map((item) => <li key={item}>{item}</li>)}</ul></div> : null}
      </section>

      <section className={styles.exportPanel} aria-labelledby="export-heading">
        <div className={styles.sectionHeading}><div><span>Local assembly</span><h3 id="export-heading">Prompt tape</h3></div>{document ? <code>{document.checksum.slice(0, 12)}</code> : null}</div>
        <div className={styles.actions}>
          <button type="button" disabled={!brief.success || busy !== null} onClick={() => void preview()}>{busy === "preview" ? "Assembling…" : "Assemble prompt"}</button>
          <button type="button" className={styles.secondary} disabled={!document || busy !== null} onClick={() => void copyPrompt()}>Copy prompt</button>
          <button type="button" className={styles.secondary} disabled={!brief.success || busy !== null} onClick={() => void exportPrompt()}>{window.studyNarrator ? "Save prompt" : "Download prompt"}</button>
          <button type="button" className={styles.skillButton} disabled={!configuration.success || busy !== null} onClick={() => void exportSkill()}>{window.studyNarrator ? "Save skill package" : "Download skill package"}</button>
        </div>
        {operationError ? <p className={styles.error} role="alert">{operationError}</p> : null}
        <p className={styles.notice} aria-live="polite">{notice}</p>
        {document ? <div className={styles.tape}><div aria-hidden="true">PROMPT / UTF-8 / {document.content.split("\n").length} LINES</div><pre tabIndex={0} aria-label="Generated prompt preview">{document.content}</pre></div> : <div className={styles.emptyTape}><strong>No prompt assembled yet</strong><p>Complete the brief, then assemble a deterministic preview before copying it.</p></div>}
        <aside className={styles.privacy}><strong>Skill package boundary</strong><p>The ZIP contains the grammar, current IDs, pronunciation guidance, and valid examples. It never contains the source material pasted above.</p></aside>
      </section>
    </div>
  );
}
