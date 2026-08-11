# Repository Instructions

## Pre-commit security check

Before every commit:

- Review `git status`, the staged file list, and the complete staged diff.
- Do not commit secrets or sensitive information, including API keys, tokens, passwords, credentials, private keys, personal endpoints, private infrastructure details, or generated files containing them.
- Check new and modified files for other security risks, such as unsafe permissions, accidental data exposure, or insecure configuration. Resolve any issue before committing.
- If `git status` shows an untracked or generated file that should never be committed, add an appropriately narrow entry to `.gitignore` so it is not accidentally committed later. Do not use `.gitignore` to conceal a file that is already tracked; remove or sanitize tracked sensitive content and address any exposure in Git history.
- If it is unclear whether a file is safe or intended for source control, do not stage or commit it until the user confirms.

Never include automated attribution metadata, AI bylines, or `Co-authored-by` lines in commits.
