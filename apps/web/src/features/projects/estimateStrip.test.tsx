// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { EstimateStrip } from "./estimateStrip.js";

afterEach(cleanup);

describe("EstimateStrip", () => {
  it("shows all six fields with stable human-readable estimated values", () => {
    render(
      <EstimateStrip
        wordCount={1_234}
        durationMs={3_661_000}
        mp3Bytes={1_024}
        cacheBytes={1_048_576}
        peakDiskBytes={0}
        allVoicesCalibrated={false}
      />,
    );

    const strip = screen.getByRole("group", { name: "Script estimates" });
    expect(strip).toHaveTextContent("Words1,234");
    expect(strip).toHaveTextContent("Estimated duration1h 1m 1s");
    expect(strip).toHaveTextContent("Estimated MP3 size1.0 KiB");
    expect(strip).toHaveTextContent("Estimated cache footprint1.0 MiB");
    expect(strip).toHaveTextContent("Estimated peak disk0 B");
    expect(strip).toHaveTextContent("Free spaceLoading…");
    expect(
      within(strip).getByRole("status", {
        name: "Estimate calibration status",
      }),
    ).toHaveTextContent("default voice timing");
  });

  it("marks calibrated values and degrades missing or invalid values safely", () => {
    render(
      <EstimateStrip
        wordCount={0}
        durationMs={Number.NaN}
        freeSpaceBytes={null}
        allVoicesCalibrated
      />,
    );

    const strip = screen.getByRole("group", { name: "Script estimates" });
    expect(strip).toHaveTextContent("Duration—");
    expect(strip).toHaveTextContent("MP3 size—");
    expect(strip).toHaveTextContent("Cache footprint—");
    expect(strip).toHaveTextContent("Peak disk—");
    expect(strip).toHaveTextContent("Free spaceUnavailable");
    expect(strip).not.toHaveTextContent("Estimated duration");
  });
});
