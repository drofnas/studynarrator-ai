# Gate G03 Manual Test

Use the Web development client and disposable data only. Lexicon entries are intentionally memory-only in this gate. Speaches is not required and must not receive requests.

## Preparation

1. Use Node `26.7.0`.
2. Run `npm run gate:reset -- G03`.
3. Run `npm run verify:gate -- G03` and confirm the final line is `GATE G03: AUTOMATED CHECKS PASSED`.
4. Start the Web application with `STUDYNARRATOR_DATA_DIR=.tmp/gates/G03/web npm run dev:web`.
5. Open the local URL shown by Vite. Confirm Script Lab is the default view and Runtime diagnostics remains available.

## Canonical transformation

1. Copy `fixtures/gates/study-guide-valid.txt` byte-for-byte into **Script source**.
2. Select **Edit as JSON** and replace the initial `[]` with:

   ```json
   [
     { "scope": "global", "entryType": "exactTerm", "displayText": "SQL", "spokenText": "sequel" },
     { "scope": "project", "entryType": "namedSense", "displayText": "resume", "senseId": "cv", "spokenText": "rez-oo-may" },
     { "scope": "project", "entryType": "namedSense", "displayText": "resume", "senseId": "continue", "spokenText": "ree-zoom" }
   ]
   ```

3. Select **Save JSON**. Confirm three active entries appear in JSON order with deterministic session IDs and the form/list view returns.
4. Open **Edit as JSON** again. Confirm the generated JSON contains the IDs and every pronunciation behavior field, includes the documented defaults, and contains no timestamps. Select **Cancel**.
5. Select **Analyze**. Confirm the G02 discovery summary still reports 2 speakers, 2 pause IDs, 2 sections, 5 speech segments, 4 explicit pauses, and 2 annotations.
6. Confirm **Pause at paragraph breaks** is enabled and identified as `pause_medium · 750 ms`. In **Paragraph pacing preview**, confirm the canonical fixture's paragraph boundary is suppressed by its explicit pause.
7. Open **Source** and confirm the complete original fixture, including annotation markup and directives, is unchanged.
8. Open **Readable transcript**. Confirm both annotations display as `resume` and both `SQL` occurrences remain `SQL`.
9. Open **TTS transcript**. Confirm the CV sense is `rez-oo-may`, the continue sense is `ree-zoom`, and both whole-word `SQL` occurrences are `sequel`.
10. Open **Lexicon matches**. Confirm exactly four rows appear. Each row must show scope, type, deterministic session entry ID, original text, spoken text, source line and column, and end-exclusive source offsets.
11. Confirm the status reads **Synthesis ready**.

## JSON validation and atomicity

1. Open **Edit as JSON**, enter `{`, and select **Save JSON**. Confirm a JSON syntax alert appears, the textarea is marked invalid, and the editor remains open.
2. Replace the draft with a root array containing a `namedSense` entry without `senseId`. Save and confirm the alert identifies the indexed path such as `[0].senseId`.
3. Add an unknown property or duplicate a supplied ID and save. Confirm every reported schema issue is listed and no partial replacement occurs.
4. Select **Cancel**. Confirm the three canonical active entries, four-match analysis, and source are unchanged.
5. Open **Edit as JSON**, type without saving, then cancel. Confirm the existing analysis never becomes stale.
6. Open **Edit as JSON**, make a valid change, and save. Confirm the previous analysis becomes stale and the replacement list is applied exactly in JSON order.
7. Restore the three-entry canonical JSON and select **Analyze** before continuing.

## Missing sense and restoration

1. Delete the Project `resume + cv` entry and select **Analyze** again.
2. Confirm a non-blocking `UNRESOLVED_NAMED_SENSE` warning points to the complete CV annotation's source location.
3. Confirm both transcript views preserve the exact `{{resume|cv}}` markup and do not apply an ordinary `resume` rule inside it.
4. Confirm the status remains **Synthesis ready**.
5. Select **Ignore this pattern** on the warning. Confirm it disappears, `UNRESOLVED_NAMED_SENSE` plus `{{resume|cv}}` appear under **Ignored diagnostic patterns**, and both transcripts remain unchanged.
6. Select **Restore this pattern** and confirm the warning returns. Restore `resume + cv`, select **Analyze**, and confirm the warning clears while the resolved readable and TTS values return.
7. Copy **Script source** to a diff tool and confirm it remains byte-for-byte identical to `fixtures/gates/study-guide-valid.txt`.
8. Delete any entry so it appears under **Removed this session**, then save `[]` through **Edit as JSON**. Confirm both the active list and restore history are cleared.

## Automatic paragraph pacing

1. Paste `First paragraph.`, two blank lines, and `Second paragraph.` with no directives. Leave **Pause at paragraph breaks** enabled and select **Analyze**.
2. Confirm **Paragraph pacing preview** contains one applied `pause_medium` row at 750 ms with the blank-line source location and neighboring speech node ordinals.
3. Confirm the source remains byte-for-byte unchanged, both transcripts contain only the two speech lines, and **Synthesis ready** is unchanged.
4. Add `[pause_short]` anywhere between the two speech lines, preserving a blank-line boundary, and analyze. Confirm the automatic row is marked suppressed and cites the explicit pause node; the authored pause remains in canonical nodes.
5. Remove the explicit pause, analyze, then clear **Pause at paragraph breaks**. Confirm the analysis becomes stale. Reanalyze and confirm the preview states that automatic paragraph pauses are disabled.
6. Re-enable the checkbox for subsequent checks. Confirm Lexicon entries and **Edit as JSON** never contain pacing fields.

## Determinism, responsiveness, and isolation

1. Select **Analyze** repeatedly without changing inputs. Confirm transcripts and match order remain identical.
2. Paste or generate a bare multi-line study guide near 100,000 characters, leave **Default speaker override** blank, and select **Analyze**. Confirm the status identifies the browser worker, the page remains interactive, `narrator` is the only discovered speaker, all source appears in both transcripts, no `MISSING_DEFAULT_SPEAKER` diagnostic appears, and the result is **Synthesis ready**.
3. Enter `host` as the override and analyze; confirm bare speech uses `host`. Clear it and analyze again; confirm bare speech returns to `narrator`.
4. During separate long analyses, edit the source, default-speaker override, transition checkbox, and lexicon. Confirm each edit marks the result stale and the old worker result is discarded.
5. Refresh the page. Confirm all lexicon entries are gone; no session entry is persisted.
6. Open browser developer tools before adding entries and analyzing. Confirm there are no project persistence, lexicon REST, Electron IPC, audio preview, or Speaches requests.
7. Replay the invalid G02 fixture and its ignore/restore flow. Confirm parser errors and warnings offer the same shared controls, canonical ordering, literal recovery, diagnostics, and source preservation still work.
8. Open Runtime diagnostics and run the G01 self-test once to confirm the previously approved screen and behavior remain intact.

## Review record

Record the automated output, browser and operating-system versions, screenshots, defects, and an explicit decision in `docs/gates/approvals/G03.md` only after completing this checklist. Leave G03 unchecked and do not create `gate-G03-approved` until the human reviewer approves it.
