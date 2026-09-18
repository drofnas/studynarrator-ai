# StudyNarrator AI

<!-- impeccable:product-schema 1 -->

## Platform

web

The React interface is shared by Docker Web and the Electron development client.

## Users

An individual creating narrated audio for their own study. The user confirmed
that clarity and efficient authoring should guide the complete UI overhaul.

## Product Purpose

Turn structured study scripts into audio that the author can preview, review,
and export. Preserve all existing capabilities throughout the redesign.

## Operating Context

Authors write scripts with speakers, sections, and pauses; assign voices; adjust
pronunciations and timing; validate scripts; render audio; and review results.
Quick Scratchpad tests short passages. Prompt Kit exports instructions for an
external language model. Authoring remains available offline.

## Capabilities and Constraints

- Local-first, single-user storage with projects, preferences, and render history.
- Speech synthesis uses an external Speaches service; no engine is bundled.
- Project and global lexicons, voice auditions, render activity, audio retention,
  exports, diagnostics, and database recovery remain accessible.
- Preserve strict REST and IPC contracts, the sandboxed Electron renderer,
  content security policy, typed service adapters, and existing persistence.
- Use the existing React, TypeScript, CSS modules, and CodeMirror stack.

## Brand Commitments

Keep the StudyNarrator AI name. The user delegated the replacement visual design.

## Evidence on Hand

Current source and manifests are authoritative. README.md describes the supported
distribution and workflows. e2e/web and e2e/electron contain acceptance coverage.
Any screenshot fixtures created for design review use disposable synthetic data.

## Product Principles

- Put the author's next task within easy reach.
- Keep writing, listening, and progress understandable at a glance.
- Show actionable errors and accurate connection and render states.
- Preserve keyboard operation and responsive access to every capability.
