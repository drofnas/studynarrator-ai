import { describe, expect, it, vi } from "vitest";
import type { LexiconEntry } from "@studynarrator/core";
import type {
  ProjectDetail,
  SystemTimingConfiguration,
} from "@studynarrator/shared-types";
import {
  createSpeechCacheKey,
  type SpeechCache,
} from "@studynarrator/rendering";
import {
  SPEACHES_CACHE_ADAPTER_ID,
  SPEACHES_CACHE_ADAPTER_VERSION,
} from "./cachedSpeech.js";
import {
  createRenderPlanComputer,
  type RenderPlanRepository,
} from "./renderPlan.js";

const projectId = "00000000-0000-4000-8000-000000000001";
const planId = "00000000-0000-4000-8000-000000000002";
const timestamp = "2026-08-13T12:00:00.000Z";
const connection = {
  baseUrl: "http://127.0.0.1:8000",
  suppliedUrlForm: "root" as const,
  configured: true,
  defaultModelId: "model",
  defaultVoiceId: "voice-teacher",
  timeoutSeconds: 120,
  retryCount: 2,
  responseFormat: "wav" as const,
  lastTestedAt: null,
  lastSuccessfulTestAt: null,
  lastTestSummary: null,
  createdAt: timestamp,
  updatedAt: timestamp,
};

function project(): ProjectDetail {
  return {
    contractVersion: 1,
    id: projectId,
    name: "Render plan fixture",
    description: "",
    scriptSource: `[section: First]\n[speaker_teacher] SQL one.\n\n[speaker_student] Two.\n[section: Second]\n[speaker_teacher] Three.\n\n[speaker_teacher] Four.\n[pause_long]\n[speaker_teacher] Five.\n[pause_short]`,
    scriptHash: "a".repeat(64),
    speakerMappings: [
      {
        speakerId: "teacher",
        displayName: "Teacher",
        voiceId: "voice-teacher",
        speed: 1,
        gainDb: 0,
        roleDescription: "",
        sampleText: "",
      },
      {
        speakerId: "student",
        displayName: "Student",
        voiceId: "voice-student",
        speed: 1.1,
        gainDb: -1,
        roleDescription: "",
        sampleText: "",
      },
    ],
    lexiconEntries: [],
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function timing(): SystemTimingConfiguration {
  return {
    pausePresets: [
      { pauseId: "pause_short", durationMs: 350, description: "Short" },
      { pauseId: "pause_medium", durationMs: 750, description: "Medium" },
      { pauseId: "pause_long", durationMs: 1_500, description: "Long" },
    ],
    transitionPauses: {
      paragraph: { mode: "preset", pauseId: "pause_medium" },
      speakerChange: { mode: "duration", durationMs: 500 },
      section: { mode: "preset", pauseId: "pause_long" },
    },
  };
}

const defaultGlobalLexiconEntries: LexiconEntry[] = [
  {
    id: "global-sql",
    scope: "global",
    entryType: "exactTerm",
    displayText: "SQL",
    spokenText: "sequel",
    caseSensitive: false,
    wholeWord: true,
    priority: 0,
    enabled: true,
    notes: "",
    createdAt: timestamp,
    updatedAt: timestamp,
  },
];

function repository(current: {
  project: ProjectDetail;
  timing?: SystemTimingConfiguration;
  globalLexiconEntries?: LexiconEntry[];
}): RenderPlanRepository {
  return {
    getProject: vi.fn(() => current.project),
    getSystemPacing: vi.fn(() => current.timing ?? timing()),
    listGlobalLexicon: vi.fn(
      () => current.globalLexiconEntries ?? defaultGlobalLexiconEntries,
    ),
    getIgnoredDiagnostics: vi.fn(() => []),
    getSpeechBackendConnection: vi.fn(() => connection),
    getVoiceCatalogOverrides: vi.fn(() => ({
      schemaVersion: 1,
      modelId: "model",
      entries: [],
    })),
  } as unknown as RenderPlanRepository;
}

function cache(): SpeechCache {
  const inspect = vi.fn(
    async (input: Parameters<SpeechCache["inspect"]>[0]) => ({
      key: createSpeechCacheKey(input),
      status: input.text.includes("Three")
        ? ("hit" as const)
        : ("miss" as const),
    }),
  );
  return Object.assign({ inspect } as unknown as SpeechCache, {
    inspectMock: inspect,
  });
}

describe("render plan computation", () => {
  it("computes deterministic ordered entries with transition precedence, exact silence, and cache predictions without writing a plan", async () => {
    const current: {
      project: ProjectDetail;
      timing?: SystemTimingConfiguration;
    } = { project: project() };
    const speechCache = cache();
    const computer = createRenderPlanComputer({
      repository: repository(current),
      cache: speechCache,
      createId: () => planId,
      now: () => new Date(timestamp),
    });
    const computed = await computer.compute(projectId);
    const { snapshot, plan, silenceAssets } = computed;
    expect(snapshot.schemaVersion).toBe(1);
    expect(snapshot.project).toEqual(current.project);
    expect(snapshot.timing.transitionPauses.section).toEqual({
      mode: "preset",
      pauseId: "pause_long",
    });
    expect(snapshot.connection.modelId).toBe("model");
    expect(snapshot.connection.serverIdentityHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(plan.id).toBe(planId);
    expect(plan.snapshotHash).toBe(snapshot.snapshotHash);
    expect(plan.scriptHash).toBe(current.project.scriptHash);
    expect(
      plan.entries.map((entry) =>
        entry.type === "pause"
          ? `${entry.type}:${entry.reason}:${String(entry.durationMs)}`
          : entry.type,
      ),
    ).toEqual([
      "section",
      "speech",
      "pause:speakerChange:500",
      "speech",
      "section",
      "pause:section:1500",
      "speech",
      "pause:paragraph:750",
      "speech",
      "pause:explicit:1500",
      "speech",
      "pause:explicit:350",
    ]);
    expect(plan.summary).toEqual({
      sectionCount: 2,
      speechCount: 5,
      pauseCount: 5,
      cacheHits: 1,
      cacheMisses: 4,
      silenceDurationMs: 4_600,
    });
    const longSilences = plan.entries.flatMap((entry) =>
      entry.type === "pause" && entry.durationMs === 1_500
        ? [entry.silence?.checksum]
        : [],
    );
    expect(longSilences).toEqual([longSilences[0], longSilences[0]]);
    expect(
      longSilences.every(
        (checksum) => checksum !== undefined && silenceAssets.has(checksum),
      ),
    ).toBe(true);
    const firstSpeech = plan.entries.find((entry) => entry.type === "speech");
    expect(firstSpeech).toMatchObject({
      type: "speech",
      readableText: "SQL one.",
      ttsText: "sequel one.",
      chunks: [{ cacheStatus: "miss" }],
    });
    if (firstSpeech?.type !== "speech")
      throw new Error("Speech fixture missing.");
    expect(firstSpeech.chunks[0]?.cacheKey).toBe(
      createSpeechCacheKey({
        adapterId: SPEACHES_CACHE_ADAPTER_ID,
        adapterVersion: SPEACHES_CACHE_ADAPTER_VERSION,
        serverIdentity: connection.baseUrl!,
        modelId: "model",
        voiceId: "voice-teacher",
        speed: 1,
        text: "sequel one.",
        responseFormat: "wav",
      }),
    );
    expect(
      (speechCache as SpeechCache & { inspectMock: ReturnType<typeof vi.fn> })
        .inspectMock,
    ).toHaveBeenCalledTimes(5);

    current.project = {
      ...current.project,
      scriptSource: "[speaker_teacher] Changed after rendering.",
      scriptHash: "c".repeat(64),
    };
    current.timing = {
      ...timing(),
      transitionPauses: {
        ...timing().transitionPauses,
        paragraph: { mode: "none" },
      },
    };
    const recomputed = await computer.compute(projectId);
    expect(recomputed.plan.scriptHash).toBe("c".repeat(64));
    expect(recomputed.plan.planHash).not.toBe(plan.planHash);
  });

  it("uses a global named-sense alias in the synthesized render text", async () => {
    const aliasProject = project();
    aliasProject.scriptSource =
      "[speaker_teacher] Review resume/cv before the interview.";
    const computer = createRenderPlanComputer({
      repository: repository({
        project: aliasProject,
        globalLexiconEntries: [
          {
            id: "global-resume-cv",
            scope: "global",
            entryType: "namedSense",
            displayText: "resume",
            senseId: "cv",
            spokenText: "rez oo may",
            caseSensitive: false,
            wholeWord: true,
            priority: 0,
            enabled: true,
            notes: "",
            createdAt: timestamp,
            updatedAt: timestamp,
          },
        ],
      }),
      cache: cache(),
      createId: () => planId,
      now: () => new Date(timestamp),
    });

    const plan = (await computer.compute(projectId)).plan;
    expect(plan.entries).toContainEqual(
      expect.objectContaining({
        type: "speech",
        readableText: "Review resume before the interview.",
        ttsText: "Review rez oo may before the interview.",
      }),
    );
  });

  it("gives every computed plan its own identity instead of reusing the project's current plan", async () => {
    const repositoryInstance = repository({ project: project() });
    let nextId = 2;
    const computer = createRenderPlanComputer({
      repository: repositoryInstance,
      cache: cache(),
      createId: () =>
        `00000000-0000-4000-8000-${String(++nextId).padStart(12, "0")}`,
      now: () => new Date(timestamp),
    });
    const first = await computer.compute(projectId);
    const second = await computer.compute(projectId);
    expect(first.plan.id).not.toBe(second.plan.id);
    expect(first.plan.planHash).not.toBe(second.plan.planHash);
    const withoutIdentity = ({
      id: _id,
      planHash: _planHash,
      ...rest
    }: {
      id: string;
      planHash: string;
    }) => rest;
    expect(withoutIdentity(first.plan)).toEqual(withoutIdentity(second.plan));
  });

  it("blocks invalid projects without inspecting cache or computing a plan", async () => {
    const invalid = project();
    invalid.speakerMappings = invalid.speakerMappings.map((speaker) => ({
      ...speaker,
      voiceId: null,
    }));
    const speechCache = cache();
    const computer = createRenderPlanComputer({
      repository: repository({ project: invalid }),
      cache: speechCache,
      createId: () => planId,
    });
    await expect(computer.compute(projectId)).rejects.toMatchObject({
      code: "RENDER_PLAN_CONFIGURATION",
    });
    expect(
      (speechCache as SpeechCache & { inspectMock: ReturnType<typeof vi.fn> })
        .inspectMock,
    ).not.toHaveBeenCalled();
  });

  it("supports disabled and zero-duration automatic transitions without leading or trailing silence", async () => {
    const base = project();
    base.scriptSource =
      "[section: Start]\n[speaker_teacher] One.\n\n[speaker_teacher] Two.";
    const zeroTiming = {
      ...timing(),
      transitionPauses: {
        paragraph: { mode: "duration" as const, durationMs: 0 },
        speakerChange: { mode: "none" as const },
        section: { mode: "none" as const },
      },
    };
    const first = createRenderPlanComputer({
      repository: repository({ project: base, timing: zeroTiming }),
      cache: cache(),
      createId: () => planId,
    });
    const zeroPlan = (await first.compute(projectId)).plan;
    expect(zeroPlan.entries.filter((entry) => entry.type === "pause")).toEqual([
      expect.objectContaining({
        reason: "paragraph",
        durationMs: 0,
        silence: null,
      }),
    ]);

    const disabledTiming = {
      ...timing(),
      transitionPauses: {
        paragraph: { mode: "none" as const },
        speakerChange: { mode: "none" as const },
        section: { mode: "none" as const },
      },
    };
    const second = createRenderPlanComputer({
      repository: repository({ project: base, timing: disabledTiming }),
      cache: cache(),
      createId: () => planId,
    });
    expect(
      (await second.compute(projectId)).plan.entries.some(
        (entry) => entry.type === "pause",
      ),
    ).toBe(false);
  });

  it("preserves repeated section boundaries while an explicit pause suppresses every automatic candidate", async () => {
    const base = project();
    base.scriptSource = [
      "[speaker_teacher] One.",
      "",
      "[section: Repeated A]",
      "[section: Repeated B]",
      "[pause_short]",
      "[speaker_student] Two.",
      "[section: Trailing]",
    ].join("\n");
    const computer = createRenderPlanComputer({
      repository: repository({ project: base }),
      cache: cache(),
      createId: () => planId,
    });
    const plan = (await computer.compute(projectId)).plan;
    expect(
      plan.entries.map((entry) =>
        entry.type === "pause"
          ? `${entry.pauseKind}:${entry.reason}`
          : entry.type,
      ),
    ).toEqual([
      "speech",
      "section",
      "section",
      "explicit:explicit",
      "speech",
      "section",
    ]);
    expect(
      plan.entries.filter(
        (entry) => entry.type === "pause" && entry.pauseKind === "automatic",
      ),
    ).toEqual([]);
  });
});
