# GRAPE: working agreement

GRAPE (GPU-Rendered Assembly Path Explorer) = browser viewer for genome assembly graphs (GFA): Rust core → WASM in workers, TypeScript WebGPU engine, thin React shell. Solo project: owner + Claude.

## The spec

Spec = Claude Doc "GRAPE: Build Spec"
(https://claude.ai/artifact/UnoFj61L4Ttvx8G8KhBDiX), read with docs tools. Source of truth: status, architecture, code organisation, features, targets, twenty-one milestones (0 to 20). Read sections relevant to milestone every time; no working from memory of old copy. Spec and code disagree → say so. Milestone ends → update doc's Status table + any section milestone changed.

## Milestone loop

Run with `/milestone <n>`, or by hand:

1. **Read** milestone, acceptance criteria, every spec section it touches. Read current code + `docs/decisions.md`.
2. **Plan**, then stop: files to create/change, approach, key data structures, tests to add, new deps + why, risks, decisions spec leaves open. Ask every question via AskUserQuestion, never as reply text; anything affecting file formats, share-link format or public API always asked. Wait for approval before code.
3. **Build** in small commits, logical order. Each commit builds + passes `npm run check:quick`.
4. **Verify**: `npm run check` green; GPU stuff checked with `npm run check:headed` or headed-browser screenshot; perf targets measured, not assumed.
5. **Stop** with demo note: what works, how to try, measured numbers vs spec targets, known gaps, decisions made. No next milestone until owner accepts this one.

Milestone 11 runs as four stages in spec's "Release stages" table, full loop + stop each. Shell or graph-look work starts with `/ux-review`; owner approves ranked list before code.

**Stop and replan** the moment something goes wrong: test fails for non-obvious reason, target missed, browser API behaves unexpectedly, or plan wrong. Explain with evidence, propose revised plan, wait. Never work around silently, never lower target without saying.

## Building comes first, measuring second

Most time + machine goes to writing code, not running it. Benchmarks and long browser runs = reference points, not habit.

- While building, run only what change needs: `npm run check:quick` before each commit, plus one or two Playwright specs or GPU checks covering touched code. Not whole suite, not after every edit.
- Run benchmark (`bench:*`, 200k or 1M graphs, anything taking minutes) only when acceptance criteria need that number, owner asks, or once to check plan-named risk. Run once, at end of work it measures, on idle machine; no reruns to watch number move.
- Screenshots + throwaway debug specs fine for looking at problem; keep small (test graphs, not 1M graph).
- If work truly needs many benchmark/long test runs (profiling missed target, comparing approaches), tell owner first with rough run count + duration so they can free machine or lend faster one. No unannounced starts.

## Commits

- One plain sentence, no punctuation:
  `Add streaming parser for segment and link records`.
- Owner sole author: no `Co-Authored-By` or any Claude attribution.
- Commit progressively as work lands, not one lump at end.
- **Never push.** Owner pushes.

## Code rules

- **Rust**: rustfmt + `clippy -D warnings` clean. No panics on user input; return errors or collect parse warnings. No `unsafe` without entry in `docs/decisions.md`. `gfa-core` stays pure (bytes in, data out, tested natively); `gfa-wasm` only converts + maps errors.
- **TypeScript**: strict, ESLint `strictTypeChecked`, no `any`. Engine owns every GPU object behind `Backend` interface; React reaches engine + workers only via store (`state/`), which alone calls `engine.send` and worker clients. Main thread never blocks > one frame: heavy work → worker or GPU. Worker messages = discriminated unions in `workers/protocol/`; big data crosses as transferable typed arrays.
- **Files** under ~400 lines; split into modules before growth. Place code per spec's Code organisation section.
- **Comments**: rare. Code should read clear without them; write one only when not obvious from code (non-obvious reason, format rule, source citation). No doc comments restating a name.
- **Dependencies**: none without reason stated in plan; prefer platform (`DecompressionStream`, raw WebGPU, `node:` built-ins). Pin exact versions.
- **Facts**: check GFA rules, Bandage behavior, WebGPU limits against real source (GFA spec, Bandage source, WebGPU spec), cite in comment. Don't trust memory.
- Record every non-obvious decision in `docs/decisions.md`: date, decision, reason, alternatives.

## Privacy (hard rules)

File contents + sequences never leave browser: no uploads, telemetry, analytics or third-party scripts at runtime. Only network request with user data = user-initiated "Open from URL". Share link made only on user request; holds whole graph file, packed in browser, and share menu says so. Search queries never in link.

## Environment notes

- `npm run check` = the gate, exactly what CI runs.
- Headless Chromium has no WebGPU adapter: headless Playwright covers fallback path only. Use `npm run check:headed` for WebGPU path.
- `wasm-bindgen-cli` must match `Cargo.lock` exactly; WASM build installs right version itself when missing or different.
- Pinned toolchain in `rust-toolchain.toml`. Rustup reports component "not applicable" → toolchain install interrupted: `rustup toolchain uninstall <ver>` then reinstall.
