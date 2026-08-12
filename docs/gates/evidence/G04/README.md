# G04 Browser QA Evidence

- Date: 2026-08-12
- Browser: Headless Chrome 145.0.7632.6
- Operating system: macOS 26.5.1 (25F80)
- Node: 26.7.0
- Data directory: `.tmp/gates/G04/browser-qa`
- Database permissions: `0600`

## Results

- Migration ledger reported schema `2 / 2`, state `ready`, the repository-root disposable database path, and no backup for a fresh database.
- Created `Gate 04 Browser QA`; its independent project pacing copy was enabled at `pause_medium = 750 ms`.
- An invalid speaker-mapping JSON draft remained visible, produced a path-specific alert, and did not save the aggregate.
- Saved Unicode/multi-paragraph source and a project lexicon entry; saved an independent global lexicon entry.
- Stopped both application processes, restarted against the same data directory, reloaded the project, and confirmed exact source, SHA-256, pacing, project lexicon, and global lexicon survived.
- Console errors: none.
- Network activity: local Vite assets and documented `/api` persistence resources only. No Speaches, TTS, synthesis, audio, render, analytics, or external requests occurred.
- Responsive captures at 375×812, 768×1024, and 1280×720 showed no horizontal clipping; the single-column mobile layout retained all controls.

## Captures

- `persistence-restart.png` — full restarted project and migration ledger.
- `persistence-lab-mobile.png` — mobile responsive layout.
- `persistence-lab-tablet.png` — tablet responsive layout.
- `persistence-lab-desktop.png` — desktop responsive layout.

These are implementation QA artifacts, not G04 approval evidence. G04 remains open for the full documented human checklist and explicit approval.
