# GRAPE

**GPU-Rendered Assembly Path Explorer**: a browser-based viewer for genome
assembly graphs in GFA format. Drop a file on the page and see the graph laid
out and rendered on the GPU. Nothing is installed and nothing is uploaded; all
parsing, layout and analysis run on your machine.

> Status: milestone 0 (scaffolding). Not usable yet.

## Supported browsers

WebGPU is required until the WebGL2 fallback lands (milestone 8). Desktop
Chrome and Edge are the primary targets.

## Development

Prerequisites: Rust and Node 22+ (npm comes with it). The pinned Rust
toolchain and the matching `wasm-bindgen-cli` install themselves on the
first build.

From the repo root:

```sh
npm install
npx playwright install chromium   # once, for the browser tests
npm run dev                       # build the WASM core, start Vite
npm run check                     # full gate: what CI runs
npm run check:quick               # Rust + TS checks and unit tests only
node scripts/check.mjs --headed   # full gate, Playwright on the real GPU
```

Headless Chromium has no WebGPU adapter, so a plain `npm run check` exercises
the fallback path only; `--headed` covers WebGPU.

## Layout

```
crates/gfa-core/    parser, graph store, algorithms (pure Rust, tested natively)
crates/gfa-wasm/    wasm-bindgen bindings around gfa-core
web/src/engine/     WebGPU device and canvas (owns all GPU objects)
web/src/workers/    parse worker and its message protocol
web/src/ui/         React panels
web/src/state/      view state
web/tests/          Vitest (unit/) and Playwright (e2e/)
scripts/check.mjs   the quality gate
docs/decisions.md   design decision log
```

## License

MIT
