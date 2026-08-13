# ADR 0001: Explicit speaker directives and permissive script recovery

## Status

Accepted.

## Context

The original grammar treated any valid-looking bracket token as a speaker and omitted malformed directive or annotation lines from speech. That made a line such as `[section Database indexes]` ambiguous: it could be mistaken for a custom speaker even though the author intended a malformed section. It also prevented authors from intentionally sending malformed-looking text to the speech service after reviewing the warning.

## Decision

- Only `[speaker_<name>]` declares a speaker. The prefix is syntax; the discovered name excludes `speaker_` and may begin with a number.
- Valid speaker and pause tokens may occur anywhere in speech. Both split speech at their source position; a pause emits a pause node, while a speaker token changes the active speaker for all following text and lines until the next speaker token.
- `\[` escapes an otherwise valid inline control token and leaves it as readable literal text.
- Unknown or malformed directives and malformed pronunciation annotations produce diagnostics and remain literal speech under the active speaker.
- A user may suppress a diagnostic by code and focused malformed-token pattern. The full offending line remains diagnostic context, but surrounding sentence text does not participate in matching. Suppression applies to every occurrence of that pattern and does not change CIR recovery behavior.
- Diagnostic suppressions are persisted as personal preferences with the rest of application storage and are managed from the Projects validation workflow.

## Consequences

Speaker discovery cannot confuse unknown bracket text with a speaker. Authors keep control of what ultimately reaches speech synthesis, while diagnostics still block rendering by default. Existing scripts using bare speaker tags must migrate to the explicit `speaker_` form.
