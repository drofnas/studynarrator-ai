---
name: StudyNarrator AI
description: A focused technical manual workspace for writing and listening to study material.
colors:
  signal: "#6550c7"
  signal-hover: "#503caf"
  signal-active: "#443394"
  signal-pale: "#eeebfb"
  selection: "#ded7fa"
  ink: "#252735"
  text-secondary: "#626779"
  paper: "#ffffff"
  mist: "#f5f6fa"
  line: "#dadee8"
  input-line: "#b8bdcc"
  warning: "#905c16"
  warning-pale: "#fff5e4"
  fault: "#b03248"
  fault-pale: "#fff0f2"
  success: "#247452"
  success-pale: "#eaf5ee"
  focus: "#6550c7"
  nav: "#252735"
  nav-hover: "#333645"
  nav-active: "#423b62"
  nav-text: "#f1effa"
  nav-muted: "#b9baca"
  nav-line: "#454756"
  nav-highlight: "#c7baff"
typography:
  headline:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "2rem"
    fontWeight: 650
    lineHeight: 1.2
    letterSpacing: "-0.03em"
  workspace-title:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "1.5rem"
    fontWeight: 650
    lineHeight: 1.25
    letterSpacing: "-0.03em"
  title:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "1.0625rem"
    fontWeight: 650
    lineHeight: 1.25
  body:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.5
  supporting:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "0.9375rem"
    fontWeight: 400
    lineHeight: 1.6
  control:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "0.875rem"
    fontWeight: 600
    lineHeight: 1.4
  field:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.4
  label:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "0.8125rem"
    fontWeight: 600
    lineHeight: 1.5
  metadata:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "0.75rem"
    fontWeight: 400
    lineHeight: 1.5
  code:
    fontFamily: 'ui-monospace, "SFMono-Regular", Consolas, monospace'
    fontSize: "0.8125rem"
    fontWeight: 400
    lineHeight: 1.6
  editor:
    fontFamily: 'ui-monospace, "SFMono-Regular", Consolas, monospace'
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.8
rounded:
  compact: "6px"
  control: "8px"
  panel: "12px"
  round: "50%"
  flat: "0"
spacing:
  tight: "4px"
  related: "8px"
  compact: "12px"
  standard: "16px"
  panel-mobile: "18px"
  section: "20px"
  panel: "24px"
  content-panel: "28px"
  page-medium: "32px"
  page: "40px"
components:
  button-primary:
    backgroundColor: "{colors.signal}"
    textColor: "{colors.paper}"
    typography: "{typography.control}"
    rounded: "{rounded.control}"
    padding: "8px 16px"
  button-primary-hover:
    backgroundColor: "{colors.signal-hover}"
    textColor: "{colors.paper}"
  button-primary-active:
    backgroundColor: "{colors.signal-active}"
    textColor: "{colors.paper}"
  button-secondary:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    typography: "{typography.control}"
    rounded: "{rounded.control}"
    padding: "8px 16px"
  button-danger:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.fault}"
    typography: "{typography.control}"
    rounded: "{rounded.control}"
    padding: "8px 16px"
  button-danger-hover:
    backgroundColor: "{colors.fault}"
    textColor: "{colors.paper}"
  button-text:
    backgroundColor: "transparent"
    textColor: "{colors.signal}"
    typography: "{typography.control}"
    padding: "4px 0"
  input-field:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    typography: "{typography.field}"
    rounded: "{rounded.control}"
    padding: "9px 12px"
  navigation-item:
    backgroundColor: "transparent"
    textColor: "{colors.nav-muted}"
    rounded: "{rounded.control}"
    padding: "10px 12px"
  navigation-item-active:
    backgroundColor: "{colors.nav-active}"
    textColor: "{colors.paper}"
  content-panel:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.panel}"
    padding: "28px"
  count-chip:
    backgroundColor: "{colors.mist}"
    textColor: "{colors.text-secondary}"
    typography: "{typography.metadata}"
    rounded: "{rounded.compact}"
    padding: "2px 8px"
  task-tab:
    backgroundColor: "transparent"
    textColor: "{colors.text-secondary}"
    typography: "{typography.control}"
    rounded: "{rounded.flat}"
    padding: "12px 18px"
  task-tab-selected:
    backgroundColor: "transparent"
    textColor: "{colors.signal}"
  script-editor:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    typography: "{typography.editor}"
    rounded: "{rounded.control}"
---

# Design System: StudyNarrator AI

## Overview

**Creative North Star: "The Technical Manual Workspace"**

StudyNarrator AI is a calm workspace for an individual turning study material into
audio. The visual system makes long passages, project lists, voice assignments,
and task controls easy to scan. Graphite navigation stays peripheral while light
working surfaces hold the author's material.

Compact headings, familiar controls, and fine dividers provide the structure.
Iris identifies actions and selection; semantic state colors explain progress,
warnings, and errors. The same visual vocabulary continues through authoring,
listening, settings, diagnostics, setup, and recovery.

**Key Characteristics:**

- Light document surfaces beside graphite navigation.
- Compact functional typography with a distinct monospace editor.
- Iris actions, quiet borders, and explicit state labels.
- Flat panels, gently rounded controls, and restrained motion.
- Responsive reflow that keeps task controls and content accessible.

This is a scan of the implemented shared React interface, not a proposed
rebrand. The normative primitives come from
`apps/web/src/app/styles/global.css`; component and responsive rules come from
the adjacent CSS modules. The sidecar extends these tokens with component
previews, motion, breakpoints, and synthesized tonal ramps for inspection. Those
ramps are preview aids, not additional production colors.

## Colors

The palette combines cool paper and graphite with a restrained iris accent.

### Primary

- **Iris** (`signal`) identifies primary buttons, links, selected task tabs, and
  focused controls. Its hover and active tokens deepen the same action color.
- **Iris wash** (`signal-pale`) supports hover and selected context on light
  surfaces. `selection` marks selected text.
- **Focus iris** (`focus`) is the keyboard outline on light surfaces;
  **navigation lavender** (`nav-highlight`) supplies contrast on graphite.

### Neutral

- **Graphite ink** (`ink`) carries main text; **slate text**
  (`text-secondary`) carries descriptions, timestamps, and supporting labels.
- **Paper** (`paper`) is the reading and input surface; **cool mist** (`mist`)
  is the page canvas, table-header background, and quieter nested surface.
- **Quiet divider** (`line`) separates panels and rows. **Field edge**
  (`input-line`) gives controls a stronger boundary.
- **Navigation graphite** (`nav`), `nav-hover`, and `nav-active` provide
  the persistent rail and its interaction states. `nav-text`, `nav-muted`,
  and `nav-line` supply the corresponding light text and dividers.

### Semantic state

- **Amber** (`warning`, `warning-pale`) marks warnings and attention states.
- **Rose** (`fault`, `fault-pale`) marks errors and destructive actions.
- **Pine** (`success`, `success-pale`) marks successful validation and recovery.

**The Meaningful Color Rule.** Use iris for action and selection, and semantic
colors for named states. Keep ordinary reading surfaces neutral.

## Typography

**UI Font:** The platform sans stack recorded in the tokens.
**Code Font:** The platform monospace stack recorded in the tokens.

The typography is functional and compact. Main headings organize tools and
documents; script syntax and technical identifiers use monospace. The build has
no separate decorative display role.

### Hierarchy

- **Headline:** Page titles use the headline token. The shared content-panel
  title inherits the global heading line height (1.25).
- **Workspace title:** The smaller authoring title leaves room for the script.
- **Title:** Section headings identify editor, settings, and review groups.
- **Body and supporting:** General text uses body; route descriptions commonly
  use supporting. Longer explanatory copy is limited to roughly 68–75 characters
  per line where the page provides a measure.
- **Control and field:** Buttons use the semibold control role; entered text uses
  the regular field role.
- **Label and metadata:** Labels describe inputs; smaller metadata supplies
  counts and secondary context. Important values remain adjacent to their label.
- **Code and editor:** Technical identifiers use code. The editor uses its more
  open line height for multiline script reading.

Tabular numerals align table data, times, outputs, and estimate values. Labels
use ordinary case; technical syntax retains its meaningful case.

**The Reading First Rule.** Keep headings subordinate to the material being
edited, and reserve monospace for scripts and technical identifiers.

## Layout

The desktop shell is a two-column grid: a sticky navigation rail (236px) and a
fluid content area capped at 1480px. Its standard content inset is 40px, with
48px at the bottom. At 1180px the inset reduces to 32px vertically and 24px
horizontally.

At 960px and below, a sticky top bar (58px) replaces the visible rail. Navigation
moves into a drawer capped at 288px or the viewport minus 48px. Content uses
28px by 24px insets; at 520px these become 26px by 16px with 36px below.

Repeated groups use related, standard, section, and panel spacing. Main panels
typically use 24px padding, with 18px on narrow screens; the reusable content
panel uses 28px, reducing to 20px at 720px. This is a small recurring spacing
vocabulary rather than a strict grid imposed on every control.

The project workspace has a compact title and save action, a native disclosure
for metadata, and sticky task tabs. The tabs sit at the top of the desktop
content and below the mobile bar on narrow screens. All four project tabs fit
the available width at 560px and below. The script takes the main reading area;
audio estimates follow it in an initially open native disclosure.

Project-library rows reflow into labeled blocks at 560px. Recovery backup rows
reflow at 600px and retain a full-width restore action. Speaker, narration, and
timing comparisons retain horizontal scrolling with a visible narrow-screen
instruction; do not squeeze their independent columns into unreadable cells.
Forms and audio controls stack as their local breakpoints require.

## Elevation & Depth

Working panels use paper, mist, and fine borders instead of shadows. Dark
navigation and audio playback surfaces provide tonal separation. The drawer is
the one shadowed overlay in the shared styles; a translucent backdrop separates
modal interactions from the page.

### Shadow Vocabulary

- **Navigation drawer:** `12px 0 36px rgb(24 26 40 / 20%)`, used only for the
  mobile navigation overlay.

**The Flat Workspace Rule.** Use borders and tonal separation for resting
content. Reserve the recorded shadow for the navigation drawer.

State changes use brief color transitions (160ms ease); project-row hover uses
120ms ease. The drawer and backdrop use 180ms ease-out. Loading indicators may
pulse or rotate. Reduced-motion preferences disable transitions and animations.

## Shapes

Controls use the control radius; main panels use the panel radius. Compact
badges, settings subnavigation, and the audio waveform use the compact radius.
Voice favorite and audition controls are circular. Tables and the tab underline
remain rectilinear so adjacent information aligns.

Most boundaries are single-pixel strokes. Rounded outer panels may contain
square rows, dividers, and grids; do not round every nested region. Line icons
use inline SVG, generally at 18–20px, with clear text labels on navigation.

## Components

### Buttons

Primary actions use iris and white, with the recorded padding and a minimum
height of 40px. Hover deepens iris; press uses the active token. Disabled buttons
reduce opacity to 0.55 and use the disabled cursor.

Secondary actions use paper, ink, and the field edge. They inherit the shared
iris hover treatment. Destructive actions use rose text on paper and a rose
hover fill; the recovery confirmation uses a filled rose variant. Text actions
use an underline with an offset of 3px and a transparent background.

The default focus outline is 2px with a 3px offset. Compact editor tools use
34px minimum height, while the main save and mobile navigation controls retain
the standard control height.

### Chips

Project counts are small mist-backed labels with compact corners. They are
readouts, not clickable filter pills. Speaker identity and default-model badges
carry specific information within their owning table or catalog.

### Cards / Containers

Panels use paper, a quiet divider stroke, and the panel radius. Group related
controls inside one panel, separating rows with lines. A panel's heading and
action share a row when space permits and wrap or stack on narrow screens.

### Inputs / Fields

Inputs use paper, ink, the field edge, and the control radius, with a minimum
height of 40px. Labels remain visible above fields. The base inset is recorded
in the field token; denser form modules use 9px by 10px.

The keyboard focus outline uses focus iris. Project fields also change their
border to iris and use a pale outline on focus. Placeholder text uses slate.
Errors remain textual and adjacent to the affected form; disabled fields keep
the disabled cursor, with additional muted styling in connection settings.

### Navigation

The graphite rail uses labeled SVG icons and 44px minimum-height main links.
Selected links use navigation-active fill, light text, and a subdued violet
border. Settings remain visibly nested with a vertical divider.

The mobile drawer keeps the same destinations and state vocabulary. Its source
includes focus entry, a focus trap, Escape dismissal, focus restoration, and
background scroll locking. Preserve those interaction patterns when changing
its appearance.

### Sticky task tabs

Task tabs use a transparent fill and a two-pixel iris underline for selection.
Hover uses iris wash. They are 48px high at minimum; focus is drawn inside the
tab boundary. Project tabs fit evenly on narrow screens, while other tab sets
can scroll. Their sticky position accounts for the mobile navigation bar.

### Script editor and supporting disclosures

The editor is a paper surface with a fine edge, compact corners, a mist gutter,
and monospace script text. It starts at 420px minimum height and uses page
scrolling as the material grows. The gutter contracts on narrow screens. Search,
selection, line focus, and keyboard focus use the same shared palette.

Keep metadata and audio estimates in native details/summary disclosures as
implemented. The estimates sit after the editor; their values change from six
columns to three and then two. The native disclosure marker is appropriate to
this control.

### Audio and recovery

Audio playback uses a graphite panel with a lavender waveform, an explicit
transport state, and aligned time readouts. Its controls reflow from a horizontal
arrangement to two columns and then one.

Recovery shares the same paper panels and state colors. Backup metadata wraps
on narrow screens, and its restore action stays beside the relevant backup
information. Confirmation dialogs use the panel radius, a dark border, and a
dimmed backdrop.

## Do's and Don'ts

### Do:

- **Do** reuse the source tokens for actions, surfaces, borders, and state.
- **Do** keep script content visually dominant over its supporting controls.
- **Do** keep visible labels, keyboard focus, and text descriptions of state.
- **Do** preserve task order when panels, rows, and controls reflow.
- **Do** use inline SVG for interface icons and native markers for disclosures.
- **Do** preserve horizontal comparison tables with clear overflow guidance.

### Don't:

- **Don't** use semantic state colors as unrelated decorative accents.
- **Don't** add shadows to resting workspace panels.
- **Don't** replace the compact heading hierarchy with oversized display type.
- **Don't** hide primary actions beyond a narrow-screen table viewport.
- **Don't** turn every row or supporting annotation into a separate card.
- **Don't** add decorative kickers or use text glyphs as a reusable icon system.

Not canonized: the current connection action and some directional helper text
contain literal arrow glyphs. These source details are not the icon standard and
were left unchanged during this documentation pass. Unused legacy selectors are
not design rules; this record follows the rendered components and active shared
tokens.
