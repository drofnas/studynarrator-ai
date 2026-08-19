import { describe, expect, it } from "vitest";
import {
  KOKORO_V1_MODEL_ID,
  KOKORO_V1_VOICE_CATALOG,
  KOKORO_VOICE_CATALOG_ATTRIBUTION,
  KOKORO_VOICE_CATALOG_SOURCE,
} from "./kokoroCatalog.js";

describe("bundled Kokoro v1.0 catalog", () => {
  it("contains the complete upstream identifier set with neutral labels", () => {
    expect(KOKORO_V1_VOICE_CATALOG.modelId).toBe(KOKORO_V1_MODEL_ID);
    expect(KOKORO_V1_VOICE_CATALOG.entries).toHaveLength(54);
    expect(
      KOKORO_V1_VOICE_CATALOG.entries.find(
        ({ voiceId }) => voiceId === "af_heart",
      )?.label,
    ).toBe("Heart — American English — af_heart");
    expect(
      KOKORO_V1_VOICE_CATALOG.entries.some(({ label }) =>
        /best|quality|grade/iu.test(label),
      ),
    ).toBe(false);
  });

  it("records the upstream source and Apache attribution", () => {
    expect(KOKORO_VOICE_CATALOG_SOURCE).toContain("hexgrad/Kokoro-82M");
    expect(KOKORO_VOICE_CATALOG_ATTRIBUTION).toContain("Apache-2.0");
  });
});
