// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SYSTEM_TIMING } from "@studynarrator/shared-types";
import type {
  ConnectionTestOverall,
  PersistenceClient,
  SpeechBackendConnectionClient,
  SystemClient,
} from "@studynarrator/shared-types";
import { App } from "./App.js";

const unusedAnalyzer = { analyze: vi.fn() };
const unusedProjectGet = vi.fn();
const unusedPersistence: PersistenceClient = {
  status: vi.fn(async () => {
    throw new Error("unused");
  }),
  backups: { list: vi.fn(async () => []), restore: vi.fn() },
  projects: {
    list: vi.fn(async () => []),
    create: vi.fn(),
    get: unusedProjectGet,
    replace: vi.fn(),
    duplicate: vi.fn(),
    delete: vi.fn(),
  },
  settings: {
    getPacing: vi.fn(async () => DEFAULT_SYSTEM_TIMING),
    updatePacing: vi.fn(),
  },
  retention: {} as PersistenceClient["retention"],
  preferences: {
    getIgnoredDiagnostics: vi.fn(async () => []),
    replaceIgnoredDiagnostics: vi.fn(),
  },
  globalLexicon: {
    list: vi.fn(async () => ({ builtIns: [], custom: [] })),
    setBuiltInEnabled: vi.fn(),
    replaceCustom: vi.fn(),
    reimportBuiltIns: vi.fn(),
  },
};
const unusedConnections = {
  get: vi.fn(async () => ({
    backendId: "speaches" as const,
    baseUrl: null,
    suppliedUrlForm: "unconfigured" as const,
    configured: false,
    defaultModelId: null,
    defaultVoiceId: null,
    timeoutSeconds: 120,
    retryCount: 2,
    responseFormat: "wav" as const,
    lastTestedAt: null,
    lastSuccessfulTestAt: null,
    lastTestSummary: null,
    createdAt: "2026-08-12T12:00:00.000Z",
    updatedAt: "2026-08-12T12:00:00.000Z",
  })),
  update: vi.fn(),
  test: vi.fn(),
  exportDiagnostics: vi.fn(),
  discoverSpeechCatalog: vi.fn(async () => ({
    schemaVersion: 1 as const,
    models: [],
  })),
  getSetupState: vi.fn(async () => ({
    onboardingCompletedAt: "2026-08-12T12:00:00.000Z",
    client: "web" as const,
  })),
  completeOnboarding: vi.fn(),
};
const unusedVoiceCatalog = {
  get: vi.fn(async (modelId: string) => ({
    schemaVersion: 1 as const,
    modelId,
    entries: [],
  })),
  replace: vi.fn(),
};
const unusedScratchpad = { preview: vi.fn() };
const unusedProjectPreview = { preview: vi.fn() };
const unusedSpeechCache = {
  status: vi.fn(async () => ({
    contractVersion: 1 as const,
    entryCount: 0,
    totalBytes: 0,
    lastUsedAt: null,
    sessionHits: 0,
    sessionMisses: 0,
    sessionWrites: 0,
    sessionCorruptMisses: 0,
    inFlight: 0,
  })),
  clearAll: vi.fn(),
  clearProject: vi.fn(),
  clearEntry: vi.fn(),
};
const promptDocuments = {
  creation: {
    kind: "creation" as const,
    fileName: "studynarrator-creation-prompt.md",
    mimeType: "text/markdown; charset=utf-8" as const,
    content: "# StudyNarrator Script Creation Instructions",
    checksum: "a".repeat(64),
  },
  update: {
    kind: "update" as const,
    fileName: "studynarrator-update-prompt.md",
    mimeType: "text/markdown; charset=utf-8" as const,
    content: "# StudyNarrator Script Update Instructions",
    checksum: "b".repeat(64),
  },
};
const unusedPromptPreview = vi.fn(
  async (_projectId: string | null, kind: "creation" | "update") =>
    promptDocuments[kind],
);
const unusedScriptGeneration = {
  previewPrompt: unusedPromptPreview,
  exportPrompt: vi.fn(),
  exportSkillPackage: vi.fn(),
};

afterEach(cleanup);

function renderApp(
  route: string,
  client: SystemClient = { diagnostics: vi.fn() },
  connection: SpeechBackendConnectionClient = unusedConnections,
) {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <App
        analyzer={unusedAnalyzer}
        client={client}
        persistence={unusedPersistence}
        connection={connection}
        voiceCatalog={unusedVoiceCatalog}
        scratchpad={unusedScratchpad}
        projectPreview={unusedProjectPreview}
        speechCache={unusedSpeechCache}
        scriptGeneration={unusedScriptGeneration}
      />
    </MemoryRouter>,
  );
}

async function findHeading(name: string) {
  return await screen.findByRole("heading", { name }, { timeout: 5_000 });
}

describe("application routing", () => {
  it.each(["/", "/missing-page"])("redirects %s to Projects", async (route) => {
    const diagnostics = vi.fn();
    renderApp(route, { diagnostics });
    expect(await findHeading("Projects")).toBeInTheDocument();
    const navigation = within(screen.getByRole("navigation"));
    expect(
      navigation.getAllByRole("link").map((link) => link.textContent),
    ).toEqual([
      "Prompt Kit",
      "Projects",
      "Quick Scratchpad",
      "Settings",
      "General",
      "Voices",
      "Lexicon",
      "Timings",
      "Retention",
      "System diagnostics",
    ]);
    expect(navigation.getByRole("link", { name: "Projects" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(diagnostics).not.toHaveBeenCalled();
  });

  it("navigates directly to system diagnostics", async () => {
    const user = userEvent.setup();
    renderApp("/projects");
    await user.click(screen.getByRole("link", { name: "System diagnostics" }));
    expect(await findHeading("Runtime self-test")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "System diagnostics" }),
    ).toHaveAttribute("aria-current", "page");
    expect(screen.queryByText("Review tools")).not.toBeInTheDocument();
  });

  it("reaches Quick Scratchpad through primary navigation", async () => {
    const user = userEvent.setup();
    renderApp("/projects");
    await user.click(screen.getByRole("link", { name: "Quick Scratchpad" }));
    expect(await findHeading("Quick Scratchpad")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Quick Scratchpad" }),
    ).toHaveAttribute("aria-current", "page");
  });

  it("opens General from the Settings parent without activating the parent", async () => {
    const user = userEvent.setup();
    renderApp("/projects");
    const navigation = within(screen.getByRole("navigation"));
    await user.click(navigation.getByRole("link", { name: "Settings" }));
    expect(await findHeading("General")).toBeInTheDocument();
    expect(
      navigation.getByRole("link", { name: "Settings" }),
    ).not.toHaveAttribute("aria-current");
    expect(navigation.getByRole("link", { name: "General" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it.each([
    ["/settings", "General"],
    ["/settings/general", "General"],
    ["/settings/voices", "Voices"],
    ["/settings/lexicon", "Lexicon"],
    ["/settings/timings", "Timings"],
  ])("routes %s to the %s settings page", async (route, pageName) => {
    renderApp(route);
    expect(await findHeading(pageName)).toBeInTheDocument();
    const navigation = within(screen.getByRole("navigation"));
    expect(navigation.getByRole("link", { name: pageName })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(
      navigation.getByRole("link", { name: "Settings" }),
    ).not.toHaveAttribute("aria-current");
  });

  it("reaches the project-free script prompt kit through primary navigation", async () => {
    const user = userEvent.setup();
    renderApp("/projects");
    await user.click(screen.getByRole("link", { name: "Prompt Kit" }));
    expect(await findHeading("Script prompt kit")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Prompt Kit" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(unusedProjectGet).not.toHaveBeenCalled();
    expect(unusedPromptPreview).toHaveBeenCalledWith(null, "creation");
  });

  it("keeps Prompt Kit active in a project-specific prompt workflow", () => {
    renderApp("/projects/project-id/script-generation");
    expect(screen.getByRole("link", { name: "Prompt Kit" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByRole("link", { name: "Projects" })).not.toHaveAttribute(
      "aria-current",
    );
  });

  it("uses the connection monitor to finish incomplete onboarding", async () => {
    const connections = {
      ...unusedConnections,
      getSetupState: vi.fn(async () => ({
        onboardingCompletedAt: null,
        client: "web" as const,
      })),
    };
    renderApp("/onboarding", { diagnostics: vi.fn() }, connections);
    const monitor = await screen.findByRole("link", {
      name: "Configuration error. Not configured. Finish setup.",
    });
    expect(monitor).toHaveAttribute("href", "/onboarding");
  });

  it.each(["/script-lab", "/persistence-lab"])(
    "redirects removed review route %s to Projects",
    async (route) => {
      renderApp(route);
      expect(await findHeading("Projects")).toBeInTheDocument();
      expect(screen.queryByText(/Lab/u)).not.toBeInTheDocument();
    },
  );

  it.each([
    ["connected", "Connected"],
    ["modelUnavailable", "Model unavailable"],
    ["voiceUnavailable", "Voice unavailable"],
    ["authenticationRequired", "Authentication required"],
    ["disconnected", "Disconnected"],
    ["configurationError", "Configuration error"],
    ["invalidAudio", "Configuration error"],
  ] as const)("shows the %s shell connection state", async (overall, label) => {
    const testedAt = "2026-08-12T12:00:00.000Z";
    const connection = {
      backendId: "speaches" as const,
      baseUrl: "http://127.0.0.1:8000",
      suppliedUrlForm: "root" as const,
      configured: true,
      defaultModelId: "model",
      defaultVoiceId: "voice",
      timeoutSeconds: 120,
      retryCount: 2,
      responseFormat: "wav" as const,
      lastTestedAt: testedAt,
      lastSuccessfulTestAt: overall === "connected" ? testedAt : null,
      lastTestSummary: {
        schemaVersion: 1 as const,
        overall: overall as ConnectionTestOverall,
        testedAt,
        httpStatus: 200,
        stages: [],
        availableModelIds: [],
        availableVoiceIds: null,
      },
      createdAt: testedAt,
      updatedAt: testedAt,
    };
    const connections = {
      ...unusedConnections,
      get: vi.fn(async () => connection),
      getSetupState: vi.fn(async () => ({
        onboardingCompletedAt: testedAt,
        client: "web" as const,
      })),
    };
    renderApp("/projects", { diagnostics: vi.fn() }, connections as never);
    const monitor = await screen.findByRole("link", {
      name: new RegExp(
        `^${label}\\. 127\\.0\\.0\\.1:8000\\. Manage connection\\.$`,
        "u",
      ),
    });
    expect(monitor).toHaveAttribute("data-state", overall);
    expect(monitor).toHaveAttribute("href", "/settings/general");
  });
});
