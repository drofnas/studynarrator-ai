# G04 Manual Test — SQLite Persistence and Migration Safety

Use Node `26.7.0` and disposable data only. G04 is reviewable when the automated verifier passes and this workflow proves two full restarts. Do not check or tag G04 until the reviewer explicitly approves it.

## Setup

1. From the repository root, run `npm run gate:reset -- G04`.
2. Run `STUDYNARRATOR_DATA_DIR=.tmp/gates/G04/manual npm run dev:web`.
3. Open the application, choose **Persistence Lab**, and open browser developer tools with network recording enabled.
4. Confirm the migration ledger reports schema `2 / 2`, state `ready`, and an actual database path under `.tmp/gates/G04/manual`.
5. Confirm **Latest backup** reports no migration backup for this fresh database.

## Complete aggregate and first restart

1. Keep the system paragraph default enabled at 750 ms.
2. Create `Gate 04 Persistence` with description `Two-restart review`.
3. Confirm the new aggregate owns `pause_medium` at 750 ms and its paragraph pacing is enabled at the same duration.
4. Paste the exact canonical fixture from `fixtures/gates/study-guide-valid.txt` into **Exact script source**.
5. Set **Speaker mappings JSON** to mappings for `teacher` and `student`.
6. Keep `pause_medium` and add `pause_short = 350` and `pause_long = 1500` in **Pause presets JSON**.
7. Add both project `resume` named senses in **Project lexicon JSON**. Use project scope.
8. In **Global lexicon JSON**, add global exact-term `SQL → sequel` and replace the global collection.
9. In **Ignored diagnostic patterns JSON**, add one harmless `{ "code", "pattern" }` pair and replace the collection.
10. Add a connection placeholder with a safe name, loopback HTTP base URL, model hint, and voice hint. Confirm there is no credential field.
11. Select that placeholder on the project and save the project aggregate.
12. Deliberately make one JSON editor invalid and select **Save project**. Confirm the invalid draft remains, every error includes a JSON path, and none of the aggregate changes were saved. Restore valid JSON and save.
13. Stop every Web application process. Start it again with the same `STUDYNARRATOR_DATA_DIR`.
14. Choose **Persistence Lab**, select **Reload from database**, load the project, and confirm exact source, SHA-256 hash, collection order, speakers, pauses, paragraph pacing, project lexicon, and connection reference survived.
15. Confirm the global SQL entry and ignored diagnostic pattern also survived.

## Copy-on-create and second restart

1. Change the system paragraph default to disabled and 1200 ms, then save it.
2. Reload `Gate 04 Persistence` and confirm it is still enabled at 750 ms.
3. Create `Gate 04 Later Defaults` and confirm it owns a `pause_medium` preset and paragraph configuration at 1200 ms with the transition disabled.
4. Change that project to enabled at 900 ms by updating both its `pause_medium` preset and paragraph configuration, then save.
5. Stop every Web application process and restart with the same data directory a second time.
6. Reload both projects. Confirm the first remains enabled at 750 ms, the second remains enabled at 900 ms, and the system default remains disabled at 1200 ms.

## Migration and ownership evidence

1. Run `npm run db:migrate -- --data-dir .tmp/gates/G04/manual` twice.
2. Confirm both runs report schema version 2, no newly applied migration, and no duplicate projects or installation records.
3. Review the automated v1-fixture upgrade evidence: it must create a protected backup before schema 2, retain the fixture record, and leave the backup at mode `0600`.
4. Delete the connection placeholder and reload the first project. Confirm its reference is `None` and all other project data remains.
5. Select **Delete project…**, confirm deletion, and reload from the database.
6. Confirm only that project and its owned speakers, pauses, and project lexicon are gone. Confirm the global SQL entry, ignored pattern, system default, other project, and remaining installation data survive.
7. Confirm Runtime diagnostics reports schema version 2, the same effective data directory/database path, migration readiness, and latest backup state.

## Security and scope checks

1. Inspect REST responses and the browser console. Confirm validation failures return sanitized `400`, missing records `404`, conflicts `409`, and unavailable migration state `503` without SQL, source text, or internal exception details.
2. Confirm the Persistence Lab and network log expose no API keys, passwords, authorization headers, generic SQL endpoint, generic filesystem primitive, generic fetch primitive, or generic IPC channel.
3. Confirm Script Lab is still memory-only: its source, lexicon, ignored patterns, and paragraph checkbox do not load from or save to G04 projects.
4. Confirm zero Speaches, TTS, audio, synthesis, render, or external network activity throughout the workflow.

## Automated evidence and review handoff

1. Run `npm run verify:gate -- G04` under Node `26.7.0`.
2. Require the final line `GATE G04: AUTOMATED CHECKS PASSED`.
3. Record operating system, browser, Electron, SQLite, and FFmpeg versions plus screenshots of the migration ledger, first-project reload, copy-on-create comparison, and ownership-safe deletion.
4. Leave G04 unchecked and untagged for human review.
