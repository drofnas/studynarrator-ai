import {
  BoundaryErrorSchema,
  RenderPlanSchema,
  RenderPlanSummaryCollectionSchema,
  type RenderPlanClient,
  type StudyNarratorBridge
} from "@studynarrator/shared-types";

declare global {
  interface Window {
    studyNarrator?: StudyNarratorBridge;
  }
}

export class RenderPlanClientError extends Error {
  constructor(readonly code: string, message: string) { super(message); }
}

async function read<T>(response: Response, parse: (input: unknown) => T): Promise<T> {
  const body = await response.json() as unknown;
  if (!response.ok) {
    const failure = BoundaryErrorSchema.safeParse(body);
    throw new RenderPlanClientError(
      failure.success ? failure.data.error.code : "RENDER_PLAN_BOUNDARY_ERROR",
      failure.success ? failure.data.error.message : "StudyNarrator could not complete the render plan operation."
    );
  }
  return parse(body);
}

export function createRestRenderPlanClient(fetchInput: typeof fetch = fetch): RenderPlanClient {
  return {
    async create(projectId) {
      const response = await fetchInput(`/api/projects/${encodeURIComponent(projectId)}/render-plans`, { method: "POST" });
      return await read(response, (body) => RenderPlanSchema.parse(body));
    },
    async list(projectId) {
      const response = await fetchInput(`/api/projects/${encodeURIComponent(projectId)}/render-plans`);
      return await read(response, (body) => RenderPlanSummaryCollectionSchema.parse(body));
    },
    async get(planId) {
      const response = await fetchInput(`/api/render-plans/${encodeURIComponent(planId)}`);
      return await read(response, (body) => RenderPlanSchema.parse(body));
    }
  };
}

export function resolveRenderPlanClient(browserWindow: Window = window): RenderPlanClient {
  return browserWindow.studyNarrator?.renderPlans ?? createRestRenderPlanClient();
}
