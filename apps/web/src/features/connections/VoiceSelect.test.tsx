// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import type { VoiceCatalogEntry } from "@studynarrator/shared-types";
import { presentVoices } from "./voicePresentation.js";
import { VoiceSelect } from "./VoiceSelect.js";

const entries: VoiceCatalogEntry[] = [
  {
    voiceId: "voice-favorite",
    label: "Favorite Voice",
    enabled: true,
    favorite: true,
    language: "English",
    locale: "en-GB",
    accent: null,
    category: null,
    style: null,
    sampleText: null,
  },
  {
    voiceId: "voice-us",
    label: "US Voice",
    enabled: true,
    favorite: false,
    language: "English",
    locale: "en-US",
    accent: null,
    category: null,
    style: null,
    sampleText: null,
  },
  {
    voiceId: "voice-gb",
    label: "British Voice",
    enabled: true,
    favorite: false,
    language: "English",
    locale: "en-GB",
    accent: null,
    category: null,
    style: null,
    sampleText: null,
  },
  {
    voiceId: "voice-unknown",
    label: "Unknown Voice",
    enabled: true,
    favorite: false,
    language: null,
    locale: null,
    accent: null,
    category: null,
    style: null,
    sampleText: null,
  },
];
const voices = presentVoices([], entries);

describe("VoiceSelect", () => {
  it("groups and formats normalized voices consistently while remaining controlled", async () => {
    function Harness() {
      const [value, setValue] = useState("voice-us");
      return (
        <label htmlFor="voice">
          Voice
          <VoiceSelect
            id="voice"
            value={value}
            voices={voices}
            onChange={setValue}
            emptyOption="Choose a voice"
          />
        </label>
      );
    }
    render(<Harness />);

    const select = screen.getByLabelText("Voice");
    expect(
      [...select.querySelectorAll("optgroup")].map(({ label }) => label),
    ).toEqual(["Favorites", "en-US", "en-GB", "Locale unavailable"]);
    expect(
      screen.getByRole("option", {
        name: "Favorite Voice (voice-favorite | en-GB)",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("option", {
        name: "Unknown Voice (voice-unknown | Locale unavailable)",
      }),
    ).toBeInTheDocument();
    await userEvent.selectOptions(select, "voice-gb");
    expect(select).toHaveValue("voice-gb");
  });

  it("supports disabled loading and empty states", () => {
    render(
      <VoiceSelect
        aria-label="Voice"
        value=""
        voices={[]}
        disabled
        emptyOption="Loading supported voices…"
        onChange={() => undefined}
      />,
    );
    expect(screen.getByLabelText("Voice")).toBeDisabled();
    expect(
      screen.getByRole("option", { name: "Loading supported voices…" }),
    ).toHaveValue("");
  });
});
