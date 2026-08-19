import { describe, expect, it, vi } from "vitest";
import { createRestClient, resolveSystemClient } from "./systemClient.js";

describe("system clients", () => {
  it("prefers the narrow preload bridge", () => {
    const system = { diagnostics: vi.fn() };
    expect(resolveSystemClient({ studyNarrator: { system } } as never)).toBe(
      system,
    );
  });

  it("validates REST boundary failures", async () => {
    const fetchInput = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            error: {
              code: "DIAGNOSTICS_BOUNDARY_ERROR",
              message: "Validated failure.",
            },
          }),
          { status: 500, headers: { "content-type": "application/json" } },
        ),
    );
    await expect(
      createRestClient(fetchInput as never).diagnostics(),
    ).rejects.toThrow("Validated failure.");
  });
});
