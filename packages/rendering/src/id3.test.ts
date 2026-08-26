import { afterEach, describe, expect, it, vi } from "vitest";
import { writeFinalMp3Metadata } from "./id3.js";

const updateId3 = vi.hoisted(() => vi.fn());

vi.mock("node-id3", () => ({
  default: { update: updateId3 },
}));

describe("final MP3 metadata", () => {
  afterEach(() => {
    updateId3.mockReset();
  });

  it("sanitizes returned ID3 write failures", () => {
    // Arrange
    const privateFailure =
      "Private output path: /users/example/private-project.mp3";
    updateId3.mockReturnValue(new Error(privateFailure));

    // Act
    let thrown: unknown;
    try {
      writeFinalMp3Metadata({
        path: "/users/example/private-project.mp3",
        title: "Private project title",
        year: 2026,
      });
    } catch (error) {
      thrown = error;
    }

    // Assert
    expect(thrown).toEqual(
      new Error("Final MP3 metadata could not be written."),
    );
    expect(String(thrown)).not.toContain(privateFailure);
  });

  it("sanitizes thrown ID3 write failures", () => {
    // Arrange
    const privateFailure =
      "Private output path: /users/example/private-project.mp3";
    updateId3.mockImplementation(() => {
      throw new Error(privateFailure);
    });

    // Act
    let thrown: unknown;
    try {
      writeFinalMp3Metadata({
        path: "/users/example/private-project.mp3",
        title: "Private project title",
        year: 2026,
      });
    } catch (error) {
      thrown = error;
    }

    // Assert
    expect(thrown).toEqual(
      new Error("Final MP3 metadata could not be written."),
    );
    expect(String(thrown)).not.toContain(privateFailure);
  });
});
