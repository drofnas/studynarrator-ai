import { config } from "zod/v4/core";
import { expect, it, vi } from "vitest";

it("initializes both workspace schema sets without probing dynamic code execution", async () => {
  vi.resetModules();
  const previous = config().jitless;
  config({ jitless: false });
  const generateCode = vi
    .spyOn(globalThis, "Function")
    .mockImplementation(() => {
      throw new Error("csp-sentinel-eval-probe");
    });
  try {
    await import("./validation.js");
    const { HealthSchema } = await import("@studynarrator/shared-types");
    const { ParseScriptInputSchema } = await import("@studynarrator/core");
    expect(
      HealthSchema.parse({ status: "ok", applicationVersion: "0.1.0" }),
    ).toEqual({
      status: "ok",
      applicationVersion: "0.1.0",
    });
    expect(ParseScriptInputSchema.parse({ source: "Hello." })).toEqual({
      source: "Hello.",
    });
    expect(HealthSchema.safeParse({ status: "invalid" }).success).toBe(false);
    expect(ParseScriptInputSchema.safeParse({ source: 42 }).success).toBe(
      false,
    );
    expect(generateCode).not.toHaveBeenCalled();
  } finally {
    generateCode.mockRestore();
    config({ jitless: previous ?? false });
  }
});
