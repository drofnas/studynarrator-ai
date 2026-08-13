import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { ProjectDetail } from "@studynarrator/shared-types";
import { createRenderPlanStore, createSpeechCacheKey, type SpeechCache } from "@studynarrator/rendering";
import { APPLICATION_SERVICE_MANIFEST } from "./serviceManifest.js";
import { SPEACHES_CACHE_ADAPTER_ID, SPEACHES_CACHE_ADAPTER_VERSION } from "./cachedSpeech.js";
import { createRenderPlanService, type RenderPlanRepository } from "./renderPlan.js";

const projectId = "00000000-0000-4000-8000-000000000001";
const planId = "00000000-0000-4000-8000-000000000002";
const timestamp = "2026-08-13T12:00:00.000Z";
const profile = {
  id: "profile", name: "Local", baseUrl: "http://127.0.0.1:8000", suppliedUrlForm: "root" as const,
  source: "saved" as const, editable: true, credentialEntryAllowed: false, configured: true, apiKeyConfigured: false,
  defaultModelId: "model", defaultVoiceId: "voice-teacher", timeoutSeconds: 120, retryCount: 2, responseFormat: "wav" as const,
  lastTestedAt: null, lastSuccessfulTestAt: null, lastTestSummary: null, createdAt: timestamp, updatedAt: timestamp
};

function project(): ProjectDetail {
  return {
    contractVersion: 4,
    id: projectId,
    name: "Render plan fixture",
    description: "",
    scriptSource: `[section: First]\n[speaker_teacher] SQL one.\n\n[speaker_student] Two.\n[section: Second]\n[speaker_teacher] Three.\n\n[speaker_teacher] Four.\n[pause_long]\n[speaker_teacher] Five.\n[pause_short]`,
    scriptHash: "a".repeat(64),
    connectionProfileId: profile.id,
    modelId: "model",
    speakerMappings: [
      { speakerId: "teacher", displayName: "Teacher", voiceId: "voice-teacher", speed: 1, gainDb: 0, roleDescription: "", sampleText: "" },
      { speakerId: "student", displayName: "Student", voiceId: "voice-student", speed: 1.1, gainDb: -1, roleDescription: "", sampleText: "" }
    ],
    pausePresets: [
      { pauseId: "pause_short", durationMs: 350, description: "Short" },
      { pauseId: "pause_medium", durationMs: 750, description: "Medium" },
      { pauseId: "pause_long", durationMs: 1_500, description: "Long" }
    ],
    transitionPauses: {
      paragraph: { mode: "preset", pauseId: "pause_medium" },
      speakerChange: { mode: "duration", durationMs: 500 },
      section: { mode: "preset", pauseId: "pause_long" }
    },
    lexiconEntries: [],
    createdAt: timestamp,
    updatedAt: timestamp
  };
}

function repository(current: { project: ProjectDetail }): RenderPlanRepository {
  return {
    getProject: vi.fn(() => current.project),
    listGlobalLexicon: vi.fn(() => [{
      id: "global-sql", scope: "global", entryType: "exactTerm", displayText: "SQL", spokenText: "sequel",
      caseSensitive: true, wholeWord: true, priority: 0, enabled: true, notes: "", createdAt: timestamp, updatedAt: timestamp
    }]),
    getIgnoredDiagnostics: vi.fn(() => []),
    getConnectionProfile: vi.fn(() => profile),
    getConnectionCredentialReference: vi.fn(() => null),
    getVoiceCatalogOverrides: vi.fn(() => ({ schemaVersion: 1, modelId: "model", entries: [] }))
  } as unknown as RenderPlanRepository;
}

function cache(): SpeechCache {
  const inspect = vi.fn(async (input: Parameters<SpeechCache["inspect"]>[0]) => ({
    key: createSpeechCacheKey(input),
    status: input.text.includes("Three") ? "hit" as const : "miss" as const
  }));
  return Object.assign({ inspect } as unknown as SpeechCache, { inspectMock: inspect });
}

describe("render plan application service", () => {
  it("matches the public service manifest", () => {
    expect(APPLICATION_SERVICE_MANIFEST.filter((path) => path.startsWith("renderPlans."))).toEqual([
      "renderPlans.create", "renderPlans.list", "renderPlans.get"
    ]);
  });

  it("freezes deterministic ordered entries with transition precedence, exact silence, and cache predictions", async () => {
    const root = await mkdtemp(join(tmpdir(), "studynarrator-application-render-plan-"));
    const current = { project: project() };
    const store = createRenderPlanStore(root);
    const speechCache = cache();
    const service = createRenderPlanService({
      repository: repository(current), cache: speechCache, store,
      createId: () => planId, now: () => new Date(timestamp)
    });
    const plan = await service.create(projectId);
    expect(plan.entries.map((entry) => entry.type === "pause" ? `${entry.type}:${entry.reason}:${String(entry.durationMs)}` : entry.type)).toEqual([
      "section", "speech", "pause:speakerChange:500", "speech", "section", "pause:section:1500", "speech",
      "pause:paragraph:750", "speech", "pause:explicit:1500", "speech", "pause:explicit:350"
    ]);
    expect(plan.summary).toEqual({ sectionCount: 2, speechCount: 5, pauseCount: 5, cacheHits: 1, cacheMisses: 4, silenceDurationMs: 4_600 });
    const longSilences = plan.entries.flatMap((entry) => entry.type === "pause" && entry.durationMs === 1_500 ? [entry.silence?.checksum] : []);
    expect(longSilences).toEqual([longSilences[0], longSilences[0]]);
    const firstSpeech = plan.entries.find((entry) => entry.type === "speech");
    expect(firstSpeech).toMatchObject({ type: "speech", readableText: "SQL one.", ttsText: "sequel one.", chunks: [{ cacheStatus: "miss" }] });
    if (firstSpeech?.type !== "speech") throw new Error("Speech fixture missing.");
    expect(firstSpeech.chunks[0]?.cacheKey).toBe(createSpeechCacheKey({
      adapterId: SPEACHES_CACHE_ADAPTER_ID,
      adapterVersion: SPEACHES_CACHE_ADAPTER_VERSION,
      serverIdentity: profile.baseUrl!, profileId: profile.id, modelId: "model", voiceId: "voice-teacher", speed: 1,
      text: "sequel one.", responseFormat: "wav"
    }));
    expect((speechCache as SpeechCache & { inspectMock: ReturnType<typeof vi.fn> }).inspectMock).toHaveBeenCalledTimes(5);
    expect((await service.list(projectId))[0]).toMatchObject({ id: planId, planHash: plan.planHash });

    current.project = { ...current.project, scriptSource: "Changed after freezing", scriptHash: "c".repeat(64), transitionPauses: { ...current.project.transitionPauses, paragraph: { mode: "none" } } };
    const reopened = await service.get(planId);
    expect(reopened).toEqual(plan);
    expect(reopened.scriptHash).toBe("a".repeat(64));
  });

  it("blocks invalid projects without inspecting cache or writing a plan", async () => {
    const root = await mkdtemp(join(tmpdir(), "studynarrator-invalid-render-plan-"));
    const invalid = project();
    invalid.speakerMappings = invalid.speakerMappings.map((speaker) => ({ ...speaker, voiceId: null }));
    const speechCache = cache();
    const service = createRenderPlanService({ repository: repository({ project: invalid }), cache: speechCache, store: createRenderPlanStore(root), createId: () => planId });
    await expect(service.create(projectId)).rejects.toMatchObject({ code: "RENDER_PLAN_CONFIGURATION" });
    expect((speechCache as SpeechCache & { inspectMock: ReturnType<typeof vi.fn> }).inspectMock).not.toHaveBeenCalled();
    await expect(service.list(projectId)).resolves.toEqual([]);
  });

  it("supports disabled and zero-duration automatic transitions without leading or trailing silence", async () => {
    const base = project();
    base.scriptSource = "[section: Start]\n[speaker_teacher] One.\n\n[speaker_teacher] Two.";
    base.transitionPauses = { paragraph: { mode: "duration", durationMs: 0 }, speakerChange: { mode: "none" }, section: { mode: "none" } };
    const firstRoot = await mkdtemp(join(tmpdir(), "studynarrator-zero-render-plan-"));
    const first = createRenderPlanService({ repository: repository({ project: base }), cache: cache(), store: createRenderPlanStore(firstRoot), createId: () => planId });
    const zeroPlan = await first.create(projectId);
    expect(zeroPlan.entries.filter((entry) => entry.type === "pause")).toEqual([
      expect.objectContaining({ reason: "paragraph", durationMs: 0, silence: null })
    ]);

    const disabled = { ...base, transitionPauses: { paragraph: { mode: "none" as const }, speakerChange: { mode: "none" as const }, section: { mode: "none" as const } } };
    const secondRoot = await mkdtemp(join(tmpdir(), "studynarrator-disabled-render-plan-"));
    const second = createRenderPlanService({ repository: repository({ project: disabled }), cache: cache(), store: createRenderPlanStore(secondRoot), createId: () => planId });
    expect((await second.create(projectId)).entries.some((entry) => entry.type === "pause")).toBe(false);
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
      "[section: Trailing]"
    ].join("\n");
    const root = await mkdtemp(join(tmpdir(), "studynarrator-explicit-render-plan-"));
    const service = createRenderPlanService({ repository: repository({ project: base }), cache: cache(), store: createRenderPlanStore(root), createId: () => planId });
    const plan = await service.create(projectId);
    expect(plan.entries.map((entry) => entry.type === "pause" ? `${entry.pauseKind}:${entry.reason}` : entry.type)).toEqual([
      "speech", "section", "section", "explicit:explicit", "speech", "section"
    ]);
    expect(plan.entries.filter((entry) => entry.type === "pause" && entry.pauseKind === "automatic")).toEqual([]);
  });
});
