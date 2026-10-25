# GRAPE

**GPU-Rendered Assembly Path Explorer**: a browser-based viewer for genome
assembly graphs in GFA format. Drop a file on the page and see the graph laid
out and rendered on the GPU. Nothing is installed and nothing is uploaded; all
parsing, layout and analysis run on your machine.

> Status: milestone 2. Opens a graph, shows its stats and draws it with a
> CPU reference layout; the GPU layout arrives in milestone 3.

## Formats

GFA 1.0 and 1.1 (S, L, P, W, C and H records) and SPAdes-style FASTG, plain,
gzipped or bgzipped. GFA 2.0 is not supported.

Parsing runs at a few hundred MB/s on graphs with long sequences, but graphs
made of many short segments are slower: about 55 MB/s on the densest sample
(*M. xanthus*, 595k segments, about 2 s).

## Drawing

Segments are drawn as ribbons and links as curves, in Bandage's style. The
layout runs in a worker: a multilevel force-directed layout with Barnes-Hut
repulsion, components packed apart, and the picture updates while it
settles. Drag to pan, scroll or pinch to zoom, arrow keys and +/- also work,
and F fits the graph.

## Supported browsers

WebGPU is required until the WebGL2 fallback lands (milestone 8). Desktop
Chrome and Edge are the primary targets.

## Development

Prerequisites: Rust and Node 22+

From the repo root:

```sh
npm install
npm run dev                       # build the WASM core, start Vite
npm run check                     # full gate: what CI runs
npm run check:quick               # Rust + TS checks and unit tests only
npm run check:headed              # full gate, browser tests on the real GPU
npm run fuzz                      # fuzz the parser (10 min; installs nightly and cargo-fuzz)
npm run bench:parse               # parse timing on a synthetic 200k-segment graph
npm run samples                   # download real sample graphs into samples/
```

Time the layout natively and draw it as SVG:

```sh
cargo run -p gfa-core --release --example layout_file -- samples/bacterial-spades.gfa --svg out.svg
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
samples/            real public graphs, downloaded on demand (see samples/README.md)
web/src/engine/     WebGPU device, renderer, shaders, camera and input (owns all GPU objects)
web/src/workers/    parse and layout workers and their message protocol
web/src/ui/         React panels
web/src/state/      view state
web/tests/          Vitest (unit/) and Playwright (e2e/)
scripts/            quality gate, WASM build, bundle size, fuzz, bench and sample fetching
docs/decisions.md   design decision log
```

## License

MIT
