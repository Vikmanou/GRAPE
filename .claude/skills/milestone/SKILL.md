---
name: milestone
description: Run one GRAPE milestone from the owner's spec doc - read, plan and stop for approval, then build with gated commits and finish with a demo note. Use when the owner says to start, plan, continue or finish a milestone, or invokes /milestone.
argument-hint: <milestone number>
---

# Run a GRAPE milestone

Arguments: `$ARGUMENTS` (the milestone number). The spec is the Claude Doc
"GRAPE: Build Spec" (https://claude.ai/artifact/UnoFj61L4Ttvx8G8KhBDiX); read
it with the docs tools, never from memory. If it cannot be read, stop and say
so.

Follow the working agreement in `CLAUDE.md`. This is the procedure.

## Phase 1: Read (no code)

1. Read the doc's outline, then this milestone, its acceptance criteria, and
   every section it depends on (architecture, code organisation, data model,
   layout, rendering, features, testing, performance targets, risks).
2. Read `docs/decisions/` (newest entry in the last file), `git log --oneline -20`, and the code the
   milestone will touch.
3. Run `npm run check:quick` so the plan starts from a known-green tree. If it is
   red, report that first.

## Phase 2: Plan, then stop

Write the plan in the reply (not a file), in this order:

- **Goal**: the milestone and its acceptance criteria, quoted.
- **Files**: each file to create or change, one line on what it holds.
- **Approach**: key data structures and algorithms, with the spec section
  each comes from.
- **Tests**: which tests prove each acceptance criterion.
- **Dependencies**: anything new, with why and the exact version.
- **Commit sequence**: the planned commits in order, each one sentence with
  no punctuation.
- **Open decisions**: things the spec leaves open or ambiguous. Every question
  goes to the owner with AskUserQuestion, never as text in the reply, with a
  recommended option first. Anything that touches file formats, the share-link
  format or the public API is always asked, never guessed.
- **Risks**: what could miss a target, and which single measurement would show
  it.

Then stop and wait for approval. Do not write code in this phase.

## Phase 3: Build

- Work on `main` in the order of the approved commit sequence. If the order
  needs to change, say so in one line and continue.
- Before each commit: `npm run check:quick` green. Stage only the files that
  belong to that commit.
- Commit with `git commit -m "<one sentence no punctuation>"`. No
  co-author trailer. Never push.
- Record non-obvious decisions in `docs/decisions/` (newest entry in the last file) as they are made, in
  the commit they belong to.
- **Stop and replan** on any surprise (see `CLAUDE.md`). Report evidence and a
  revised plan, then wait.

## Phase 4: Verify

1. `npm run check` (the full gate) must pass.
2. For anything rendered: run `npm run check:headed`, and take a
   headed screenshot with a throwaway Playwright spec in the scratchpad
   (copied into `web/tests/e2e/` only while it runs, then deleted). Look at it.
3. Measure only the numbers this milestone's acceptance criteria name, once,
   on an idle machine, and record them. Anything that takes minutes (`bench:*`,
   the 200k or 1M graphs) is announced to the owner first with the number of
   runs and the time. A number not measured is reported as "not measured"; a
   missed target is reported, never hidden.
4. Check each acceptance criterion one by one.

## Phase 5: Demo note, then stop

End with:

- **Acceptance**: a table of each criterion and its status, with evidence.
- **What works** and **how to try it** (exact commands).
- **Measured numbers** against the spec's targets, and which were not
  measured.
- **Known gaps** and anything deferred, with the reason.
- **Decisions made** (also in `docs/decisions/` (newest entry in the last file)).
- **Commits**: `git log --oneline` for the milestone.

Once the owner accepts, update the doc: the Status table row, and any section
whose "(Mn)" plan became "(built)" or changed. Then stop. The next milestone
waits for the owner's acceptance.
