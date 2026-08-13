import { useCallback, useEffect, useState } from "react";
import {
  GlobalLexiconReplaceInputSchema,
  IgnoredDiagnosticCollectionSchema,
  PausePresetCollectionSchema,
  ProjectLexiconAuthoringCollectionSchema,
  ProjectReplaceInputSchema,
  SpeakerMappingCollectionSchema,
  type PersistenceClient,
  type PersistenceStatus,
  type ProjectDetail,
  type ProjectSummary,
  type SystemPacingDefaults
} from "@studynarrator/shared-types";
import { ParagraphPauseConfigurationSchema } from "@studynarrator/core";
import { ContentPanel } from "@/shared/ui/ContentPanel.js";
import styles from "./PersistenceLabPage.module.css";

interface SafeSchema<T> {
  safeParse(value: unknown):
    | { success: true; data: T }
    | { success: false; error: { issues: readonly { path: readonly PropertyKey[]; message: string }[] } };
}

function json(value: unknown) {
  return JSON.stringify(value, null, 2);
}

function authoringLexicon(entries: ProjectDetail["lexiconEntries"]) {
  return entries.map((entry) => ({
    id: entry.id,
    scope: entry.scope,
    entryType: entry.entryType,
    displayText: entry.displayText,
    ...(entry.senseId === undefined ? {} : { senseId: entry.senseId }),
    spokenText: entry.spokenText,
    caseSensitive: entry.caseSensitive,
    wholeWord: entry.wholeWord,
    priority: entry.priority,
    enabled: entry.enabled,
    notes: entry.notes
  }));
}

function issuePath(path: readonly PropertyKey[]) {
  return path.reduce<string>((result, part) => typeof part === "number" ? `${result}[${String(part)}]` : `${result}.${String(part)}`, "$");
}

function parseJson<T>(label: string, draft: string, schema: SafeSchema<T>): { data?: T; errors: string[] } {
  let raw: unknown;
  try {
    raw = JSON.parse(draft) as unknown;
  } catch {
    return { errors: [`${label} $: Invalid JSON syntax.`] };
  }
  const parsed = schema.safeParse(raw);
  if (parsed.success) return { data: parsed.data, errors: [] };
  return { errors: parsed.error.issues.map((issue) => `${label} ${issuePath(issue.path)}: ${issue.message}`) };
}

function messageFor(error: unknown) {
  return error instanceof Error ? error.message : "The persistence operation failed.";
}

interface ProjectDrafts {
  name: string;
  description: string;
  source: string;
  connectionProfileId: string;
  speakers: string;
  pauses: string;
  paragraph: string;
  lexicon: string;
}

function draftsFor(project: ProjectDetail): ProjectDrafts {
  return {
    name: project.name,
    description: project.description,
    source: project.scriptSource,
    connectionProfileId: project.connectionProfileId ?? "",
    speakers: json(project.speakerMappings),
    pauses: json(project.pausePresets),
    paragraph: json(project.paragraphPause),
    lexicon: json(authoringLexicon(project.lexiconEntries))
  };
}

const EMPTY_DRAFTS: ProjectDrafts = {
  name: "", description: "", source: "", connectionProfileId: "", speakers: "[]", pauses: "[]",
  paragraph: json({ enabled: true, pauseId: "pause_medium", durationMs: 750 }), lexicon: "[]"
};

export function PersistenceLabPage({ client }: { client: PersistenceClient }) {
  const [status, setStatus] = useState<PersistenceStatus>();
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [project, setProject] = useState<ProjectDetail>();
  const [drafts, setDrafts] = useState<ProjectDrafts>(EMPTY_DRAFTS);
  const [pacing, setPacing] = useState<SystemPacingDefaults>({ enabled: true, durationMs: 750 });
  const [globalDraft, setGlobalDraft] = useState("[]");
  const [ignoredDraft, setIgnoredDraft] = useState("[]");
  const [createName, setCreateName] = useState("");
  const [createDescription, setCreateDescription] = useState("");
  const [errors, setErrors] = useState<string[]>([]);
  const [notice, setNotice] = useState("Loading persistence state…");
  const [busy, setBusy] = useState(true);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const loadProject = useCallback(async (projectId: string) => {
    const loaded = await client.projects.get(projectId);
    setProject(loaded);
    setDrafts(draftsFor(loaded));
    setConfirmDelete(false);
    return loaded;
  }, [client]);

  const reloadDatabase = useCallback(async () => {
    setBusy(true);
    setErrors([]);
    try {
      const nextStatus = await client.status();
      setStatus(nextStatus);
      if (nextStatus.state === "unavailable") {
        setNotice("Persistence is in diagnostics-only mode.");
        return;
      }
      const [nextProjects, nextPacing, nextGlobal, nextIgnored] = await Promise.all([
        client.projects.list(), client.settings.getPacing(), client.globalLexicon.list(),
        client.preferences.getIgnoredDiagnostics()
      ]);
      setProjects(nextProjects);
      setPacing(nextPacing);
      setGlobalDraft(json(authoringLexicon(nextGlobal)));
      setIgnoredDraft(json(nextIgnored));
      if (project && nextProjects.some((item) => item.id === project.id)) await loadProject(project.id);
      else if (project) { setProject(undefined); setDrafts(EMPTY_DRAFTS); }
      setNotice("Reloaded durable state from SQLite.");
    } catch (error) {
      setErrors([messageFor(error)]);
      setNotice("Database reload failed.");
    } finally {
      setBusy(false);
    }
  }, [client, loadProject, project]);

  useEffect(() => { void reloadDatabase(); }, []); // reload is intentionally explicit after first mount

  const run = async (operation: () => Promise<void>, success: string) => {
    setBusy(true);
    setErrors([]);
    try {
      await operation();
      setNotice(success);
    } catch (error) {
      setErrors([messageFor(error)]);
      setNotice("Nothing was saved.");
    } finally {
      setBusy(false);
    }
  };

  const createProject = () => run(async () => {
    const created = await client.projects.create({ name: createName, description: createDescription });
    setProjects(await client.projects.list());
    setProject(created);
    setDrafts(draftsFor(created));
    setCreateName("");
    setCreateDescription("");
  }, "Project created with an independent copy of the current pacing defaults.");

  const saveProject = async () => {
    if (!project) return;
    const speakers = parseJson("Speaker mappings", drafts.speakers, SpeakerMappingCollectionSchema);
    const pauses = parseJson("Pause presets", drafts.pauses, PausePresetCollectionSchema);
    const paragraph = parseJson("Paragraph pacing", drafts.paragraph, ParagraphPauseConfigurationSchema);
    const lexicon = parseJson("Project lexicon", drafts.lexicon, ProjectLexiconAuthoringCollectionSchema);
    const jsonErrors = [...speakers.errors, ...pauses.errors, ...paragraph.errors, ...lexicon.errors];
    if (jsonErrors.length > 0) { setErrors(jsonErrors); setNotice("Nothing was saved."); return; }
    const aggregate = ProjectReplaceInputSchema.safeParse({
      name: drafts.name,
      description: drafts.description,
      scriptSource: drafts.source,
      connectionProfileId: drafts.connectionProfileId || null,
      speakerMappings: speakers.data,
      pausePresets: pauses.data,
      paragraphPause: paragraph.data,
      lexiconEntries: lexicon.data
    });
    if (!aggregate.success) {
      setErrors(aggregate.error.issues.map((issue) => `Project ${issuePath(issue.path)}: ${issue.message}`));
      setNotice("Nothing was saved.");
      return;
    }
    await run(async () => {
      const saved = await client.projects.replace(project.id, aggregate.data);
      setProject(saved);
      setDrafts(draftsFor(saved));
      setProjects(await client.projects.list());
    }, "Project aggregate saved atomically.");
  };

  const deleteProject = () => {
    if (!project) return Promise.resolve();
    return run(async () => {
      await client.projects.delete(project.id);
      setProjects(await client.projects.list());
      setProject(undefined);
      setDrafts(EMPTY_DRAFTS);
      setConfirmDelete(false);
    }, "Project and its owned records were deleted.");
  };

  const savePacing = () => run(async () => {
    setPacing(await client.settings.updatePacing(pacing));
  }, "System pacing defaults saved. Existing projects were not changed.");

  const saveGlobal = async () => {
    const parsed = parseJson("Global lexicon", globalDraft, GlobalLexiconReplaceInputSchema);
    if (!parsed.data) { setErrors(parsed.errors); setNotice("Nothing was saved."); return; }
    await run(async () => {
      const saved = await client.globalLexicon.replace(parsed.data!);
      setGlobalDraft(json(authoringLexicon(saved)));
    }, "Global lexicon replaced atomically.");
  };

  const saveIgnored = async () => {
    const parsed = parseJson("Ignored diagnostics", ignoredDraft, IgnoredDiagnosticCollectionSchema);
    if (!parsed.data) { setErrors(parsed.errors); setNotice("Nothing was saved."); return; }
    await run(async () => { setIgnoredDraft(json(await client.preferences.replaceIgnoredDiagnostics(parsed.data!))); }, "Ignored diagnostic patterns replaced atomically.");
  };

  const unavailable = status?.state === "unavailable";

  return (
    <ContentPanel
      action={<button type="button" onClick={() => void reloadDatabase()} disabled={busy}>Reload from database</button>}
      kicker="G04 · Durable boundary"
      title="Persistence Lab"
      titleId="persistence-lab-title"
    >
      <section className={styles.ledger} aria-label="Migration ledger">
        <div><span>Schema</span><strong>{status?.databaseSchemaVersion ?? "—"} / {status?.targetDatabaseSchemaVersion ?? 2}</strong></div>
        <div><span>Migration state</span><strong data-state={status?.state}>{status?.state ?? "loading"}</strong></div>
        <div className={styles.pathCell}><span>Database</span><code>{status?.databasePath ?? "Resolving…"}</code></div>
        <div className={styles.pathCell}><span>Latest backup</span><code>{status?.latestBackupPath ?? "No migration backup"}</code></div>
      </section>

      <p className={styles.notice} aria-live="polite">{notice}</p>
      {errors.length > 0 ? <div className={styles.alert} role="alert"><strong>Review these errors</strong><ul>{errors.map((error) => <li key={error}>{error}</li>)}</ul></div> : null}
      {unavailable ? <div className={styles.alert} role="alert"><strong>Diagnostics-only mode</strong><p>{status.message}</p></div> : null}

      <div className={styles.workspace} aria-disabled={unavailable}>
        <aside className={styles.projectRail}>
          <h3><span>01</span> Projects</h3>
          <label>New project name<input value={createName} onChange={(event) => setCreateName(event.target.value)} /></label>
          <label>Description<input value={createDescription} onChange={(event) => setCreateDescription(event.target.value)} /></label>
          <button type="button" onClick={() => void createProject()} disabled={busy || unavailable || createName.trim().length === 0}>Create project</button>
          <div className={styles.projectList} aria-label="Persisted projects">
            {projects.length === 0 ? <p>No projects in this database.</p> : projects.map((item) => (
              <button className={item.id === project?.id ? styles.selectedProject : ""} type="button" key={item.id} onClick={() => void run(async () => { await loadProject(item.id); }, `Loaded ${item.name} from SQLite.`)}>
                <strong>{item.name}</strong><small>{item.scriptHash.slice(0, 10)} · {new Date(item.updatedAt).toLocaleString()}</small>
              </button>
            ))}
          </div>
        </aside>

        <div className={styles.editorColumn}>
          <section className={styles.section}>
            <h3><span>02</span> Project aggregate</h3>
            {!project ? <p className={styles.empty}>Create or load a project to inspect its complete durable aggregate.</p> : <>
              <div className={styles.twoColumns}>
                <label>Project name<input value={drafts.name} onChange={(event) => setDrafts({ ...drafts, name: event.target.value })} /></label>
                <label>Managed connection reference<input value={drafts.connectionProfileId || "None"} disabled /></label>
              </div>
              <label>Description<textarea rows={2} value={drafts.description} onChange={(event) => setDrafts({ ...drafts, description: event.target.value })} /></label>
              <label>Exact script source<textarea className={styles.source} rows={10} value={drafts.source} onChange={(event) => setDrafts({ ...drafts, source: event.target.value })} /></label>
              <div className={styles.hashLine}><span>SHA-256</span><code>{project.scriptHash}</code></div>
              <div className={styles.jsonGrid}>
                <JsonDraft label="Speaker mappings JSON" value={drafts.speakers} onChange={(speakers) => setDrafts({ ...drafts, speakers })} />
                <JsonDraft label="Pause presets JSON" value={drafts.pauses} onChange={(pauses) => setDrafts({ ...drafts, pauses })} />
                <JsonDraft label="Paragraph pacing JSON" value={drafts.paragraph} onChange={(paragraph) => setDrafts({ ...drafts, paragraph })} />
                <JsonDraft label="Project lexicon JSON" value={drafts.lexicon} onChange={(lexicon) => setDrafts({ ...drafts, lexicon })} />
              </div>
              <div className={styles.actions}><button type="button" disabled={busy || unavailable} onClick={() => void saveProject()}>Save project</button><button type="button" className={styles.secondary} disabled={busy} onClick={() => void loadProject(project.id)}>Discard draft</button></div>
              <div className={styles.dangerZone}>{confirmDelete ? <><p>Delete <strong>{project.name}</strong> and all of its owned records?</p><button type="button" className={styles.danger} onClick={() => void deleteProject()}>Confirm delete</button><button type="button" className={styles.secondary} onClick={() => setConfirmDelete(false)}>Cancel</button></> : <button type="button" className={styles.danger} onClick={() => setConfirmDelete(true)}>Delete project…</button>}</div>
            </>}
          </section>
        </div>
      </div>

      <div className={styles.installationGrid}>
        <section className={styles.section}>
          <h3><span>03</span> System pacing defaults</h3>
          <label className={styles.check}><input type="checkbox" checked={pacing.enabled} onChange={(event) => setPacing({ ...pacing, enabled: event.target.checked })} /> Pause at paragraph breaks by default</label>
          <label>Paragraph duration (ms)<input type="number" min="0" max="30000" value={pacing.durationMs} onChange={(event) => setPacing({ ...pacing, durationMs: Number(event.target.value) })} /></label>
          <p className={styles.help}>Fixed preset: <code>pause_medium</code>. Changes are copied only into newly created projects.</p>
          <button type="button" disabled={busy || unavailable} onClick={() => void savePacing()}>Save system defaults</button>
        </section>

        <section className={styles.section}>
          <h3><span>04</span> Installation JSON</h3>
          <JsonDraft label="Global lexicon JSON" value={globalDraft} onChange={setGlobalDraft} />
          <button type="button" disabled={busy || unavailable} onClick={() => void saveGlobal()}>Replace global lexicon</button>
          <JsonDraft label="Ignored diagnostic patterns JSON" value={ignoredDraft} onChange={setIgnoredDraft} />
          <button type="button" disabled={busy || unavailable} onClick={() => void saveIgnored()}>Replace ignored patterns</button>
        </section>
      </div>

    </ContentPanel>
  );
}

function JsonDraft({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return <label>{label}<textarea className={styles.jsonDraft} spellCheck={false} rows={8} value={value} onChange={(event) => onChange(event.target.value)} /></label>;
}
