import { z } from "zod";
import { LexiconEntrySchema, PauseIdSchema, SpeakerIdSchema, type LexiconEntry } from "./schemas.js";

export const SCRIPT_GENERATION_SCHEMA_VERSION = 1;
export const SCRIPT_GENERATION_SOURCE_MAX_CHARACTERS = 5_000_000;

export const ScriptGenerationSpeakerSchema = z.object({
  speakerId: SpeakerIdSchema,
  roleDescription: z.string().trim().min(1).max(5_000)
}).strict();

export const ScriptGenerationPauseSchema = z.object({
  pauseId: PauseIdSchema,
  description: z.string().trim().min(1).max(500)
}).strict();

function uniqueIds(
  values: readonly { id: string }[],
  context: z.RefinementCtx,
  path: "speakers" | "pauses"
): void {
  const seen = new Set<string>();
  values.forEach(({ id }, index) => {
    if (seen.has(id)) context.addIssue({ code: "custom", message: `Duplicate ${path === "speakers" ? "speaker" : "pause"} ID: ${id}.`, path: [path, index] });
    seen.add(id);
  });
}

const ScriptGenerationConfigurationBaseSchema = z.object({
  schemaVersion: z.literal(SCRIPT_GENERATION_SCHEMA_VERSION),
  purpose: z.string().trim().min(1).max(5_000),
  targetAudience: z.string().trim().min(1).max(5_000),
  detailLevel: z.enum(["concise", "balanced", "comprehensive"]),
  sectionMode: z.enum(["required", "optional", "omit"]),
  codeHandling: z.enum(["explain", "spell", "omit"]),
  additionalGuidance: z.string().max(10_000),
  speakers: z.array(ScriptGenerationSpeakerSchema).min(1).max(20),
  pauses: z.array(ScriptGenerationPauseSchema).max(50)
}).strict();

export const ScriptGenerationConfigurationSchema = ScriptGenerationConfigurationBaseSchema.superRefine((configuration, context) => {
  uniqueIds(configuration.speakers.map((speaker) => ({ id: speaker.speakerId })), context, "speakers");
  uniqueIds(configuration.pauses.map((pause) => ({ id: pause.pauseId })), context, "pauses");
});
export type ScriptGenerationConfiguration = z.infer<typeof ScriptGenerationConfigurationSchema>;

export const ScriptGenerationBriefSchema = ScriptGenerationConfigurationBaseSchema.extend({
  sourceMaterial: z.string().trim().min(1).max(SCRIPT_GENERATION_SOURCE_MAX_CHARACTERS)
}).strict().superRefine((brief, context) => {
  uniqueIds(brief.speakers.map((speaker) => ({ id: speaker.speakerId })), context, "speakers");
  uniqueIds(brief.pauses.map((pause) => ({ id: pause.pauseId })), context, "pauses");
});
export type ScriptGenerationBrief = z.infer<typeof ScriptGenerationBriefSchema>;

export const ScriptGenerationLexiconSchema = z.array(LexiconEntrySchema).max(20_000);

export interface GeneratedTextFile {
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

function sectionGuidance(mode: ScriptGenerationConfiguration["sectionMode"]): string {
  if (mode === "required") return "Use a section directive on its own line before every major subject.";
  if (mode === "omit") return "Do not emit section directives.";
  return "Use section directives on their own lines when they materially improve navigation.";
}

function codeGuidance(mode: ScriptGenerationConfiguration["codeHandling"]): string {
  if (mode === "omit") return "Omit source code unless its behavior must be summarized for technical accuracy.";
  if (mode === "spell") return "Read important code and symbols aloud in unambiguous spoken words; do not emit fenced code blocks.";
  return "Explain what code does in speakable prose. Include exact code only when the source explicitly requires it to be read aloud.";
}

function example(configuration: ScriptGenerationConfiguration, twoSpeakers: boolean): string {
  const first = configuration.speakers[0]!;
  const second = configuration.speakers[1];
  const pause = configuration.pauses[0];
  const lines = configuration.sectionMode === "omit" ? [] : ["[section: Caching]", ""];
  lines.push(`[speaker_${first.speakerId}] A cache keeps a reusable result close to where it is needed.`);
  if (pause) lines.push(`[${pause.pauseId}]`);
  if (twoSpeakers && second) {
    lines.push(`[speaker_${second.speakerId}] What happens when the original data changes?`);
    if (pause) lines.push(`[${pause.pauseId}]`);
    lines.push(`[speaker_${first.speakerId}] The application needs an invalidation strategy so it does not serve stale data.`);
  } else {
    lines.push(`[speaker_${first.speakerId}] When the original data changes, the application needs an invalidation strategy.`);
  }
  return `${lines.join("\n")}\n`;
}

function contractSections(configuration: ScriptGenerationConfiguration, entries: readonly LexiconEntry[]): string[] {
  const aliases = aliasSections(entries);
  return [
    "OUTPUT CONTRACT",
    "- Output only the raw script.",
    "- Do not wrap the output in a Markdown code fence.",
    "- Do not add commentary outside the script.",
    "- Use only the directives and IDs listed below.",
    "- Speaker tags may appear between spoken phrases and remain active until the next speaker tag.",
    "- Pause directives may appear between spoken phrases.",
    "- Preserve names, numbers, constraints, warnings, and technical distinctions from the source.",
    "- Do not invent facts or pronunciations.",
    "",
    "ALLOWED SPEAKERS",
    ...configuration.speakers.map(({ speakerId, roleDescription }) => `- [speaker_${speakerId}]: ${oneLine(roleDescription)}`),
    "",
    "ALLOWED PAUSES",
    ...(configuration.pauses.length > 0
      ? configuration.pauses.map(({ pauseId, description }) => `- [${pauseId}]: ${oneLine(description)}`)
      : ["- No pause directives are allowed."]),
    "",
    "SECTION FORMAT",
    sectionGuidance(configuration.sectionMode),
    ...(configuration.sectionMode === "omit" ? [] : ["Use: [section: Descriptive section title]"]),
    "",
    "AMBIGUOUS PRONUNCIATION FORMAT",
    "Use {{display text|sense}} only for a supplied named sense.",
    ...(aliases.senses.length > 0 ? aliases.senses : ["- No named pronunciation senses are configured."]),
    "",
    "AUTOMATIC PRONUNCIATION RULES",
    "StudyNarrator applies these after generation; preserve the written display text:",
    ...(aliases.automatic.length > 0 ? aliases.automatic : ["- No automatic pronunciation replacements are configured."])
  ];
}

export function buildExternalLlmPrompt(input: {
  brief: ScriptGenerationBrief;
  lexiconEntries: readonly LexiconEntry[];
}): string {
  const brief = ScriptGenerationBriefSchema.parse(input.brief);
  const { sourceMaterial: _sourceMaterial, ...configurationInput } = brief;
  void _sourceMaterial;
  const configuration = ScriptGenerationConfigurationSchema.parse(configurationInput);
  const sections = [
    "You are converting source material into a spoken script for a deterministic text-to-speech application.",
    "",
    "GOAL",
    oneLine(brief.purpose),
    `Audience: ${oneLine(brief.targetAudience)}`,
    `Detail level: ${brief.detailLevel}.`,
    "The script may use multiple speakers to make the material clearer, but it must not add unsupported facts.",
    "",
    ...contractSections(configuration, input.lexiconEntries),
    "",
    "CODE HANDLING",
    codeGuidance(brief.codeHandling),
    "",
    "SCRIPTING GUIDANCE",
    "- Keep spoken turns reasonably short and natural.",
    "- Do not alternate speakers unless a question, misconception, or recap improves understanding.",
    "- Convert useful tables and dense visual material into spoken prose.",
    "- Do not read decorative Markdown characters aloud.",
    ...(brief.additionalGuidance.trim() ? [oneLine(brief.additionalGuidance)] : []),
    "",
    "VALID EXAMPLE",
    example(configuration, configuration.speakers.length > 1).trimEnd(),
    "",
    "SOURCE MATERIAL",
    brief.sourceMaterial.trim(),
    ""
  ];
  return sections.join("\n");
}

export function buildSkillPackageFiles(input: {
  configuration: ScriptGenerationConfiguration;
  lexiconEntries: readonly LexiconEntry[];
}): GeneratedTextFile[] {
  const configuration = ScriptGenerationConfigurationSchema.parse(input.configuration);
  const contract = contractSections(configuration, input.lexiconEntries).join("\n");
  const aliases = aliasSections(input.lexiconEntries);
  const files: GeneratedTextFile[] = [
    {
      path: "SKILL.md",
      content: [
        "# StudyNarrator Script Authoring",
        "",
        "Use this skill when converting supplied source material into a deterministic StudyNarrator script.",
        "",
        `Purpose: ${oneLine(configuration.purpose)}`,
        `Audience: ${oneLine(configuration.targetAudience)}`,
        `Detail level: ${configuration.detailLevel}.`,
        "",
        "## Workflow",
        "",
        "1. Read the source material without adding unsupported facts.",
        "2. Follow SCRIPT_FORMAT.md and use only its configured speaker and pause IDs.",
        "3. Apply LEXICON_ALIASES.md when pronunciation guidance is relevant.",
        "4. Return only the raw script, without a code fence or commentary.",
        "",
        `Code handling: ${codeGuidance(configuration.codeHandling)}`,
        ...(configuration.additionalGuidance.trim() ? ["", `Additional guidance: ${oneLine(configuration.additionalGuidance)}`] : []),
        ""
      ].join("\n")
    },
    {
      path: "SCRIPT_FORMAT.md",
      content: `# Script Format\n\n${contract}\n`
    },
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
        ""
      ].join("\n")
    },
    { path: "examples/single-narrator.txt", content: example(configuration, false) }
  ];
  if (configuration.speakers.length > 1) files.push({ path: "examples/two-speaker-study-guide.txt", content: example(configuration, true) });
  return files;
}
