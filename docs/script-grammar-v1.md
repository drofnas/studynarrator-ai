# StudyNarrator Script Grammar v1

`SCRIPT_GRAMMAR_VERSION = 1` is deterministic. Sections and paragraph boundaries are line-oriented; speaker and pause control tokens are recognized anywhere in speech.

```ebnf
document       = { line, newline } ;
line           = blank | section | flow ;
blank          = { whitespace } ;
section        = indentation, "[section:", section-title, "]", trailing-whitespace ;
flow           = indentation, { speech-fragment | pause | speaker } ;
pause          = "[", "pause_", identifier-tail, "]" ;
speaker        = "[speaker_", speaker-id, "]" ;
speaker-id     = letter-or-digit, { letter | digit | "_" | "-" } ;
annotation     = "{{", display-text, "|", sense-id, "}}" ;
sense-id       = ( letter | digit | "_" | "-" ), { letter | digit | "_" | "-" } ;
escaped-bracket = "\\[" ;
```

Only `[speaker_<name>]` changes the active speaker. It may occur anywhere in speech: text before it is emitted under the previous speaker, text after it uses the new speaker, and that speaker remains active across later lines until another speaker token. The discovered name after `speaker_` uses `[A-Za-z0-9][A-Za-z0-9_-]*`, so `[speaker_1bad]` discovers `1bad` for later voice mapping. A valid pause may likewise occur anywhere; speech is split around it and the CIR emits the pause between those speech nodes. Section directives still occupy their own line and require a nonempty title. Pronunciation annotations are single-line, have nonempty display text, and use a sense matching `[A-Za-z0-9_-]+`.

`\[` and `\{{` anywhere in speech produce literal readable text by removing only the escape character. Other bracket text remains literal unless it is a valid `speaker_` or `pause_` token. Runs of whitespace-only lines become one `paragraphBreak` node and do not imply silence.

Unknown or malformed beginning-of-line directives, malformed inline `speaker_` or `pause_` tokens, and malformed annotations produce blocking diagnostics, but their exact source text is retained as literal speech under the active speaker. They are never inferred to be controls. Each diagnostic keeps the full `offendingText` line for context and a focused `ignorePattern` for the malformed token. A caller suppresses every matching occurrence by matching the diagnostic `code` and `ignorePattern`; surrounding sentence text is irrelevant, and suppression does not alter recovered speech nodes. Script Lab keeps these suppressions in memory for G02, while durable personal preferences are deferred to G04. Named-sense existence is resolved by G03, not by this grammar.
