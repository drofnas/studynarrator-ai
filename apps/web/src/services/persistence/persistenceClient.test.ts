import { describe, expect, it, vi } from "vitest";
import { createRestPersistenceClient, PersistenceClientError, resolvePersistenceClient } from "./persistenceClient.js";

describe("persistence client", () => {
  it("prefers the narrow Electron persistence bridge", () => {
    const persistence = { status: vi.fn() };
    expect(resolvePersistenceClient({ studyNarrator: { persistence } } as never)).toBe(persistence);
  });

  it("sends encoded REST requests and validates successful responses", async () => {
    const fetchInput = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify([]), { status: 200, headers: { "content-type": "application/json" } }));
    await expect(createRestPersistenceClient(fetchInput).projects.list()).resolves.toEqual([]);
    expect(fetchInput.mock.calls[0]?.[0]).toBe("/api/projects");
    expect(new Headers(fetchInput.mock.calls[0]?.[1]?.headers).get("accept")).toBe("application/json");
  });

  it("surfaces safe path-specific boundary issues", async () => {
    const fetchInput = vi.fn(async () => new Response(JSON.stringify({
      error: { code: "VALIDATION_ERROR", message: "Invalid project.", issues: [{ path: "$.name", message: "Required" }] }
    }), { status: 400, headers: { "content-type": "application/json" } }));
    try {
      await createRestPersistenceClient(fetchInput as never).projects.create({ name: "" });
      throw new Error("Expected the request to fail.");
    } catch (error) {
      expect(error).toBeInstanceOf(PersistenceClientError);
      expect(error).toMatchObject({ code: "VALIDATION_ERROR", status: 400, issues: [{ path: "$.name" }] });
    }
  });

  it("does not expose malformed server error bodies", async () => {
    const fetchInput = vi.fn(async () => new Response(JSON.stringify({ error: "SQLITE private detail" }), { status: 500 }));
    await expect(createRestPersistenceClient(fetchInput as never).status()).rejects.toThrow("invalid response");
  });
});
