<p align="center">
  <img src="assets/grape-banner.png" alt="GRAPE: GPU-Rendered Assembly Path Explorer" width="600">
</p>

[![CI](https://github.com/Vikmanou/GRAPE/actions/workflows/ci.yml/badge.svg)](https://github.com/Vikmanou/GRAPE/actions/workflows/ci.yml)

**GRAPE** (GPU-Rendered Assembly Path Explorer) is a browser viewer for genome
assembly graphs. Drop a GFA file on the page and see it laid out and drawn on the GPU.
Nothing has to be installed and nothing is uploaded: parsing, layout and rendering
all run on your machine.

![GRAPE showing an Acacia mitochondrion assembly graph with three of its paths highlighted](assets/acacia-mitochondrion.png)

<sub>Acacia mitochondrion assembled by SPAdes, with three of its contig paths
highlighted, from [Zenodo 5722622](https://doi.org/10.5281/zenodo.5722622)
(CC-BY-4.0). It is one of the bundled examples under Open, then Examples.</sub>

![A walk through GRAPE: open an example, watch the layout settle, colour by depth, show names, select a segment, find segments and zoom in](assets/grape-demo.gif)

## Features

- GFA 1.0 and 1.1 and SPAdes-style FASTG, plain, gzipped or bgzipped, up to
  1 million segments and 1.5 million links. Larger graphs still load, with a
  warning.
- Graph stats, a sortable table of components (length, mean depth, whether
  it closes into a circle) and parse warnings with line numbers.
- Four bundled example graphs under Open, then Examples.
- Segments drawn as ribbons and links as curves, in Bandage's style.
- Multilevel force-directed layout on the GPU that you watch settle, with
  pause, resume, a seed you can set (the same seed gives the same layout) and
  Fast, Balanced and Best presets. A 200k-segment graph settles in 2 s on a
  desktop GPU; see [Benchmarks](#benchmarks).
- Colour by depth (linear or log, adjustable range), GC, length, component,
  path, Bandage's CL/C2 tags or at random, with legends; width by depth;
  labels that never overlap; Bandage's double mode with both strands; light
  and dark themes.
- Paths (P) and walks (W): search them, highlight several in their own
  colours and step through one segment by segment.
- Filters that hide without a new layout: within N steps of the selection,
  only the selected components, components under a size, a depth range.
- Merge simple chains as Bandage's "Merge all possible nodes" does, and save
  the merged graph as GFA in Bandage's format.
- Graphs saved without sequences (ABySS style) take them from a FASTA file.
- Find DNA in the graph: paste bases or give a FASTA file, and hits show as
  bands on the ribbons and in a table, joined across linked segments.
- Drag to pan, scroll or pinch to zoom, arrow keys and +/-, F to fit.
- Click a segment to see its length, depth, GC, component, neighbours, its
  line in the file and the ends of its sequence; shift-click to add or
  remove, shift-drag to select by box, select whole components, invert and
  zoom to the selection.
- Copy sequences or save them as FASTA exactly as Bandage writes them.
- Export the view as a PNG up to 4× the screen (tiled past the GPU's
  texture limit) or as SVG; save GFA or FASTA of the whole graph, the
  selection or what the filters show.
- Share a link that carries the whole graph and the view (layout seed,
  settings, camera, selection, highlighted paths), packed in the browser by
  a DNA-aware coder (about 1.7 to 1.9 bits per base), so it opens with
  nothing else to download. Graphs up to roughly 7 million bases of distinct sequence
  fit Chrome's 2 MB link limit; past 1 MB, Firefox opens the link when it is
  pasted into Open URL.
- Export and load layouts as BandageNG does (`.layout`, and `.tsv` with one
  point per segment), so a drawing moves between GRAPE and BandageNG and
  comes back exactly in GRAPE on either renderer.
- Open a graph from a URL; your browser downloads it directly.
- Find segments by a list of names or a regular expression.
- Drag a segment to pin it while the rest of the graph follows; unpin, or lay
  out just the selection again.
- Works offline after one visit: the browser keeps a copy of the app.
- Keyboard shortcuts for all of the above; press `?` for the list.

GRAPE draws with WebGPU where the browser has it (current desktop Chrome and
Edge, Safari 26, Firefox on Windows) and with WebGL2 everywhere else, with the
same features: Chrome 56, Edge 79, Firefox 51, Safari 15 or later. Try it at
[vikmanou.github.io/GRAPE](https://vikmanou.github.io/GRAPE/).

## Benchmarks

GRAPE against [Bandage](https://github.com/rrwick/Bandage) 0.9.0 and
[BandageNG](https://github.com/asl/BandageNG) 2026.11.1 on the same graphs.

<!-- compare:start -->

|                                |      GRAPE |    Bandage |  BandageNG |
| ------------------------------ | ---------: | ---------: | ---------: |
| Open a 50,000-segment graph    |  **1.5 s** |     32.9 s |      4.9 s |
| Open a 200,000-segment graph   |  **1.9 s** | 2 min 12 s |     27.0 s |
| Open a 1,000,000-segment graph |  **7.2 s** | 15 min 1 s | 2 min 59 s |
| Memory with 200,000 segments   | **766 MB** |     2.4 GB |     2.8 GB |
| Memory with 1,000,000 segments | **2.0 GB** |    12.4 GB |    12.4 GB |

On a million segments GRAPE shows the finished layout 25 times sooner than BandageNG and
125 times sooner than Bandage, in a sixth of the memory. Open means from
choosing the file to the finished layout on screen; memory is the peak while doing so. Medians of
five runs of each tool on synthetic graphs, on an AMD Ryzen 9 9950X 16-Core Processor with NVIDIA GeForce RTX 5060, 2026-11-17.

Small graphs are the exception. On sample graphs of up to 336 segments Bandage
opens in 30 ms to 220 ms and GRAPE in 598 ms to 1.0 s, and at 10,000 segments BandageNG
is still ahead (867 ms against GRAPE's 1.5 s).

Every measure, the pictures each tool draws and the exports compared byte for byte are in
[docs/benchmarks/compare.md](docs/benchmarks/compare.md); GRAPE on its own against its targets is in
[docs/benchmarks/results.md](docs/benchmarks/results.md) and [docs/benchmarks/interaction.md](docs/benchmarks/interaction.md).

<!-- compare:end -->

## Development

Requires Rust and Node 22+.

```sh
npm install
npm run dev            # build the WASM core and start Vite
npm run build          # the production build, with the offline worker, in web/dist
npm run check          # the full gate CI runs
npm run check:quick    # Rust and TypeScript checks with unit tests
npm run check:headed   # full gate with browser tests on the real GPU
npm run format         # rustfmt and Prettier
npm run samples        # download real sample graphs (see data/samples/README.md)
npm run fuzz           # fuzz the parser and the link packer
npm run bench:parse    # time parsing a synthetic 200k-segment graph
npm run bench:layout   # GPU layout timings and quality against the CPU reference
npm run bench:interaction  # frame rates and pointer latency on the 200k and 1M graphs
node scripts/bench-bandage.mjs   # pictures and GFA exports against Bandage and BandageNG
node scripts/bench-compare.mjs   # open time, memory and export against both, resumable
node scripts/compare-table.mjs   # the comparison table from docs/benchmarks/compare.json
```

Native tools for the Rust core, run with
`cargo run -p gfa-core --release --example <name> -- <file>`: `parse_file`
times parsing, `layout_file` times the CPU reference layout (`--svg out.svg`
draws it) and `compare_layout` measures a GPU layout against it.

Design decisions are recorded in [docs/decisions/](docs/decisions/). The
browsers and assistive tools the site was checked in are listed in
[docs/browser-checks.md](docs/browser-checks.md). Pushing to `main` publishes the
site to GitHub Pages once the CI gate passes (`.github/workflows/ci.yml`).

## About AI

I use AI coding tools a lot on this project, and I'd rather say so than hide
it. Nothing lands without me reading the code myself and every change passes
the full test gate and is checked by hand on real assembly graphs in the
browser before it's merged. If something is broken anyway, please open an
issue.

## License

[MIT](LICENSE)
