# Gate G02 Manual Test

Use the Web development client and disposable data only. Speaches is not required and must not receive requests during this gate.

## Preparation

1. Run `npm run gate:reset -- G02`.
2. Run `npm run verify:gate -- G02` and confirm the final line is `GATE G02: AUTOMATED CHECKS PASSED`.
3. Start the Web application with `STUDYNARRATOR_DATA_DIR=.tmp/gates/G02/web npm run dev:web`.
4. Open the local URL shown by Vite. Confirm Script Lab is the default view and Runtime diagnostics remains available in navigation.

## Valid fixture

1. Open `fixtures/gates/study-guide-valid.txt`, copy it byte-for-byte, and paste it into **Script source**.
2. Leave **Default speaker ID** empty and select **Parse**.
3. Confirm the discovery summary reports 2 speakers, 2 pause IDs, 2 sections, 5 speech segments, 4 explicit pauses, and 2 annotations.
4. Inspect the ordered table. Confirm section, paragraph, speech, and pause nodes follow source order and every row displays its source line.
5. Confirm annotated `resume` text is readable without its `{{...}}` markup.
6. Copy the editor value back to a file or diff tool and confirm it remains byte-for-byte identical to the fixture.

## Invalid and escaped input

1. Replace the editor contents with `fixtures/gates/study-guide-invalid.txt` and select **Parse**.
2. Confirm `1bad` and `teacher` are discovered, and confirm `pause_short` has two occurrences.
3. Confirm line 3 emits its leading pause, speech under `1bad`, its inline pause, and trailing literal annotation speech in that exact order.
4. Confirm line 5 emits `This annotation` under `1bad`, changes speaker at `[speaker_teacher]`, and emits the remaining speech under `teacher`.
5. Add a plain speech line after line 5 and parse. Confirm it remains assigned to `teacher` until another speaker token appears.
6. Confirm lines 2 through 5 contain two section and two annotation errors with codes, locations, offending text, focused patterns, and suggestions. Confirm all malformed source remains literal speech.
7. Select **Ignore this pattern** for either malformed annotation. Confirm both annotation errors disappear, both speech nodes remain, and only `{{resume|cv` appears under **Ignored diagnostic patterns**.
8. Ignore either malformed section and confirm both matching section errors disappear without changing their speech nodes.
9. Restore both patterns and confirm all four errors return. These choices are intentionally limited to the current Script Lab session until G04 adds persistence.
10. Enter `Speak \[pause_short] literally.`, set the default speaker to `narrator`, and parse. Confirm `[pause_short]` remains readable speech and no pause node is created.
11. Enter `[speaker_Teacher] First.`, a newline, and `[speaker_teacher] Second.`; parse and confirm the case-collision warning appears.

## Responsiveness and isolation

1. Paste or generate a large script near 100,000 characters and select **Parse**.
2. Confirm the parsing status identifies the browser worker and the page remains interactive while work completes.
3. While a large parse is running, edit the source. Confirm the completed stale result is discarded and the UI asks you to parse again.
4. Open browser developer tools and confirm parsing creates no project API, persistence, IPC, or Speaches network request.
5. Open Runtime diagnostics and run the G01 self-test once to confirm the prior screen and behavior remain intact.

## Approval

Record automated output, browser and operating-system versions, screenshots of the valid and invalid results, any defects, and the explicit decision in `docs/gates/approvals/G02.md`. Leave G02 unchecked until the reviewer approves this gate.
