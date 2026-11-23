# ADR 0002: Script voice hints with persisted Settings overrides

## Status

Accepted.

## Context

Writers want a script to choose a speaker's voice, for example `[speaker_alice|af_heart]`, instead of setting every voice by hand in Project Settings. Speaker voices already live in the project's saved speaker mappings, and rendering and previews read only those saved voices. Project Settings fills a missing or unusable voice with the connection default, or the first enabled voice, as soon as a speaker appears, and saves it. Before this decision, nothing recorded whether a saved voice was chosen by a person or filled automatically, so a rule such as "the script fills only an empty voice" would ignore a hint added to any speaker that had already received a default.

The PRD requires the UI to keep a script speaker ID distinct from a model voice ID, and the parser must stay deterministic and offline, without the voice catalog.

## Decision

- Grammar v1 gains an optional voice hint in the speaker directive: `[speaker_<id>|<voice-id>]`. `SCRIPT_GRAMMAR_VERSION` stays 1 because every existing script parses identically and stored render snapshots record grammar version 1.
- The parser records the first hint per speaker. A different later hint is a non-blocking `CONFLICTING_SPEAKER_VOICE_HINT` warning, and the first hint wins. A malformed hint is a blocking `INVALID_SPEAKER_VOICE_HINT` diagnostic and stays literal speech, consistent with ADR 0001.
- Each saved speaker mapping has a persisted `voiceOverride` flag (database schema 15, `speaker_mappings.voice_override`). The effective voice is resolved as: a saved override whose voice is usable, then a usable script hint, then the existing default chain.
- The Settings voice list is never locked. It marks the script's voice with `*` and the text "script default". Choosing another voice saves an override. Choosing the `*` voice clears the override, so the speaker follows the script again. Automatic default filling never sets the override.
- A hint the selected model does not offer, or that is disabled, is reported in Project Settings as the non-blocking `SCRIPT_VOICE_UNAVAILABLE` warning, and the default chain applies.
- The resolved voice is written to the mapping's `voiceId` and saved, so rendering and previews keep reading only saved voices.
- Migration 15 marks every existing mapping that already has a voice as an override. Those voices were chosen or accepted before hints existed, so no existing project's audio can change when a hint is later added; choosing the `*` voice opts the speaker into the script hint. Mappings without a voice are not overrides.
- `voiceOverride` is optional in the shared speaker mapping schema. Render snapshots written before schema 15 omit it and keep their recorded hashes; an omitted flag means "not overridden". A REST or IPC client that replaces a project without the flag therefore clears overrides.

## Consequences

Scripts can carry voices, and people can still change any voice in Settings. Hints apply only when a project is opened in the Web or Electron UI, which is when voices are resolved and saved; projects changed only through the API keep their saved voices until then. The prompt kit (create and update prompts, and the skill package's `SCRIPT_FORMAT.md`) tells an LLM that a script may use any number of speakers, teaches the `[speaker_<id>|<voice-id>]` form on a speaker's first directive, and lists the bundled Kokoro 82M v1.0 ONNX voice IDs so generated hints match the catalog.
