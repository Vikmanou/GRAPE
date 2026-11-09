---
name: ux-review
description: Audit GRAPE's interface or the look of its graphs from real screenshots and return a ranked list of fixes for the owner to approve. Use before any work on the shell (panels, bars, overlays, onboarding) or on how labels, ribbons and links look, and when the owner says the UI feels crowded, confusing or off.
argument-hint: <shell | graph | a panel or feature name>
---

# Review GRAPE's UX

Scope: `$ARGUMENTS` (`shell` for the panels and bars, `graph` for labels,
ribbons and links, or one panel or feature). This skill finds and ranks
problems. It writes no product code; fixes are built afterwards through the
milestone loop, once the owner has approved the list.

## 1. Look at the real thing

Judge from screenshots, never from the source alone.

- Take them with a throwaway Playwright spec written in the scratchpad, copied
  into `web/tests/e2e/` only while it runs, then deleted. Run it headed so the
  WebGPU path is the one drawn, and once with `?renderer=webgl2`.
- Use the bundled examples and the handcrafted test graphs. Never the 200k or
  1M graphs.
- Cover both themes and three window sizes: 1440x900, 1024x768 and 390x844.
- `shell`: the empty state, a loaded graph with each sidebar tab open, the info
  panel for one and for several segments, every overlay, a toast, a running
  task with progress, an error, and the status bar with a filter on.
- `graph`: each example fitted to the window, zoomed to one component and
  zoomed to a few segments; labels on with each label field; double mode; a
  selection, a hover, highlighted paths and search hits. Open the same files in
  Bandage's published screenshots or its source defaults when a comparison
  helps, and cite what was compared.

Read every screenshot before writing anything.

## 2. Judge

For each screen, answer in a line each:

- **First glance**: what does the eye land on, and is that the most useful
  thing on the screen?
- **Crowding**: which controls are on screen that this task does not need? What
  could be collapsed, moved behind a disclosure or removed?
- **Grouping and order**: do controls that act together sit together, in the
  order a user reaches for them? Is each control in the tab a new user would
  look in?
- **Discoverability**: can a microbiologist who knows Bandage but not GRAPE
  find how to open a file, colour by depth, find a segment, search a sequence
  and export, without the help overlay?
- **Wording**: labels in the user's words (Bandage's terms where it has one),
  no internal names, units shown.
- **Feedback**: does every action show that it happened, every long task show
  progress and a cancel, every error say what to do next?
- **Legibility**: text size and contrast (WCAG AA) in both themes; labels
  readable over ribbons; links followable when zoomed out; selection, hover,
  path and hit styles distinguishable from each other and for colour-blind
  users.
- **Consistency**: one spacing scale, one set of control styles, the same
  pattern for the same kind of action.
- **Keyboard and narrow windows**: reachable by keyboard with a visible focus;
  nothing cut off or overlapping at the small sizes.

## 3. Report, then ask

Write the findings in the reply as one table, worst first:

| # | Where | Problem (with the screenshot that shows it) | Proposed fix | Effort |

Rank by how much a finding hurts a first-time user on a common task, then by
effort. Keep each proposed fix concrete enough to build: what moves where, what
is removed, the new value. For `shell`, follow the table with one proposed
structure (what lives in the top bar, each sidebar tab, the info panel and the
status bar) and, where the visual direction is open, load the `frontend-design`
skill and offer two or three directions.

Then ask the owner, through AskUserQuestion, which findings to fix and which
direction to take. Stop there. Record the approved direction in
`docs/decisions.md` when the first fix is committed.
