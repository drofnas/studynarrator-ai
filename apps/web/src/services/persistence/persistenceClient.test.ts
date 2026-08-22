import { describe, expect, it, vi } from "vitest";
import {
  createRestPersistenceClient,
  PersistenceClientError,
  resolvePersistenceClient,
} from "./persistenceClient.js";

describe("persistence client", () => {
  it("prefers the narrow Electron persistence bridge", () => {
    const persistence = { status: vi.fn() };
    expect(
      resolvePersistenceClient({ studyNarrator: { persistence } } as never),
    ).toBe(persistence);
  });

  it("sends encoded REST requests and validates successful responses", async () => {
    const fetchInput = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response(JSON.stringify([]), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    await expect(
      createRestPersistenceClient(fetchInput).projects.list(),
    ).resolves.toEqual([]);
    expect(fetchInput.mock.calls[0]?.[0]).toBe("/api/projects");
    expect(
      new Headers(fetchInput.mock.calls[0]?.[1]?.headers).get("accept"),
    ).toBe("application/json");
  });

  it("uses the narrow duplicate endpoint with an encoded project ID", async () => {
    const fetchInput = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response(JSON.stringify([]), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    await expect(
      createRestPersistenceClient(fetchInput).projects.duplicate(
        "project/one",
        { name: "Copy" },
      ),
    ).rejects.toThrow();
    expect(fetchInput.mock.calls[0]?.[0]).toBe(
      "/api/projects/project%2Fone/duplicate",
    );
    expect(fetchInput.mock.calls[0]?.[1]).toMatchObject({
      method: "POST",
      body: JSON.stringify({ name: "Copy" }),
    });
  });

  it("uses the typed retention maintenance endpoints", async () => {
    const fetchInput = vi.fn(
      async (input: RequestInfo | URL, _init?: RequestInit) => {
        const path =
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.toString()
              : input.url;
        const body =
          path === "/api/settings/retention/usage"
            ? {
                speechCache: { entries: 1, bytes: 2 },
                jobSnapshots: { entries: 3, bytes: 4 },
                renderArtifacts: { entries: 5, bytes: 6 },
              }
            : path === "/api/settings/retention/reclaim-preview"
              ? {
                  reclaimable: {
                    speechCache: { entries: 1, bytes: 2 },
                    jobSnapshots: { entries: 0, bytes: 0 },
                    renderArtifacts: { entries: 0, bytes: 0 },
                  },
                  skipped: false,
                }
              : path === "/api/settings/retention/reclaim"
                ? {
                    reclaimed: {
                      speechCache: { entries: 1, bytes: 2 },
                      jobSnapshots: { entries: 0, bytes: 0 },
                      renderArtifacts: { entries: 0, bytes: 0 },
                    },
                    skipped: false,
                  }
                : {
                    speechCacheTtl: "7d",
                    jobSnapshotTtl: "never",
                    renderArtifactTtl: "never",
                    speechCacheSizeCapBytes: 1024,
                    updatedAt: "2026-08-22T00:00:00.000Z",
                  };
        return new Response(JSON.stringify(body), { status: 200 });
      },
    );
    const client = createRestPersistenceClient(fetchInput as never);
    await client.retention.get();
    await client.retention.update({
      speechCacheTtl: "7d",
      jobSnapshotTtl: "never",
      renderArtifactTtl: "never",
      speechCacheSizeCapBytes: 1024,
    });
    await client.retention.usage();
    await client.retention.previewReclaim();
    await client.retention.reclaim({ confirm: true });
    expect(fetchInput.mock.calls.map(([path]) => path)).toEqual([
      "/api/settings/retention",
      "/api/settings/retention",
      "/api/settings/retention/usage",
      "/api/settings/retention/reclaim-preview",
      "/api/settings/retention/reclaim",
    ]);
    expect(fetchInput.mock.calls[1]?.[1]).toMatchObject({ method: "PUT" });
    expect(fetchInput.mock.calls[4]?.[1]).toMatchObject({
      method: "POST",
      body: JSON.stringify({ confirm: true }),
    });
  });

  it("surfaces safe path-specific boundary issues", async () => {
    const fetchInput = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            error: {
              code: "VALIDATION_ERROR",
              message: "Invalid project.",
              issues: [{ path: "$.name", message: "Required" }],
            },
          }),
          { status: 400, headers: { "content-type": "application/json" } },
        ),
    );
    try {
      await createRestPersistenceClient(fetchInput as never).projects.create({
        name: "",
      });
      throw new Error("Expected the request to fail.");
    } catch (error) {
      expect(error).toBeInstanceOf(PersistenceClientError);
      expect(error).toMatchObject({
        code: "VALIDATION_ERROR",
        status: 400,
        issues: [{ path: "$.name" }],
      });
    }
  });

  it("does not expose malformed server error bodies", async () => {
    const fetchInput = vi.fn(
      async () =>
        new Response(JSON.stringify({ error: "SQLITE private detail" }), {
          status: 500,
        }),
    );
    await expect(
      createRestPersistenceClient(fetchInput as never).status(),
    ).rejects.toThrow("invalid response");
  });
});
