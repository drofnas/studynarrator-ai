const connection = ["connection"] as const;
const persistence = ["persistence"] as const;
const speechCache = ["speech-cache"] as const;
const system = ["system"] as const;
const renders = ["renders"] as const;
const scriptGeneration = ["script-generation"] as const;

/**
 * Server-state keys are stable, serializable resource tuples. Start with the
 * resource root, then append the specific operation and identifying input.
 */
export const queryKeys = {
  connection: {
    all: connection,
    current: () => [...connection, "current"] as const,
    setup: () => [...connection, "setup"] as const,
    voiceCatalog: (modelId: string) =>
      [...connection, "voice-catalog", modelId] as const,
  },
  persistence: {
    all: persistence,
    status: () => [...persistence, "status"] as const,
    projects: () => [...persistence, "projects"] as const,
    project: (projectId: string) =>
      [...persistence, "projects", projectId] as const,
    globalLexicon: () => [...persistence, "global-lexicon"] as const,
    ignoredDiagnostics: () => [...persistence, "ignored-diagnostics"] as const,
    timing: () => [...persistence, "timing"] as const,
    retention: () => [...persistence, "retention"] as const,
    retentionUsage: () => [...persistence, "retention", "usage"] as const,
  },
  speechCache: {
    all: speechCache,
    status: () => [...speechCache, "status"] as const,
  },
  system: {
    all: system,
    diagnostics: () => [...system, "diagnostics"] as const,
  },
  renders: {
    all: renders,
    project: (projectId: string) => [...renders, "project", projectId] as const,
    detail: (renderId: string) => [...renders, "detail", renderId] as const,
    waveform: (renderId: string) => [...renders, "waveform", renderId] as const,
  },
  scriptGeneration: {
    all: scriptGeneration,
    prompt: (projectId: string | null, kind: string) =>
      [...scriptGeneration, "prompt", projectId, kind] as const,
  },
} as const;
