# GRAPE: working agreement

GRAPE (GPU-Rendered Assembly Path Explorer) is a browser viewer for genome
assembly graphs (GFA): Rust core compiled to WASM in workers, TypeScript
WebGPU engine, thin React shell. Solo project: the owner and Claude.

## The spec

The spec is the Claude Doc "GRAPE: Build Spec"
(https://claude.ai/artifact/UnoFj61L4Ttvx8G8KhBDiX), read with the docs
tools. It is the source of truth: status, architecture, code organisation,
features, targets and the twelve milestones. Read the sections that matter for
the milestone every time; don't work from memory of an older copy. If the spec
and the code disagree, say so. When a milestone ends, update the doc's Status
table and any section the milestone changed.

## Milestone loop

Run it with `/milestone <n>`, or follow it by hand:

1. **Read** the milestone, its acceptance criteria and every spec section it
   touches. Read the current code and `docs/decisions.md`.
2. **Plan**, then stop: files to create or change, approach, key data
   structures, tests to add, new dependencies and why, risks, and decisions
   the spec leaves open. Ask the questions that affect file formats, the
   share-link format or the public API. Wait for approval before code.
3. **Build** in small commits in a logical order. Each commit builds and
   passes `npm run check:quick`.
4. **Verify**: `npm run check` green; anything GPU-related checked with
   `npm run check:headed` or a screenshot from a headed browser;
   performance targets measured, not assumed.
5. **Stop** with a demo note: what works, how to try it, measured numbers
   against the spec's targets, known gaps, and anything decided along the way.
   Don't start the next milestone until the owner accepts this one.

**Stop and replan** the moment something goes wrong: a test fails for a
non-obvious reason, a target is missed, a browser API behaves differently than
expected, or the plan turns out wrong. Explain with evidence, propose a revised
plan, wait. Never work around it silently and never lower a target without
saying so.

## Building comes first, measuring second

Most of the time and machine goes to writing the code, not to running it.
Benchmarks and long browser runs are reference points, not a habit.

- While building, run only what the change needs: `npm run check:quick`
  before each commit, plus the one or two Playwright specs or GPU checks that
  cover the code just touched. Not the whole suite, not after every edit.
- Run a benchmark (`bench:*`, the 200k or 1M graphs, anything that takes
  minutes) only when the milestone's acceptance criteria call for that
  number, when the owner asks, or once to check a risk the plan named. Run it
  once, at the end of the work it measures, on an otherwise idle machine; don't
  rerun it to watch a number move.
- Screenshots and throwaway debug specs are fine for looking at a problem; keep
  them small (test graphs, not the 1M graph).
- If the work truly needs many benchmark runs or long test runs (profiling a
  missed target, comparing several approaches), say so to the owner first, with
  roughly how many runs and how long, so they can free the machine or lend a
  faster one. Don't start them unannounced.

## Commits

- One plain sentence, no punctuation:
  `Add streaming parser for segment and link records`.
- The owner is the only author: no `Co-Authored-By` or any Claude attribution.
- Commit progressively as work lands, not in one lump at the end.
- **Never push.** The owner pushes.

## Code rules

- **Rust**: rustfmt and `clippy -D warnings` clean. No panics on user input;
  return errors or collect parse warnings. No `unsafe` without an entry in
  `docs/decisions.md`. `gfa-core` stays pure (bytes in, data out, tested
  natively); `gfa-wasm` only converts and maps errors.
- **TypeScript**: strict, ESLint `strictTypeChecked`, no `any`. The engine owns
  every GPU object behind the `Backend` interface; React reaches the engine and
  the workers only through the store (`state/`), which alone calls
  `engine.send` and the worker clients. The main thread never blocks for more
  than a frame: heavy work goes to a worker or the GPU. Worker messages are
  discriminated unions in `workers/protocol/`; big data crosses as
  transferable typed arrays.
- **Files** under about 400 lines; split into modules before they grow. Place
  code by the spec's Code organisation section.
- **Comments**: rare. Code should read clearly without them; write one
  only when something is not obvious from the code itself (a non-obvious
  reason, a format rule, a source citation). No doc comments that restate a
  name.
- **Dependencies**: none without a reason stated in the plan; prefer the
  platform (`DecompressionStream`, raw WebGPU, `node:` built-ins). Pin exact
  versions.
- **Facts**: check GFA rules, Bandage behavior and WebGPU limits against the
  real source (GFA spec, Bandage source, WebGPU spec) and cite it in a
  comment. Don't trust memory.
- Record every non-obvious decision in `docs/decisions.md`: date, decision,
  reason, alternatives.

## Privacy (hard rules)

File contents and sequences never leave the browser: no uploads, telemetry,
analytics or third-party scripts at runtime. The only network request
involving user data is a user-initiated "Open from URL". Share links carry
view state and a fingerprint, never sequences.

## Environment notes

- Development is on Windows (PowerShell) and Fedora Linux; CI runs Linux and
  Windows.
- `npm run check` is the gate and is exactly what CI runs.
- Headless Chromium has no WebGPU adapter: headless Playwright covers the
  fallback path only. Use `npm run check:headed` for the WebGPU path.
- `wasm-bindgen-cli` must match `Cargo.lock` exactly; the WASM build installs
  the right version itself when it is missing or different.
- The pinned toolchain lives in `rust-toolchain.toml`. If rustup reports a
  component "not applicable", the toolchain install was interrupted:
  `rustup toolchain uninstall <ver>` then install again.
