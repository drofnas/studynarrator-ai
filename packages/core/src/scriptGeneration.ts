import { z } from "zod";
import {
  LexiconEntrySchema,
  PauseIdSchema,
  SpeakerIdSchema,
  type LexiconEntry,
} from "./schemas.js";

export const SCRIPT_GENERATION_SCHEMA_VERSION = 1;

export const ScriptPromptKindSchema = z.enum(["creation", "update"]);
export type ScriptPromptKind = z.infer<typeof ScriptPromptKindSchema>;

const ScriptGenerationSpeakerSchema = z
  .object({
    speakerId: SpeakerIdSchema,
    roleDescription: z.string().trim().min(1).max(5_000),
  })
  .strict();

const ScriptGenerationPauseSchema = z
  .object({
    pauseId: PauseIdSchema,
    description: z.string().trim().min(1).max(500),
  })
  .strict();

const ScriptGenerationContextBaseSchema = z
  .object({
    schemaVersion: z.literal(SCRIPT_GENERATION_SCHEMA_VERSION),
    projectName: z.string().trim().min(1).max(200),
    speakers: z.array(ScriptGenerationSpeakerSchema).min(1).max(20),
    pauses: z.array(ScriptGenerationPauseSchema).max(50),
  })
  .strict();
export const ScriptGenerationContextSchema =
  ScriptGenerationContextBaseSchema.superRefine((value, refinement) => {
    const speakerIds = new Set<string>();
    value.speakers.forEach(({ speakerId }, index) => {
      if (speakerIds.has(speakerId))
        refinement.addIssue({
          code: "custom",
          message: `Duplicate speaker ID: ${speakerId}.`,
          path: ["speakers", index],
        });
      speakerIds.add(speakerId);
    });
    const pauseIds = new Set<string>();
    value.pauses.forEach(({ pauseId }, index) => {
      if (pauseIds.has(pauseId))
        refinement.addIssue({
          code: "custom",
          message: `Duplicate pause ID: ${pauseId}.`,
          path: ["pauses", index],
        });
      pauseIds.add(pauseId);
    });
  });
export type ScriptGenerationContext = z.infer<
  typeof ScriptGenerationContextSchema
>;

const ScriptGenerationLexiconSchema = z.array(LexiconEntrySchema).max(20_000);

interface GeneratedTextFile {
  path: string;
  content: string;
}

function oneLine(value: string): string {
  return value.trim().replace(/\s+/gu, " ");
}

function effectiveLexicon(
  entriesInput: readonly LexiconEntry[],
): LexiconEntry[] {
  const entries = ScriptGenerationLexiconSchema.parse(entriesInput).filter(
    ({ enabled }) => enabled,
  );
  const byBehavior = new Map<string, LexiconEntry>();
  for (const entry of [
    ...entries.filter(({ scope }) => scope === "global"),
    ...entries.filter(({ scope }) => scope === "project"),
  ]) {
    byBehavior.set(
      `${entry.entryType}\u0000${entry.displayText}\u0000${entry.senseId ?? ""}`,
      entry,
    );
  }
  return [...byBehavior.values()].sort((left, right) => {
    const type = left.entryType.localeCompare(right.entryType);
    if (type !== 0) return type;
    const display = left.displayText.localeCompare(right.displayText);
    return display !== 0
      ? display
      : (left.senseId ?? "").localeCompare(right.senseId ?? "");
  });
}

function aliasSections(entriesInput: readonly LexiconEntry[]): {
  senses: string[];
  automatic: string[];
} {
  const senses: string[] = [];
  const automatic: string[] = [];
  for (const entry of effectiveLexicon(entriesInput)) {
    if (entry.entryType === "namedSense") {
      senses.push(
        `- {{${entry.displayText}|${entry.senseId ?? "sense"}}}: pronounce as “${oneLine(entry.spokenText)}”.`,
      );
    } else {
      automatic.push(
        `- ${entry.displayText} → ${oneLine(entry.spokenText)} (${entry.entryType === "exactPhrase" ? "exact phrase" : "exact term"}).`,
      );
    }
  }
  return { senses, automatic };
}

function formatStructure(context: ScriptGenerationContext): string[] {
  return [
    "Speaker directives",
    "- Start a spoken turn with [speaker_<id>]. The selected speaker remains active until another speaker directive appears.",
    "- Use only these configured speaker directives:",
    ...context.speakers.map(
      ({ speakerId, roleDescription }) =>
        `  - [speaker_${speakerId}]: ${oneLine(roleDescription)}`,
    ),
    "",
    "Pause directives",
    "- Put a pause command on its own line between spoken passages.",
    ...(context.pauses.length > 0
      ? [
          "- Use only these configured pause commands:",
          ...context.pauses.map(
            ({ pauseId, description }) =>
              `  - [${pauseId}]: ${oneLine(description)}`,
          ),
        ]
      : [
          "- This project has no configured pause commands; do not invent one.",
        ]),
    "",
    "Section directives",
    "- Use [section: Descriptive title] on its own line to mark a major topic.",
  ];
}

function formatReference(
  context: ScriptGenerationContext,
  entriesInput: readonly LexiconEntry[],
): string[] {
  const aliases = aliasSections(entriesInput);
  return [
    "SCRIPT FORMAT AND LEXICON",
    "",
    ...formatStructure(context),
    "",
    "Pronunciation lexicon",
    "- Preserve the written display text. StudyNarrator applies configured pronunciations during narration.",
    ...(aliases.senses.length > 0
      ? [
          "- Named pronunciation senses:",
          ...aliases.senses.map((item) => `  ${item}`),
        ]
      : ["- No named pronunciation senses are configured."]),
    ...(aliases.automatic.length > 0
      ? [
          "- Automatic pronunciation replacements:",
          ...aliases.automatic.map((item) => `  ${item}`),
        ]
      : ["- No automatic pronunciation replacements are configured."]),
    "- If a word or name may need a new pronunciation entry, annotate it as {{display text|new_sense_id}}.",
    "- Make new_sense_id a short lowercase identifier with letters, numbers, underscores, or hyphens.",
    "- Do not invent a spoken pronunciation. StudyNarrator will detect the new sense during import so the user can review and add it to the lexicon.",
  ];
}

function example(
  context: ScriptGenerationContext,
  twoSpeakers: boolean,
): string {
  const first = context.speakers[0]!;
  const second = context.speakers[1];
  const pause = context.pauses[0];
  const lines = [
    "[section: Core idea]",
    "",
    `[speaker_${first.speakerId}] Explain the first important idea in clear spoken language.`,
  ];
  if (pause) lines.push(`[${pause.pauseId}]`);
  if (twoSpeakers && second) {
    lines.push(
      `[speaker_${second.speakerId}] Ask a useful question that exposes a likely misunderstanding.`,
    );
    if (pause) lines.push(`[${pause.pauseId}]`);
    lines.push(
      `[speaker_${first.speakerId}] Resolve the misunderstanding without adding unsupported facts.`,
    );
  }
  lines.push(
    `[speaker_${first.speakerId}] A term needing review can be marked as {{Example Name|example_name}}.`,
  );
  return `${lines.join("\n")}\n`;
}

const CREATION_PROMPT = `# StudyNarrator Script Creation Instructions

Create a new StudyNarrator study script using the topic, learning goals, requirements, source material, and any attached files provided at the end of this prompt.

Use supplied source material when available. If additional research is needed and web access is available, research the topic using reliable sources before creating the script.

## PRIMARY GOAL

Create a coherent spoken lesson designed to be listened to for studying.

Do not simply turn source material into a list of facts. Organize the material into a teaching sequence that helps the listener understand, connect, and remember the important ideas.

## AUTHORING RULES

- Explain prerequisite concepts before concepts that depend on them.
- Prioritize the user's stated learning goals and questions.
- Explain why important concepts matter, not just what they are.
- Use examples, comparisons, questions, corrections, mental models, and brief recaps when they improve learning.
- Keep spoken passages natural and reasonably short.
- Use clear transitions so the lesson can be followed without looking at a screen.
- Reinforce especially important ideas when repetition improves retention.
- Preserve important names, numbers, warnings, constraints, qualifications, and technical distinctions from supplied sources.
- Do not invent facts, citations, source claims, speaker IDs, or unsupported details.

## WRITE FOR AUDIO

StudyNarrator scripts are meant to be heard rather than visually read.

- Prefer natural spoken explanations over document-style prose.
- Do not depend on visual formatting to communicate meaning.
- Convert useful tables into spoken comparisons or summaries.
- Explain diagrams and visual relationships in words.
- Explain the purpose and behavior of code rather than reading large blocks of source code aloud, unless exact code is specifically important to the lesson.
- Avoid unnecessary URLs, Markdown formatting, symbols, or punctuation that would sound awkward when narrated.
- When presenting a list, make its structure and ordering clear in spoken language.

## STUDYNARRATOR SCRIPT FORMAT

### Speakers

A speaker directive selects the voice used for the spoken content that follows.

Configured speakers:

- \`[speaker_narrator]\` — Primary narrator. Explains the material clearly and accurately.

Example:

[speaker_narrator] A cache stores previously computed data so later requests can often be answered more quickly.

The selected speaker remains active until another speaker directive appears.

Rules:

- Use only configured speaker IDs.
- Do not invent additional speaker IDs.
- A speaker directive does not need to be repeated for every paragraph if the same speaker remains active.

### Pauses

Pause directives must appear on their own line.

Available pauses:

- \`[pause_short]\` — Brief thinking beat or small transition.
- \`[pause_medium]\` — Paragraph or subtopic transition.
- \`[pause_long]\` — Major topic or section transition.

Example:

[speaker_narrator] First, let's look at what the cache is responsible for.

[pause_short]

The cache sits between the incoming request and the more expensive computation behind it.

Use pauses intentionally rather than after every sentence.

### Sections

Use section directives to mark major topics.

Format:

[section: Descriptive title]

Example:

[section: Cache Architecture]

Section titles should be short and meaningful.

## CONTEXT-SENSITIVE WORD ALIASES

StudyNarrator handles normal pronunciation through its own pronunciation lexicon. Write ordinary terms using their normal spelling.

A small number of words may have the same spelling but different pronunciations depending on their meaning. For these words, use the configured context alias so StudyNarrator knows which meaning is intended.

Configured aliases:

- \`resume/cv\` — a résumé or career document.
- \`resume/continue\` — to continue or restart something.
- \`read/present\` — present-tense "read."
- \`read/past\` — past-tense "read."
- \`lead/guide\` — to lead, guide, or direct.
- \`lead/metal\` — the metal lead.
- \`live/exist\` — to live or be alive.
- \`live/realtime\` — happening now, such as a live event or live system.
- \`record/noun\` — a stored record or piece of information.
- \`record/verb\` — to record or capture something.
- \`project/noun\` — a project or body of work.
- \`project/verb\` — to project, forecast, display, or extend outward.
- \`object/thing\` — an object, item, or programming object.
- \`object/oppose\` — to object or express opposition.
- \`present/current\` — current or existing now.
- \`present/give\` — to present, demonstrate, or give something.
- \`content/material\` — information, media, or subject matter.
- \`content/satisfied\` — satisfied or pleased.
- \`minute/time\` — a unit of time.
- \`minute/tiny\` — extremely small.
- \`attribute/property\` — an attribute, property, or characteristic.
- \`attribute/assign\` — to attribute something to a source or cause.
- \`import/noun\` — an import or imported item.
- \`import/verb\` — to import something.
- \`export/noun\` — an export or exported item.
- \`export/verb\` — to export something.
- \`row/line\` — a row of items or a database row.
- \`row/argument\` — a quarrel or argument.
- \`axes/math\` — plural of axis.
- \`axes/tools\` — plural of axe.

Rules:

- Use an alias only when the word appears and its meaning matches one of the configured aliases.
- Use only aliases listed above.
- Do not invent new aliases.
- Write all other words normally.
- Do not manually alter spelling merely to influence pronunciation.

Example:

[speaker_narrator] Review your resume/cv before the interview.

[pause_short]

When you are ready, resume/continue the lesson.

## OUTPUT CONTRACT

- Return only the complete raw StudyNarrator script.
- Do not wrap the script in a Markdown code fence.
- Do not add commentary, research notes, citations, explanations, or a summary outside the script.

# USER INPUT

Process the information provided below and any relevant files attached to the conversation.

Not every field needs to be filled in. Use whatever information is provided.

## Topic or material to teach

[WHAT SHOULD THE SCRIPT TEACH?]

## Learning goals or questions

[WHAT SHOULD THE LISTENER UNDERSTAND OR BE ABLE TO EXPLAIN AFTER LISTENING?]

## Audience and existing knowledge

[OPTIONAL — WHO IS THIS FOR AND WHAT DO THEY ALREADY KNOW?]

## Desired depth, length, or emphasis

[OPTIONAL — FOR EXAMPLE: QUICK REVIEW, INTERVIEW PREP, BEGINNER LESSON, DEEP TECHNICAL STUDY.]

## Required topics, facts, or constraints

[OPTIONAL — INCLUDE ANYTHING THAT MUST BE COVERED, EMPHASIZED, PRESERVED, OR AVOIDED.]

## Research requirements

[OPTIONAL — IDENTIFY TRUSTED SOURCES, WHETHER WEB RESEARCH SHOULD BE USED, OR ANY RESEARCH CONSTRAINTS.]

## Source material

[PASTE SOURCE MATERIAL HERE AND/OR ATTACH RELEVANT FILES TO THE CONVERSATION.]`;

const UPDATE_PROMPT = `# StudyNarrator Script Update Instructions

Update an existing StudyNarrator script using the requested changes, current script, supporting information, and any relevant files attached to the conversation.

Use supplied source material when available. If the requested changes require additional research and web access is available, research the necessary information using reliable sources before updating the script.

## PRIMARY GOAL

Return a complete revised StudyNarrator script that incorporates the requested changes while preserving correct material that does not need to change.

## UPDATE RULES

- Return the complete revised script, not a patch, diff, or list of edits.
- Make all changes required by the user's request.
- Preserve correct content that is unrelated to the requested changes.
- Preserve the existing structure when it still works well.
- Restructure sections when necessary to make the requested additions understandable.
- Preserve important names, numbers, warnings, constraints, qualifications, and technical distinctions.
- Maintain a coherent lesson rather than simply inserting disconnected information.
- Do not invent facts, citations, source claims, speaker IDs, or unsupported details.

## WRITE FOR AUDIO

StudyNarrator scripts are meant to be heard rather than visually read.

When adding or revising content:

- Prefer natural spoken explanations over document-style prose.
- Keep spoken passages reasonably short.
- Explain prerequisite concepts before dependent concepts when adding new material.
- Use clear transitions between ideas.
- Convert useful tables into spoken comparisons or summaries.
- Explain diagrams and visual relationships in words.
- Explain the purpose and behavior of code rather than reading large blocks of source code aloud, unless exact code is specifically important.
- Avoid unnecessary URLs, Markdown formatting, symbols, or punctuation that would sound awkward when narrated.
- Use examples, comparisons, questions, corrections, mental models, and brief recaps when they improve learning.

## STUDYNARRATOR SCRIPT FORMAT

### Speakers

A speaker directive selects the voice used for the spoken content that follows.

Configured speakers:

- \`[speaker_narrator]\` — Primary narrator. Explains the material clearly and accurately.

Example:

[speaker_narrator] A cache stores previously computed data so later requests can often be answered more quickly.

The selected speaker remains active until another speaker directive appears.

Rules:

- Use only configured speaker IDs already supported by the script.
- Do not invent additional speaker IDs.
- A speaker directive does not need to be repeated for every paragraph if the same speaker remains active.

### Pauses

Pause directives must appear on their own line.

Available pauses:

- \`[pause_short]\` — Brief thinking beat or small transition.
- \`[pause_medium]\` — Paragraph or subtopic transition.
- \`[pause_long]\` — Major topic or section transition.

Use pauses intentionally rather than after every sentence.

### Sections

Use section directives to mark major topics.

Format:

[section: Descriptive title]

Section titles should be short and meaningful.

Add, rename, reorder, or remove sections when necessary to properly incorporate the requested changes.

## CONTEXT-SENSITIVE WORD ALIASES

StudyNarrator handles normal pronunciation through its own pronunciation lexicon. Write ordinary terms using their normal spelling.

A small number of words may have the same spelling but different pronunciations depending on their meaning. For these words, use the configured context alias so StudyNarrator knows which meaning is intended.

Configured aliases:

- \`resume/cv\` — a résumé or career document.
- \`resume/continue\` — to continue or restart something.
- \`read/present\` — present-tense "read."
- \`read/past\` — past-tense "read."
- \`lead/guide\` — to lead, guide, or direct.
- \`lead/metal\` — the metal lead.
- \`live/exist\` — to live or be alive.
- \`live/realtime\` — happening now, such as a live event or live system.
- \`record/noun\` — a stored record or piece of information.
- \`record/verb\` — to record or capture something.
- \`project/noun\` — a project or body of work.
- \`project/verb\` — to project, forecast, display, or extend outward.
- \`object/thing\` — an object, item, or programming object.
- \`object/oppose\` — to object or express opposition.
- \`present/current\` — current or existing now.
- \`present/give\` — to present, demonstrate, or give something.
- \`content/material\` — information, media, or subject matter.
- \`content/satisfied\` — satisfied or pleased.
- \`minute/time\` — a unit of time.
- \`minute/tiny\` — extremely small.
- \`attribute/property\` — an attribute, property, or characteristic.
- \`attribute/assign\` — to attribute something to a source or cause.
- \`import/noun\` — an import or imported item.
- \`import/verb\` — to import something.
- \`export/noun\` — an export or exported item.
- \`export/verb\` — to export something.
- \`row/line\` — a row of items or a database row.
- \`row/argument\` — a quarrel or argument.
- \`axes/math\` — plural of axis.
- \`axes/tools\` — plural of axe.

Rules:

- Use an alias only when the word appears and its meaning matches one of the configured aliases.
- Use only aliases listed above.
- Do not invent new aliases.
- Write all other words normally.
- Do not manually alter spelling merely to influence pronunciation.

## OUTPUT CONTRACT

- Return only the complete revised raw StudyNarrator script.
- Do not wrap the script in a Markdown code fence.
- Do not add commentary, research notes, citations, explanations, or a change summary outside the script.

# USER INPUT

Process the information provided below and any relevant files attached to the conversation.

## Requested changes

[DESCRIBE WHAT SHOULD BE ADDED, REMOVED, CORRECTED, EXPANDED, OR REORGANIZED.]

## Current StudyNarrator script

[PASTE THE CURRENT SCRIPT HERE AND/OR ATTACH IT TO THE CONVERSATION.]

## Additional requirements or source material

[OPTIONAL — PROVIDE FACTS, RESEARCH, SOURCE MATERIAL, CONSTRAINTS, OR ATTACH RELEVANT FILES.]`;

function creationPrompt(): string {
  return `${CREATION_PROMPT}\n`;
}

function updatePrompt(): string {
  return `${UPDATE_PROMPT}\n`;
}

export function buildExternalLlmPrompt(input: {
  kind: ScriptPromptKind;
  context: ScriptGenerationContext;
  lexiconEntries: readonly LexiconEntry[];
}): string {
  const kind = ScriptPromptKindSchema.parse(input.kind);
  ScriptGenerationContextSchema.parse(input.context);
  return kind === "creation" ? creationPrompt() : updatePrompt();
}

export function buildSkillPackageFiles(input: {
  context: ScriptGenerationContext;
  lexiconEntries: readonly LexiconEntry[];
}): GeneratedTextFile[] {
  const context = ScriptGenerationContextSchema.parse(input.context);
  const aliases = aliasSections(input.lexiconEntries);
  const format = formatReference(context, input.lexiconEntries).join("\n");
  const files: GeneratedTextFile[] = [
    {
      path: "SKILL.md",
      content: [
        "# StudyNarrator Script Authoring",
        "",
        "Use CREATION_PROMPT.md when starting a script and UPDATE_PROMPT.md when revising an existing script.",
        "Follow SCRIPT_FORMAT.md, preserve supplied facts, and return only the raw script.",
        "",
      ].join("\n"),
    },
    { path: "CREATION_PROMPT.md", content: creationPrompt() },
    { path: "UPDATE_PROMPT.md", content: updatePrompt() },
    { path: "SCRIPT_FORMAT.md", content: `# Script Format\n\n${format}\n` },
    {
      path: "LEXICON_ALIASES.md",
      content: [
        "# Lexicon Aliases",
        "",
        "## Named senses",
        "",
        ...(aliases.senses.length > 0
          ? aliases.senses
          : ["No named pronunciation senses are configured."]),
        "",
        "## Automatic replacements",
        "",
        ...(aliases.automatic.length > 0
          ? aliases.automatic
          : ["No automatic pronunciation replacements are configured."]),
        "",
        "## New candidates",
        "",
        "Mark a pronunciation candidate as {{display text|new_sense_id}}. StudyNarrator will detect it during import for user review.",
        "",
      ].join("\n"),
    },
    { path: "examples/single-narrator.txt", content: example(context, false) },
  ];
  if (context.speakers.length > 1)
    files.push({
      path: "examples/two-speaker-study-guide.txt",
      content: example(context, true),
    });
  return files;
}
