// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  GlobalLexiconReplaceInput,
  PersistenceClient,
} from "@studynarrator/shared-types";
import { LexiconSettingsPage } from "./LexiconSettingsPage.js";
import { timestamp } from "./settingsTestFixtures.js";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("Lexicon settings", () => {
  it("adds named-sense aliases and autosaves alias text, pronunciation, enablement, and deletion", async () => {
    let stored = [
      {
        id: "global-sql",
        scope: "global",
        entryType: "exactTerm",
        displayText: "SQL",
        spokenText: "S Q L",
        caseSensitive: false,
        wholeWord: true,
        priority: 0,
        enabled: true,
        notes: "",
        createdAt: timestamp,
        updatedAt: timestamp,
      },
    ];
    const replace = vi.fn(async (entries: Array<Record<string, unknown>>) => {
      stored = entries.map((entry, index) => ({
        ...entry,
        id:
          typeof entry.id === "string"
            ? entry.id
            : `global-${String(index + 1)}`,
        scope: "global",
        createdAt: timestamp,
        updatedAt: timestamp,
      })) as typeof stored;
      return structuredClone(stored);
    });
    const client = {
      globalLexicon: {
        list: vi.fn(async () => structuredClone(stored)),
        replace,
      },
    } as unknown as PersistenceClient;
    render(<LexiconSettingsPage client={client} />);

    expect(
      await screen.findByRole("heading", { name: "Global lexicon" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Lexicon" }),
    ).toBeInTheDocument();
    expect(screen.getByText("resume/cv")).toBeInTheDocument();
    expect(screen.getByText("{{resume|cv}}")).toBeInTheDocument();
    expect(screen.queryByText("Type")).not.toBeInTheDocument();
    expect(screen.queryByText("Case sensitive")).not.toBeInTheDocument();

    fireEvent.change(screen.getAllByLabelText("Alias")[0]!, {
      target: { value: "resume/cv" },
    });
    fireEvent.change(screen.getAllByLabelText("Spoken Text")[0]!, {
      target: { value: "rez oo may" },
    });
    await userEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(replace).toHaveBeenLastCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          displayText: "resume",
          senseId: "cv",
          spokenText: "rez oo may",
          entryType: "namedSense",
          caseSensitive: false,
          wholeWord: true,
          priority: 0,
          enabled: true,
          notes: "",
        }),
      ]),
    );

    const aliasRow = await screen.findByRole("article", {
      name: "Lexicon entry resume/cv",
    });
    fireEvent.change(within(aliasRow).getByLabelText("Alias"), {
      target: { value: "resume/profile" },
    });
    await waitFor(
      () =>
        expect(replace).toHaveBeenLastCalledWith(
          expect.arrayContaining([
            expect.objectContaining({
              displayText: "resume",
              senseId: "profile",
              entryType: "namedSense",
            }),
          ]),
        ),
      { timeout: 1_500 },
    );

    fireEvent.change(screen.getByDisplayValue("S Q L"), {
      target: { value: "ess cue ell" },
    });
    expect(screen.queryByText("Saving…")).not.toBeInTheDocument();
    await waitFor(
      () =>
        expect(replace).toHaveBeenLastCalledWith(
          expect.arrayContaining([
            expect.objectContaining({
              id: "global-sql",
              spokenText: "ess cue ell",
            }),
          ]),
        ),
      { timeout: 1_500 },
    );
    expect(screen.queryByText("Saved")).not.toBeInTheDocument();

    await userEvent.click(
      within(aliasRow).getByRole("checkbox", { name: "Enabled" }),
    );
    await waitFor(() =>
      expect(replace).toHaveBeenLastCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            displayText: "resume",
            senseId: "profile",
            enabled: false,
          }),
        ]),
      ),
    );
    await userEvent.click(
      within(aliasRow).getByRole("button", { name: "Delete" }),
    );
    await waitFor(() =>
      expect(
        screen.queryByDisplayValue("resume/profile"),
      ).not.toBeInTheDocument(),
    );
    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(
      await screen.findByText("No matching global lexicon entries."),
    ).toBeInTheDocument();
  });

  it("rejects blank, malformed, and duplicate aliases while preserving failed inline edits", async () => {
    const replace = vi
      .fn()
      .mockRejectedValueOnce(new Error("Storage is unavailable"))
      .mockImplementation(async (entries: GlobalLexiconReplaceInput) =>
        entries.map((entry) => ({
          ...entry,
          id: entry.id ?? "global-new",
          createdAt: timestamp,
          updatedAt: timestamp,
        })),
      );
    const client = {
      globalLexicon: {
        list: vi.fn(async () => [
          {
            id: "global-api",
            scope: "global",
            entryType: "exactTerm",
            displayText: "API",
            spokenText: "A P I",
            caseSensitive: false,
            wholeWord: true,
            priority: 0,
            enabled: true,
            notes: "",
            createdAt: timestamp,
            updatedAt: timestamp,
          },
        ]),
        replace,
      },
    } as unknown as PersistenceClient;
    render(<LexiconSettingsPage client={client} />);
    await screen.findByDisplayValue("A P I");

    await userEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Alias and Spoken Text are required",
    );
    fireEvent.change(screen.getAllByLabelText("Alias")[0]!, {
      target: { value: "resume/cv/extra" },
    });
    fireEvent.change(screen.getAllByLabelText("Spoken Text")[0]!, {
      target: { value: "invalid" },
    });
    await userEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(screen.getByRole("alert")).toHaveTextContent("one term/sense pair");
    fireEvent.change(screen.getAllByLabelText("Alias")[0]!, {
      target: { value: "api" },
    });
    fireEvent.change(screen.getAllByLabelText("Spoken Text")[0]!, {
      target: { value: "duplicate" },
    });
    await userEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(
      screen.getByText("Alias must be unique regardless of capitalization."),
    ).toBeInTheDocument();
    expect(replace).not.toHaveBeenCalled();

    fireEvent.change(screen.getByDisplayValue("A P I"), {
      target: { value: "new pronunciation" },
    });
    fireEvent.blur(screen.getByDisplayValue("new pronunciation"));
    expect(
      await screen.findByText("Not saved — edit or blur to retry"),
    ).toBeInTheDocument();
    expect(screen.getByDisplayValue("new pronunciation")).toBeInTheDocument();
    fireEvent.blur(screen.getByDisplayValue("new pronunciation"));
    await waitFor(() => expect(replace).toHaveBeenCalledTimes(2));
    expect(
      screen.queryByText("Not saved — edit or blur to retry"),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Saved")).not.toBeInTheDocument();
  });
});
