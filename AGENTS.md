# Repository Instructions

## Pre-commit security check

Before every commit:

- Review `git status`, the staged file list, and the complete staged diff.
- Do not commit secrets or sensitive information, including API keys, tokens, passwords, credentials, private keys, personal endpoints, private infrastructure details, or generated files containing them.
- Check new and modified files for other security risks, such as unsafe permissions, accidental data exposure, or insecure configuration. Resolve any issue before committing.
- If `git status` shows an untracked or generated file that should never be committed, add an appropriately narrow entry to `.gitignore` so it is not accidentally committed later. Do not use `.gitignore` to conceal a file that is already tracked; remove or sanitize tracked sensitive content and address any exposure in Git history.
- If it is unclear whether a file is safe or intended for source control, do not stage or commit it until the user confirms.

Never include automated attribution metadata, AI bylines, or `Co-authored-by` lines in commits.

## Incremental commit discipline

During implementation work, create small, coherent checkpoint commits instead of waiting until an entire feature or milestone is finished.

- Commit after each independently understandable and validated slice of work, such as a schema or parser change, its UI integration, or its documentation and test updates.
- Create a checkpoint before moving to a materially different concern, beginning a risky refactor, or making changes that would make the current working state harder to reconstruct.
- Keep unrelated changes in separate commits. Do not sweep pre-existing or user-authored working-tree changes into a checkpoint unless they are confirmed to be part of the same task.
- Run the relevant focused checks before each checkpoint. A checkpoint must not knowingly leave the branch in a broken build or failing-test state.
- Run the cumulative product verifier at release-level milestones; focused validation is sufficient for smaller intermediate commits when the full verifier would be disproportionate.
- Use concise commit messages that state the completed behavior. Do not use vague messages such as `WIP`, `updates`, or `misc changes`.
- Do not rewrite, squash, or discard checkpoint commits unless the user explicitly asks.

When the user has authorized implementation on the current branch, these checkpoint commits are part of the normal implementation workflow and should not require a separate reminder after every slice.

## Formatting

Formatting is owned by Prettier: run `npm run format` before committing, and never mix formatting changes with logic changes in the same commit.

## Mandatory automated acceptance and API contracts

Functional behavior must be automated before it is handed to a human reviewer.

- Any added or changed user-facing route, primary workflow, navigation path, dialog, or way of accessing a UI component must add or update Playwright coverage in the same checkpoint. Keep the tests current when later changes move, rename, or replace UI access paths.
- Use accessible role, label, text, and state locators. Add a test ID only when the UI has no stable semantic locator and adding an accessible name would be inappropriate.
- Cover the happy path, validation, expected failure states, persistence/reload behavior, and security or redaction behavior whenever they apply to the changed workflow. Do not use fixed sleeps; wait for observable application state.
- Any REST route, typed Electron IPC channel, or public application-service method change must update its explicit manifest and manifest-driven unit or contract tests in the same checkpoint. A route, channel, or service addition is incomplete until the live surface and test manifest agree.
- Keep focused component tests and service unit tests. Playwright adds real workflow acceptance and does not replace Testing Library or Vitest coverage.
- Run the relevant focused tests before each checkpoint. Do not hand work to a human reviewer until focused tests and the cumulative `npm run verify` command pass.
- Human review is UX-only after automation is green: visual quality, accessibility feel, responsive behavior, perceived timing, audio perception when relevant, and operating-system-native interaction feel. Any functional defect found there must receive an automated regression test before approval.
