import { z } from "zod";
import {
  LexiconEntrySchema,
  PauseIdSchema,
  SpeakerIdSchema,
  VoiceHintSchema,
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

/**
 * A voice the generated instructions may offer as a speaker's script default.
 * The application supplies these from its bundled voice catalog because core
 * has no catalog of its own.
 */
const ScriptGenerationVoicesSchema = z
  .array(
    z
      .object({
        voiceId: VoiceHintSchema,
        language: z.string().trim().min(1).max(100),
      })
      .strict(),
  )
  .max(500);
export type ScriptGenerationVoice = z.infer<
  typeof ScriptGenerationVoicesSchema
>[number];

const SCRIPT_GENERATION_VOICE_MODEL_LABEL =
  "Kokoro 82M v1.0 ONNX (`speaches-ai/Kokoro-82M-v1.0-ONNX`)";

function voiceListLines(voices: readonly ScriptGenerationVoice[]): string[] {
  const byLanguage = new Map<string, string[]>();
  for (const { voiceId, language } of voices) {
    const ids = byLanguage.get(language) ?? [];
    ids.push(`\`${voiceId}\``);
    byLanguage.set(language, ids);
  }
  return [...byLanguage].map(
    ([language, ids]) => `- ${language}: ${ids.join(", ")}`,
  );
}

function voiceGuidance(voices: readonly ScriptGenerationVoice[]): string[] {
  const shared = [
    "- Add the voice to the speaker's first directive only: `[speaker_<id>|<voice_id>]`. After that, use the plain `[speaker_<id>]`.",
    "- Give each speaker one voice. A different voice on a later directive for the same speaker is ignored and produces a warning.",
    "- Give different speakers different voices so listeners can tell them apart, and choose voices that match the language of the script.",
    "- The voice becomes that speaker's script default. The user can still choose a different voice for any speaker in the project settings.",
  ];
  if (voices.length === 0)
    return [
      "Each speaker can be given a default voice in the script.",
      "",
      ...shared,
      "- Use a voice ID only if the user input names one. Otherwise leave the voice out, and the user will choose voices in StudyNarrator AI.",
    ];
  return [
    `Each speaker can be given a default voice from the ${SCRIPT_GENERATION_VOICE_MODEL_LABEL} speech model.`,
    "",
    ...shared,
    "- Use only voice IDs from the list below. Do not invent voice IDs.",
    "- In a voice ID, the first letter is the language and the second letter is the voice's gender: `f` for female and `m` for male. For example, `af_heart` is an American English female voice and `bm_george` is a British English male voice.",
    "",
    "Available voices:",
    "",
    ...voiceListLines(voices),
  ];
}

const MULTI_SPEAKER_EXAMPLE = [
  "[speaker_host|af_heart] Welcome back. Today we will look at why a cache can make a slow system feel fast.",
  "",
  "[speaker_guest|bm_george] The short version is that a cache remembers answers, so they do not have to be worked out twice.",
  "",
  "[speaker_host] So what happens when the underlying data changes?",
  "",
  "[speaker_guest] Then the remembered copy can go stale, which is why every cache needs a rule for when to refresh it.",
].join("\n");

function speakerSection(
  kind: ScriptPromptKind,
  voices: readonly ScriptGenerationVoice[],
): string {
  return [
    "### Speakers",
    "",
    "A speaker directive selects the voice used for the spoken content that follows. The selected speaker remains active until another speaker directive appears.",
    "",
    "A script can use as many speakers as it needs. One narrator works well for a straightforward explanation. Use two or more speakers for a dialogue, an interview, a debate, question-and-answer practice, or a story with several characters. If the user input asks for particular speakers, use them.",
    "",
    "Rules:",
    "",
    "- `[speaker_<id>]` switches to that speaker.",
    "- Make each speaker ID a short lowercase name such as `narrator`, `host`, `guest`, `teacher`, or `alice`. IDs may contain only letters, numbers, underscores, and hyphens, and must start with a letter or number.",
    "- Use exactly the same ID every time the same speaker talks. IDs that differ only by capitalization are reported as a mistake.",
    "- Text before the first speaker directive is spoken by the `narrator` speaker.",
    "- A speaker directive does not need to be repeated for every paragraph if the same speaker remains active.",
    ...(kind === "update"
      ? [
          "- Keep the speaker IDs already used in the current script. Voice settings are attached to speaker IDs, so do not rename an existing speaker unless the requested changes ask for it.",
          "- You may add new speakers when the requested changes call for them.",
        ]
      : []),
    "",
    "### Voices",
    "",
    ...voiceGuidance(voices),
    ...(kind === "update"
      ? [
          "",
          "- If the current script sets a speaker's voice, keep that voice on the speaker's first directive in the revised script, even if sections move. Give each new speaker a voice on its first directive.",
        ]
      : []),
    "",
    "Example with two speakers:",
    "",
    MULTI_SPEAKER_EXAMPLE,
  ].join("\n");
}

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

function formatStructure(
  context: ScriptGenerationContext,
  voices: readonly ScriptGenerationVoice[],
): string[] {
  return [
    "Speaker directives",
    "- Start a spoken turn with [speaker_<id>]. The selected speaker remains active until another speaker directive appears.",
    "- A script can use as many speakers as it needs. This project already has these speakers; reuse their IDs for these roles:",
    ...context.speakers.map(
      ({ speakerId, roleDescription }) =>
        `  - [speaker_${speakerId}]: ${oneLine(roleDescription)}`,
    ),
    "- Add new speakers when the script needs them. Use short lowercase IDs containing only letters, numbers, underscores, or hyphens, and spell each ID the same way every time.",
    "",
    "Speaker voices",
    ...voiceGuidance(voices),
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
  voices: readonly ScriptGenerationVoice[],
): string[] {
  const aliases = aliasSections(entriesInput);
  return [
    "SCRIPT FORMAT AND LEXICON",
    "",
    ...formatStructure(context, voices),
    "",
    "Pronunciation lexicon",
    "- Preserve the written display text. StudyNarrator AI applies configured pronunciations during narration.",
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
    "- Do not invent a spoken pronunciation. StudyNarrator AI will detect the new sense during import so the user can review and add it to the lexicon.",
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

const creationPromptText = (
  voices: readonly ScriptGenerationVoice[],
) => `# StudyNarrator AI Script Creation Instructions

Create a new StudyNarrator AI study script using the topic, learning goals, requirements, source material, and any attached files provided at the end of this prompt.

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
- Do not invent facts, citations, source claims, voice IDs, or unsupported details.

## WRITE FOR AUDIO

StudyNarrator AI scripts are meant to be heard rather than visually read.

- Prefer natural spoken explanations over document-style prose.
- Do not depend on visual formatting to communicate meaning.
- Convert useful tables into spoken comparisons or summaries.
- Explain diagrams and visual relationships in words.
- Explain the purpose and behavior of code rather than reading large blocks of source code aloud, unless exact code is specifically important to the lesson.
- Avoid unnecessary URLs, Markdown formatting, symbols, or punctuation that would sound awkward when narrated.
- When presenting a list, make its structure and ordering clear in spoken language.

## STUDYNARRATOR SCRIPT FORMAT

${speakerSection("creation", voices)}

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

StudyNarrator AI handles normal pronunciation through its own pronunciation lexicon. Write ordinary terms using their normal spelling.

A small number of words may have the same spelling but different pronunciations depending on their meaning. For these words, use the configured context alias so StudyNarrator AI knows which meaning is intended.

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

- Return only the complete raw StudyNarrator AI script.
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

## Speakers and voices

[OPTIONAL — FOR EXAMPLE: ONE NARRATOR, A HOST AND A GUEST, OR A TEACHER AND TWO STUDENTS, PLUS ANY VOICES, ACCENTS, OR GENDERS YOU PREFER.]

## Desired depth, length, or emphasis

[OPTIONAL — FOR EXAMPLE: QUICK REVIEW, INTERVIEW PREP, BEGINNER LESSON, DEEP TECHNICAL STUDY.]

## Required topics, facts, or constraints

[OPTIONAL — INCLUDE ANYTHING THAT MUST BE COVERED, EMPHASIZED, PRESERVED, OR AVOIDED.]

## Research requirements

[OPTIONAL — IDENTIFY TRUSTED SOURCES, WHETHER WEB RESEARCH SHOULD BE USED, OR ANY RESEARCH CONSTRAINTS.]

## Source material

[PASTE SOURCE MATERIAL HERE AND/OR ATTACH RELEVANT FILES TO THE CONVERSATION.]`;

const updatePromptText = (
  voices: readonly ScriptGenerationVoice[],
) => `# StudyNarrator AI Script Update Instructions

Update an existing StudyNarrator AI script using the requested changes, current script, supporting information, and any relevant files attached to the conversation.

Use supplied source material when available. If the requested changes require additional research and web access is available, research the necessary information using reliable sources before updating the script.

## PRIMARY GOAL

Return a complete revised StudyNarrator AI script that incorporates the requested changes while preserving correct material that does not need to change.

## UPDATE RULES

- Return the complete revised script, not a patch, diff, or list of edits.
- Make all changes required by the user's request.
- Preserve correct content that is unrelated to the requested changes.
- Preserve the existing structure when it still works well.
- Restructure sections when necessary to make the requested additions understandable.
- Preserve important names, numbers, warnings, constraints, qualifications, and technical distinctions.
- Maintain a coherent lesson rather than simply inserting disconnected information.
- Do not invent facts, citations, source claims, voice IDs, or unsupported details.

## WRITE FOR AUDIO

StudyNarrator AI scripts are meant to be heard rather than visually read.

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

${speakerSection("update", voices)}

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

StudyNarrator AI handles normal pronunciation through its own pronunciation lexicon. Write ordinary terms using their normal spelling.

A small number of words may have the same spelling but different pronunciations depending on their meaning. For these words, use the configured context alias so StudyNarrator AI knows which meaning is intended.

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

- Return only the complete revised raw StudyNarrator AI script.
- Do not wrap the script in a Markdown code fence.
- Do not add commentary, research notes, citations, explanations, or a change summary outside the script.

# USER INPUT

Process the information provided below and any relevant files attached to the conversation.

## Requested changes

[DESCRIBE WHAT SHOULD BE ADDED, REMOVED, CORRECTED, EXPANDED, OR REORGANIZED.]

## Current StudyNarrator AI script

[PASTE THE CURRENT SCRIPT HERE AND/OR ATTACH IT TO THE CONVERSATION.]

## Additional requirements or source material

[OPTIONAL — PROVIDE FACTS, RESEARCH, SOURCE MATERIAL, CONSTRAINTS, OR ATTACH RELEVANT FILES.]`;

function creationPrompt(voices: readonly ScriptGenerationVoice[]): string {
  return `${creationPromptText(voices)}\n`;
}

function updatePrompt(voices: readonly ScriptGenerationVoice[]): string {
  return `${updatePromptText(voices)}\n`;
}

export function buildExternalLlmPrompt(input: {
  kind: ScriptPromptKind;
  context: ScriptGenerationContext;
  lexiconEntries: readonly LexiconEntry[];
  voices?: readonly ScriptGenerationVoice[];
}): string {
  const kind = ScriptPromptKindSchema.parse(input.kind);
  ScriptGenerationContextSchema.parse(input.context);
  const voices = ScriptGenerationVoicesSchema.parse(input.voices ?? []);
  return kind === "creation" ? creationPrompt(voices) : updatePrompt(voices);
}

export function buildSkillPackageFiles(input: {
  context: ScriptGenerationContext;
  lexiconEntries: readonly LexiconEntry[];
  voices?: readonly ScriptGenerationVoice[];
}): GeneratedTextFile[] {
  const context = ScriptGenerationContextSchema.parse(input.context);
  const voices = ScriptGenerationVoicesSchema.parse(input.voices ?? []);
  const aliases = aliasSections(input.lexiconEntries);
  const format = formatReference(context, input.lexiconEntries, voices).join(
    "\n",
  );
  const files: GeneratedTextFile[] = [
    {
      path: "SKILL.md",
      content: [
        "# StudyNarrator AI Script Authoring",
        "",
        "Use CREATION_PROMPT.md when starting a script and UPDATE_PROMPT.md when revising an existing script.",
        "Follow SCRIPT_FORMAT.md, preserve supplied facts, and return only the raw script.",
        "",
      ].join("\n"),
    },
    { path: "CREATION_PROMPT.md", content: creationPrompt(voices) },
    { path: "UPDATE_PROMPT.md", content: updatePrompt(voices) },
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
        "Mark a pronunciation candidate as {{display text|new_sense_id}}. StudyNarrator AI will detect it during import for user review.",
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
