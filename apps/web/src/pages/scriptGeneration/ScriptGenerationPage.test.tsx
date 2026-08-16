// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import "@/test/domGeometry.js";
import { EditorView } from "@codemirror/view";
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PersistenceClient, ProjectDetail, ScriptGenerationClient } from "@studynarrator/shared-types";
import { ScriptGenerationPage } from "./ScriptGenerationPage.js";

const project: ProjectDetail = {
  contractVersion: 1,
  id: "00000000-0000-4000-8000-000000000001",
  name: "Caching guide",
  description: "Explain cache invalidation.",
  scriptSource: "PRIVATE SAVED SCRIPT",
  scriptHash: "a".repeat(64),
  speakerMappings: [{ speakerId: "teacher", displayName: "Teacher", voiceId: null, speed: 1, gainDb: 0, roleDescription: "Explains clearly.", sampleText: "" }],
  lexiconEntries: [{ id: "sql", scope: "project", entryType: "exactTerm", displayText: "SQL", spokenText: "sequel", caseSensitive: true, wholeWord: true, priority: 0, enabled: true, notes: "", createdAt: "2026-08-14T00:00:00.000Z", updatedAt: "2026-08-14T00:00:00.000Z" }],
  createdAt: "2026-08-14T00:00:00.000Z",
  updatedAt: "2026-08-14T00:00:00.000Z"
};

function fixture() {
  const replaceProject = vi.fn();
  const getProject = vi.fn(async () => structuredClone(project));
  const persistence: PersistenceClient = {
    status: vi.fn(),
    projects: { list: vi.fn(), create: vi.fn(), get: getProject, replace: replaceProject, duplicate: vi.fn(), delete: vi.fn() },
    settings: { getPacing: vi.fn(), updatePacing: vi.fn() },
    preferences: { getIgnoredDiagnostics: vi.fn(), replaceIgnoredDiagnostics: vi.fn() },
    globalLexicon: { list: vi.fn(async () => []), replace: vi.fn() }
  };
  const creation = { kind: "creation" as const, fileName: "caching-creation-prompt.md", mimeType: "text/markdown; charset=utf-8" as const, content: "KNOWLEDGE TO GATHER AND TEACH\n[speaker_teacher]\nSQL → sequel\n{{display text|new_sense_id}}", checksum: "a".repeat(64) };
  const update = { kind: "update" as const, fileName: "caching-update-prompt.md", mimeType: "text/markdown; charset=utf-8" as const, content: "SCRIPT AND CHANGE REQUEST\n[speaker_teacher]\nSQL → sequel", checksum: "b".repeat(64) };
  const exportPrompt = vi.fn(async (_projectId: string | null, kind: "creation" | "update", _content?: string) => ({ disposition: "download" as const, fileName: kind === "creation" ? creation.fileName : update.fileName }));
  const exportSkillPackage = vi.fn(async () => ({ disposition: "download" as const, fileName: "caching-skill.zip" }));
  const previewPrompt = vi.fn(async (_projectId: string | null, kind: "creation" | "update") => kind === "creation" ? creation : update);
  const generation: ScriptGenerationClient = {
    previewPrompt,
    exportPrompt,
    exportSkillPackage
  };
  return { persistence, generation, creation, update, replaceProject, getProject, previewPrompt, exportPrompt, exportSkillPackage };
}

function renderPage(persistence: PersistenceClient, generation: ScriptGenerationClient, path = "/script-prompts") {
  return render(<MemoryRouter initialEntries={[path]}><Routes>
    <Route path="/script-prompts" element={<ScriptGenerationPage persistence={persistence} generation={generation} />} />
    <Route path="/projects/:projectId/script-generation" element={<ScriptGenerationPage persistence={persistence} generation={generation} />} />
  </Routes></MemoryRouter>);
}

function editorView(name: string): EditorView {
  const content = screen.getByRole("textbox", { name });
  const view = EditorView.findFromDOM(content.closest(".cm-editor") as HTMLElement);
  if (!view) throw new Error("Expected a CodeMirror editor view.");
  return view;
}

function replaceEditorContent(name: string, content: string) {
  const view = editorView(name);
  act(() => view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: content } }));
}

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("script prompt kit", () => {
  it("shows separate creation and update boilerplates without the saved script", async () => {
    const { persistence, generation, getProject, previewPrompt } = fixture();
    renderPage(persistence, generation);
    expect(await screen.findByRole("heading", { name: "Script prompt kit" })).toBeInTheDocument();
    const createTab = screen.getByRole("tab", { name: /Create a script/u });
    const updateTab = screen.getByRole("tab", { name: /Update a script/u });
    expect(createTab).toHaveAttribute("aria-selected", "true");
    expect(updateTab).toHaveAttribute("aria-selected", "false");
    expect(editorView("Create a script prompt editor").state.doc.toString()).toContain("KNOWLEDGE TO GATHER AND TEACH");
    expect(editorView("Create a script prompt editor").state.doc.toString()).toContain("{{display text|new_sense_id}}");
    expect(screen.queryByText(project.scriptSource)).not.toBeInTheDocument();
    await userEvent.click(updateTab);
    expect(editorView("Update a script prompt editor").state.doc.toString()).toContain("SCRIPT AND CHANGE REQUEST");
    expect(screen.getByText(/current script and the exact edits/u)).toBeInTheDocument();
    expect(screen.getByText("New script", { exact: true })).toBeInTheDocument();
    expect(screen.getAllByText("Existing script", { exact: true })).toHaveLength(2);
    expect(screen.queryByText(/Blank page|Red pen|Included automatically/u)).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "View Projects" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /both prompts/u })).not.toBeInTheDocument();
    expect(screen.queryByText("a".repeat(12))).not.toBeInTheDocument();
    expect(getProject).not.toHaveBeenCalled();
    expect(previewPrompt).toHaveBeenCalledWith(null, "creation");
  });

  it("preserves independent drafts and copies and exports the selected edits", async () => {
    const { persistence, generation, creation, update, replaceProject, exportPrompt, exportSkillPackage } = fixture();
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    renderPage(persistence, generation);
    await screen.findByRole("heading", { name: "Script prompt kit" });
    const editedCreation = `${creation.content}\nCREATE EDIT`;
    replaceEditorContent("Create a script prompt editor", editedCreation);
    await userEvent.click(screen.getByRole("tab", { name: /Update a script/u }));
    const editedUpdate = `${update.content}\nUPDATE EDIT`;
    replaceEditorContent("Update a script prompt editor", editedUpdate);
    await userEvent.click(screen.getByRole("tab", { name: /Create a script/u }));
    expect(editorView("Create a script prompt editor").state.doc.toString()).toBe(editedCreation);
    await userEvent.click(screen.getByRole("tab", { name: /Update a script/u }));
    expect(editorView("Update a script prompt editor").state.doc.toString()).toBe(editedUpdate);
    await userEvent.click(screen.getByRole("button", { name: "Copy update prompt" }));
    expect(writeText).toHaveBeenCalledWith(editedUpdate);
    await userEvent.click(screen.getByRole("button", { name: "Download update prompt" }));
    expect(exportPrompt).toHaveBeenCalledWith(null, "update", editedUpdate);
    expect(exportSkillPackage).not.toHaveBeenCalled();
    expect(replaceProject).not.toHaveBeenCalled();
  });

  it("disables copy and export for an empty draft", async () => {
    const { persistence, generation } = fixture();
    renderPage(persistence, generation);
    await screen.findByRole("heading", { name: "Script prompt kit" });
    replaceEditorContent("Create a script prompt editor", "");
    expect(screen.getByRole("button", { name: "Copy creation prompt" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Download creation prompt" })).toBeDisabled();
  });

  it("supports keyboard navigation between prompt tabs", async () => {
    const { persistence, generation } = fixture();
    renderPage(persistence, generation);
    const createTab = await screen.findByRole("tab", { name: /Create a script/u });
    createTab.focus();
    await userEvent.keyboard("{ArrowRight}");
    expect(screen.getByRole("tab", { name: /Update a script/u })).toHaveFocus();
    expect(screen.getByRole("tab", { name: /Update a script/u })).toHaveAttribute("aria-selected", "true");
  });

  it("reports clipboard denial without hiding either prompt", async () => {
    const { persistence, generation } = fixture();
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: vi.fn(async () => { throw new Error("denied"); }) } });
    renderPage(persistence, generation);
    await screen.findByRole("heading", { name: "Script prompt kit" });
    await userEvent.click(screen.getByRole("button", { name: "Copy creation prompt" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Clipboard access was denied");
    expect(screen.getByRole("textbox", { name: "Create a script prompt editor" })).toBeInTheDocument();
  });

  it("keeps the existing project-specific route available", async () => {
    const { persistence, generation, getProject, previewPrompt } = fixture();
    renderPage(persistence, generation, `/projects/${project.id}/script-generation`);
    expect(await screen.findByRole("link", { name: `Back to ${project.name}` })).toBeInTheDocument();
    expect(getProject).toHaveBeenCalledWith(project.id);
    expect(previewPrompt).toHaveBeenCalledWith(project.id, "creation");
  });
});
