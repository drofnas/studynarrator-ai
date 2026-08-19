import {
  BoundaryErrorSchema,
  FileExportResultSchema,
  PromptDocumentSchema,
  ProjectIdSchema,
  ScriptPromptKindSchema,
  type ScriptGenerationClient,
  type StudyNarratorBridge,
} from "@studynarrator/shared-types";

declare global {
  interface Window {
    studyNarrator?: StudyNarratorBridge;
  }
}

async function failure(response: Response): Promise<Error> {
  let body: unknown;
  try {
    body = (await response.json()) as unknown;
  } catch {
    body = null;
  }
  const parsed = BoundaryErrorSchema.safeParse(body);
  return new Error(
    parsed.success
      ? parsed.data.error.message
      : "StudyNarrator could not complete the script generation operation.",
  );
}

function responseFileName(response: Response, fallback: string): string {
  return (
    /filename="([^"]+)"/u.exec(
      response.headers.get("content-disposition") ?? "",
    )?.[1] ?? fallback
  );
}

async function download(response: Response, fallback: string) {
  if (!response.ok) throw await failure(response);
  const blobUrl = URL.createObjectURL(await response.blob());
  const fileName = responseFileName(response, fallback);
  const anchor = document.createElement("a");
  anchor.href = blobUrl;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(blobUrl);
  return FileExportResultSchema.parse({ disposition: "download", fileName });
}

function endpointRoot(projectIdInput: string | null): string {
  if (projectIdInput === null) return "/api/script-generation";
  const projectId = ProjectIdSchema.parse(projectIdInput);
  return `/api/projects/${encodeURIComponent(projectId)}`;
}

export function createRestScriptGenerationClient(
  fetchInput: typeof fetch = fetch,
): ScriptGenerationClient {
  return {
    async previewPrompt(projectIdInput, kindInput) {
      const kind = ScriptPromptKindSchema.parse(kindInput);
      const response = await fetchInput(
        `${endpointRoot(projectIdInput)}/prompt-preview`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ kind }),
        },
      );
      if (!response.ok) throw await failure(response);
      return PromptDocumentSchema.parse((await response.json()) as unknown);
    },
    async exportPrompt(projectIdInput, kindInput, content) {
      const kind = ScriptPromptKindSchema.parse(kindInput);
      return await download(
        await fetchInput(`${endpointRoot(projectIdInput)}/prompt-export`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            kind,
            ...(content === undefined ? {} : { content }),
          }),
        }),
        "study-narrator-prompt.md",
      );
    },
    async exportSkillPackage(projectIdInput) {
      return await download(
        await fetchInput(`${endpointRoot(projectIdInput)}/skill-export`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({}),
        }),
        "study-narrator-script-skill.zip",
      );
    },
  };
}

export function resolveScriptGenerationClient(
  browserWindow: Window = window,
): ScriptGenerationClient {
  return (
    browserWindow.studyNarrator?.scriptGeneration ??
    createRestScriptGenerationClient()
  );
}
