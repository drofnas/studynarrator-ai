import {
  PARAGRAPH_PACING_VERSION,
  ResolveParagraphPausesInputSchema,
  ResolveParagraphPausesResultSchema,
  type ResolveParagraphPausesInput,
  type ResolveParagraphPausesResult,
  type ResolvedParagraphPauseAudit
} from "./schemas.js";

export function resolveParagraphPauses(input: ResolveParagraphPausesInput): ResolveParagraphPausesResult {
  const parsedInput = ResolveParagraphPausesInputSchema.parse(input);
  const { parsedScript, configuration } = parsedInput;
  const audits: ResolvedParagraphPauseAudit[] = [];

  if (configuration.enabled) {
    const speechIndexes = parsedScript.nodes.flatMap((node, index) => node.type === "speech" ? [index] : []);

    for (let speechIndex = 1; speechIndex < speechIndexes.length; speechIndex += 1) {
      const previousIndex = speechIndexes[speechIndex - 1];
      const nextIndex = speechIndexes[speechIndex];
      if (previousIndex === undefined || nextIndex === undefined) continue;

      const previousSpeech = parsedScript.nodes[previousIndex];
      const nextSpeech = parsedScript.nodes[nextIndex];
      if (previousSpeech?.type !== "speech" || nextSpeech?.type !== "speech") continue;

      const boundaryNodes = parsedScript.nodes.slice(previousIndex + 1, nextIndex);
      const paragraphBreaks = boundaryNodes.flatMap((node) => node.type === "paragraphBreak" ? [{
        nodeOrdinal: node.ordinal,
        range: node.range
      }] : []);
      if (paragraphBreaks.length === 0) continue;

      const explicitPauseNodeOrdinals = boundaryNodes.flatMap((node) => node.type === "pause" ? [node.ordinal] : []);
      audits.push({
        status: explicitPauseNodeOrdinals.length > 0 ? "suppressedByExplicitPause" : "applied",
        pauseId: configuration.pauseId,
        durationMs: configuration.durationMs,
        previousSpeechNodeOrdinal: previousSpeech.ordinal,
        nextSpeechNodeOrdinal: nextSpeech.ordinal,
        paragraphBreaks,
        explicitPauseNodeOrdinals
      });
    }
  }

  return ResolveParagraphPausesResultSchema.parse({
    pacingVersion: PARAGRAPH_PACING_VERSION,
    configuration,
    audits
  });
}
