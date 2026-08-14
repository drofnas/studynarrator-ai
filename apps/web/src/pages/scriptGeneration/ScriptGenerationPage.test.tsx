// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PersistenceClient, ProjectDetail, ScriptGenerationClient } from "@studynarrator/shared-types";
import { ScriptGenerationPage } from "./ScriptGenerationPage.js";

const project: ProjectDetail = {
  contractVersion: 4,
  id: "00000000-0000-4000-8000-000000000001",
  name: "Caching guide",
  description: "Explain cache invalidation.",
  scriptSource: "PRIVATE SESSION SOURCE",
  scriptHash: "a".repeat(64),
  connectionProfileId: null,
  modelId: null,
  speakerMappings: [
    { speakerId: "teacher", displayName: "Teacher", voiceId: null, speed: 1, gainDb: 0, roleDescription: "Explains clearly.", sampleText: "" },
    { speakerId: "student", displayName: "Student", voiceId: null, speed: 1, gainDb: 0, roleDescription: "Asks concise questions.", sampleText: "" }
  ],
  pausePresets: [{ pauseId: "pause_short", durationMs: 350, description: "Brief handoff." }],
  transitionPauses: { paragraph: { mode: "none" }, speakerChange: { mode: "none" }, section: { mode: "none" } },
  lexiconEntries: [],
  createdAt: "2026-08-14T00:00:00.000Z",
  updatedAt: "2026-08-14T00:00:00.000Z"
};

function fixture() {
  const replaceProject = vi.fn();
  const persistence: PersistenceClient = {
    status: vi.fn(),
    projects: { list: vi.fn(), create: vi.fn(), get: vi.fn(async () => structuredClone(project)), replace: replaceProject, duplicate: vi.fn(), delete: vi.fn() },
    settings: { getPacing: vi.fn(), updatePacing: vi.fn() },
    preferences: { getIgnoredDiagnostics: vi.fn(), replaceIgnoredDiagnostics: vi.fn() },
    globalLexicon: { list: vi.fn(), replace: vi.fn() }
  };
  const prompt = { fileName: "caching-prompt.md", mimeType: "text/markdown; charset=utf-8" as const, content: "GOAL\nGenerated prompt\nSOURCE MATERIAL\nPRIVATE SESSION SOURCE", checksum: "b".repeat(64) };
  const exportPrompt = vi.fn(async () => ({ disposition: "download" as const, fileName: prompt.fileName }));
  const exportSkillPackage = vi.fn(async () => ({ disposition: "download" as const, fileName: "caching-skill.zip" }));
  const generation: ScriptGenerationClient = {
    previewPrompt: vi.fn(async () => prompt),
    exportPrompt,
    exportSkillPackage
  };
  return { persistence, generation, prompt, replaceProject, exportPrompt, exportSkillPackage };
}

function renderPage(persistence: PersistenceClient, generation: ScriptGenerationClient) {
  return render(<MemoryRouter initialEntries={[`/projects/${project.id}/script-generation`]}><Routes>
    <Route path="/projects/:projectId/script-generation" element={<ScriptGenerationPage persistence={persistence} generation={generation} />} />
  </Routes></MemoryRouter>);
}

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("Instruction workbench", () => {
  it("assembles, copies, and explicitly exports session-only artifacts", async () => {
    const { persistence, generation, prompt, replaceProject, exportPrompt, exportSkillPackage } = fixture();
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    renderPage(persistence, generation);
    expect(await screen.findByRole("heading", { name: "Instruction workbench" })).toBeInTheDocument();
    expect(screen.getByLabelText("Purpose")).toHaveValue(project.description);
    expect(screen.getByLabelText("Source material")).toHaveValue(project.scriptSource);
    expect(screen.getByLabelText("Speaker 1 ID")).toHaveValue("teacher");
    await userEvent.click(screen.getByRole("button", { name: "Assemble prompt" }));
    expect(await screen.findByLabelText("Generated prompt preview")).toHaveTextContent("Generated prompt");
    await userEvent.click(screen.getByRole("button", { name: "Copy prompt" }));
    expect(writeText).toHaveBeenCalledWith(prompt.content);
    await userEvent.click(screen.getByRole("button", { name: "Download prompt" }));
    await userEvent.click(screen.getByRole("button", { name: "Download skill package" }));
    expect(exportPrompt).toHaveBeenCalledOnce();
    expect(exportSkillPackage).toHaveBeenCalledOnce();
    expect(replaceProject).not.toHaveBeenCalled();
    expect(await screen.findByText(/Source material was not included/u)).toBeInTheDocument();
  });

  it("blocks duplicate IDs and reports clipboard denial without losing the preview", async () => {
    const { persistence, generation } = fixture();
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: vi.fn(async () => { throw new Error("denied"); }) } });
    renderPage(persistence, generation);
    await screen.findByRole("heading", { name: "Instruction workbench" });
    await userEvent.clear(screen.getByLabelText("Speaker 2 ID"));
    await userEvent.type(screen.getByLabelText("Speaker 2 ID"), "teacher");
    expect(screen.getByRole("alert")).toHaveTextContent("Duplicate speaker ID: teacher.");
    expect(screen.getByRole("button", { name: "Assemble prompt" })).toBeDisabled();
    await userEvent.clear(screen.getByLabelText("Speaker 2 ID"));
    await userEvent.type(screen.getByLabelText("Speaker 2 ID"), "student");
    await userEvent.click(screen.getByRole("button", { name: "Assemble prompt" }));
    await userEvent.click(await screen.findByRole("button", { name: "Copy prompt" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Clipboard access was denied");
    expect(screen.getByLabelText("Generated prompt preview")).toBeInTheDocument();
  });

  it("re-seeds the brief from the project after the page is reopened", async () => {
    const { persistence, generation, replaceProject } = fixture();
    const first = renderPage(persistence, generation);
    const source = await screen.findByLabelText("Source material");
    await userEvent.clear(source);
    await userEvent.type(source, "temporary edit");
    first.unmount();
    renderPage(persistence, generation);
    await waitFor(() => expect(screen.getByLabelText("Source material")).toHaveValue(project.scriptSource));
    expect(replaceProject).not.toHaveBeenCalled();
  });
});
