# GRAPE

**GPU-Rendered Assembly Path Explorer**: a browser-based viewer for genome
assembly graphs in GFA format. Drop a file on the page and see the graph laid
out and rendered on the GPU. Nothing is installed and nothing is uploaded; all
parsing, layout and analysis run on your machine.

> Status: milestone 1. Opens a graph and shows its stats; no drawing yet.

## Formats

GFA 1.0 and 1.1 (S, L, P, W, C and H records) and SPAdes-style FASTG, plain,
gzipped or bgzipped. GFA 2.0 is not supported.

## Supported browsers

WebGPU is required until the WebGL2 fallback lands (milestone 8). Desktop
Chrome and Edge are the primary targets.

## Development

Prerequisites: Rust and Node 22+ (npm comes with it). The pinned Rust
toolchain, the matching `wasm-bindgen-cli` and the test browser install
themselves the first time they are needed.

From the repo root:

```sh
npm install
npm run dev                       # build the WASM core, start Vite
npm run check                     # full gate: what CI runs
npm run check:quick               # Rust + TS checks and unit tests only
npm run check:headed              # full gate, browser tests on the real GPU
npm run fuzz                      # fuzz the parser (10 min; installs nightly and cargo-fuzz)
npm run bench:parse               # parse timing on a synthetic 200k-segment graph
```

Headless Chromium has no WebGPU adapter, so a plain `npm run check` exercises
the fallback path only; `check:headed` covers WebGPU.

## Layout

```
crates/gfa-core/    parser, graph store, algorithms (pure Rust, tested natively)
crates/gfa-wasm/    wasm-bindgen bindings around gfa-core
crates/gfa-gen/     synthetic graph generator for tests and benchmarks
fuzz/               cargo-fuzz target for the parser
testdata/           small handcrafted graphs
web/src/engine/     WebGPU device and canvas (owns all GPU objects)
web/src/workers/    parse worker and its message protocol
web/src/ui/         React panels
web/src/state/      view state
web/tests/          Vitest (unit/) and Playwright (e2e/)
scripts/            quality gate, WASM build, bundle size, fuzz and bench runners
docs/decisions.md   design decision log
```

## License

MIT
