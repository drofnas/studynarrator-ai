import { describe, expect, it } from "vitest";
import { queryKeys } from "./queryKeys.js";

describe("queryKeys", () => {
  it("uses resource roots before operations and identifying inputs", () => {
    expect(queryKeys.persistence.all).toEqual(["persistence"]);
    expect(queryKeys.persistence.projects()).toEqual([
      "persistence",
      "projects",
    ]);
    expect(
      queryKeys.persistence.project("0f5dd719-e4cd-4c89-b6db-9c469750c951"),
    ).toEqual([
      "persistence",
      "projects",
      "0f5dd719-e4cd-4c89-b6db-9c469750c951",
    ]);
    expect(queryKeys.connection.voiceCatalog("model-1")).toEqual([
      "connection",
      "voice-catalog",
      "model-1",
    ]);
  });
});
