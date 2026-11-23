# StudyNarrator AI Script Grammar v1

`SCRIPT_GRAMMAR_VERSION = 1` is deterministic. Sections and paragraph boundaries are line-oriented; speaker and pause control tokens are recognized anywhere in speech.

```ebnf
document       = { line, newline } ;
line           = blank | section | flow ;
blank          = { whitespace } ;
section        = indentation, "[section:", section-title, "]", trailing-whitespace ;
flow           = indentation, { speech-fragment | pause | speaker } ;
pause          = "[", "pause_", identifier-tail, "]" ;
speaker        = "[speaker_", speaker-id, [ "|", voice-hint ], "]" ;
speaker-id     = letter-or-digit, { letter | digit | "_" | "-" } ;
voice-hint     = letter-or-digit, { letter | digit | "." | "_" | "-" } ;
annotation     = "{{", display-text, "|", sense-id, "}}" ;
sense-id       = ( letter | digit | "_" | "-" ), { letter | digit | "_" | "-" } ;
escaped-bracket = "\\[" ;
```

Bare speech begins under the system default speaker `narrator`. A caller may provide an explicit default-speaker override. `[speaker_<name>]` changes the active speaker from either default and may occur anywhere in speech: text before it is emitted under the previous speaker, text after it uses the new speaker, and that speaker remains active across later lines until another speaker token. The discovered name after `speaker_` uses `[A-Za-z0-9][A-Za-z0-9_-]*`, so `[speaker_1bad]` discovers `1bad` for later voice mapping. A valid pause may likewise occur anywhere; speech is split around it and the CIR emits the pause between those speech nodes. Section directives still occupy their own line and require a nonempty title.

A speaker directive may carry an optional voice hint after one `|`, for example `[speaker_alice|af_heart]`. The hint is additive to grammar v1: it switches the active speaker exactly like `[speaker_alice]`, never becomes speech, and never changes the speaker ID or how speech is split. The hint names a model voice ID, not a model, and is at most 500 characters. The parser records the first hint for each speaker in `discoveries.speakers[].voiceHint`; the key is omitted when a speaker has no hint. A later tag without a hint, or with the same hint, uses that voice too. A later tag with a different hint keeps the first one and produces the non-blocking warning `CONFLICTING_SPEAKER_VOICE_HINT`, which can be ignored by its exact tag. An empty hint, a second `|`, or a character outside `[A-Za-z0-9._-]` produces the blocking `INVALID_SPEAKER_VOICE_HINT` diagnostic, and the tag remains literal speech under the active speaker. The parser has no voice catalog: Project Settings reports a hinted voice that the selected model does not offer with the non-blocking `SCRIPT_VOICE_UNAVAILABLE` warning and uses the usual default voice instead.

Project Settings resolves each speaker's voice in this order: a voice chosen in Settings (a saved override), then a usable script voice hint, then the connection default or first enabled voice. The voice list marks the script's voice with `*`. Choosing any other voice records an override with the project; choosing the `*` voice again clears the override so the speaker follows the script. Rendering and previews use the resolved voice saved with the project. See [ADR 0002](adr/0002-script-voice-hints.md). Pronunciation annotations are single-line, have nonempty display text, and use a sense matching `[A-Za-z0-9_-]+`.

`\[` and `\{{` anywhere in speech produce literal readable text by removing only the escape character. Other bracket text remains literal unless it is a valid `speaker_` or `pause_` token. Runs of whitespace-only lines become one `paragraphBreak` node. The parser never converts that node into silence; a separate transition resolver may map an eligible boundary to the configured automatic paragraph pause without changing the CIR.

Unknown or malformed beginning-of-line directives, malformed inline `speaker_` or `pause_` tokens, and malformed annotations produce blocking diagnostics, but their exact source text is retained as literal speech under the active speaker. They are never inferred to be controls. Before voice hints, a tag such as `[speaker_alice|af_heart]` was an `INVALID_SPEAKER_DIRECTIVE` kept as literal speech; a suppression saved for that pattern no longer applies because the tag is now a valid control, so escape it as `\[speaker_alice|af_heart]` to keep it spoken. Each diagnostic keeps the full `offendingText` line for context and a focused `ignorePattern` for the malformed token. A caller suppresses every matching occurrence by matching the diagnostic `code` and `ignorePattern`; surrounding sentence text is irrelevant, and suppression does not alter recovered speech nodes. The Projects validation workflow persists these personal preferences. Named-sense existence is resolved by the lexicon transformer, not by this grammar.
