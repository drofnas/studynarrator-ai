import { z } from "zod";
import { LexiconEntrySchema, PauseIdSchema, SpeakerIdSchema, type LexiconEntry } from "./schemas.js";

export const SCRIPT_GENERATION_SCHEMA_VERSION = 1;

export const ScriptPromptKindSchema = z.enum(["creation", "update"]);
export type ScriptPromptKind = z.infer<typeof ScriptPromptKindSchema>;

const ScriptGenerationSpeakerSchema = z.object({
  speakerId: SpeakerIdSchema,
  roleDescription: z.string().trim().min(1).max(5_000)
}).strict();

const ScriptGenerationPauseSchema = z.object({
  pauseId: PauseIdSchema,
  description: z.string().trim().min(1).max(500)
}).strict();

const ScriptGenerationContextBaseSchema = z.object({
  schemaVersion: z.literal(SCRIPT_GENERATION_SCHEMA_VERSION),
  projectName: z.string().trim().min(1).max(200),
  speakers: z.array(ScriptGenerationSpeakerSchema).min(1).max(20),
  pauses: z.array(ScriptGenerationPauseSchema).max(50)
}).strict();
export const ScriptGenerationContextSchema = ScriptGenerationContextBaseSchema.superRefine((value, refinement) => {
  const speakerIds = new Set<string>();
  value.speakers.forEach(({ speakerId }, index) => {
    if (speakerIds.has(speakerId)) refinement.addIssue({ code: "custom", message: `Duplicate speaker ID: ${speakerId}.`, path: ["speakers", index] });
    speakerIds.add(speakerId);
  });
  const pauseIds = new Set<string>();
  value.pauses.forEach(({ pauseId }, index) => {
    if (pauseIds.has(pauseId)) refinement.addIssue({ code: "custom", message: `Duplicate pause ID: ${pauseId}.`, path: ["pauses", index] });
    pauseIds.add(pauseId);
  });
});
export type ScriptGenerationContext = z.infer<typeof ScriptGenerationContextSchema>;

const ScriptGenerationLexiconSchema = z.array(LexiconEntrySchema).max(20_000);

interface GeneratedTextFile {
  path: string;
  content: string;
}

function oneLine(value: string): string {
  return value.trim().replace(/\s+/gu, " ");
}

function effectiveLexicon(entriesInput: readonly LexiconEntry[]): LexiconEntry[] {
  const entries = ScriptGenerationLexiconSchema.parse(entriesInput).filter(({ enabled }) => enabled);
  const byBehavior = new Map<string, LexiconEntry>();
  for (const entry of [...entries.filter(({ scope }) => scope === "global"), ...entries.filter(({ scope }) => scope === "project")]) {
    byBehavior.set(`${entry.entryType}\u0000${entry.displayText}\u0000${entry.senseId ?? ""}`, entry);
  }
  return [...byBehavior.values()].sort((left, right) => {
    const type = left.entryType.localeCompare(right.entryType);
    if (type !== 0) return type;
    const display = left.displayText.localeCompare(right.displayText);
    return display !== 0 ? display : (left.senseId ?? "").localeCompare(right.senseId ?? "");
  });
}

function aliasSections(entriesInput: readonly LexiconEntry[]): { senses: string[]; automatic: string[] } {
  const senses: string[] = [];
  const automatic: string[] = [];
  for (const entry of effectiveLexicon(entriesInput)) {
    if (entry.entryType === "namedSense") {
      senses.push(`- {{${entry.displayText}|${entry.senseId ?? "sense"}}}: pronounce as “${oneLine(entry.spokenText)}”.`);
    } else {
      automatic.push(`- ${entry.displayText} → ${oneLine(entry.spokenText)} (${entry.entryType === "exactPhrase" ? "exact phrase" : "exact term"}).`);
    }
  }
  return { senses, automatic };
}

function formatStructure(context: ScriptGenerationContext): string[] {
  return [
    "Speaker directives",
    "- Start a spoken turn with [speaker_<id>]. The selected speaker remains active until another speaker directive appears.",
    "- Use only these configured speaker directives:",
    ...context.speakers.map(({ speakerId, roleDescription }) => `  - [speaker_${speakerId}]: ${oneLine(roleDescription)}`),
    "",
    "Pause directives",
    "- Put a pause command on its own line between spoken passages.",
    ...(context.pauses.length > 0
      ? ["- Use only these configured pause commands:", ...context.pauses.map(({ pauseId, description }) => `  - [${pauseId}]: ${oneLine(description)}`)]
      : ["- This project has no configured pause commands; do not invent one."]),
    "",
    "Section directives",
    "- Use [section: Descriptive title] on its own line to mark a major topic."
  ];
}

function formatReference(context: ScriptGenerationContext, entriesInput: readonly LexiconEntry[]): string[] {
  const aliases = aliasSections(entriesInput);
  return [
    "SCRIPT FORMAT AND LEXICON",
    "",
    ...formatStructure(context),
    "",
    "Pronunciation lexicon",
    "- Preserve the written display text. StudyNarrator applies configured pronunciations during narration.",
    ...(aliases.senses.length > 0 ? ["- Named pronunciation senses:", ...aliases.senses.map((item) => `  ${item}`)] : ["- No named pronunciation senses are configured."]),
    ...(aliases.automatic.length > 0 ? ["- Automatic pronunciation replacements:", ...aliases.automatic.map((item) => `  ${item}`)] : ["- No automatic pronunciation replacements are configured."]),
    "- If a word or name may need a new pronunciation entry, annotate it as {{display text|new_sense_id}}.",
    "- Make new_sense_id a short lowercase identifier with letters, numbers, underscores, or hyphens.",
    "- Do not invent a spoken pronunciation. StudyNarrator will detect the new sense during import so the user can review and add it to the lexicon."
  ];
}

function example(context: ScriptGenerationContext, twoSpeakers: boolean): string {
  const first = context.speakers[0]!;
  const second = context.speakers[1];
  const pause = context.pauses[0];
  const lines = ["[section: Core idea]", "", `[speaker_${first.speakerId}] Explain the first important idea in clear spoken language.`];
  if (pause) lines.push(`[${pause.pauseId}]`);
  if (twoSpeakers && second) {
    lines.push(`[speaker_${second.speakerId}] Ask a useful question that exposes a likely misunderstanding.`);
    if (pause) lines.push(`[${pause.pauseId}]`);
    lines.push(`[speaker_${first.speakerId}] Resolve the misunderstanding without adding unsupported facts.`);
  }
  lines.push(`[speaker_${first.speakerId}] A term needing review can be marked as {{Example Name|example_name}}.`);
  return `${lines.join("\n")}\n`;
}

function creationPrompt(context: ScriptGenerationContext, entries: readonly LexiconEntry[]): string {
  return [
    "# StudyNarrator script creation instructions",
    "",
    "Use these standing instructions together with my topic, learning goals, and source requirements below. Create a brand-new StudyNarrator script from that material.",
    "",
    "KNOWLEDGE TO GATHER AND TEACH",
    "[REPLACE THIS BLOCK WITH THE TOPIC, QUESTIONS TO ANSWER, LEARNING GOALS, AUDIENCE, DETAIL LEVEL, TRUSTED SOURCES, AND ANY FACTS OR CONSTRAINTS THE SCRIPT MUST INCLUDE.]",
    "",
    "AUTHORING GOALS",
    "- Build a coherent lesson, not a list of disconnected facts.",
    "- Explain prerequisite ideas before dependent ideas.",
    "- Use questions, corrections, comparisons, and recaps only when they improve learning.",
    "- Keep spoken turns natural and reasonably short.",
    "- Convert useful tables, code, and visual material into clear spoken explanations.",
    "- Preserve names, numbers, warnings, constraints, and technical distinctions from supplied sources.",
    "- Do not invent facts, citations, or pronunciations.",
    "",
    ...formatReference(context, entries),
    "",
    "OUTPUT CONTRACT",
    "- Return only the complete raw StudyNarrator script.",
    "- Do not wrap the script in a Markdown code fence.",
    "- Do not add notes or commentary outside the script.",
    "",
    "VALID FORMAT EXAMPLE",
    example(context, context.speakers.length > 1).trimEnd(),
    ""
  ].join("\n");
}

function updatePrompt(context: ScriptGenerationContext): string {
  return [
    "# StudyNarrator study guide conversion instructions",
    "",
    "Convert the existing study guide at the end of this prompt into a complete StudyNarrator audio script.",
    "",
    "AUDIO SCRIPT GOALS",
    "- Preserve the study guide's facts, names, numbers, warnings, and technical distinctions.",
    "- Organize the material into a coherent spoken lesson instead of reading outline fragments verbatim.",
    "- Explain prerequisite ideas before dependent ideas.",
    "- Use natural spoken language and reasonably short speaker turns.",
    "- Use questions, corrections, comparisons, and recaps only when they improve learning.",
    "- Convert useful tables, code, and visual material into clear spoken explanations.",
    "- Do not invent facts or citations.",
    "",
    "SCRIPT FORMAT",
    "",
    ...formatStructure(context),
    "",
    "OUTPUT CONTRACT",
    "- Return only the complete raw StudyNarrator script.",
    "- Do not wrap the script in a Markdown code fence.",
    "- Do not add notes or commentary outside the script.",
    "",
    "EXISTING STUDY GUIDE",
    "[INSERT EXISTING SCRIPT]",
    ""
  ].join("\n");
}

export function buildExternalLlmPrompt(input: {
  kind: ScriptPromptKind;
  context: ScriptGenerationContext;
  lexiconEntries: readonly LexiconEntry[];
}): string {
  const kind = ScriptPromptKindSchema.parse(input.kind);
  const context = ScriptGenerationContextSchema.parse(input.context);
  return kind === "creation" ? creationPrompt(context, input.lexiconEntries) : updatePrompt(context);
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
        ""
      ].join("\n")
    },
    { path: "CREATION_PROMPT.md", content: creationPrompt(context, input.lexiconEntries) },
    { path: "UPDATE_PROMPT.md", content: updatePrompt(context) },
    { path: "SCRIPT_FORMAT.md", content: `# Script Format\n\n${format}\n` },
    {
      path: "LEXICON_ALIASES.md",
      content: [
        "# Lexicon Aliases",
        "",
        "## Named senses",
        "",
        ...(aliases.senses.length > 0 ? aliases.senses : ["No named pronunciation senses are configured."]),
        "",
        "## Automatic replacements",
        "",
        ...(aliases.automatic.length > 0 ? aliases.automatic : ["No automatic pronunciation replacements are configured."]),
        "",
        "## New candidates",
        "",
        "Mark a pronunciation candidate as {{display text|new_sense_id}}. StudyNarrator will detect it during import for user review.",
        ""
      ].join("\n")
    },
    { path: "examples/single-narrator.txt", content: example(context, false) }
  ];
  if (context.speakers.length > 1) files.push({ path: "examples/two-speaker-study-guide.txt", content: example(context, true) });
  return files;
}
