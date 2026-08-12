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
6. Open **Source** and confirm the complete original fixture, including annotation markup and directives, is unchanged.
7. Open **Readable transcript**. Confirm both annotations display as `resume` and both `SQL` occurrences remain `SQL`.
8. Open **TTS transcript**. Confirm the CV sense is `rez-oo-may`, the continue sense is `ree-zoom`, and both whole-word `SQL` occurrences are `sequel`.
9. Open **Lexicon matches**. Confirm exactly four rows appear. Each row must show scope, type, deterministic session entry ID, original text, spoken text, source line and column, and end-exclusive source offsets.
10. Confirm the status reads **Synthesis ready**.

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
2. Confirm an `UNRESOLVED_NAMED_SENSE` blocking diagnostic points to the CV annotation's source location.
3. Confirm both transcript views preserve `resume` for that unresolved annotation and do not apply an ordinary `resume` rule inside it.
4. Confirm the status reads **Blocking issues**.
5. Restore `resume + cv`, select **Analyze**, and confirm the diagnostic clears and **Synthesis ready** returns.
6. Copy **Script source** to a diff tool and confirm it remains byte-for-byte identical to `fixtures/gates/study-guide-valid.txt`.
7. Delete any entry so it appears under **Removed this session**, then save `[]` through **Edit as JSON**. Confirm both the active list and restore history are cleared.

## Determinism, responsiveness, and isolation

1. Select **Analyze** repeatedly without changing inputs. Confirm transcripts and match order remain identical.
2. Paste or generate a script near 100,000 characters and select **Analyze**. Confirm the status identifies the browser worker and the page remains interactive.
3. During separate long analyses, edit the source, default speaker, and lexicon. Confirm each edit marks the result stale and the old worker result is discarded.
4. Refresh the page. Confirm all lexicon entries are gone; no session entry is persisted.
5. Open browser developer tools before adding entries and analyzing. Confirm there are no project persistence, lexicon REST, Electron IPC, audio preview, or Speaches requests.
6. Replay the invalid G02 fixture and its ignore/restore flow. Confirm canonical ordering, literal recovery, diagnostics, and source preservation still work.
7. Open Runtime diagnostics and run the G01 self-test once to confirm the previously approved screen and behavior remain intact.

## Review record

Record the automated output, browser and operating-system versions, screenshots, defects, and an explicit decision in `docs/gates/approvals/G03.md` only after completing this checklist. Leave G03 unchecked and do not create `gate-G03-approved` until the human reviewer approves it.
