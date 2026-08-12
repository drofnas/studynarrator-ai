# Product Requirements Document: StudyNarrator

**Product name:** StudyNarrator  
**Document status:** Draft v1.3  
**Date:** August 10, 2026  
**Primary usage:** Local-first, self-hosted, single-user  
**Supported v1 distributions:** Docker Web UI and Electron desktop application  
**Application stack:** React + TypeScript, Node.js + TypeScript, and Electron  
**Open-source license:** Apache License 2.0  
**Naming status:** Selected working name; trademark, domain, and package-name clearance remain release tasks  
**External TTS backend:** Speaches with `speaches-ai/Kokoro-82M-v1.0-ONNX`

---

## 1. Executive Summary

StudyNarrator is a lightweight, local-first authoring and rendering harness that sits in front of a separately installed Speaches text-to-speech server. It converts a structured plain-text script into polished audio while adding deterministic controls that are not available in a basic text-file-to-MP3 shell script.

The product name describes the user outcome rather than a specific model or server. StudyNarrator may render a single narrator or a multi-speaker study dialogue, and its identity, project format, and UI must not imply ownership of or exclusive coupling to Speaches, Kokoro, or any future TTS backend.

Version 1 supports two application distributions:

1. A Docker-based Web UI that connects to an existing Speaches endpoint through environment configuration.
2. An Electron desktop application for Windows, macOS, and Linux that connects to a local or private-network Speaches endpoint through application settings.

StudyNarrator does **not** install, bundle, launch, update, or administer Speaches in version 1. Users who do not already have Speaches can follow the official upstream documentation:

- [Speaches installation guide](https://speaches.ai/installation/)
- [Speaches text-to-speech guide](https://speaches.ai/usage/text-to-speech/)

After Speaches is available, the user supplies its base URL and optionally an API key. The application validates that connection and uses the configured OpenAI-compatible speech endpoint.

The application will support:

- A reusable pronunciation lexicon for technical terms, names, acronyms, and words with multiple meanings.
- Multiple speakers in one script, with each speaker mapped to a different configured TTS voice.
- Named pause directives with user-configurable durations.
- Automatic detection of speakers, pause names, sections, and pronunciation annotations when a script is pasted or uploaded.
- A Quick Scratchpad for testing a short passage, voice, pronunciation, and server connection without creating or changing a full project.
- Friendly voice labels that show useful language, accent, or style metadata while keeping the underlying voice ID visible.
- Short previews before rendering an entire document.
- An integrated, seekable audio player with a compact waveform for previews, completed renders, and individual rendered segments.
- Expandable render history with per-segment play, copy, and explicit save actions.
- Detailed progress that identifies the current phase, section, speech segment, synthesis chunk, cache activity, and failure location.
- Segment-level caching so that changing a pause, voice assignment, or one sentence does not require regenerating every unchanged segment.
- Low-memory, streaming lossless assembly so long study guides do not require the complete combined audio to reside in the Node.js heap.
- Exportable prompts and reusable instruction files that help an external LLM create valid scripts.
- No embedded LLM, cloud dependency, semantic rewriting, or nondeterministic content generation.
- A shared React and Node.js codebase across the Docker Web UI and Electron application.

The source script remains authoritative. Every transformation is inspectable, reproducible, and reversible. Both v1 distributions use the same TypeScript parser, project schema, lexicon engine, rendering services, cache rules, and Speaches adapter.

---

## 2. Problem Statement

The existing shell script can take a text file and produce an MP3, but it treats the input as one uninterrupted block of literal text. This creates several practical problems for long study guides, conversations, and technical material.

### 2.1 Pronunciation problems

Text-to-speech models may pronounce technical terms or ambiguous words incorrectly. Examples include:

- `SQL` should sometimes be spoken as “sequel” and sometimes as “S Q L.”
- `resume` may mean a curriculum vitae or the act of continuing.
- Product names, surnames, abbreviations, programming symbols, and domain-specific vocabulary may need custom spoken forms.

A simple global search-and-replace is not sufficient because:

- Some words have multiple valid pronunciations.
- Longer phrases should take precedence over shorter terms.
- Replacements must not alter the original source script.
- Users need project-level overrides without changing their global dictionary.

### 2.2 Single-voice output

Long study material is easier to follow when multiple roles use distinct voices. A teacher-and-student format, interviewer-and-candidate format, or narrator-and-expert format can provide structure without requiring a full podcast-production tool.

The existing script cannot interpret speaker markers or switch voices within one output file.

### 2.3 Inadequate pacing

Punctuation alone does not provide reliable control over silence. Users need explicit short pauses between speakers and longer pauses between subjects. The meaning of a pause name should be stable within a project while its actual duration remains editable in the UI.

### 2.4 Script creation friction

External LLMs can rewrite source material into a useful spoken script, but they need an exact output contract. Without one, they may add Markdown fences, inconsistent speaker labels, unsupported commands, or prose that the harness cannot parse.

The application should generate a prompt or reusable skill file for Claude, ChatGPT, Gemini, or another external model without directly connecting to any LLM.

### 2.5 Expensive corrections

A small change to one word or one pause should not force the user to regenerate a long audio file from the beginning. The harness needs reusable speech segments and deterministic assembly.

### 2.6 External dependency setup friction

StudyNarrator requires a working Speaches server, but Speaches has its own installation choices, hardware considerations, release cadence, and model-management workflow. Reproducing or owning that setup inside the initial harness would expand the product far beyond its core purpose.

Version 1 therefore needs a clear dependency boundary:

- StudyNarrator provides direct links to the official Speaches installation and TTS documentation.
- The user installs and operates Speaches independently.
- The Web UI receives the endpoint through `.env` configuration.
- The Electron application receives the endpoint through a first-run connection screen and Settings.
- StudyNarrator tests connectivity and reports actionable errors, but it does not manage Speaches processes, containers, models, GPUs, or upgrades.

This keeps the initial release focused while leaving integrated installation packages as a possible future version.

---

## 3. Product Goals

### 3.1 Primary goals

1. Convert a structured text script into one combined audio file using one or more configured TTS voices.
2. Give users deterministic control over pronunciation, speaker assignment, timing, and output structure.
3. Detect all required script configuration immediately after paste or upload.
4. Make pronunciation and pacing easy to test before a full render.
5. Preserve a lightweight local deployment with minimal infrastructure.
6. Keep source material, configuration, generated audio, and logs on the user’s machine or within the user-selected private Speaches connection.
7. Generate portable instructions that external LLMs can use to create valid scripts.
8. Provide a Docker Web UI that can be installed without cloning the source repository.
9. Provide an Electron desktop application for Windows, macOS, and Linux.
10. Use React and TypeScript for the UI and Node.js with TypeScript for the shared application and rendering services.
11. Let users connect to Speaches on the same machine or elsewhere on a private network without changing application code.
12. Keep Speaches installation and lifecycle management outside the v1 product boundary.
13. Make short experimentation faster through a project-independent Quick Scratchpad.
14. Make long renders inspectable through detailed progress, seekable playback, and segment-level history actions.
15. Assemble long-form lossless audio with bounded application memory rather than accumulating the entire result in memory.

### 3.2 Success criteria

Version 1 is successful when a user can:

- Paste the sample two-speaker script.
- See two speakers and two pause presets detected automatically.
- Assign a different voice to each speaker.
- Set concrete durations for `pause_short` and `pause_long`.
- Add `SQL → sequel` to the lexicon.
- Use explicit annotations to distinguish the two meanings of `resume`.
- Test a short passage in the Quick Scratchpad before creating or rendering a full project.
- Preview a selected line.
- Seek through a completed render using its compact waveform.
- Expand the completed render and play, copy, or explicitly save an individual rendered segment.
- Render one MP3 with the correct voices, pronunciations, and silences.
- Change only `pause_long`, rerender, and reuse all previously generated speech segments.
- Export a prompt that instructs an external LLM to produce the same valid script format.
- Start the Docker Web UI from a supplied Compose file and `.env` that points to an existing Speaches server.
- Install the Electron application, configure a local or LAN Speaches endpoint, and complete the same project and render workflow.
- Open the official Speaches setup documentation from onboarding when no endpoint is available.
- Use either v1 client without installing Python or a separate StudyNarrator backend runtime.

---

## 4. Non-Goals

The following are explicitly outside version 1:

- Direct integration with Claude, ChatGPT, Gemini, Ollama, or another LLM.
- Automatic semantic rewriting of source material.
- Automatic contextual guessing for ambiguous pronunciations.
- Voice cloning or training custom voices.
- Speech recognition or audio transcription.
- A multitrack digital audio workstation.
- Waveform-level manual editing. Version 1 may display a seekable waveform overview, but it is not a waveform editor or digital audio workstation.
- Background music, sound effects, or audio mixing beyond speech, silence, gain adjustment, and normalization.
- Real-time collaborative editing.
- Cloud accounts, subscriptions, billing, or multi-tenant hosting.
- A public internet-facing service by default.
- Bundling Speaches, Kokoro model weights, or a Speaches Docker Compose file with the v1 release.
- Installing, starting, stopping, updating, or monitoring the lifecycle of Speaches containers or processes.
- Selecting or configuring CPU, CUDA, ROCm, or other Speaches acceleration modes.
- Downloading or administering Speaches models on the user’s behalf.
- A command-line client, incoming-folder watcher, or shell-script-compatible batch interface in v1.
- A Python or FastAPI runtime for StudyNarrator.
- Managing arbitrary remote Docker hosts, Kubernetes clusters, or public cloud infrastructure.
- Guaranteed bit-for-bit identical audio across different operating systems, hardware, model versions, or audio encoders. The harness’s parsing and transformation decisions must be deterministic; backend inference and encoding may vary by runtime.

---

## 5. Target Users and Use Cases

### 5.1 Primary user

A local-first user who wants to create long-form spoken study material, tutorials, interview preparation, articles, or conversational explanations through a Speaches server they control.

### 5.2 Core use cases

#### Study guide conversion

A user asks an external LLM to convert a technical study guide into a conversation between a teacher and a student. The user pastes the result into StudyNarrator, maps each role to a voice, checks technical pronunciations, and renders a combined MP3.

#### Single-narrator audiobook-style output

A user imports a script with one narrator, section markers, and long pauses. The application creates one combined MP3 plus optional per-section files when that output is enabled.

#### Pronunciation correction

A generated preview pronounces a product name incorrectly. The user selects the term, adds a project lexicon entry, previews it again, and rerenders only affected segments.

#### Ambiguous word handling

The user needs “resume” pronounced differently in two places. The source script uses explicit sense annotations rather than asking the harness to guess from context.

#### Existing local Speaches server

A user already has Speaches running on the same computer. They start the StudyNarrator Docker Web UI with `SPEACHES_BASE_URL=http://host.docker.internal:8000`, or they configure the Electron application with `http://localhost:8000`.

#### Private-network Speaches server

A user runs Speaches on a workstation or home server. The Docker Web UI or Electron application connects through a private hostname or IP address while all script editing and project storage remain local to StudyNarrator.

#### User without Speaches

A user opens StudyNarrator but has not installed Speaches. The application explains that synthesis requires the external service, links to the official installation and TTS guides, and still permits offline script editing, parsing, lexicon work, and prompt export.

#### Desktop application

A user installs StudyNarrator as a normal Electron application on Windows, macOS, or Linux. They use native file dialogs and export controls while connecting to a separately operated local or private-network Speaches server.

---

## 6. Product Principles

### 6.1 Deterministic before intelligent

The application should use explicit rules rather than probabilistic inference. A user must be able to inspect why a word, voice, or pause was selected.

### 6.2 The original script is never destructively modified

Pronunciation replacement occurs in a generated speech representation. The application must retain:

- Original script text.
- Parsed structure.
- Transformed TTS text.
- Lexicon matches.
- Render configuration.

### 6.3 The script is portable

A script should remain understandable in a text editor and should not require a proprietary binary format.

### 6.4 Errors should be caught before synthesis

Unknown directives, unmapped speakers, invalid pause values, and unresolved pronunciation aliases should be shown during parsing rather than after a long render begins.

### 6.5 Correct only what changed

Speech should be synthesized as reusable segments. A change to one segment should invalidate only that segment and the final assembly, not the entire project.

### 6.6 Local-first and private

The application must not send script content, audio, analytics, or error reports to an unrelated external service. Speaches is treated as a user-configured local or private-network dependency.

### 6.7 Keep infrastructure proportional to the task

The default deployment should not require Redis, Celery, Kafka, object storage, or an external database. SQLite, the local filesystem, an in-process render queue, and FFmpeg are sufficient for the intended single-user workload.

### 6.8 One TypeScript application across two clients

The Docker Web UI and Electron desktop application must share the same React components, TypeScript domain models, parser, validation rules, lexicon engine, rendering services, cache behavior, and project schema. REST and Electron IPC are transport adapters, not separate implementations of product behavior.

### 6.9 Keep Speaches outside the v1 application boundary

StudyNarrator depends only on the documented Speaches HTTP API. Version 1 does not own Speaches installation artifacts, container definitions, hardware configuration, model downloads, or process lifecycle. The product should link to upstream documentation rather than copy instructions that may become stale.

### 6.10 Keep the v1 product UI-first

The supported user surfaces are the Docker Web UI and Electron application. A CLI, folder watcher, public API, or combined deployment may be added later, but those interfaces must not delay the initial harness.

---

## 7. Scope and Priority

### 7.1 P0: Version 1 requirements

- Local project creation and persistence.
- Script paste and `.txt` upload.
- Automatic script parsing.
- Section marker detection and section-boundary behavior.
- Multiple speaker detection and voice mapping.
- Named pause detection and duration mapping.
- Reusable global and project lexicons.
- Explicit pronunciation-sense annotations.
- Quick Scratchpad for short voice, pronunciation, and connection tests.
- Segment preview.
- Friendly voice labels with raw voice-ID visibility.
- Integrated player with compact waveform and seeking.
- Expandable render history with segment-level play, copy, and explicit save actions.
- Full render to MP3.
- WAV segment generation and deterministic, streaming final assembly.
- Segment-level cache.
- Detailed phase, section, segment, and synthesis-chunk progress, with failure reporting, retry, and cancellation.
- Original transcript, transformed transcript, and render manifest.
- Universal external-LLM prompt export.
- Reusable skill or instruction-package export.
- React + TypeScript frontend.
- Node.js + TypeScript application services and web backend.
- Production Docker image containing only StudyNarrator.
- Application-only Compose file and `.env.example` for connecting to an existing Speaches endpoint.
- Electron packages for Windows, macOS, and Linux using the same React UI and shared TypeScript core.
- First-run connection setup, connection status, and actionable diagnostics.
- Direct links to the official Speaches installation and TTS documentation.
- Offline editing, parsing, lexicon management, and prompt export when Speaches is unavailable.
- Default local-only Web UI binding.
- Apache-2.0 release licensing, third-party notices, an About/Credits view, and the upstream acknowledgments defined in Section 23.

### 7.2 P1: High-value follow-up requirements

These may follow the first usable v1 release without changing the two supported v1 distributions:

- `.md` upload and conservative Markdown cleanup.
- Optional per-section audio output.
- Chapter/timestamp manifest.
- Project import/export bundle.
- Lexicon CSV/JSON import and export.
- Acronym and unusual-token review panel.
- Voice sample catalog.
- Final WAV output in addition to MP3.
- Optional loudness normalization.
- Signed and notarized desktop installers where release infrastructure and project funding permit.
- Optional desktop auto-update with an explicit user-controlled update policy.
- Additional validated processor architectures where the complete dependency chain is supported.

### 7.3 Explicitly deferred from version 1

The following belong in the Future Versions section and are not hidden v1 deliverables:

- A Docker Compose stack that bundles StudyNarrator with Speaches.
- A Speaches-only Docker Compose package.
- CPU, CUDA, ROCm, or other Speaches deployment variants.
- Guided Speaches model installation or download management.
- Starting or stopping Speaches from the Electron application.
- Command-line rendering and incoming-folder automation.
- Public REST or MCP integration APIs.
- Additional TTS backend adapters.
- Multi-user or authenticated LAN-server mode.

---

## 8. End-to-End User Workflow

### 8.1 Install, launch, and connect

Speaches is an external prerequisite for preview and rendering. A user who does not have it can follow:

- [Official Speaches installation guide](https://speaches.ai/installation/)
- [Official Speaches text-to-speech guide](https://speaches.ai/usage/text-to-speech/)

The user then chooses one of two StudyNarrator paths:

1. **Docker Web UI:** copy `.env.example` to `.env`, set `SPEACHES_BASE_URL`, and start the supplied StudyNarrator Compose file.
2. **Electron desktop application:** install the native package, open the first-run connection screen, and enter a local or private-network Speaches endpoint.

At startup, the application must:

- Load the effective Speaches connection from environment variables or saved desktop settings.
- Start even when Speaches is temporarily unavailable.
- Show a clear disconnected state rather than a blank page or fatal startup error.
- Provide the official setup links when no endpoint has been configured.
- Offer a connection test that distinguishes URL, DNS, TCP, HTTP, authentication, model, voice, and audio-response failures.
- Explain whether a setting is editable in the UI or managed by the Docker environment.
- Never attempt to install, update, start, stop, or reconfigure Speaches.

Before creating a project, the user may open the **Quick Scratchpad**, choose a connection profile and voice, enter a short passage, and synthesize it through the same adapter used by project previews. This provides a fast connection, voice, and pronunciation check without introducing project state.

### 8.2 Create or open a project

The user creates a project and provides:

- Project name.
- Speaches connection profile, preselected from the installation default when available.
- TTS model ID.
- Default output directory or export behavior.
- Optional default narrator.

Recommended defaults:

- Connection profile: current installation default.
- Model: `speaches-ai/Kokoro-82M-v1.0-ONNX`
- Output format: MP3
- TTS segment format: WAV
- Voice speed: `1.0`

The endpoint and API key belong to the installation-local connection profile rather than the portable project itself.

### 8.3 Paste or upload a script

The user pastes plain text or uploads a `.txt` file. The parser runs automatically and reports:

- Detected speaker IDs.
- Detected pause IDs.
- Detected sections.
- Pronunciation aliases.
- Character count.
- Estimated speech-segment count.
- Errors and warnings with line numbers.

### 8.4 Configure discovered items

The UI creates editable rows for every discovered speaker and pause.

For each speaker, the user selects:

- Voice ID.
- Speed.
- Optional gain adjustment.
- Optional role description used only in exported LLM instructions.

For each pause, the user selects:

- Duration in milliseconds or seconds.
- Optional description used in exported LLM instructions.

### 8.5 Review pronunciation

The user can:

- Search global and project lexicons.
- Add a new exact term or phrase.
- Create two or more named senses for an ambiguous term.
- See every matching occurrence in the script.
- Compare original text with transformed TTS text.
- Preview a short sample using a selected speaker.

### 8.6 Dry run

Before synthesis, the user runs validation and sees an ordered segment table containing:

- Segment number.
- Segment type: speech, pause, or section.
- Speaker.
- Voice.
- Original text.
- Transformed TTS text.
- Estimated or configured duration.
- Cache status.
- Validation status.

A dry run is available while Speaches is offline except for checks that require a live voice or audio response. Those checks are marked as pending rather than incorrectly reported as parser failures.

### 8.7 Render

The user starts a render. The application:

1. Freezes a versioned project snapshot.
2. Parses and validates again.
3. Applies deterministic text transformations.
4. Reuses cached speech chunks when possible.
5. Requests only missing speech chunks from Speaches.
6. Generates exact-duration silence segments.
7. Concatenates lossless intermediate audio.
8. Optionally normalizes loudness when enabled.
9. Encodes the final MP3.
10. Writes transcripts, checksums, and a render manifest.
11. Opens the completed output in the shared player and creates an expandable history entry whose child rows represent the rendered segments.

During synthesis, the UI reports the current phase, section, speech segment, generated/requested chunk count, cache hits, and any segment-specific error.

### 8.8 Correct and rerender

After listening, the user changes a pronunciation, sentence, voice, or pause value. The application identifies which cache keys changed and regenerates only the affected speech chunks before rebuilding the final artifact.

The user may expand either render, play the exact affected segment, copy its readable or transformed text, and explicitly save that segment audio for comparison without rerendering it.

## 9. Script Format Specification

### 9.1 Design goals

The format must be:

- Readable as ordinary text.
- Easy for an external LLM to generate.
- Easy to parse without ambiguous natural-language rules.
- Backward compatible with a simple one-speaker text file.
- Strict enough to validate before synthesis.

Sections and paragraph boundaries are line-oriented. Valid `speaker_` and `pause_` control tokens are recognized anywhere in speech and split the canonical speech nodes at their exact source position. Other bracketed text is ordinary spoken text unless it is malformed reserved control syntax.

### 9.2 Speaker directives

A speaker directive changes the active speaker and remains active until another speaker directive appears.

Supported forms:

```text
[speaker_person_a]
This is spoken by person A.
```

```text
[speaker_person_a] This is also spoken by person A.
```

Rules:

- Only a directive beginning with `speaker_` declares a speaker; the prefix is not part of the discovered name.
- Speaker names may contain letters, numbers, underscores, and hyphens and must begin with a letter or number.
- Speaker IDs are case-sensitive in the script but the UI should warn about IDs that differ only by case.
- A speaker tag may occur anywhere in a line. Text before it uses the previous speaker; text after it uses the new speaker.
- The selected speaker remains active across subsequent lines until another speaker tag appears.
- Text before the first speaker tag uses the configured default speaker.
- If no default speaker is configured, text before the first speaker tag is a blocking validation error.
- A speaker may be mapped to the same voice as another speaker.

### 9.3 Pause directives

A pause directive inserts digital silence with an exact configured duration.

```text
[pause_short]
```

```text
[pause_long]
```

Rules:

- Any directive whose ID begins with `pause_` is treated as a pause preset.
- A pause directive may occur anywhere in a line. Speech before and after it becomes separate speech nodes with the pause emitted between them.
- Pause presets are automatically discovered from the script.
- A project may define pause presets that do not currently appear in the script.
- Duration is stored internally in milliseconds.
- The UI may accept values such as `350 ms`, `0.35 s`, or `1.5 s` and normalize them to milliseconds.
- Recommended allowed range: 0 through 30,000 milliseconds.
- A zero-duration pause is valid and useful when temporarily disabling a pause without editing the script.

Recommended starter defaults:

| Pause ID | Default duration | Intended use |
|---|---:|---|
| `pause_short` | 350 ms | Speaker handoff or a brief thinking beat |
| `pause_medium` | 750 ms | Paragraph or subtopic separation |
| `pause_long` | 1,500 ms | Major subject or section separation |

These are editable defaults, not model behavior.

### 9.4 Section directives

A section directive identifies a logical subject boundary.

```text
[section: Database indexes]
```

Rules:

- Section directives must be on their own line.
- A section creates a manifest marker but does not speak the section title by default.
- A setting may optionally speak section titles using a selected narrator.
- A section may automatically insert a configured section pause.
- An explicit pause immediately adjacent to a section takes precedence and prevents an automatic duplicate pause.
- Sections enable optional per-section audio files and future chapter-aware output.

### 9.5 Explicit pronunciation-sense annotations

Global replacement cannot safely distinguish every ambiguous word. The script therefore supports explicit named senses.

Syntax:

```text
{{display text|sense}}
```

Examples:

```text
Please update your {{resume|cv}} before the interview.
```

```text
After the service restarts, processing will {{resume|continue}}.
```

The lexicon may contain:

| Display text | Sense | Spoken form |
|---|---|---|
| `resume` | `cv` | `rez-oo-may` |
| `resume` | `continue` | `ree-zoom` |

Rules:

- The readable transcript displays only the display text.
- The transformed TTS transcript contains the spoken form.
- An unresolved sense is a blocking validation error.
- Sense names use letters, numbers, underscores, and hyphens.
- Sense lookup is exact and deterministic.
- The harness does not infer a sense from surrounding prose.
- Malformed annotation markup produces a diagnostic and remains literal speech unless the author fixes it.

### 9.6 Escaping directives

To speak text that resembles a control token anywhere in a line, prefix the opening bracket with a backslash.

```text
\[not_a_speaker] This line is spoken literally.
```

To speak literal pronunciation markup, escape its opening braces.

```text
\{{example|literal}}
```

The readable transcript removes only the escape character. This also prevents an escaped inline `speaker_` or `pause_` token from changing the CIR.

### 9.7 Blank lines and paragraphs

Blank lines preserve paragraph boundaries in the parsed representation but insert no silence by default.

The project may configure an automatic paragraph pause. Explicit pause directives adjacent to a blank-line boundary override the automatic paragraph pause.

### 9.8 Unknown directives

A bracketed token is interpreted as one of the following:

1. A valid `pause_*` or `speaker_*` control token anywhere in speech.
2. A valid `section:` directive when it occupies its own line.
3. A malformed reserved token when it uses reserved syntax but fails validation.
4. Ordinary literal bracketed speech otherwise.

An unknown or malformed directive produces a blocking diagnostic and remains literal speech under the active speaker. It is never inferred to be a speaker. Diagnostics retain the full offending line for context and a focused malformed-token pattern for suppression. The user may suppress every occurrence matching the same diagnostic code and token pattern, regardless of surrounding sentence text; suppression keeps literal speech unchanged. G02 holds these preferences in memory, and G04 persists them as personal application data.

### 9.9 Example script

```text
[section: Resumes and background processing]

[speaker_teacher] Today we will compare two meanings of the word {{resume|cv}}.
[pause_short]
[speaker_student] That is the document I send with a job application.
[pause_short]
[speaker_teacher] Correct. In a different context, a paused job can {{resume|continue}} after a restart.
[pause_long]

[section: SQL pronunciation]

[speaker_teacher] In this project, SQL is pronounced according to the project lexicon.
[pause_short]
[speaker_student] The lexicon can use sequel here while another project could use S Q L.
```

---

## 10. Functional Requirements

### 10.1 Version 1 distribution and dependency model

StudyNarrator version 1 must be released through two supported application distributions. Speaches is a separately installed external dependency in both modes.

#### 10.1.1 Shared distribution requirements

Both distributions must:

- Use the same React UI, shared TypeScript packages, project schema, parser, lexicon rules, cache-key rules, renderer, and Speaches adapter.
- Run without requiring a source-code checkout.
- Run without requiring Python or FastAPI.
- Display the application version, schema version, client type, data directory, FFmpeg availability, and effective Speaches endpoint in diagnostics.
- Persist projects, global lexicon entries, render history, artifacts, and cache data across restarts and upgrades.
- Start the UI even if Speaches is offline.
- Keep TTS requests outside the browser renderer. The Web browser and Electron renderer must not receive a Speaches API key or call Speaches directly.
- Accept a Speaches root URL such as `http://server:8000` and safely normalize an OpenAI-style URL ending in `/v1` without producing `/v1/v1/audio/speech`.
- Support loopback, Docker-host, DNS-hostname, and private-network endpoints.
- Include a tested upgrade path and document which directories or volumes must be backed up.
- Publish checksums for downloadable release artifacts.
- Clearly state that Speaches is not bundled and must be installed and operated separately.
- Provide links to the official [Speaches installation guide](https://speaches.ai/installation/) and [Speaches text-to-speech guide](https://speaches.ai/usage/text-to-speech/).

#### 10.1.2 Mode A: Docker Web UI with an external Speaches server

This mode contains StudyNarrator only.

Required deliverables:

- A production application image containing the Node.js server, compiled React assets, FFmpeg, and required application runtime dependencies.
- An application-only `compose.yaml`.
- A documented `.env.example`.
- A short setup guide with same-machine and private-network endpoint examples.

Required behavior:

- `SPEACHES_BASE_URL` is the primary connection setting.
- `SPEACHES_API_KEY` is optional and must remain in the Node.js server process.
- The application container stores persistent state under a documented mount such as `/data`.
- The host port and bind address are configurable. The supplied Compose file binds to `127.0.0.1` by default.
- The Compose file may provide a Linux-compatible `host.docker.internal` mapping through the Docker host gateway so the application can reach Speaches running on the Docker host.
- A LAN hostname or IP address may be used directly when Speaches runs on another machine.
- The application reports a useful disconnected state when the endpoint is wrong or temporarily unavailable; it must not enter a restart loop solely because Speaches is offline.
- The StudyNarrator Compose file must not define a Speaches service in version 1.

Example endpoint values:

```text
Speaches on the Docker host:  http://host.docker.internal:8000
Speaches on a private server: http://192.168.1.50:8000
Speaches behind local DNS:    http://speaches.home.arpa:8000
```

#### 10.1.3 Mode B: Electron desktop application

The Electron application must provide installable desktop access for Windows, macOS, and Linux without requiring the user to run StudyNarrator through Docker.

The desktop package must:

- Reuse the production React UI.
- Use Node.js and TypeScript in the Electron main process and shared application packages.
- Invoke the shared application service layer through a narrow, typed preload/IPC bridge rather than duplicating parser or renderer behavior.
- Run long render orchestration outside the renderer thread and keep the UI responsive.
- Bundle or reliably provide the required FFmpeg runtime under a license-compatible distribution approach.
- Store projects and generated files under operating-system-appropriate application-data locations while allowing user-selected export destinations.
- Provide native file selection, drag-and-drop import, “show in folder,” and normal desktop open/save behavior.
- Use a first-run screen for Speaches base URL, optional API key, default model, and default voice.
- Support Speaches on `localhost` or on a private-network server.
- Start and remain usable for project editing when Speaches is offline.
- Display the official Speaches installation and TTS links when no server is available.
- Never install, launch, stop, update, or administer Speaches.
- Never require administrator or root privileges for normal application use after installation.

The Electron installer must not include Speaches, model weights, Docker, Python, or a second backend runtime.

Minimum release artifacts are:

- A Windows installer or portable package.
- A notarization-capable macOS package for the architectures validated by CI.
- At least one broadly usable Linux desktop package, with AppImage or a native package format documented by the release process.

If a release is unsigned, the download page and installation guide must state that fact and explain the operating-system warning users will see. The application must not claim to be signed or notarized unless the distributed artifact was actually processed that way.

#### 10.1.4 External Speaches dependency guidance

Version 1 documentation and onboarding must explain:

- Speaches is required only for voice preview and rendering; editing, parsing, lexicon work, and prompt export remain available without it.
- StudyNarrator does not control how Speaches is installed or accelerated.
- The official upstream installation guide is the source of truth for Speaches setup.
- The official upstream TTS guide is the source of truth for downloading and testing `speaches-ai/Kokoro-82M-v1.0-ONNX`.
- `localhost` refers to the current device. An Electron client connecting to another computer must use that server’s private hostname or IP.
- A Docker container normally cannot reach a host service through its own `localhost`; the supplied documentation should show `host.docker.internal` and LAN examples.
- Upstream pages must open in a normal browser. The product should not scrape or mirror their contents.

The setup screen should provide these actions:

```text
Open Speaches installation guide
Open Speaches TTS/model guide
Test connection
Continue offline
```

#### 10.1.5 Configuration precedence and locking

The effective runtime configuration must be resolved in this order:

1. Explicit process or launch arguments.
2. Environment variables or injected container secrets.
3. Saved application-level connection profiles.
4. Product defaults.

Project configuration may select a connection profile and model, but project exports must not contain raw API keys. A Docker deployment may set `STUDYNARRATOR_LOCK_SPEACHES_SETTINGS=true` to make an environment-managed endpoint read-only in the UI. The UI must identify the source of each effective value.

Electron should store API keys in the operating system’s credential store where available. Docker deployments should receive secrets through environment variables, an environment file with restricted permissions, or Docker secrets. API keys must not be written into render manifests, project bundles, browser storage, crash reports, or logs.

#### 10.1.6 Required release-package layout

The repository and release archive should expose v1 artifacts in predictable locations similar to:

```text
LICENSE
NOTICE
ACKNOWLEDGMENTS.md
README.md

apps/
  web/
  desktop/

packages/
  core/
  rendering/
  audio/
  waveform/
  persistence/
  speaches-adapter/
  shared-types/
  ui/

deploy/
  web/
    compose.yaml
    .env.example
    README.md

desktop/
  release-notes/
  checksums/
```

The final filenames may change, but the Docker Web UI and Electron workflows must remain obvious and independently documented. No Speaches Compose definition is included in the v1 release package.

### 10.2 Speaches connection and model configuration

Speaches connectivity must be represented by installation-local **connection profiles** rather than duplicating machine-specific URLs and secrets in every project.

A connection profile must support:

- Human-readable name.
- Speaches base URL.
- Optional API-key reference.
- Default model ID.
- Default voice ID.
- Request timeout.
- Retry count and bounded retry policy.
- Default response format for temporary segments.
- Whether the profile is editable or managed by Docker environment configuration.
- Last successful test time and a non-secret diagnostic summary.

A project references a connection profile and may override non-secret rendering choices such as model ID when the installation permits it. Moving a project between Docker and Electron should require selecting a valid local connection profile, not editing the script or exposing an old server key.

The application must provide a **Test Connection** action that checks progressively:

1. URL validity and normalization.
2. Hostname resolution and TCP reachability.
3. A usable HTTP response from the Speaches server.
4. Authentication when configured.
5. Whether the selected model can accept a speech request or returns an actionable model error.
6. Whether the selected default voice can produce a small sample.
7. Receipt of decodable audio.

The result must identify the failing stage and offer corrective guidance. A failed connection test must not delete saved projects or block offline editing.

When failures indicate that Speaches is not installed, the model is unavailable, or upstream configuration is required, the UI must link to the official Speaches documentation rather than attempting to repair or administer the external service.

The harness must communicate through a shared TypeScript backend adapter rather than spreading Speaches-specific request logic throughout React components, Express routes, or Electron IPC handlers. The initial adapter targets the OpenAI-compatible speech endpoint.

The application must not depend on internal files inside the downloaded model repository. Model packaging and lifecycle are implementation details of Speaches.

### 10.3 Voice catalog

Because a stable voice-discovery endpoint cannot be assumed, the application must support a local voice catalog.

The catalog must allow:

- Bundled known voice IDs for the selected model.
- Manual voice-ID entry.
- A concise, human-readable primary label.
- The raw backend voice ID as visible secondary information rather than hidden implementation detail.
- Optional language, locale, accent, voice-category, and style metadata when that information is supplied by the model or catalog maintainer.
- Search and filtering by label, ID, language, or available metadata.
- Optional sample text and one-click sample preview.
- Enable or disable without deleting.
- Import or replace the catalog from JSON.

The UI should prefer labels such as `Heart — American English — af_heart` over displaying only `af_heart`. It must fall back cleanly to the raw ID when descriptive metadata is unavailable and must not invent unsupported metadata.

A voice catalog entry does not guarantee server support. Preview or connection testing provides final validation.

### 10.4 Project management

A project must store:

- Name and optional description.
- Current script.
- Speaches connection-profile reference.
- Model selection.
- Speaker mappings.
- Pause presets.
- Transition rules.
- Project lexicon entries.
- Output settings.
- Prompt-builder settings.
- Render history.

Required project actions:

- Create.
- Rename.
- Duplicate.
- Delete with confirmation.
- Autosave locally.
- Export as a portable bundle.
- Import from a bundle.

A render must reference an immutable project snapshot rather than live mutable state.

### 10.5 Script input

The MVP must support:

- Paste into an editor.
- Upload a UTF-8 `.txt` file.
- Drag and drop a `.txt` file.
- Preserve Unix and Windows line endings correctly.
- Preserve Unicode characters.
- Remove a single surrounding Markdown code fence through an explicit cleanup action.

P1 adds `.md` import with conservative formatting removal. Markdown import must not perform semantic rewriting.

### 10.6 Automatic parsing and discovery

Parsing should run after paste, file upload, or editor changes using a short debounce.

The parser must return:

- Abstract syntax tree or ordered intermediate representation.
- Detected speakers.
- Detected pause IDs.
- Detected sections.
- Detected pronunciation aliases.
- Validation errors.
- Non-blocking warnings.
- Source line and column for each node.

The parser must not call Speaches or any external service.

### 10.7 Speaker configuration

Each discovered speaker must have:

- Speaker ID.
- Display name.
- Voice ID.
- Speed, default `1.0`.
- Optional gain in decibels, default `0 dB`.
- Optional role description for external-LLM prompt generation.
- Preview sample text.

Required actions:

- Assign voice.
- Copy settings from another speaker.
- Preview speaker.
- Set as default narrator.
- Find all script occurrences.

The UI must clearly distinguish a script speaker ID from a model voice ID.

### 10.8 Transition settings

The project may define automatic pauses for:

- Speaker changes.
- Paragraph boundaries.
- Section boundaries.

Each transition may be set to:

- None.
- A named project pause preset.
- A direct duration.

Precedence rules:

1. An explicit pause directive wins.
2. An automatic section pause applies only when no adjacent explicit pause exists.
3. An automatic speaker-change pause applies only when no explicit pause separates the two speech nodes.
4. An automatic paragraph pause applies only when no stronger boundary pause exists.

This prevents accidental doubled silence.

### 10.9 Lexicon management

#### 10.9.1 Lexicon scopes

The application must support:

- Global lexicon entries shared by every project.
- Project lexicon entries that apply only to one project.
- Project overrides of global entries.

#### 10.9.2 Lexicon entry types

MVP entry types:

1. **Exact term** — replaces a whole word or exact token.
2. **Exact phrase** — replaces a multiword phrase.
3. **Named sense** — resolves explicit `{{display|sense}}` annotations.

P2 may add regular-expression entries.

#### 10.9.3 Lexicon fields

Each entry contains:

- Stable ID.
- Scope: global or project.
- Entry type.
- Display term or phrase.
- Optional sense ID.
- Spoken replacement.
- Case sensitivity.
- Whole-word matching, enabled by default.
- Priority.
- Enabled status.
- Notes.
- Creation and update timestamps.

#### 10.9.4 Matching precedence

For ordinary text, matches are resolved using this order:

1. Project exact phrase.
2. Global exact phrase.
3. Project exact term.
4. Global exact term.

Within the same level:

1. Higher explicit priority wins.
2. Longer matching text wins.
3. Stable entry ID breaks any remaining tie.

Explicit named-sense annotations are resolved before ordinary matching and are never overridden by a global term rule.

#### 10.9.5 Safety requirements

- Lexicon replacement applies only to speech text, never directives or metadata.
- The original script is never overwritten.
- The transformed text view must highlight replacements.
- A user can inspect which entry changed each occurrence.
- Conflicting entries generate a warning before render.
- Empty replacements are prohibited in the MVP.
- Replacement output is plain speakable text, not executable markup.

#### 10.9.6 Pronunciation workbench

The UI must provide a small test area where the user can:

- Enter a word, phrase, or sentence.
- Select a speaker or voice.
- See transformed text.
- Generate a short preview.
- Add or edit a lexicon entry from the result.

#### 10.9.7 Starter dictionaries

Technical starter dictionaries may be offered later, but they must be opt-in because pronunciations vary by person and project. For example, `SQL` may intentionally be “sequel” in one project and “S Q L” in another.

### 10.10 Text normalization

The normalization pipeline must be ordered and visible.

MVP order:

1. Normalize Unicode and line endings.
2. Parse directives and speech nodes.
3. Resolve escaped syntax.
4. Resolve explicit pronunciation senses.
5. Apply project and global lexicon rules.
6. Apply limited safe whitespace normalization.
7. Split long speech into synthesis chunks.

The application must not silently rewrite punctuation, numbers, URLs, or code beyond configured deterministic rules.

### 10.11 Chunking

A speech node may need to be split before sending it to Speaches.

Chunking requirements:

- Prefer paragraph and sentence boundaries.
- Avoid splitting inside pronunciation annotations because aliases are resolved first.
- Preserve speaker, voice, speed, and gain settings.
- Produce stable chunks for the same normalized text and chunking configuration.
- Use a configurable maximum character or token estimate.
- Warn when a single unsplittable unit exceeds the configured limit.
- Do not insert audible silence between chunks unless punctuation or a configured boundary requires it.

### 10.12 Quick Scratchpad and preview

#### 10.12.1 Quick Scratchpad

The Quick Scratchpad is a project-independent surface for fast experiments. It must allow the user to:

- Enter or paste a short passage.
- Select an installation-local Speaches connection profile, model, voice, and speed.
- Optionally apply the global lexicon and inspect the transformed TTS text before synthesis.
- Synthesize, play, pause, seek, replay, and explicitly save the result.
- See whether the result came from cache and which server/profile produced it.
- Copy the passage into a new project or the current project through an explicit action.

Scratchpad activity must not silently modify a project, project lexicon, speaker mapping, pause configuration, or render history. A lightweight scratchpad history may retain recent tests locally, subject to the same storage-cleanup controls as previews.

#### 10.12.2 Project preview modes

Project preview modes include:

- Selected text.
- Selected parsed segment.
- Speaker sample.
- Pronunciation workbench sample.
- First segment of each section.

#### 10.12.3 Shared preview requirements

All previews must:

- Use the same transformation, chunking, cache-key, and TTS adapter behavior as a full render.
- Clearly identify whether the preview came from cache.
- Display the readable text, transformed TTS text, friendly voice label, and raw voice ID.
- Allow playback without writing to the final output directory.
- Allow the user to save a preview only through an explicit action.
- Use the shared player and waveform requirements defined in Section 11.8.

### 10.13 Rendering

#### 10.13.1 Render states

A render job moves through:

1. `validating`
2. `queued`
3. `synthesizing`
4. `assembling`
5. `normalizing`
6. `encoding`
7. `writing_artifacts`
8. `complete`, `failed`, or `canceled`

The render coordinator must emit structured progress events rather than only an overall percentage. Events should identify the render phase, current section, speech-segment ordinal and total, synthesis-chunk ordinal when available, cache hit or miss, current speaker/voice, shortened source excerpt, elapsed time, and recoverable error details.

#### 10.13.2 Temporary speech format

The recommended internal format is WAV. Each speech chunk is requested from Speaches as WAV, stored in the segment cache, and encoded only once when producing the final MP3.

This avoids repeatedly decoding and re-encoding lossy MP3 fragments.

#### 10.13.3 Silence generation

Pause nodes must become exact-duration PCM silence matching the sample rate and channel layout used by synthesized speech. Silence should not be approximated with punctuation or blank text sent to the TTS model.

#### 10.13.4 Assembly

The audio assembler must:

- Normalize temporary segments to a compatible sample rate and channel layout when necessary.
- Concatenate in manifest order.
- Process component files incrementally from disk or through an FFmpeg pipeline rather than accumulating the complete decoded program in the Node.js heap.
- Keep memory usage bounded by a documented buffer or small number of active segments for long-form renders.
- Apply per-speaker gain after synthesis and before final normalization.
- Avoid clipping.
- Produce one intermediate lossless combined file through a streaming or append-safe workflow.
- Validate segment order and final decodability before publishing the artifact.
- Encode the requested final format from that intermediate file without first constructing one complete in-memory `AudioBuffer` or equivalent PCM object.

For long projects, WAV assembly and final MP3 encoding must remain file- or stream-oriented. An implementation that repeatedly appends all decoded audio to one growing JavaScript object does not satisfy this requirement.

#### 10.13.5 Loudness normalization

P1 adds optional final loudness normalization.

Requirements:

- Disabled by default until tested on the user’s environment.
- Applied to the combined lossless intermediate, not independently to each speaker segment.
- Configuration stored in the render manifest.
- A no-normalization path must remain available.

#### 10.13.6 Retry and recovery

- A failed speech chunk may be retried according to project settings.
- Successful chunks remain cached when another chunk fails.
- A failed render may resume from missing chunks.
- The UI must show the exact segment, speaker, source line, request settings, and server error.
- Cancellation stops new TTS requests and completes after the current non-interruptible operation.

### 10.14 Segment cache

The cache is a core requirement, not an optional optimization.

A speech cache key should include at least:

- TTS adapter version.
- Speaches base identity or configured server profile.
- Model ID.
- Voice ID.
- Speed.
- Normalized TTS text.
- Relevant synthesis options.
- Normalization/chunking version.

Gain, pauses, output metadata, and final encoding settings should not invalidate the raw speech cache when they can be applied during assembly.

Cache requirements:

- Display cache hit/miss status in dry run and render progress.
- Allow clear-all, clear-project, and clear-selected-segment actions.
- Track size and last-used timestamp.
- Use content-addressed filenames or an equivalent collision-resistant strategy.
- Validate cached audio before reuse.
- Never delete source scripts when clearing cache.

### 10.15 Output artifacts

A successful render should produce a folder containing:

```text
project-name/
  render-YYYYMMDD-HHMMSS/
    project-name.mp3
    original-script.txt
    readable-transcript.txt
    tts-transcript.txt
    render-manifest.json
    project-snapshot.json
    checksums.txt
```

Optional P1 artifacts:

```text
    project-name.wav
    sections/
      001-introduction.mp3
      002-database-indexes.mp3
    timestamps.json
```

#### 10.15.1 Manifest requirements

The manifest must include:

- Project and render IDs.
- Creation time.
- Script hash.
- Configuration hash.
- Lexicon version or hash.
- Model and server profile.
- Ordered segment list.
- Segment type.
- Speaker and voice.
- Original and transformed text hashes.
- Pause duration.
- Cache hit/miss.
- Actual audio duration.
- Section timestamps.
- Output file checksums.
- Application and parser versions.

The manifest is the primary debugging and reproducibility record.

#### 10.15.2 Render-segment playback and export

A completed render must expose its ordered speech, pause, and section-boundary records to the UI. For each rendered speech segment, the application must support:

- Playing the exact stored or cached audio used in that render without issuing a new TTS request.
- Copying the readable source text.
- Copying the transformed TTS text.
- Explicitly saving the segment audio to a user-selected location.
- Navigating back to the corresponding source line or parsed segment.
- Displaying speaker, friendly voice label, raw voice ID, duration, cache status, and generation state.

Pause rows may be played or visualized and may be exported as silence only through an explicit action. If a segment file has been removed by cache or artifact cleanup, the UI must report that state and offer an explicit regeneration path rather than silently synthesizing it.

### 10.16 External-LLM prompt builder

The application must generate a portable prompt that the user can copy into an external LLM.

Prompt-builder inputs:

- Purpose of the script.
- Target audience.
- Desired speaker IDs and role descriptions.
- Allowed pause IDs and intended meanings.
- Whether section markers are required.
- Desired level of detail.
- Whether code should be explained, spelled, or omitted.
- Pronunciation aliases available to the script.
- Source material.

Prompt-builder output requirements:

- Plain Markdown or text that can be copied.
- Exact script grammar.
- Allowed speaker and pause IDs.
- Instruction to output only the script, without a code fence or commentary.
- Instruction not to invent facts.
- Instruction to preserve technical accuracy.
- Instruction to use explicit sense annotations for ambiguous terms.
- At least one valid example.

The prompt builder must not send the prompt or source material anywhere.

### 10.17 Reusable skill-package export

P1 should export a small platform-neutral package:

```text
study-narrator-script-skill/
  SKILL.md
  SCRIPT_FORMAT.md
  LEXICON_ALIASES.md
  examples/
    two-speaker-study-guide.txt
    single-narrator.txt
```

The package should describe the output contract without requiring a specific LLM vendor or API.



## 11. UI and User Experience Requirements

### 11.1 First-run onboarding and connection status

On first launch, the UI must detect whether a usable Speaches connection has been configured.

The onboarding flow must:

- Identify whether the user is in the Docker Web UI or Electron application.
- Prepopulate Docker environment-managed values without revealing secrets.
- Let Electron users create and test a connection profile.
- Provide same-computer and private-network endpoint examples.
- Link to the official [Speaches installation guide](https://speaches.ai/installation/) and [Speaches text-to-speech guide](https://speaches.ai/usage/text-to-speech/).
- State clearly that StudyNarrator does not install or manage Speaches in version 1.
- Allow the user to continue into offline project editing without completing synthesis setup.

The normal application shell must display a compact connection indicator with these states:

```text
Connected
Testing
Server responding; model or voice unavailable
Authentication required
Disconnected
Configuration error
```

Selecting the indicator opens diagnostics containing the effective endpoint, connection-profile source, HTTP result, selected model, selected voice, and last test time. API keys are never displayed after entry.

A Settings area must provide:

- Connection profiles.
- Client and application-version information.
- Data, cache, and output locations.
- FFmpeg status.
- Storage usage and cleanup.
- External Speaches setup links.
- Exportable redacted diagnostics.
- About / Credits with the project license and upstream acknowledgments.

### 11.2 Application navigation and Quick Scratchpad

The primary navigation must make these surfaces obvious:

```text
Projects | Quick Scratchpad | Lexicon | Render History | Settings
```

The Quick Scratchpad should open without requiring a project and should keep the minimum useful controls together: connection status, voice, speed, text, transformed-text preview, synthesize, playback, and explicit save. It should be usable as the fastest path for testing a newly configured voice or pronunciation.

### 11.3 Primary editor layout

Recommended desktop layout:

```text
+---------------------------------------------------------------+
| Project | Parse status | Preview | Render | Render history    |
+--------------------------------------+------------------------+
|                                      | Detected configuration |
| Script editor                        | - Speakers             |
|                                      | - Pauses               |
|                                      | - Sections             |
|                                      | - Aliases              |
+--------------------------------------+------------------------+
| Errors / warnings / transformed segment preview               |
+---------------------------------------------------------------+
```

The UI should remain functional at narrower widths by stacking panels.

### 11.4 Script editor

Required behaviors:

- Plain-text editing.
- Line numbers.
- Search and replace.
- Syntax highlighting for recognized directives and pronunciation aliases.
- Error markers tied to source locations.
- Click an error to focus its line.
- Autosave status.
- Original content remains available after cleanup actions.

A full rich-text editor is not required.

### 11.5 Configuration panels

### Speakers panel

Each row shows:

- Speaker ID.
- Display name.
- Voice selector or manual ID.
- Speed.
- Preview button.
- Number of script occurrences.
- Mapping status.

### Pauses panel

Each row shows:

- Pause ID.
- Duration.
- Human-readable description.
- Number of script occurrences.
- Play-silence or visualize-duration control.

### Sections panel

Each row shows:

- Section title.
- Source line.
- Speech segment count.
- Estimated duration.
- Per-section output toggle.

### Lexicon panel

Required controls:

- Search.
- Scope filter.
- Entry type filter.
- Add/edit/disable/delete.
- Preview.
- Show script matches.
- Show replacement conflicts.

### 11.6 Validation summary

The top-level status should be one of:

- Ready to render.
- Ready with warnings.
- Blocked by errors.
- Parsing.
- Script changed since last render.

Blocking errors should be visually and programmatically distinct from warnings.

### 11.7 Render progress

The render screen must show:

- Current phase.
- Current section and total known sections.
- Current parsed speech segment and total parsed speech segments.
- Current synthesis chunk and generated chunk count when the backend or adapter exposes chunk-level progress.
- Completed speech chunks and total speech chunks.
- Cache hits, cache misses, and new TTS requests.
- Current speaker, friendly voice label, raw voice ID, and shortened text preview.
- Elapsed time.
- A prominent cancel or stop action whose behavior is explained.
- Live segment-specific error details without requiring log-file inspection.

A generic spinner or percentage alone is insufficient for a long render. Progress remains useful even when an exact completion percentage cannot be calculated.

### 11.8 Audio player and waveform

The shared audio player is used by the Quick Scratchpad, project previews, completed renders, and individual segment playback. It must provide:

- Play, pause, stop, and replay.
- Current time and total duration.
- Seeking by keyboard-accessible time control and by selecting a position on a compact waveform.
- Volume control and mute.
- A textual label identifying the currently loaded project, render, or segment.
- A fallback progress bar when waveform peaks are not yet available.

The waveform is a visual navigation aid, not an editor. It must not expose destructive cutting, drawing, or sample manipulation in version 1. Peak extraction should be downsampled, cached, and performed without loading an entire long MP3 or WAV into renderer memory. The waveform may later overlay section or speaker boundaries, but that is not required for the first implementation.

### 11.9 Render history

Each render entry should show:

- Creation time.
- Script/config status relative to current project.
- Duration.
- Output size.
- Model.
- Completion state.
- Open output folder.
- Play audio in the shared waveform player.
- View manifest.
- Retry failed render.
- Delete artifact without deleting project or cache.

A completed or partially completed render can expand into ordered child rows for its segments. Each child row should show segment ordinal and type, section, speaker, friendly voice label, readable-text excerpt, duration, cache state, and completion state. Available actions are:

- Play the exact rendered segment.
- Copy readable text.
- Copy transformed TTS text.
- Explicitly save segment audio.
- Jump to the corresponding source location.

Expanded history must be virtualized or incrementally rendered for large projects and fully operable with keyboard and screen-reader controls. Missing cleaned-up segment files are shown as unavailable rather than causing broken controls or silent rerendering.

### 11.10 Accessibility

The UI must:

- Be fully keyboard navigable.
- Use native controls where possible.
- Give every form field a persistent label.
- Expose parse errors through accessible live regions without repeatedly interrupting screen readers on every keystroke.
- Avoid relying on color alone.
- Provide visible focus indicators.
- Associate errors with their inputs.
- Make playback controls operable without a mouse.
- Provide a non-visual seeking control and current-time announcement so waveform interaction is never required.
- Give expandable render and segment rows correct disclosure semantics, names, states, and focus behavior.
- Offer reduced-motion behavior.

---

## 12. Data Model

### 12.1 TTS connection profile

```text
TtsConnectionProfile
- id
- name
- base_url
- api_key_source
- api_key_reference, nullable
- managed_by_environment
- default_model_id
- default_voice_id
- timeout_seconds
- retry_count
- last_tested_at, nullable
- last_test_status, nullable
- created_at
- updated_at
```

`api_key_reference` identifies an environment variable, container secret, or operating-system credential-store entry. It must not contain a raw key in exported project data.

### 12.2 Project

```text
Project
- id
- name
- description
- tts_connection_profile_id
- script_text
- script_hash
- config_json
- created_at
- updated_at
```

### 12.3 Speaker profile

```text
SpeakerProfile
- project_id
- speaker_id
- display_name
- voice_id
- speed
- gain_db
- role_description
- sample_text
```

### 12.4 Pause preset

```text
PausePreset
- project_id
- pause_id
- duration_ms
- description
```

### 12.5 Lexicon entry

```text
LexiconEntry
- id
- scope
- project_id, nullable
- entry_type
- display_text
- sense_id, nullable
- spoken_text
- case_sensitive
- whole_word
- priority
- enabled
- notes
- created_at
- updated_at
```

### 12.6 Render job

```text
RenderJob
- id
- project_id
- project_snapshot_path
- state
- progress_json
- error_json
- created_at
- started_at
- finished_at
```

### 12.7 Render segment

```text
RenderSegment
- render_id
- ordinal
- segment_type
- synthesis_chunk_count, nullable
- source_start_line
- source_end_line
- section_id
- speaker_id
- voice_id
- original_text
- tts_text
- pause_duration_ms
- cache_key
- cache_hit
- audio_path
- actual_duration_ms
- state
- error_json
```

### 12.8 Render artifact

```text
RenderArtifact
- id
- render_id
- artifact_type
- path
- size_bytes
- checksum
- duration_ms, nullable
- created_at
```

---

## 13. Example Project Configuration

```json
{
  "version": 1,
  "speaches": {
    "connectionProfile": "default",
    "model": "speaches-ai/Kokoro-82M-v1.0-ONNX",
    "timeoutSeconds": 120,
    "retryCount": 2,
    "segmentResponseFormat": "wav"
  },
  "speakers": {
    "teacher": {
      "displayName": "Teacher",
      "voice": "af_heart",
      "speed": 1.0,
      "gainDb": 0,
      "roleDescription": "Explains concepts clearly and accurately."
    },
    "student": {
      "displayName": "Student",
      "voice": "am_michael",
      "speed": 1.0,
      "gainDb": 0,
      "roleDescription": "Asks short clarifying questions."
    }
  },
  "pauses": {
    "pause_short": {
      "durationMs": 350,
      "description": "Brief speaker handoff."
    },
    "pause_long": {
      "durationMs": 1500,
      "description": "Major topic transition."
    }
  },
  "transitions": {
    "speakerChange": "none",
    "paragraph": "none",
    "section": "pause_long",
    "explicitPauseWins": true
  },
  "output": {
    "format": "mp3",
    "combinedFile": true,
    "perSectionFiles": false,
    "finalWav": false,
    "loudnessNormalization": false
  },
  "rendering": {
    "maxChunkCharacters": 1200,
    "concurrency": 1,
    "cacheEnabled": true
  }
}
```

The canonical portable project format should be versioned JSON so the Web UI and Electron application use the same schema, runtime validation, and migration logic. Connection profiles are installation-local; project bundles may preserve a profile name as a hint but must require remapping when that profile does not exist on the destination installation. Raw API keys must never be included in this project configuration.

---

## 14. System Architecture

### 14.1 Shared TypeScript architecture

```text
                         Shared React UI
                    /                         \
           Docker Web client             Electron renderer
                    |                         |
               REST adapter            Typed preload/IPC adapter
                    \                         /
                 Shared application service layer
                    |-- Projects and lexicon --> SQLite
                    |-- Parser and validator
                    |-- Prompt/skill exporter
                    |-- In-process render coordinator
                            |-- Segment cache --> Application data directory
                            |-- Speaches adapter --> External Speaches server
                            |-- Streaming audio assembler --> FFmpeg subprocess
                            |-- Waveform peak extractor --> Cached peak data
                            |-- Artifact writer --> Application data or export path
```

The architecture separates product behavior from transport:

- React components call a typed client interface.
- The Web UI implements that interface through HTTP requests to the Node.js server.
- Electron implements that interface through validated IPC calls exposed by the preload bridge.
- Both transports invoke the same TypeScript application services.
- The browser and Electron renderer never receive the Speaches API key or execute FFmpeg directly.

### 14.2 Docker Web UI topology

```text
Browser
   |
   v
StudyNarrator Node.js container
   |-- Serves compiled React assets
   |-- Express API
   |-- SQLite and /data persistent volume
   |-- FFmpeg subprocesses
   |
   +---- HTTP/private network ----> Separately installed Speaches server
```

The external Speaches server may run:

- On the Docker host.
- In a different Compose project managed by the user.
- On another machine in the private network.
- Behind a private reverse proxy.

No direct browser-to-Speaches route is required, so Speaches does not need browser CORS solely for StudyNarrator.

### 14.3 Electron desktop topology

```text
Electron main process (Node.js + TypeScript)
   |-- Shared application services
   |-- SQLite and application data
   |-- Render coordinator
   |-- FFmpeg subprocesses
   |-- HTTP client ----> Separately installed Speaches server
   |
   +-- Narrow preload bridge
           |
           v
      React renderer
```

Electron does not launch a Python sidecar or an additional local web server in version 1. The main process owns privileged operations and exposes only validated application commands to the renderer. Expensive local work must use subprocesses or worker threads where needed so that neither the renderer nor main event loop becomes unresponsive.

Closing the final window should request a clean shutdown after state writes are flushed. An interrupted render remains recoverable at the next launch.

### 14.4 Recommended implementation stack

This is an implementation requirement for the language boundary and a recommendation for the named libraries:

- Language: TypeScript across shared application code, server code, Electron code, and frontend code.
- Frontend: React with TypeScript and Vite.
- Web backend: Node.js with TypeScript and Express.
- Desktop shell: Electron using the same compiled React UI.
- Shared validation: Zod or an equivalent TypeScript schema library.
- Persistence: SQLite through a Node/Electron-compatible driver, behind a repository interface.
- HTTP client: the Node.js Fetch API or a small standards-based wrapper.
- Audio assembly and encoding: FFmpeg invoked with argument arrays through `child_process.spawn` or an equivalent safe process API.
- Background orchestration: a persisted in-process queue; worker threads or child processes only where they materially protect responsiveness.
- Container packaging: a multi-stage Node.js build with a non-root runtime user.
- Workspace layout: a TypeScript monorepo using npm, pnpm, or an equivalent workspace tool.

Python and FastAPI are not part of the v1 application runtime.

### 14.5 Why an in-process queue is sufficient

The default product is single-user and local. One render worker provides:

- Predictable load on Speaches.
- Simple cancellation and progress reporting.
- No extra queue infrastructure.
- Easy crash recovery from persisted job and segment state.

The queue abstraction should permit a future external worker, but version 1 should not require Redis, BullMQ, RabbitMQ, or a separate worker service.

### 14.6 Suggested monorepo layout

```text
apps/
  server/                 # Express API and React static hosting
  web/                    # React/Vite application
  desktop/                # Electron main, preload, packaging

packages/
  application/            # Use cases and service orchestration
  core/                   # Script parser, grammar, validation, CIR
  lexicon/                # Matching and pronunciation transforms
  rendering/              # Queue, cache keys, TTS orchestration
  speaches-adapter/       # OpenAI-compatible speech client
  audio/                  # FFmpeg plans, silence, streaming assembly, metadata
  waveform/               # Downsampled peak extraction and playback metadata
  persistence/            # SQLite repositories and migrations
  shared-types/           # Zod schemas and TypeScript contracts
  ui/                     # Shared React components and hooks
  prompt-export/          # External-LLM prompts and skill files
```

Transport-specific code must depend on the shared service layer. Shared domain packages must not import Express, Electron, browser-only APIs, or operating-system-specific UI code.

### 14.7 Canonical intermediate representation

All inputs should become an ordered list of nodes before synthesis.

Illustrative representation:

```json
[
  {
    "type": "section",
    "title": "SQL pronunciation",
    "source_line": 1
  },
  {
    "type": "speech",
    "speaker": "teacher",
    "original_text": "SQL can be pronounced in more than one way.",
    "tts_text": "sequel can be pronounced in more than one way.",
    "source_line": 3
  },
  {
    "type": "pause",
    "pause_id": "pause_short",
    "duration_ms": 350,
    "source_line": 4
  }
]
```

The audio renderer consumes this representation rather than reparsing the source.

## 15. Application Service and Web API Contract

The shared TypeScript application service layer is the primary contract. The Docker Web UI exposes it through REST. Electron exposes the same operations through typed preload/IPC commands.

The exact HTTP paths may change, but the Web distribution requires capabilities equivalent to:

```text
GET    /api/health
GET    /api/runtime
GET    /api/diagnostics

GET    /api/tts-connections
POST   /api/tts-connections
GET    /api/tts-connections/{connection_id}
PUT    /api/tts-connections/{connection_id}
DELETE /api/tts-connections/{connection_id}
POST   /api/tts-connections/{connection_id}/test

GET    /api/projects
POST   /api/projects
GET    /api/projects/{project_id}
PUT    /api/projects/{project_id}
DELETE /api/projects/{project_id}

POST   /api/projects/{project_id}/parse
POST   /api/projects/{project_id}/validate
POST   /api/projects/{project_id}/preview
POST   /api/scratchpad/preview

GET    /api/lexicon
POST   /api/lexicon
PUT    /api/lexicon/{entry_id}
DELETE /api/lexicon/{entry_id}

POST   /api/projects/{project_id}/renders
GET    /api/renders/{render_id}
POST   /api/renders/{render_id}/cancel
POST   /api/renders/{render_id}/retry

GET    /api/renders/{render_id}/artifacts
GET    /api/renders/{render_id}/segments
GET    /api/renders/{render_id}/segments/{ordinal}/audio
GET    /api/renders/{render_id}/waveform
POST   /api/renders/{render_id}/segments/{ordinal}/export
GET    /api/artifacts/{artifact_id}

POST   /api/projects/{project_id}/prompt-export
POST   /api/projects/{project_id}/skill-export
```

Electron should expose equivalent high-level commands, not raw filesystem, database, HTTP, or process primitives. Example command groups are:

```text
connections.list / save / test / delete
projects.list / create / read / update / delete
scripts.parse / validate / preview
scratchpad.preview / history / clear
lexicon.list / save / delete
renders.start / status / cancel / retry / artifacts / segments / waveform
exports.prompt / skill / artifact / segment
system.diagnostics / openExternal / revealFile
```

Shared Zod schemas or equivalent runtime validators must validate inputs and outputs at REST and IPC boundaries.

The Web API is local application infrastructure, not a supported public integration API in version 1. It binds according to the supplied host-port policy. LAN exposure requires a documented authentication or trusted reverse-proxy strategy. The Electron application does not need to expose a loopback HTTP server because the renderer communicates through the preload bridge.

## 16. Error Handling and Recovery

### 16.1 Parse errors

Examples:

- Invalid `speaker_` directive.
- Malformed section directive.
- Unknown or malformed control directive.
- Unclosed pronunciation annotation.
- Unknown or unresolved pronunciation sense.
- Text before the first speaker when no default speaker exists.

Parse errors include line, column, offending text, and a suggested correction.

### 16.2 Configuration errors

Examples:

- Speaker has no voice mapping.
- Pause has no duration.
- Negative pause duration.
- Invalid speed.
- Output directory is not writable.
- Selected voice is missing from the local catalog.

A missing catalog entry may be a warning when manual voice IDs are allowed, but a failed voice preview is blocking for a full render unless the user explicitly bypasses preflight validation.

### 16.3 Backend errors

Examples:

- Speaches is unreachable.
- Request timeout.
- Model not installed.
- Voice rejected.
- Empty or invalid audio response.
- FFmpeg unavailable.
- Audio segments have incompatible properties.
- Disk is full.

The user-facing error should identify the failing component and preserve technical details in an expandable panel.

### 16.4 Crash recovery

On startup, the application must inspect interrupted render jobs.

It should offer:

- Resume from valid cached and completed chunks.
- Mark as failed.
- Delete incomplete temporary artifacts.

It must never assume an output is complete merely because the final filename exists. Completion is recorded only after artifact validation and manifest finalization.

### 16.5 Deployment and startup errors

The application must provide specific handling for:

- Missing or malformed required Docker environment variables.
- An environment-managed setting that cannot be edited in the UI.
- Speaches hostname resolution or connection refusal.
- Authentication failure.
- A selected model that is absent, loading, or rejected by the external server.
- An invalid model or voice.
- A Docker data volume that is read-only or owned by an incompatible user.
- A missing or non-executable FFmpeg runtime.
- An Electron worker or FFmpeg subprocess that exits unexpectedly.
- A desktop data migration that cannot be completed safely.

Startup errors must preserve access to a redacted diagnostics screen whenever the application process can still run. The UI must avoid collapsing all failures into “Speaches unavailable.” Failures that require upstream installation or model management must include the official Speaches setup links without attempting to modify the external service.

## 17. Nonfunctional Requirements

### 17.1 Performance

- Parsing and discovery should feel immediate for ordinary study scripts.
- A 100,000-character script should parse locally without freezing the UI.
- Parse work must not run on the browser’s main thread when it becomes large enough to affect input responsiveness.
- A pause-only change should require zero new TTS calls.
- A one-sentence text change should regenerate only the chunks whose cache keys changed.
- The default renderer should issue one TTS request at a time unless concurrency is deliberately enabled.
- Lossless assembly and waveform peak extraction must remain bounded-memory for long study guides and must not require the complete decoded program in the renderer or Node.js heap.

### 17.2 Reliability

- Project writes should be atomic or transactional.
- Final artifacts should be written to a temporary path and moved into place after validation.
- Render snapshots must remain available even if the live project changes.
- Cache corruption should invalidate only the affected item.
- A failed final encoding must not delete valid speech chunks.
- A failed waveform extraction must not invalidate otherwise valid audio artifacts or block playback through the fallback timeline.

### 17.3 Portability

- The Docker Web UI is the reference server distribution and must run on supported Docker Engine or Docker Desktop environments.
- The Electron application must have validated release artifacts for Windows, macOS, and Linux.
- Docker deployment must work with Speaches addressed by Docker-host alias, DNS hostname, or private IP address.
- Paths must not assume a specific home directory, drive letter, username, or path separator.
- Project bundles must move between Docker and Electron installations without rewriting script content.
- Hardware-specific Speaches acceleration is an external deployment concern; the StudyNarrator application layer must not require a GPU.
- The shared TypeScript project schema and transformation behavior must remain consistent across the two clients.

### 17.4 Maintainability

- Script grammar must be versioned.
- Project configuration must contain a schema version.
- Render manifests must identify application, parser, and adapter versions.
- Database migrations must be explicit and reversible when practical.
- TTS backend behavior must be isolated behind an adapter interface.

### 17.5 Observability

Local logs should include:

- Render ID.
- Project ID.
- Segment ordinal.
- Cache hit or miss.
- TTS request duration.
- Audio duration.
- Retry count.
- FFmpeg exit status.

Logs must not include full script content by default. A debug mode may include shortened or user-approved text excerpts.

### 17.6 Storage controls

The UI must show storage used by:

- Projects.
- Render artifacts.
- Segment cache.
- Temporary files.

Cleanup actions must distinguish these categories and explain what will be regenerated.

Docker deployments must keep persistent data outside the container layer. Electron must use an operating-system-appropriate writable data directory and allow artifact export to a user-selected location.

### 17.7 Distribution, upgrades, and migration

- Docker images and desktop packages must report the same semantic application version when built from the same release.
- Database and project-schema migrations must run before the UI accepts writes.
- A migration failure must leave the previous data intact and produce recovery guidance.
- Docker upgrades must preserve named or bind-mounted application-data volumes.
- Desktop upgrades must preserve application data without requiring manual copying.
- Release notes must identify schema changes, minimum tested Speaches version when applicable, and any manual migration step.
- CI must build and smoke-test the Docker Web and Electron artifacts rather than treating source tests as sufficient.
- Speaches upgrades remain the user’s responsibility and are not coupled to StudyNarrator release installation.

## 18. Privacy and Security Requirements

### 18.1 Common requirements

- Do not include telemetry or remote analytics by default.
- Do not fetch remote scripts, prompts, dictionaries, or updates without a user action or explicit update policy.
- Do not send source text to any service other than the configured Speaches endpoint.
- Display the target Speaches host before a render when it is not loopback or a recognized private address.
- Keep Speaches requests and credentials in the backend process.
- Sanitize uploaded filenames and store uploads under generated internal IDs.
- Invoke FFmpeg and other processes with argument arrays, not shell-composed command strings.
- Prevent directory traversal in project names, uploaded paths, archive extraction, and output filenames.
- Redact API keys and authorization headers from logs, manifests, diagnostics, and support exports.
- Validate imported project bundles before writing files.

### 18.2 Docker Web requirements

- The supplied Compose file binds StudyNarrator to `127.0.0.1` by default.
- The application image runs as a non-root user and writes only to documented data and temporary locations.
- Speaches API keys should be supplied through environment variables, a protected `.env` file, or Docker secrets.
- The `.env.example` must contain placeholders only.
- Enabling LAN binding must produce a visible warning when no application authentication or trusted reverse proxy is configured.
- The StudyNarrator image must not contain Speaches model weights or an embedded Speaches service.
- Container images should use pinned dependencies, automated vulnerability scanning, and a minimal runtime layer.

### 18.3 Electron requirements

- Enable Electron context isolation.
- Disable Node.js integration in renderer content.
- Use a restrictive Content Security Policy and do not load the application UI from an arbitrary remote origin.
- Expose only narrowly scoped, validated IPC functions through the preload bridge.
- Prevent arbitrary renderer-controlled process execution, HTTP requests, database queries, and filesystem access.
- Open external Speaches documentation links through the operating system only after validating the `https` scheme and approved host.
- Keep Speaches API calls and FFmpeg execution in the main process or a controlled worker, never in the renderer.
- Store API keys in the operating-system credential store where available and never in browser local storage.
- Verify downloaded update packages before installation when auto-update is added.
- Document the signing and notarization status of every desktop release accurately.

### 18.4 Network exposure

Loopback-only use is the secure default. Private-LAN access is an explicit advanced configuration. Public internet exposure is unsupported unless the user places the application behind an independently managed reverse proxy that supplies TLS, authentication, request limits, and access controls.

---

## 19. Testing Strategy

### 19.1 Parser unit tests

Required cases:

- One speaker on its own line.
- Speaker and text on the same line.
- Multiple speakers.
- Multiple pause presets.
- Sections.
- Blank lines.
- Escaped bracket at beginning of line.
- Literal brackets in the middle of speech.
- Valid and invalid pronunciation aliases.
- Windows and Unix line endings.
- Unicode speaker text.
- Text before first speaker with and without default narrator.
- Consecutive speaker directives.
- Consecutive pauses.
- Pause at beginning and end.
- Malformed directives.
- Numeric-leading speaker names using the explicit `speaker_` prefix.
- Speech following a pause on the same line.
- Multiple inline pauses and speaker switches with exact speech splitting.
- Active-speaker persistence after an inline speaker switch.
- Escaped inline control tokens.
- Literal recovery and token-pattern diagnostic suppression for malformed directives and annotations, including repeated patterns in different sentences.

### 19.2 Lexicon unit tests

Required cases:

- Whole-word replacement.
- Case-sensitive replacement.
- Exact phrase before exact term.
- Project override before global entry.
- Longer match wins.
- Priority tie-breaking.
- Named-sense resolution.
- Unresolved sense error.
- No replacement inside directives.
- No mutation of original script.
- Overlapping entries produce deterministic output.

### 19.3 Chunking tests

- Stable chunks for identical input.
- Sentence-boundary preference.
- Long paragraph handling.
- No loss or duplication of text.
- No speaker changes inside a chunk.
- Cache keys change when relevant synthesis settings change.
- Cache keys remain unchanged for pause-only or output-metadata changes.

### 19.4 TTS adapter tests

Use a fake local server to test:

- Valid audio response.
- Timeout.
- Retry.
- HTTP error.
- Empty response.
- Invalid content type.
- Voice rejection.
- Cancellation between requests.

A separate opt-in integration suite should test an actual Speaches installation.

### 19.5 Audio assembly tests

- Speech plus pause plus speech.
- Multiple sample rates normalized correctly.
- Expected silence duration within an acceptable encoder tolerance.
- No missing or duplicated segment.
- Gain adjustment.
- Final duration equals the sum of component durations within tolerance.
- Final artifact can be decoded by FFmpeg.
- Manifest timestamps are monotonically increasing.
- A long synthetic fixture is assembled without memory growth proportional to the full decoded output.
- Final MP3 encoding uses the lossless file or stream path rather than a complete in-memory PCM object.

### 19.6 Player, waveform, scratchpad, and history tests

- Quick Scratchpad synthesis does not mutate project state.
- Global lexicon use in the Scratchpad matches the full-render transformation path.
- Waveform seeking updates playback position and has a keyboard-accessible equivalent.
- Large waveform peak sets are downsampled or virtualized without freezing the renderer.
- An expanded render lists segments in manifest order.
- Segment play uses existing audio without a new TTS request.
- Copy-readable and copy-TTS actions return the correct representations.
- Explicit segment export writes the selected audio and does not expose unrelated cache files.
- Cleaned-up segment audio produces a clear unavailable state and explicit regeneration option.

### 19.7 Distribution and deployment tests

Automated or release-gate tests must cover:

- Application-only Compose startup with an external mock or real Speaches endpoint.
- Linux Docker-host routing through `host.docker.internal` and the host-gateway mapping when that example is shipped.
- Container recreation without losing StudyNarrator application data.
- URL normalization for root and `/v1` endpoint forms.
- Missing Speaches at startup followed by successful reconnection without restarting StudyNarrator.
- Offline access to project editing, parsing, lexicon management, and prompt export.
- Verification that the v1 Compose definition contains no Speaches service.
- Upgrade from the previous supported application version using the preserved application-data volume.

### 19.8 Electron packaging and security tests

Each published desktop target must verify:

- Installer or package launch on a clean supported operating-system image.
- Main-process startup, secure preload exposure, clean shutdown, and interrupted-render recovery.
- No unrestricted Node.js API in the renderer.
- IPC input and output validation.
- File import, output export, and “show in folder.”
- Localhost and private-network Speaches connection profiles.
- Application-data persistence across upgrade.
- Offline project editing when Speaches is unavailable.
- External documentation links open only to approved HTTPS destinations.
- Accurate signing or unsigned-build metadata.

### 19.9 End-to-end acceptance fixture

Maintain a small fixture project with:

- Two speakers.
- Two pause presets.
- Two sections.
- `SQL` lexicon replacement.
- Both `resume` pronunciation senses.

The fixture should produce a stable manifest and segment sequence. Audio hashes may be environment-specific and should not be the only correctness check.

---

## 20. Acceptance Criteria

### AC-1: Speaker discovery

Given a script containing `[speaker_person_a]` and `[speaker_person_b]`, the parser lists exactly `person_a` and `person_b` and shows every occurrence.

### AC-2: Pause discovery

Given `[pause_short]` and `[pause_long]`, the parser creates two editable pause rows. Changing their durations does not modify the script.

### AC-3: Voice switching

When `person_a` and `person_b` are assigned different valid voice IDs, the final manifest and audio segment order use the correct voice for each speech segment.

### AC-4: Global lexicon

Given a whole-word project entry `SQL → sequel`, the transformed TTS text uses “sequel,” while the original and readable transcripts retain `SQL`.

### AC-5: Ambiguous pronunciation

Given `{{resume|cv}}` and `{{resume|continue}}`, the transformed TTS text uses two different configured spoken forms. Removing either named-sense lexicon entry blocks rendering with a source-linked error.

### AC-6: Exact pauses

A configured `pause_short` of 350 milliseconds and `pause_long` of 1,500 milliseconds produce silence segments with those intended durations within the accepted audio-encoding tolerance.

### AC-7: Parse before render

An unmapped speaker, an unsuppressed malformed-directive diagnostic, or an unresolved sense prevents render start and identifies the exact source location. An exact suppressed malformed directive remains intentional literal speech.

### AC-8: Preview parity

A segment preview uses the same transformed text, model, voice, speed, and adapter behavior as the equivalent segment in a full render.

### AC-9: Cache reuse

After a successful render, changing only `pause_long` and rendering again results in cache hits for every unchanged speech chunk and no new TTS requests.

### AC-10: Partial correction

Changing one sentence invalidates only the chunks that contain that sentence. Other speech chunks remain reusable.

### AC-11: Failure recovery

When one TTS request fails after other chunks succeed, the successful chunks remain cached and a retry resumes from the missing work.

### AC-12: Artifacts

A successful render writes the final MP3, original script, readable transcript, transformed TTS transcript, project snapshot, checksums, and render manifest.

### AC-13: External prompt

The prompt builder produces copyable instructions that specify the currently configured speaker IDs, pause IDs, section syntax, pronunciation alias syntax, and output-only requirement.

### AC-14: No external LLM call

Creating or exporting a prompt produces no network request to an LLM provider.

### AC-15: Shared React and Node.js implementation

The Docker Web UI and Electron application use the same React component library and shared TypeScript domain, parser, lexicon, rendering, and persistence contracts. The shipped v1 application does not require Python or FastAPI.

### AC-16: Docker Web deployment

Given a supplied `.env` containing a reachable `SPEACHES_BASE_URL`, the StudyNarrator Compose package starts the Node.js Web application, persists a project under its data volume, and completes a preview through the external server.

### AC-17: Docker package excludes Speaches

The version 1 Compose file defines StudyNarrator and its application storage only. It contains no Speaches service, model-cache volume, CPU/CUDA profile, or Speaches lifecycle command.

### AC-18: Offline Docker startup

When Speaches is unreachable during StudyNarrator startup, the Web UI still opens, existing projects remain editable, and connecting the server later allows a successful test without restarting the application container.

### AC-19: Electron desktop workflow

A packaged Electron build launches on each supported operating-system family, creates a project, connects to a configured Speaches endpoint, renders audio, and reveals the output through native desktop controls.

### AC-20: Electron remote-server workflow

An Electron installation can connect to a Speaches server on a private-network hostname or IP address without requiring Docker or Speaches on the desktop computer.

### AC-21: External setup guidance

When no Speaches endpoint is configured, both clients offer the official Speaches installation and TTS documentation links, allow offline authoring, and do not attempt to install or start Speaches.

### AC-22: Secret isolation

A Speaches API key supplied through Docker environment configuration or the desktop credential store is not present in browser storage, project export, render manifest, redacted diagnostics, or normal logs.

### AC-23: Cross-client project portability

A project bundle exported from Docker imports into Electron and produces the same parsed node order after the user maps it to a valid local connection profile.

### AC-24: Versioned upgrade

Upgrading the Docker image or Electron application from the previous supported release preserves user data and either completes migrations successfully or leaves the prior data recoverable with a clear error.

### AC-25: Quick Scratchpad

A user can synthesize a short passage with a selected connection profile, model, voice, speed, and optional global lexicon without creating or modifying a project. The result uses the same adapter and transformation path as a project preview.

### AC-26: Friendly voice presentation

A configured voice appears with a human-readable label and visible raw voice ID. When optional metadata is unavailable, the UI falls back to the ID without inventing language, accent, or style information.

### AC-27: Detailed render progress

During a multi-section render, the UI reports the active phase, section, speech-segment ordinal, chunk/request activity, speaker/voice, cache counts, and a source-linked error when a segment fails.

### AC-28: Seekable waveform player

A completed render opens in a shared player with play, pause, time display, keyboard seeking, and compact waveform seeking. Playback remains usable through a non-waveform fallback if peak extraction is unavailable.

### AC-29: Segment-level render history

Expanding a completed render shows its segments in manifest order. A speech segment can be played without a new TTS request, its readable and transformed text can be copied independently, and its audio can be explicitly saved to a user-selected destination.

### AC-30: Bounded-memory assembly

A long-form fixture is assembled and encoded through a file- or stream-oriented lossless workflow whose application memory does not grow in proportion to the full decoded output.

### AC-31: License and upstream acknowledgment

The release contains an Apache-2.0 `LICENSE`, accurate dependency notices, and a visible acknowledgment of Kokoro Local GUI/Kokoro Studio, Shteryan Nikolaev (`AcTePuKc`), and relevant contributors for the workflow ideas identified in Section 23. No affiliation or endorsement is implied.

## 21. Delivery Phases

### Phase 1: Shared deterministic TypeScript core

- Versioned script parser.
- Canonical intermediate representation.
- Validation.
- Lexicon engine.
- Named pronunciation senses.
- Chunking and cache-key logic.
- Shared Speaches adapter.
- WAV segment handling.
- Silence generation.
- Streaming final MP3 assembly plan.
- Downsampled waveform peak extraction contract.
- Segment cache.
- SQLite repositories and migrations.
- Shared application service contracts.

### Phase 2: React Web UI and Node.js Docker application

- React project editor and configuration panels.
- Automatic discovery panels.
- Voice and pause configuration.
- Pronunciation workbench.
- Quick Scratchpad.
- Preview.
- Detailed render queue and segment/chunk progress.
- Shared seekable player and compact waveform.
- Expandable render history with segment-level play, copy, and save actions.
- Artifact playback and access.
- TTS connection profiles and diagnostics.
- Express API and React static hosting.
- Production StudyNarrator image.
- Application-only Compose file and `.env.example`.
- External Speaches installation and TTS links.
- Apache-2.0 release files, About/Credits view, and upstream acknowledgments.

### Phase 3: Electron desktop application

- Electron main and preload layers using the shared TypeScript services.
- Production React renderer.
- Native file and folder integration.
- First-run connection setup.
- Credential-store integration where available.
- Windows, macOS, and Linux release artifacts.
- Cross-platform persistence and upgrade testing.
- Accurate signing and notarization metadata.

### Phase 4: Script-generation workflow

- Universal prompt builder.
- Dynamic inclusion of speakers, pauses, and aliases.
- Prompt copy/export.
- Skill-package export.
- Example scripts.

### Phase 5: Long-form polish

- Section output.
- Timestamp manifest.
- Per-section MP3s.
- Markdown cleanup.
- Acronym review.
- Project bundle import/export.
- Optional loudness normalization.

No phase in version 1 includes a Speaches container, Speaches installer, hardware profile, or model-management implementation.

## 22. Future Versions (TBD)

The following items are intentionally deferred. They are candidates, not committed promises, and should receive their own scope and design review before implementation.

### 22.1 Integrated Speaches deployment options

- A combined Docker Compose stack containing StudyNarrator and Speaches.
- A separate Speaches-only Docker Compose package for Electron or LAN-server users.
- CPU and supported GPU variants, potentially including NVIDIA CUDA or other upstream-supported runtimes.
- Persistent Speaches model-cache volumes.
- Guided Kokoro model download or preload behavior.
- Readiness feedback that distinguishes server startup, model download, model loading, and synthesis readiness.
- Version compatibility testing between pinned StudyNarrator and Speaches releases.

These features must remain optional. StudyNarrator should continue supporting any compatible external Speaches endpoint.

### 22.2 Automation and integration surfaces

- A command-line client using the shared TypeScript application services.
- Incoming-folder and batch rendering workflows.
- A supported local REST API for other applications.
- An MCP server for deterministic project, lexicon, script, preview, and render operations.
- Configurable batch concurrency and external workers.

### 22.3 Additional product capabilities

- Additional TTS adapters with capability discovery.
- M4B output with navigable chapters.
- SRT or WebVTT timestamps calculated from actual segment durations.
- Deterministic reading profiles for source code and command-line examples.
- Lexicon packs for web development, databases, healthcare, and product names.
- A review report listing capitalized acronyms and words not present in any lexicon.
- Side-by-side A/B previews of two voices or pronunciations.
- Reorderable section lists that rewrite a project copy rather than silently changing the source.
- Multiple render workers for users with sufficient hardware.
- Signed desktop releases and automated notarization when maintainership resources permit.
- User-controlled desktop auto-update channels.
- Additional native package formats and validated processor architectures.
- Optional detection of an already running local Speaches service.
- Advanced authenticated multi-user or LAN-server mode.

### 22.4 Electron-managed external services

A future version may explore helping users start or stop a separately installed Speaches service, but only after upstream packaging, security, hardware detection, permissions, and cross-platform lifecycle behavior are stable enough to support. This is not part of version 1 and should not be implied by its UI or documentation.

## 23. Open-Source License and Acknowledgments

### 23.1 StudyNarrator license

StudyNarrator source code and first-party project documentation will be released under the **Apache License 2.0** unless a particular file or bundled asset states otherwise. Every source release must include:

- The complete Apache-2.0 text in a root `LICENSE` file.
- `Apache-2.0` in package metadata where the package format supports a license identifier.
- A `NOTICE` and/or `ACKNOWLEDGMENTS.md` file containing required third-party notices and the voluntary upstream acknowledgments below.
- An in-application **About / Credits** view that links to the license and acknowledgment files.
- Accurate attribution and license preservation for any third-party code that is copied or adapted.

The Apache-2.0 license applies to the application implementation, not automatically to a user’s imported study material, project content, generated transcripts, or generated audio. Those artifacts remain subject to the rights and licenses applicable to their source content, selected voices/models, and TTS services. Dependencies, FFmpeg distributions, Electron components, Speaches, models, and voice assets retain their own licenses.

### 23.2 Kokoro Local GUI inspiration

Several workflow requirements were inspired by the open-source **Kokoro Local GUI / Kokoro Studio** project:

- Repository: [AcTePuKc/Kokoro-Local-Gui](https://github.com/AcTePuKc/Kokoro-Local-Gui)
- License: [Apache License 2.0](https://github.com/AcTePuKc/Kokoro-Local-Gui/blob/main/LICENSE)
- Primary maintainer and core developer identified by the upstream README: **Shteryan Nikolaev** (`AcTePuKc`)

StudyNarrator should specifically thank Shteryan Nikolaev and the project’s contributors for demonstrating useful patterns around:

- A fast scratchpad for short synthesis tests.
- Per-segment preview and expandable generation history.
- Play, copy, and save actions for individual generated segments.
- A compact seekable waveform player.
- Detailed synthesis progress and an obvious stop action.
- Friendly voice labels.
- Lower-memory streaming WAV assembly for long-form output.

The upstream README specifically credits contributor **syedusama5556** for synthesis progress, memory-use, waveform, and history-control improvements; StudyNarrator’s acknowledgment should preserve that particular credit alongside the broader maintainer and contributor credit.

These acknowledgments describe product and UX inspiration. StudyNarrator is an independent implementation in React, Node.js, TypeScript, and Electron; it is not affiliated with, sponsored by, endorsed by, or a distribution of Kokoro Local GUI. If implementation code is later copied or adapted, the project must separately preserve all notices required by Apache-2.0 and document the adapted files.

Recommended concise About-screen wording:

```text
StudyNarrator is licensed under Apache-2.0.

Workflow inspiration and thanks: Kokoro Local GUI / Kokoro Studio,
maintained by Shteryan Nikolaev (AcTePuKc) and contributors. Particular
credit to syedusama5556 for upstream progress, waveform, memory-use, and
history-control improvements. StudyNarrator is an independent project.
```

### 23.3 Release attribution checks

Before each public release:

1. Verify that upstream names, contributor handles, repository links, and license links remain accurate.
2. Regenerate the third-party license inventory from the actual dependency lockfile and bundled binaries.
3. Distinguish voluntary inspiration credits from legally required copied-code notices.
4. Confirm that the About/Credits view and source-distribution notices match.
5. Avoid using upstream logos, screenshots, or branding without separate permission.

# Appendix A: Complete Example Script

```text
[section: Introduction]

[speaker_teacher] Today we are going to discuss database queries and job application documents.
[pause_short]
[speaker_student] Those sound unrelated.
[pause_short]
[speaker_teacher] They are, but both contain words that text-to-speech systems may pronounce differently than we want.
[pause_long]

[section: SQL]

[speaker_teacher] SQL lets an application read and modify relational data.
[pause_short]
[speaker_student] In this project, should SQL sound like sequel or S Q L?
[pause_short]
[speaker_teacher] The project lexicon decides. The visible transcript still contains SQL.
[pause_long]

[section: Resume]

[speaker_teacher] A {{resume|cv}} summarizes a candidate's professional experience.
[pause_short]
[speaker_student] What happens after a paused background job restarts?
[pause_short]
[speaker_teacher] The job can {{resume|continue}} from its last safe checkpoint.
[pause_long]

[section: Summary]

[speaker_teacher] Speaker tags choose voices, pause tags control silence, and the lexicon controls pronunciation.
[pause_short]
[speaker_student] The original text remains available for review.
```

Expected automatic discovery:

```text
Speakers:
- teacher
- student

Pauses:
- pause_short
- pause_long

Sections:
- Introduction
- SQL
- Resume
- Summary

Pronunciation aliases:
- resume | cv
- resume | continue
```

---

# Appendix B: Universal External-LLM Prompt Template

The application should generate a project-specific version of the following template.

```text
You are converting source material into a spoken script for a deterministic text-to-speech application.

GOAL
Create an accurate, easy-to-follow audio script. The script may use multiple speakers to make study material clearer, but it must not add facts that are not supported by the source.

OUTPUT CONTRACT
- Output only the raw script.
- Do not wrap the output in a Markdown code fence.
- Do not add an introduction, explanation, notes, or a summary outside the script.
- Use only the directives and speaker IDs listed below.
- Put section directives on their own lines. Pause directives may appear between words when a dramatic pause is needed.
- Speaker tags may appear between spoken phrases; the new speaker remains active until the next speaker tag.
- Keep each spoken turn reasonably short.
- Preserve technical accuracy.
- Expand or explain dense visual material so it makes sense when heard without looking at a screen.
- Avoid Markdown tables. Convert each useful row into spoken prose.
- Do not read decorative Markdown characters aloud.
- Do not invent pronunciations. Use the supplied pronunciation aliases when an ambiguous term requires one.

ALLOWED SPEAKERS
- [speaker_teacher]: Explains concepts clearly and accurately.
- [speaker_student]: Asks concise clarifying questions and checks understanding.

ALLOWED PAUSES
- [pause_short]: Brief pause between speakers or closely related ideas.
- [pause_long]: Longer pause between major subjects.

SECTION FORMAT
Use this on its own line before each major subject:
[section: Descriptive section title]

AMBIGUOUS PRONUNCIATION FORMAT
Use:
{{display text|sense}}

Available aliases:
- {{resume|cv}} for the job-application document.
- {{resume|continue}} for continuing an interrupted action.

VALID EXAMPLE
[section: Caching]

[speaker_teacher] A cache stores a reusable result close to where it is needed.
[pause_short]
[speaker_student] What happens when the original data changes?
[pause_short]
[speaker_teacher] The application needs an invalidation strategy so it does not keep serving stale data.
[pause_long]

SCRIPTING GUIDANCE
- Prefer a natural conversation over alternating speakers after every sentence.
- Use the student only when a question, misconception, or recap improves understanding.
- Use [pause_short] for speaker handoffs when the transition would otherwise feel rushed.
- Use [pause_long] after a completed major subject.
- Do not create new speaker or pause IDs.
- Do not place instructions in square brackets unless they are valid directives.
- When source material contains code, explain what the code does in speakable prose. Include exact code only when the user explicitly requests code to be read aloud.
- Read important symbols in words when necessary for understanding.
- Preserve names, numbers, constraints, warnings, and distinctions from the source.

SOURCE MATERIAL
{{SOURCE_MATERIAL}}
```

The prompt builder should replace speakers, pauses, aliases, guidance, and source material with the project’s current configuration.

---

# Appendix C: Example Lexicon Entries

```yaml
- id: project.sql.sequel
  scope: project
  type: exact_term
  display_text: SQL
  spoken_text: sequel
  case_sensitive: true
  whole_word: true
  priority: 100
  enabled: true
  notes: This project consistently uses the sequel pronunciation.

- id: global.resume.cv
  scope: global
  type: named_sense
  display_text: resume
  sense_id: cv
  spoken_text: rez-oo-may
  enabled: true

- id: global.resume.continue
  scope: global
  type: named_sense
  display_text: resume
  sense_id: continue
  spoken_text: ree-zoom
  enabled: true

- id: project.postgresql
  scope: project
  type: exact_term
  display_text: PostgreSQL
  spoken_text: post gres Q L
  case_sensitive: false
  whole_word: true
  priority: 100
  enabled: true
```

The spoken strings above are examples and must remain user-editable because a particular spelling may sound different across voices.

---

# Appendix D: Suggested Local Directory Layout

```text
study-narrator/
  data/
    app.db
    settings.json
    lexicon/
      global-export.json
    projects/
      <project-id>/
        script.txt
        project.json
        renders/
          <render-id>/
            ...artifacts...
    cache/
      speech/
        ab/
          <content-hash>.wav
    previews/
    temp/
  logs/
```

The cache and temporary directories may be moved to a different volume through configuration. Docker maps this logical layout under `/data`. Electron maps it into the operating system’s application-data location and may store user-selected final exports elsewhere.

# Appendix E: Key Product Decisions

1. **No embedded LLM.** Script generation is external and optional.
2. **Explicit ambiguity resolution.** The harness does not guess which meaning of a word the user intended.
3. **WAV for reusable speech segments.** MP3 is produced once at final output.
4. **Named pauses become real silence.** Punctuation is not used as a substitute for timing control.
5. **Speaker and pause IDs are discovered from the script.** The UI is configuration-driven rather than requiring setup before paste.
6. **The original script remains untouched.** Replacements appear only in a transformed TTS representation.
7. **Segment caching is part of version 1.** Long-form corrections must be inexpensive.
8. **A single local worker is the default.** The product remains lightweight and avoids unnecessary queue infrastructure.
9. **Voice IDs remain configurable.** The harness does not rely on a permanent voice-list API or model-repository layout.
10. **React and Node.js are the v1 application stack.** Shared product behavior is implemented in TypeScript.
11. **Two v1 clients share one core.** Docker Web and Electron use the same parser, services, schemas, and React UI components.
12. **Speaches is an external dependency.** Version 1 links to official setup documentation but does not bundle or administer it.
13. **Connection profiles are installation-local.** Portable projects reference profiles without carrying server credentials.
14. **Offline editing remains available.** A missing Speaches server does not prevent project editing, parsing, lexicon work, or prompt export.
15. **Localhost is the secure Web default.** LAN exposure requires an explicit configuration change and visible warning.
16. **The Electron renderer is unprivileged.** Filesystem, credentials, HTTP, and process execution remain behind validated IPC commands.
17. **CLI and combined deployment are future work.** They are not hidden requirements for the initial harness.
18. **Quick experiments do not require a project.** The Scratchpad uses the production transformation and adapter path without mutating project state.
19. **The waveform is for navigation, not editing.** Version 1 provides compact, accessible seeking without becoming a DAW.
20. **Rendered segments remain inspectable.** History exposes exact segment playback, readable/TTS text copy, and explicit segment export.
21. **Long-form assembly is streaming and bounded-memory.** The complete decoded program is not accumulated in Node.js or renderer memory.
22. **The project is Apache-2.0 with visible upstream thanks.** Inspiration from Kokoro Local GUI is credited without implying affiliation.

---

# Appendix F: Version 1 Environment Contract

The exact environment-variable names may evolve before implementation, but the Docker Web release must provide a stable, documented contract equivalent to the following.

## F.1 StudyNarrator Web settings

```dotenv
# Host-side Web UI exposure used by the supplied Compose file.
STUDYNARRATOR_BIND_ADDRESS=127.0.0.1
STUDYNARRATOR_HOST_PORT=8080

# Persistent path inside the application container.
STUDYNARRATOR_DATA_DIR=/data

# External Speaches connection. No Speaches service is defined by this Compose file.
SPEACHES_BASE_URL=http://host.docker.internal:8000
SPEACHES_API_KEY=
SPEACHES_MODEL_ID=speaches-ai/Kokoro-82M-v1.0-ONNX
SPEACHES_DEFAULT_VOICE=af_heart
SPEACHES_REQUEST_TIMEOUT_SECONDS=120
SPEACHES_RETRY_COUNT=2

# Prevent UI changes when the deployment owner controls the endpoint.
STUDYNARRATOR_LOCK_SPEACHES_SETTINGS=false
```

The `.env.example` must contain no live secrets and must explain that:

- `SPEACHES_BASE_URL` points to a separately installed server.
- `localhost` inside the StudyNarrator container refers to that container, not the Docker host.
- `host.docker.internal` or a private hostname/IP is commonly required.
- Speaches installation, hardware selection, and model management follow the official upstream documentation.

## F.2 Configuration-source display

The diagnostics page should render effective values in a table similar to:

```text
Setting                    Effective value                 Source       Editable
Speaches base URL          http://192.168.1.50:8000        environment  no
Default model              speaches-ai/Kokoro-82M-...      environment  no
Default voice              af_heart                        saved profile yes
Application data path      /data                           environment  no
Client type                docker-web                      runtime      no
```

Secrets display only as “configured” or “not configured.”

Electron stores equivalent values in application settings and the operating-system credential store where available; it does not use this `.env` contract for normal installed-app usage.

---

# Appendix G: Version 1 Distribution Package Requirements

## G.1 Docker Web package

The Docker Web package must define:

```text
Service: study-narrator
Runtime: Node.js application serving the React build and Express API
Image: versioned StudyNarrator image
Ports: ${STUDYNARRATOR_BIND_ADDRESS}:${STUDYNARRATOR_HOST_PORT}:<container-port>
Volume: application data -> /data
Environment: external Speaches connection and StudyNarrator settings
Extra host: host.docker.internal -> host-gateway where supported
Restart policy: unless-stopped or documented equivalent
```

It must not define:

```text
A Speaches service
A Speaches model-cache volume
CPU or GPU Speaches profiles
A Kokoro model download command
Speaches lifecycle scripts
```

## G.2 Electron package

The Electron release must provide:

- Platform-appropriate application packages.
- The compiled React renderer.
- Electron main and preload code built from TypeScript.
- The shared application, parser, rendering, persistence, and Speaches-adapter packages.
- A bundled or validated FFmpeg distribution strategy.
- Release checksums.
- Clear signing and notarization status.
- First-run connection guidance and official external Speaches setup links.

## G.3 Shared release documentation

Both package types must include the applicable Apache-2.0 license, third-party notices, and StudyNarrator acknowledgment files, and must document:

- How to point to Speaches on the same computer.
- How to point to Speaches on another private-network computer.
- How to test a connection.
- What remains usable while Speaches is offline.
- Where application data is stored.
- How to back up and restore projects.
- That Speaches itself is not included in version 1.

---

# Appendix H: Desktop Platform Contract

The desktop implementation should map shared concepts as follows:

```text
Shared application concept       Electron implementation
------------------------------------------------------------------
React application                Packaged renderer assets
Application service command      Validated preload/IPC invocation
Node.js backend service          Electron main/shared TypeScript service
SQLite repository                Per-user application-data database
Docker .env connection defaults  First-run/saved connection profile
Browser file upload              Native open dialog and drag/drop
Artifact download                Native save/export dialog
Artifact path                    Show in Finder/Explorer/file manager
External documentation link      Validated HTTPS system-browser action
Server logs                      Redacted diagnostics and local log file
```

Suggested data-location behavior:

- Windows: use the Electron-provided per-user application-data directory.
- macOS: use the Electron-provided per-user Application Support directory.
- Linux: honor the Electron and XDG-compatible per-user data location.

The implementation should rely on Electron APIs to resolve these locations rather than hard-coding paths shown in documentation.

The renderer must not receive generic APIs such as `readFile(path)`, `spawn(command)`, or `fetchAnyUrl(url)`. It receives task-specific methods such as `openScriptFile`, `startRender`, `saveArtifact`, and `openApprovedExternalLink`.

---

# Appendix I: Version 1 Documentation Checklist

Every release must document:

1. The two supported v1 application distributions.
2. That Speaches is a separately installed prerequisite for preview and rendering.
3. The official Speaches installation and TTS/model links.
4. Docker Web `.env` configuration.
5. Localhost, Docker-host, and LAN endpoint examples.
6. How to test the endpoint and interpret connection failures.
7. Which features remain available offline.
8. Persistent StudyNarrator data locations.
9. Backup and restore.
10. Upgrade and rollback.
11. API-key and network-exposure guidance.
12. Diagnostics and logs.
13. Desktop signing or notarization status.
14. Tested operating-system, processor, Docker, Node.js, Electron, and Speaches versions.
15. A clear statement that the v1 release does not contain a Speaches Compose file, model installer, or hardware configuration.
16. Quick Scratchpad, shared player, waveform, and segment-history usage.
17. Apache-2.0 licensing, third-party notices, and Kokoro Local GUI acknowledgments.
