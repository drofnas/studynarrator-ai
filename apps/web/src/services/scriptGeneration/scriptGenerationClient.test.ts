// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { createRestScriptGenerationClient } from "./scriptGenerationClient.js";

const projectId = "00000000-0000-4000-8000-000000000001";

afterEach(() => vi.restoreAllMocks());

describe("REST script generation client", () => {
  it("previews a validated prompt without a project", async () => {
    const document = {
      kind: "creation" as const,
      fileName: "prompt.md",
      mimeType: "text/markdown; charset=utf-8" as const,
      content: "Prompt",
      checksum: "a".repeat(64),
    };
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify(document), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    await expect(
      createRestScriptGenerationClient(fetchMock).previewPrompt(
        null,
        "creation",
      ),
    ).resolves.toEqual(document);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/script-generation/prompt-preview",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ kind: "creation" }),
      }),
    );
  });

  it("downloads prompt and skill exports with server filenames", async () => {
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:generated");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => undefined);
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL) =>
        new Response(new Uint8Array([1, 2, 3]), {
          status: 200,
          headers: {
            "content-disposition": `attachment; filename="${(typeof input === "string" ? input : input instanceof URL ? input.href : input.url).includes("skill") ? "skill.zip" : "prompt.md"}"`,
          },
        }),
    );
    const client = createRestScriptGenerationClient(fetchMock);
    await expect(
      client.exportPrompt(null, "update", "Edited prompt"),
    ).resolves.toEqual({ disposition: "download", fileName: "prompt.md" });
    await expect(client.exportSkillPackage(null)).resolves.toEqual({
      disposition: "download",
      fileName: "skill.zip",
    });
    expect(click).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/script-generation/prompt-export",
      expect.objectContaining({
        body: JSON.stringify({ kind: "update", content: "Edited prompt" }),
      }),
    );
  });

  it("keeps generated prompt export compatible when no content override is supplied", async () => {
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:generated");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(
      () => undefined,
    );
    const fetchMock = vi.fn(
      async () => new Response(new Uint8Array([1]), { status: 200 }),
    );
    await createRestScriptGenerationClient(fetchMock).exportPrompt(
      null,
      "creation",
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/script-generation/prompt-export",
      expect.objectContaining({ body: JSON.stringify({ kind: "creation" }) }),
    );
  });

  it("retains project-scoped endpoints for compatible deep links", async () => {
    const document = {
      kind: "creation" as const,
      fileName: "prompt.md",
      mimeType: "text/markdown; charset=utf-8" as const,
      content: "Prompt",
      checksum: "a".repeat(64),
    };
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify(document), { status: 200 }),
    );
    await createRestScriptGenerationClient(fetchMock).previewPrompt(
      projectId,
      "creation",
    );
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/projects/${projectId}/prompt-preview`,
      expect.any(Object),
    );
  });

  it("surfaces sanitized boundary errors", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            error: { code: "VALIDATION_ERROR", message: "Fix the brief." },
          }),
          { status: 400 },
        ),
    );
    await expect(
      createRestScriptGenerationClient(fetchMock).previewPrompt(
        projectId,
        "creation",
      ),
    ).rejects.toThrow("Fix the brief.");
  });
});
