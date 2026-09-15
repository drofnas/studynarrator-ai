import { RenderIdSchema } from "@studynarrator/shared-types";

const key = "studynarrator.viewed-renders.v1";

export function readViewedRenders(): Set<string> {
  try {
    const parsed = RenderIdSchema.array().safeParse(
      JSON.parse(window.localStorage.getItem(key) ?? "[]") as unknown,
    );
    return new Set(parsed.success ? parsed.data : []);
  } catch {
    return new Set();
  }
}

export function storeViewedRenders(ids: Set<string>): void {
  try {
    window.localStorage.setItem(key, JSON.stringify([...ids]));
  } catch {
    // The current session still works when browser storage is unavailable.
  }
}
