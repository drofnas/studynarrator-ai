// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PersistenceClient, ProjectDetail, ScriptGenerationClient } from "@studynarrator/shared-types";
import { ScriptGenerationPage } from "./ScriptGenerationPage.js";

const project: ProjectDetail = {
  contractVersion: 9,
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
  const exportPrompt = vi.fn(async (_projectId: string | null, kind: "creation" | "update") => ({ disposition: "download" as const, fileName: kind === "creation" ? creation.fileName : update.fileName }));
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

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("script prompt kit", () => {
  it("shows separate creation and update boilerplates without the saved script", async () => {
    const { persistence, generation, getProject, previewPrompt } = fixture();
    renderPage(persistence, generation);
    expect(await screen.findByRole("heading", { name: "Script prompt kit" })).toBeInTheDocument();
    expect(screen.getByLabelText("Create a script prompt preview")).toHaveTextContent("KNOWLEDGE TO GATHER AND TEACH");
    expect(screen.getByLabelText("Create a script prompt preview")).toHaveTextContent("{{display text|new_sense_id}}");
    expect(screen.queryByText(project.scriptSource)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /Update a script/u }));
    expect(screen.getByLabelText("Update a script prompt preview")).toHaveTextContent("SCRIPT AND CHANGE REQUEST");
    expect(screen.getByText(/current script and the exact edits/u)).toBeInTheDocument();
    expect(getProject).not.toHaveBeenCalled();
    expect(previewPrompt).toHaveBeenCalledWith(null, "creation");
  });

  it("copies and exports the selected prompt plus the combined kit", async () => {
    const { persistence, generation, update, replaceProject, exportPrompt, exportSkillPackage } = fixture();
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    renderPage(persistence, generation);
    await screen.findByRole("heading", { name: "Script prompt kit" });
    await userEvent.click(screen.getByRole("button", { name: /Update a script/u }));
    await userEvent.click(screen.getByRole("button", { name: "Copy update prompt" }));
    expect(writeText).toHaveBeenCalledWith(update.content);
    await userEvent.click(screen.getByRole("button", { name: "Download update prompt" }));
    await userEvent.click(screen.getByRole("button", { name: "Download both prompts as a kit" }));
    expect(exportPrompt).toHaveBeenCalledWith(null, "update");
    expect(exportSkillPackage).toHaveBeenCalledWith(null);
    expect(replaceProject).not.toHaveBeenCalled();
  });

  it("reports clipboard denial without hiding either prompt", async () => {
    const { persistence, generation } = fixture();
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: vi.fn(async () => { throw new Error("denied"); }) } });
    renderPage(persistence, generation);
    await screen.findByRole("heading", { name: "Script prompt kit" });
    await userEvent.click(screen.getByRole("button", { name: "Copy creation prompt" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Clipboard access was denied");
    expect(screen.getByLabelText("Create a script prompt preview")).toBeInTheDocument();
  });

  it("keeps the existing project-specific route available", async () => {
    const { persistence, generation, getProject, previewPrompt } = fixture();
    renderPage(persistence, generation, `/projects/${project.id}/script-generation`);
    expect(await screen.findByRole("link", { name: `Back to ${project.name}` })).toBeInTheDocument();
    expect(getProject).toHaveBeenCalledWith(project.id);
    expect(previewPrompt).toHaveBeenCalledWith(project.id, "creation");
  });
});
