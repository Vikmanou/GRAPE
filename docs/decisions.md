# Decisions

Running log of non-obvious design decisions. Newest last. Each entry: date,
decision, reason, alternatives considered.

## 2026-10-23: Project name GRAPE

- **Decision**: name the project GRAPE (GPU-Rendered Assembly Path Explorer).
  Crate names stay `gfa-core`, `gfa-wasm`, `gfa-gen` as in the spec.
- **Reason**: chosen by the owner; a bunch of grapes looks like a graph.
- **Alternatives**: Gauze (spec working name), Splint, Tangle, Unitig, Ravel.

## 2026-10-23: MIT license

- **Decision**: MIT only.
- **Reason**: owner's choice; short and permissive.
- **Alternatives**: Apache-2.0, MIT OR Apache-2.0 dual license.

## 2026-10-23: Rust, not Bend2, for the core

- **Decision**: keep the spec's Rust to WASM core.
- **Reason**: Bend2's JavaScript backend is sequential and much slower than
  WASM, it has no supported browser or WebGPU target, no `U64`, and strings are
  linked lists, which rules out the parser throughput target.
- **Alternatives**: Bend2 for pure graph algorithms via its ES module output.

## 2026-10-23: cargo + wasm-bindgen-cli instead of wasm-pack

- **Decision**: build with `cargo build --target wasm32-unknown-unknown` then
  `wasm-bindgen --target web`, driven by `web/scripts/build-wasm.mjs`.
- **Reason**: fewer moving parts and wasm-pack is barely maintained. The
  `wasm-bindgen` crate is pinned with `=` so it always matches the CLI.
- **Alternatives**: wasm-pack; a Vite WASM plugin (not needed, the `.wasm` is
  loaded through a `?url` import).

## 2026-10-23: No SharedArrayBuffer, no WASM threads

- **Decision**: parallelism comes from separate workers and the GPU.
- **Reason**: GitHub Pages cannot set COOP/COEP headers (spec requirement).
- **Alternatives**: `coi-serviceworker` to fake cross-origin isolation;
  rejected for v1 because it reloads the page and is fragile.

## 2026-10-23: The engine owns the canvas

- **Decision**: React renders an empty host element; the engine creates the
  canvas inside it and owns all GPU objects. UI and engine talk only through a
  typed command and event interface.
- **Reason**: keeps React re-renders away from the frame loop (spec rule).

## 2026-10-23: TypeScript 6.0, not 7.0

- **Decision**: pin TypeScript 6.0.x.
- **Reason**: `typescript-eslint` 8.72 supports TypeScript `<6.1.0` only.
- **Alternatives**: TypeScript 7 without type-aware lint rules. Revisit when
  `typescript-eslint` supports 7.

## 2026-10-23: Engine requests its own adapter

- **Decision**: `detectBackend` probes for an adapter and discards it; the
  engine requests a fresh adapter when it creates its device.
- **Reason**: a WebGPU adapter can create only one device, and React
  StrictMode mounts effects twice in development.

## 2026-10-23: Smoke test accepts any renderer

- **Decision**: the Playwright smoke test passes on WebGPU, the WebGL2 notice
  or the unsupported message, as long as the WASM core loads and there are no
  page errors. WebGPU is verified locally with `pnpm e2e --headed`.
- **Reason**: headless Chromium on CI and on Windows returns no WebGPU adapter.

## 2026-10-23: pnpm installed with npm

- **Decision**: install pnpm with `npm i -g pnpm`; CI uses `pnpm/action-setup`.
- **Reason**: Node 25+ no longer bundles corepack.

## 2026-10-23: Root pnpm workspace and one gate script

- **Decision**: the repo root is a pnpm workspace (`web` is its only package)
  with one lockfile, and `scripts/check.mjs` is the single quality gate, run
  locally and by CI on Linux and Windows.
- **Reason**: everything runs from the root, and CI cannot drift from local
  runs because it runs the same script.
- **Alternatives**: separate `check.sh` and `check.ps1`; listing every step
  in the CI YAML.
