// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
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
import type { ReactNode } from "react";
import type {
  CustomGlobalLexiconReplaceInput,
  PersistenceClient,
} from "@studynarrator/shared-types";
import { LexiconSettingsPage } from "./LexiconSettingsPage.js";
import { timestamp } from "./settingsTestFixtures.js";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function renderPage(children: ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>,
  );
}

type GlobalLexiconState = Awaited<
  ReturnType<PersistenceClient["globalLexicon"]["list"]>
>;

function builtIn(
  overrides: Partial<GlobalLexiconState["builtIns"][number]> = {},
): GlobalLexiconState["builtIns"][number] {
  return {
    id: "global-resume-cv",
    scope: "global",
    entryKind: "builtIn",
    entryType: "namedSense",
    displayText: "resume",
    senseId: "cv",
    spokenText: "rez oo may",
    caseSensitive: false,
    wholeWord: true,
    priority: 0,
    enabled: true,
    notes: "",
    createdAt: timestamp,
    updatedAt: timestamp,
    ...overrides,
  };
}

function custom(
  overrides: Partial<GlobalLexiconState["custom"][number]> = {},
): GlobalLexiconState["custom"][number] {
  return {
    id: "custom-cli",
    scope: "global",
    entryKind: "custom",
    entryType: "exactTerm",
    displayText: "CLI",
    spokenText: "C L I",
    caseSensitive: false,
    wholeWord: true,
    priority: 0,
    enabled: true,
    notes: "",
    createdAt: timestamp,
    updatedAt: timestamp,
    ...overrides,
  };
}

function createClient(initial: GlobalLexiconState) {
  let stored = structuredClone(initial);
  const list = vi.fn(async () => structuredClone(stored));
  const setBuiltInEnabled = vi.fn(
    async (
      input: Parameters<
        PersistenceClient["globalLexicon"]["setBuiltInEnabled"]
      >[0],
    ) => {
      stored = {
        ...stored,
        builtIns: stored.builtIns.map((entry) =>
          entry.id === input.id ? { ...entry, enabled: input.enabled } : entry,
        ),
      };
      return structuredClone(stored);
    },
  );
  const replaceCustom = vi.fn(
    async (entries: CustomGlobalLexiconReplaceInput) => {
      stored = {
        ...stored,
        custom: entries.map((entry, index) => ({
          ...entry,
          id: entry.id ?? `custom-${String(index + 1)}`,
          entryKind: "custom" as const,
          createdAt: timestamp,
          updatedAt: timestamp,
        })),
      } as GlobalLexiconState;
      return structuredClone(stored);
    },
  );
  const reimportBuiltIns = vi.fn(async () => {
    stored = {
      ...stored,
      builtIns: stored.builtIns.map((entry) => ({ ...entry, enabled: true })),
    };
    return structuredClone(stored);
  });
  return {
    client: {
      globalLexicon: {
        list,
        setBuiltInEnabled,
        replaceCustom,
        reimportBuiltIns,
      },
    } as unknown as PersistenceClient,
    list,
    setBuiltInEnabled,
    replaceCustom,
    reimportBuiltIns,
  };
}

function sectionFor(heading: string): HTMLElement {
  const section = screen
    .getByRole("heading", { name: heading })
    .closest("section");
  if (!section) throw new Error(`Section ${heading} was not found.`);
  return section;
}

describe("Lexicon settings", () => {
  it("limits built-ins to enablement while allowing custom CRUD", async () => {
    const { client, setBuiltInEnabled, replaceCustom } = createClient({
      builtIns: [builtIn()],
      custom: [],
    });
    const user = userEvent.setup();
    renderPage(<LexiconSettingsPage client={client} />);

    const customSection = sectionFor("Custom lexicon");
    const globalSection = sectionFor("Global lexicon");
    expect(
      customSection.compareDocumentPosition(globalSection) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    const globalRow = await within(globalSection).findByRole("article", {
      name: "Lexicon entry resume/cv",
    });
    expect(within(globalRow).getByLabelText("Alias")).toBeDisabled();
    expect(within(globalRow).getByLabelText("Spoken Text")).toBeDisabled();
    expect(
      within(globalSection).queryByRole("button", { name: "Add" }),
    ).toBeNull();
    expect(
      within(globalSection).queryByRole("button", { name: "Delete" }),
    ).toBeNull();

    await user.click(
      within(globalRow).getByRole("checkbox", { name: "Enabled" }),
    );
    await waitFor(() =>
      expect(setBuiltInEnabled).toHaveBeenCalledWith({
        id: "global-resume-cv",
        enabled: false,
      }),
    );

    const [alias] = within(customSection).getAllByLabelText("Alias");
    const [spokenText] = within(customSection).getAllByLabelText("Spoken Text");
    fireEvent.change(alias!, { target: { value: "resume/profile" } });
    fireEvent.change(spokenText!, { target: { value: "rez oo may" } });
    await user.click(
      within(customSection).getByRole("button", { name: "Add" }),
    );
    await waitFor(() =>
      expect(replaceCustom).toHaveBeenCalledWith([
        expect.objectContaining({
          entryType: "namedSense",
          displayText: "resume",
          senseId: "profile",
          spokenText: "rez oo may",
        }),
      ]),
    );

    const customRow = await within(customSection).findByRole("article", {
      name: "Lexicon entry resume/profile",
    });
    await user.click(within(customRow).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(replaceCustom).toHaveBeenLastCalledWith([]));
  });

  it("reimports only built-ins and preserves custom entries", async () => {
    const { client, reimportBuiltIns } = createClient({
      builtIns: [builtIn({ enabled: false })],
      custom: [custom()],
    });
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const user = userEvent.setup();
    renderPage(<LexiconSettingsPage client={client} />);

    expect(await screen.findByDisplayValue("C L I")).toBeInTheDocument();
    await user.click(
      screen.getByRole("button", { name: "Reimport global lexicon" }),
    );
    await waitFor(() => expect(reimportBuiltIns).toHaveBeenCalledOnce());
    expect(
      screen.getByText(
        "Global lexicon reimported. Custom entries were preserved.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByDisplayValue("C L I")).toBeInTheDocument();
    expect(
      within(sectionFor("Global lexicon")).getByRole("checkbox", {
        name: "Enabled",
      }),
    ).toBeChecked();
  });

  it("validates custom aliases before saving", async () => {
    const { client, replaceCustom } = createClient({
      builtIns: [builtIn()],
      custom: [],
    });
    const user = userEvent.setup();
    renderPage(<LexiconSettingsPage client={client} />);

    const customSection = sectionFor("Custom lexicon");
    await user.click(
      within(customSection).getByRole("button", { name: "Add" }),
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Alias and Spoken Text are required",
    );

    const [alias] = within(customSection).getAllByLabelText("Alias");
    const [spokenText] = within(customSection).getAllByLabelText("Spoken Text");
    fireEvent.change(alias!, { target: { value: "resume/cv/extra" } });
    fireEvent.change(spokenText!, { target: { value: "invalid" } });
    await user.click(
      within(customSection).getByRole("button", { name: "Add" }),
    );
    expect(screen.getByRole("alert")).toHaveTextContent("one term/sense pair");
    expect(replaceCustom).not.toHaveBeenCalled();
  });
});
