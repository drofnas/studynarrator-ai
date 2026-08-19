import { describe, expect, it, vi } from "vitest";
import { SpeachesSynthesisError } from "@studynarrator/speaches-adapter";
import type { SpeechCache } from "@studynarrator/rendering";
import { DEFAULT_GLOBAL_NAMED_SENSE_LEXICON } from "@studynarrator/shared-types";
import {
  createScratchpadService,
  type ScratchpadRepository,
} from "./scratchpad.js";
import { APPLICATION_SERVICE_MANIFEST } from "./serviceManifest.js";

const timestamp = "2026-08-12T12:00:00.000Z";
const connection = {
  baseUrl: "http://127.0.0.1:8000",
  suppliedUrlForm: "root" as const,
  configured: true,
  defaultModelId: "model",
  defaultVoiceId: "voice",
  timeoutSeconds: 12,
  retryCount: 2,
  responseFormat: "wav" as const,
  lastTestedAt: null,
  lastSuccessfulTestAt: null,
  lastTestSummary: null,
  createdAt: timestamp,
  updatedAt: timestamp,
};
const namedSenseDefaults = DEFAULT_GLOBAL_NAMED_SENSE_LEXICON.map((entry) => ({
  ...entry,
  createdAt: timestamp,
  updatedAt: timestamp,
}));

function repository(): ScratchpadRepository {
  return {
    getSpeachesConnection: vi.fn(() => connection),
    listGlobalLexicon: vi.fn(() => [
      {
        id: "sql",
        scope: "global" as const,
        entryType: "exactTerm" as const,
        displayText: "SQL",
        spokenText: "sequel",
        caseSensitive: true,
        wholeWord: true,
        priority: 0,
        enabled: true,
        notes: "",
        createdAt: timestamp,
        updatedAt: timestamp,
      },
      ...namedSenseDefaults,
    ]),
    replaceSpeachesConnection: vi.fn(),
    recordConnectionTest: vi.fn(),
    getConnectionSetup: vi.fn(),
    completeConnectionOnboarding: vi.fn(),
    getVoiceCatalogOverrides: vi.fn(() => ({
      schemaVersion: 1,
      modelId: "model",
      entries: [
        {
          voiceId: "voice",
          label: "Friendly Voice",
          enabled: true,
          favorite: false,
          language: null,
          locale: null,
          accent: null,
          category: null,
          style: null,
          sampleText: null,
        },
      ],
    })),
    replaceVoiceCatalogOverrides: vi.fn(),
  } as unknown as ScratchpadRepository;
}

function speechCache() {
  const retainScratchpad = vi.fn(async () => ({
    entriesRemoved: 0,
    bytesFreed: 0,
  }));
  const cache: SpeechCache = {
    async getOrCreate(input, _usage, synthesize, signal) {
      const bytes = await synthesize(
        input.text,
        signal ?? new AbortController().signal,
      );
      return {
        key: "a".repeat(64),
        status: "miss",
        bytes,
        metadata: {
          schemaVersion: 1,
          normalizationVersion: 1,
          chunkingVersion: 1,
          adapterId: input.adapterId,
          adapterVersion: input.adapterVersion,
          serverIdentityHash: "b".repeat(64),
          modelId: input.modelId,
          voiceId: input.voiceId,
          speed: input.speed,
          textHash: "c".repeat(64),
          responseFormat: "wav",
          key: "a".repeat(64),
          audioChecksum: "d".repeat(64),
          byteLength: bytes.byteLength,
          createdAt: timestamp,
          lastUsedAt: timestamp,
          projectIds: [],
          scratchpadUsed: true,
        },
      };
    },
    async inspect() {
      return { key: "a".repeat(64), status: "miss" as const };
    },
    async status() {
      return {
        entryCount: 0,
        totalBytes: 0,
        lastUsedAt: null,
        sessionHits: 0,
        sessionMisses: 0,
        sessionWrites: 0,
        sessionCorruptMisses: 0,
        inFlight: 0,
      };
    },
    async clearAll() {
      return { entriesRemoved: 0, bytesFreed: 0 };
    },
    async clearProject() {
      return { entriesRemoved: 0, bytesFreed: 0 };
    },
    async clearEntry() {
      return { entriesRemoved: 0, bytesFreed: 0 };
    },
    retainScratchpad,
  };
  return { cache, retainScratchpad };
}

describe("scratchpad service", () => {
  it("matches the public application-service manifest", () => {
    const service = createScratchpadService({
      repository: repository(),
      cache: speechCache().cache,
    });
    expect(Object.keys(service).map((key) => `scratchpad.${key}`)).toEqual(
      APPLICATION_SERVICE_MANIFEST.filter((path) =>
        path.startsWith("scratchpad."),
      ),
    );
  });

  it("reads privileged configuration, transforms text, and creates a portable validated result", async () => {
    const store = repository();
    const synthesize = vi.fn(async () => ({
      bytes: new Uint8Array([1, 2, 3]),
      mimeType: "audio/wav" as const,
      attempts: 1,
    }));
    const { cache, retainScratchpad } = speechCache();
    const service = createScratchpadService({
      repository: store,
      cache,
      synthesize,
      createId: () => "00000000-0000-4000-8000-000000000001",
      now: () => new Date(timestamp),
    });
    const result = await service.preview({
      modelId: "model",
      voiceId: "voice",
      speed: 1.1,
      text: "SQL indexes.",
      applyGlobalLexicon: true,
    });
    expect(synthesize).toHaveBeenCalledWith(
      expect.objectContaining({
        baseUrl: connection.baseUrl,
        modelId: "model",
        voiceId: "voice",
        speed: 1.1,
        text: "sequel indexes.",
        timeoutSeconds: 12,
        retryCount: 2,
      }),
    );
    expect(result).toMatchObject({
      schemaVersion: 1,
      originalText: "SQL indexes.",
      transformedText: "sequel indexes.",
      voiceLabel: "Friendly Voice",
      cache: { status: "miss" },
      audio: { base64: "AQID", byteLength: 3 },
    });
    expect(retainScratchpad).toHaveBeenCalledWith("a".repeat(64));
    expect(JSON.stringify(result)).not.toContain("test-secret-must-not-appear");
    expect(
      (store.recordConnectionTest as ReturnType<typeof vi.fn>).mock.calls,
    ).toHaveLength(0);
  });

  it("applies built-in named senses and keeps disabled or deleted senses literal", async () => {
    const source = "{{resume|cv}}, {{lead|metal}}, and {{axes|tools}}.";
    const synthesize = vi.fn(async () => ({
      bytes: new Uint8Array([1]),
      mimeType: "audio/wav" as const,
      attempts: 1,
    }));
    const enabled = createScratchpadService({
      repository: repository(),
      cache: speechCache().cache,
      synthesize,
    });
    await expect(
      enabled.preview({
        modelId: "model",
        voiceId: "voice",
        speed: 1,
        text: source,
        applyGlobalLexicon: true,
      }),
    ).resolves.toMatchObject({
      readableText: "resume, lead, and axes.",
      transformedText: "rez oo may, led, and ak siz.",
      warnings: [],
    });

    const disabledRepository = repository();
    (
      disabledRepository.listGlobalLexicon as ReturnType<typeof vi.fn>
    ).mockReturnValue([{ ...namedSenseDefaults[0]!, enabled: false }]);
    const disabled = createScratchpadService({
      repository: disabledRepository,
      cache: speechCache().cache,
      synthesize,
    });
    await expect(
      disabled.preview({
        modelId: "model",
        voiceId: "voice",
        speed: 1,
        text: "Review {{resume|cv}}.",
        applyGlobalLexicon: true,
      }),
    ).resolves.toMatchObject({
      transformedText: "Review {{resume|cv}}.",
      warnings: [expect.objectContaining({ code: "UNRESOLVED_NAMED_SENSE" })],
    });

    const deleted = createScratchpadService({
      repository: { ...repository(), listGlobalLexicon: vi.fn(() => []) },
      cache: speechCache().cache,
      synthesize,
    });
    await expect(
      deleted.preview({
        modelId: "model",
        voiceId: "voice",
        speed: 1,
        text: "Review {{resume|cv}}.",
        applyGlobalLexicon: true,
      }),
    ).resolves.toMatchObject({
      transformedText: "Review {{resume|cv}}.",
      warnings: [expect.objectContaining({ code: "UNRESOLVED_NAMED_SENSE" })],
    });
  });

  it("maps adapter failures to stable sanitized application errors and creates no result", async () => {
    const service = createScratchpadService({
      repository: repository(),
      cache: speechCache().cache,
      synthesize: vi.fn(async () => {
        throw new SpeachesSynthesisError(
          "selectionRejected",
          "upstream-private-body",
          false,
          422,
        );
      }),
      createId: vi.fn(() => "00000000-0000-4000-8000-000000000001"),
    });
    try {
      await service.preview({
        modelId: "bad",
        voiceId: "bad",
        speed: 1,
        text: "Keep me.",
        applyGlobalLexicon: false,
      });
      throw new Error("Expected synthesis to fail.");
    } catch (error) {
      expect(error).toMatchObject({ code: "SCRATCHPAD_SELECTION_REJECTED" });
      expect(error instanceof Error ? error.message : "").not.toContain(
        "upstream-private-body",
      );
    }
  });

  it("turns an oversized WAV into actionable, sanitized guidance", async () => {
    const service = createScratchpadService({
      repository: repository(),
      cache: speechCache().cache,
      synthesize: vi.fn(async () => {
        throw new SpeachesSynthesisError(
          "audioTooLarge",
          "upstream-private-body",
          false,
          200,
        );
      }),
    });
    await expect(
      service.preview({
        modelId: "model",
        voiceId: "voice",
        speed: 1,
        text: "Keep me.",
        applyGlobalLexicon: false,
      }),
    ).rejects.toMatchObject({
      code: "SCRATCHPAD_INVALID_AUDIO",
      message:
        "The generated WAV exceeded the 5 MiB Scratchpad limit. Shorten the passage and retry.",
    });
  });

  it("passes cancellation through and never calls synthesis for invalid control text", async () => {
    const synthesize = vi.fn();
    const service = createScratchpadService({
      repository: repository(),
      cache: speechCache().cache,
      synthesize,
    });
    await expect(
      service.preview({
        modelId: "model",
        voiceId: "voice",
        speed: 1,
        text: "[pause_short]",
        applyGlobalLexicon: false,
      }),
    ).rejects.toMatchObject({ code: "SCRATCHPAD_CONFIGURATION" });
    expect(synthesize).not.toHaveBeenCalled();
  });
});
