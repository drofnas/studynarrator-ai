import { describe, expect, it, vi } from "vitest";
import type { RenderPlan, RenderPlanClient, StudyNarratorBridge } from "@studynarrator/shared-types";
import { createRestRenderPlanClient, RenderPlanClientError, resolveRenderPlanClient } from "./renderPlanClient.js";

const projectId = "00000000-0000-4000-8000-000000000001";
const plan: RenderPlan = {
  schemaVersion: 1,
  id: "00000000-0000-4000-8000-000000000002",
  projectId,
  createdAt: "2026-08-13T12:00:00.000Z",
  snapshotHash: "a".repeat(64),
  planHash: "b".repeat(64),
  scriptHash: "c".repeat(64),
  entries: [],
  summary: { sectionCount: 0, speechCount: 0, pauseCount: 0, cacheHits: 0, cacheMisses: 0, silenceDurationMs: 0 }
};
const summary = {
  id: plan.id, projectId: plan.projectId, createdAt: plan.createdAt, snapshotHash: plan.snapshotHash,
  planHash: plan.planHash, scriptHash: plan.scriptHash, summary: plan.summary
};

describe("render plan web client", () => {
  it("uses the versioned REST routes and validates responses", async () => {
    const fetchInput = vi.fn(async (url: string, init?: RequestInit) => new Response(
      JSON.stringify(url.endsWith("render-plans") && init?.method !== "POST" ? [summary] : plan),
      { status: init?.method === "POST" ? 201 : 200, headers: { "content-type": "application/json" } }
    ));
    const client = createRestRenderPlanClient(fetchInput as unknown as typeof fetch);
    await expect(client.create(projectId)).resolves.toEqual(plan);
    await expect(client.list(projectId)).resolves.toEqual([summary]);
    await expect(client.get(plan.id)).resolves.toEqual(plan);
    expect(fetchInput.mock.calls.map(([url, init]) => [url, init?.method ?? "GET"])).toEqual([
      [`/api/projects/${projectId}/render-plans`, "POST"],
      [`/api/projects/${projectId}/render-plans`, "GET"],
      [`/api/render-plans/${plan.id}`, "GET"]
    ]);
  });

  it("surfaces sanitized REST failures", async () => {
    const client = createRestRenderPlanClient(async () => new Response(JSON.stringify({
      error: { code: "RENDER_PLAN_CONFIGURATION", message: "Configure the Speaches connection." }
    }), { status: 409, headers: { "content-type": "application/json" } }));
    await expect(client.create(projectId)).rejects.toEqual(new RenderPlanClientError("RENDER_PLAN_CONFIGURATION", "Configure the Speaches connection."));
  });

  it("prefers the validated Electron bridge", () => {
    const renderPlans = { create: vi.fn(), list: vi.fn(), get: vi.fn() } as unknown as RenderPlanClient;
    const browser = { studyNarrator: { renderPlans } as StudyNarratorBridge } as Window;
    expect(resolveRenderPlanClient(browser)).toBe(renderPlans);
  });
});
