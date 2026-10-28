# Decisions

Running log of non-obvious design decisions. Newest last. Each entry: date,
decision, reason, alternatives considered.

## 2026-10-23: cargo + wasm-bindgen-cli instead of wasm-pack

- **Decision**: build with `cargo build --target wasm32-unknown-unknown` then
  `wasm-bindgen --target web`, driven by `scripts/build-wasm.mjs`, which also
  installs the CLI version locked in `Cargo.lock` when it is missing.
- **Reason**: fewer moving parts and wasm-pack is barely maintained. The CLI
  must match the crate exactly; installing it from the lockfile means nobody
  has to know the version.
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
  page errors. WebGPU is verified locally with `npm run check:headed`.
- **Reason**: headless Chromium returns no WebGPU adapter.

## 2026-10-23: Root npm workspace and one gate script

- **Decision**: the repo root is an npm workspace (`web` is its only package)
  with one lockfile, and `scripts/check.mjs` is the single quality gate, run
  locally and by CI.
- **Reason**: everything runs from the root, and CI cannot drift from local
  runs because it runs the same script.
- **Alternatives**: separate `check.sh` and `check.ps1`; listing every step
  in the CI YAML.

## 2026-10-24: npm instead of pnpm (departs from the spec)

- **Decision**: use npm, which ships with Node, instead of the spec's pnpm.
- **Reason**: a solo repo with one JavaScript package gets little from pnpm's
  shared store and strictness, and pnpm is an extra global tool to install
  (Node 25+ dropped corepack, the built-in way to enable it). Owner's choice.
- **Alternatives**: pnpm as the spec says; yarn.

## 2026-10-24: FASTG in v1, from milestone 1

- **Decision**: read SPAdes-style FASTG (`>EDGE_<n>_length_<l>_cov_<c>[']:...;`)
  next to GFA. Names are the edge number, depth is `cov`, and a reverse
  record defines a segment only when no forward record exists. Overlaps are
  left unknown; inferring them waits for chain merging (milestone 5).
- **Reason**: owner's choice; SPAdes writes it and Bandage reads it, and it
  maps onto the same store with little code.
- **Alternatives**: later version; v1 in milestone 5.

## 2026-10-24: GFA 2.0 is rejected with a message

- **Decision**: `VN:Z:2.x` or any `E`/`F`/`G`/`O`/`U` record stops the load
  with "GFA 2.0 is not supported".
- **Reason**: few assemblers emit GFA 2, and loading only its GFA 1 lines
  would show a silently wrong graph.
- **Alternatives**: parse an S/E/O/U subset; warn and keep GFA 1 lines.

## 2026-10-24: hashbrown for the name and link tables

- **Decision**: `hashbrown::HashTable<u32>` maps names (and canonical links)
  to ids, hashing through the arenas so no key is copied.
- **Reason**: keeps the store under the 64 bytes per segment target
  (measured 44.8 B on a 200k graph); std `HashMap` has no such API.
- **Alternatives**: std `HashMap<Box<[u8]>, u32>` (a second copy of every
  name); sorted name index built after parsing (no lookups while streaming).

## 2026-10-24: Memory target excludes name text

- **Decision**: the "< 64 bytes per segment excluding sequence" target is
  measured over the fixed per-segment structures (segment arrays, name
  offsets, name hash table, adjacency offsets). Name text is reported
  separately.
- **Reason**: names are file content of any length (SPAdes names run to 30+
  bytes), so no fixed budget can include them.

## 2026-10-24: Undefined depth is NaN, not 1

- **Decision**: segments without DP/KC/RC/FC tags have depth NaN and are
  left out of the length-weighted mean.
- **Reason**: the spec says NaN; Bandage uses 1.0, which would skew the mean.
  Tag priority (DP, then KC/RC/FC divided by length, tag names
  case-insensitive) follows Bandage's `buildDeBruijnGraphFromGfa`.

## 2026-10-24: bgzip read block by block

- **Decision**: gzip files whose header carries a BGZF `BC` field are split at
  block boundaries (no decompression needed to find them) and each block goes
  through its own `DecompressionStream`, eight at a time. Other multi-member
  gzip files fail with a message to decompress first.
- **Reason**: Chrome's `DecompressionStream('gzip')` stops after the first
  member with "Junk found after end of compressed data" (Node's does not),
  and bgzip output is multi-member by design. Owner's choice.
- **Alternatives**: inflate in Rust with flate2/miniz_oxide (a dependency and
  slower than the native path); single-member gzip only.

## 2026-10-24: Real sample graphs are downloaded, not committed

- **Decision**: `samples/manifest.json` maps file names to pinned source URLs,
  and `npm run samples` downloads them. Only the manifest and a README with
  descriptions and licenses are committed.
- **Reason**: the files carry mixed licenses (MIT, CC-BY-4.0, GPL-3.0, one
  with none stated), and the large ones run to gigabytes. Downloading from the
  source avoids redistributing them. Owner asked for a minimal manifest: URLs
  only.
- **Alternatives**: commit the permissively licensed small files; record a
  hash and expected counts per file.

## 2026-10-24: Links keep both overlap sides

- **Decision**: each link stores the overlap on its From and its To segment.
  When the mirror of a stored link repeats it with a different simple `nM`,
  that value is taken as the overlap on the mirror line's own From segment
  (counted, no warning). A repeat in the same direction with a different
  overlap is still a conflict.
- **Reason**: miniasm and hifiasm measure each strand's overlap on its own
  read, so a link and its mirror legitimately differ; the potato hifiasm
  sample produced 1,839 false conflict warnings. Costs 4 bytes per link.
- **Alternatives**: keep one side and warn (noise on two common assemblers);
  keep one side silently (loses the second length).

## 2026-10-24: Parse speed on dense graphs

- **Decision**: decimal names (no leading zeros, below 10^9) are looked up in
  a dense array instead of the hash table; the last defined segment is cached
  for the From name of the L lines that follow it; forward references are
  tracked in a per-segment array instead of a hash map; lines and fields are
  split with `memchr`; GC counting is written so LLVM vectorizes it; the WASM
  build enables `simd128`.
- **Reason**: real graphs with many short segments spent their time in cache
  misses on hash tables, not in reading bytes. The densest sample
  (_M. xanthus_, 595k segments) went from 31 to about 55 MB/s in WASM, and
  sequence-heavy synthetic graphs from about 115 to over 400 MB/s.
- **Alternatives**: sort-based link deduplication at the end of parsing
  (more transient memory); resolving names in batches. Left for later.
- **Dependency**: `memchr` 2.8.3, the standard SIMD byte search crate.

## 2026-10-24: WASM SIMD required

- **Decision**: `.cargo/config.toml` builds the WASM core with `simd128`.
- **Reason**: every browser GRAPE supports has WASM SIMD (Chrome 91, Firefox
  89, Safari 16.4), and the parser's byte scanning uses it.

## 2026-10-24: Dense-graph parse speed accepted as a known limit

- **Decision**: the spec's ≥100 MB/s parse target is met on sequence-heavy
  graphs (about 430 MB/s on the 200k synthetic graph) but not on the densest
  real sample, _M. xanthus_ (595k short segments), which parses at about
  55 MB/s in WASM. The owner accepted this for milestone 1.
- **Reason**: on that graph the time goes to name and link lookups, not
  byte scanning; the remaining ideas trade memory or complexity for an
  uncertain gain, and the absolute time (about 2 s) is acceptable.
- **Alternatives**: sort-based link deduplication at the end of parsing;
  resolving names in batches. Revisit if a real graph parses too slowly.

## 2026-10-24: The CPU reference layout is multilevel

- **Decision**: the CPU reference layout uses the spec's multilevel scheme
  (heavy-edge coarsening down to 8 nodes per component, 500 iterations on
  the coarsest level, then refinement with 50 iterations on level 0,
  doubling per level up to 400). Children are split towards their own
  neighbours. Repulsion is Barnes-Hut `k^2 / d` with `k` the level's mean
  rest length and no mass weighting; springs pull with Hooke's law up to
  their rest length and with the square of the stretch beyond it. A merged
  node's extent is the distance between its children's centres plus half of
  each child's extent, which is exact for chains. Point counts and drawn
  lengths follow Bandage's automatic node length.
- **Reason**: a single-level layout left real graphs tangled (pangenome
  chains folded into balls) and took 43 ms per iteration at 15k points.
  Each change was measured on the samples with the spec's metrics and
  against `Bandage image` renders: counting the gap between merged nodes
  twice made extents grow about 2.2 times per level, so coarse layouts were
  far too large (median link 436 units against a rest of 5; on a 20-level
  pangenome the coarsest extent exceeded the whole graph's length) and the
  refined layout collapsed into a strip; mass-weighted repulsion crossed
  coarse edges; more iterations on cheap coarse levels removed most
  remaining crossings.
  The M3 GPU layout reuses this coarsening, so it is compared against the
  same scheme.
- **Alternatives**: FMMM (Bandage's OGDF layout), stress majorization;
  both heavier to port to WGSL.

## 2026-10-24: Layout runs in its own worker

- **Decision**: the parse worker hands a compact topology (lengths,
  component ranks, link ends and orientation bits) to the main thread, which
  passes a copy to a separate layout worker running its own WASM instance.
  The layout worker sends the render geometry once (ribbon pieces as point
  and segment, links as end and inner point on each side), then positions
  every 100 ms until the layout settles.
- **Reason**: the parse worker stays free for later queries (info panel,
  sequences), a new layout can be cancelled by ending its worker, and the
  same worker is the WebGL2 fallback's layout in milestone 7. Computing link
  geometry in Rust keeps per-link loops off the main thread.
- **Alternatives**: running the layout in the parse worker (blocks it for
  the whole layout); computing link geometry in TypeScript on the main
  thread (a loop over up to 1.5M links).

## 2026-10-24: Rendering choices for the first picture

- **Decision**: ribbons are instanced capsules cut by a signed distance in
  the fragment shader; links are cubic Beziers leaving each end along its
  segment, 16 steps, drawn under the ribbons; ends that nearly meet open
  into a loop. Widths follow Bandage (node width 5, edge width 1.5), never
  thinner than one pixel. Links fade as ribbons shrink from 3 to 1 pixel
  wide. Segment colours use Bandage's random-colour saturation and
  lightness with hues stepped by the golden ratio from a seeded start.
  Positions are uploaded relative to an origin at the camera and
  re-uploaded once the camera is 10^5 pixels away. Fitting leaves out the
  panels marked `data-inset`. The device asks for the adapter's largest
  storage binding and buffer sizes. The status bar's frame rate counts only
  back-to-back frames.
- **Reason**: two draw calls whatever the graph size; Bandage's look; f32
  precision on large layouts (spec, Camera); random hues put neighbouring
  ids of small graphs close in colour; the default 128 MB binding limit is
  below what million-segment graphs need; frames drawn for 10 Hz layout
  updates are not a frame rate.
- **Alternatives**: point sprites for sub-pixel segments and labels (both
  milestone 4); per-segment colours computed in the shader (would have to be
  duplicated in the WebGL2 renderer).

## 2026-10-24: Bandage renders as the layout baseline

- **Decision**: layouts were compared against `Bandage image` output from
  Bandage 0.8.1's Linux build run under WSL with `QT_QPA_PLATFORM=offscreen`.
- **Reason**: the Windows build's command line writes no image.
- **Alternatives**: comparing against memory of Bandage's look.

## 2026-10-25: Software WebGPU adapters count as no WebGPU

- **Decision**: `requestAdapter` returns null for an adapter whose
  `info.isFallbackAdapter` is true, so detection falls through to WebGL2 or the
  unsupported message.
- **Reason**: headless Chromium on Linux and WSL hands out a SwiftShader
  adapter; its device was lost right after creation ("A valid external
  Instance reference no longer exists") and the page said WebGPU while showing
  the unsupported message. A CPU rasterizer could not meet the frame targets
  anyway.
- **Alternatives**: `--disable-features=Vulkan` or similar flags only in the
  Playwright config (hides the problem from real users on software-only
  machines); keep using the fallback adapter and handle the device loss.

## 2026-10-25: Playwright enables Vulkan on Linux

- **Decision**: on Linux, Playwright's Chromium starts with
  `--enable-features=Vulkan` as well as `--enable-unsafe-webgpu`.
- **Reason**: without it, headed Chromium on Linux offers only the
  SwiftShader fallback adapter (Intel UHD 620 class GPU, Fedora 44), so
  `check:headed` skipped every WebGPU test. With it the real Intel adapter
  appears. Headless runs still get no hardware adapter.
- **Alternatives**: a Linux-only headed config; documenting the flag for
  manual runs only.

## 2026-10-25: GPU layout on a spatial hash, deterministic by construction

- **Decision**: the GPU layout (milestone 3) runs the CPU reference's
  multilevel scheme with its coarsening, rest lengths, cooling and
  prolongation, and replaces Barnes-Hut with the spec's grid. Every
  iteration rebuilds a hash of fine cells keyed by (component, cell), with
  cells two mean rest lengths wide: a counting sort (count, prefix sum,
  scatter), then each bucket sorted by node and copied next to its
  neighbours. Coarse cells are 3x3 blocks of fine cells and sum their nodes
  in fixed point. Repulsion is `k^2 / d` with every node within reach counted
  once: exact pairs from the 3x3 fine cells around a node, and the centroids
  of the 5x5 coarse cells around it with those fine cells' nodes subtracted.
  Springs are gathered per node through a CSR, never scattered.
- **Reason**: components keep their own frames without bounding boxes;
  integer sums and sorted buckets make every float sum run in a fixed order,
  so a seed reproduces a layout bit for bit on one machine (tested), whatever
  the batch sizes. A first version faded exact pairs into coarse centroids
  over a distance window instead of subtracting; a node near its own coarse
  cell's centroid then lost the repulsion of most of that cell, and the 200k
  graph had 4.8 times the CPU reference's overlaps (5,098 against 1,059).
  The exact split brought it to 1,676.
- **Alternatives**: a uniform grid over each component's bounding box (needs
  boxes every iteration); float atomics (not in WGSL, and order dependent);
  Barnes-Hut on the GPU.

## 2026-10-25: Cell hashes sum each coordinate times its own prime

- **Decision**: `cell_hash` is murmur3's finaliser over `x * p1 + y * p2 +
component * p3` (primes from Teschner et al. 2003); `cell_key`, which tells
  cells apart in the coarse table, does the same with other multipliers.
- **Reason**: two earlier versions collided. Mixing `x * k ^ y` maps (1, 1)
  and (-1, -1) together, which merged coarse cells mirrored through the
  origin (caught by the force check); xoring the products, as Teschner does,
  repeats about 8% of keys on a small grid, which merged coarse cells
  (caught by the binning check, which now compares against true cell
  coordinates). The sums repeat none over 1.8 million cells.

## 2026-10-25: The layout's division of work

- **Decision**: the layout worker coarsens (WASM) and packs components; the
  engine runs every iteration on the GPU and presents positions straight
  into the renderer's buffer, adding each component's packing offset there.
  Four times a second it reads back component boxes for the worker to pack.
- **Reason**: positions never cross to the CPU while the layout runs, the
  main thread only encodes commands, and packing (a skyline over up to
  100k boxes) stays off the main thread.
- **Alternatives**: packing in TypeScript on the main thread; reading back
  all positions each update.

## 2026-10-25: Pacing the GPU layout

- **Decision**: each frame submits a batch of iterations in one compute
  pass, at most three batches in flight. Batches aim at 30 ms of GPU time (4
  ms while the user pans or zooms), measured with timestamp queries where
  the adapter has them. A settling layout is redrawn at most every 100 ms,
  and no more than a tenth of GPU time goes to drawing it; panning and
  zooming draw every frame. The status bar's frame rate is capped by
  measured draw time.
- **Reason**: measured on the 200k graph (Intel UHD 620 class GPU): drawing
  every frame starved the layout (680 s); `onSubmittedWorkDone` resolves up
  to 100 ms late in Chrome, so sizing batches from it left the GPU idle; ten
  passes per iteration cost about 1 ms of fixed overhead on small levels.
  Animation frames kept coming at 60 Hz while the GPU was 200 ms behind, so
  frames counted alone overstated the frame rate. A hidden tab gets no
  animation frames, so its layout waits until it is shown again.
- **Alternatives**: a fixed iteration count per frame; drawing only after
  the layout settles (no progressive view).

## 2026-10-25: Draw only what is in view

- **Decision**: before each draw a compute pass marks the ribbon pieces and
  links whose bounds touch the view, prefix-sums the marks and compacts the
  survivors' indices; the render pass draws them with `drawIndirect`.
- **Reason**: zoomed in on the 200k graph, every one of 710k pieces and
  220k links (16 quads each) went through the vertex shader each frame: 21
  fps. Compacting by prefix sum keeps the original order, so overlapping
  ribbons do not swap places (and flicker) as the view moves, which an
  atomic append would cause.
- **Alternatives**: discarding off-screen instances in the vertex shader
  (still runs every vertex); a CPU-side grid query (positions live on the
  GPU).

## 2026-10-25: Layout presets, seeds and first usable time

- **Decision**: presets are fast, balanced and best, scaling the CPU
  reference's iteration budget (500 coarsest, 50 refining) by 0.5, 1 and 2.
  Changing the preset restarts the layout with the same seed. Seeds are u32,
  shown and editable in decimal. "First usable layout" is timed when the
  layout has refined to level 3 or finer and a component pack has been
  applied. GPU quality passes when it is no more than 15% worse than the CPU
  reference on edge CV and on overlaps, with overlaps also allowed 0.1% of
  the point count. Owner's choices.
- **Reason**: these values end up in share links (milestone 7); overlaps on
  small graphs are near zero, where a relative tolerance means nothing.

## 2026-10-25: Pinning and re-layout of a selection wait for milestone 4

- **Decision**: pin by drag, unpin all and re-layout selection come with
  picking and selection in milestone 4.
- **Reason**: they need to know what is under the cursor and what is
  selected.

## 2026-10-25: Test and benchmark hooks

- **Decision**: `?layout=cpu` draws the CPU reference layout in the same
  renderer, and development builds put the last settled layout on
  `window.grapeLayout`. `npm run bench:layout` lays out a fixed standard set
  (a SPAdes bacterial graph, the SPAdes Acacia mitochondrion, the LPA
  pangenome region, the 20k-segment potato hifiasm graph and the 200k
  synthetic graph), or the files passed as arguments instead, on the GPU;
  compares each with the CPU reference natively (`compare_layout`); and
  writes `bench/results.md` and a screenshot per graph.
  `GRAPE_GPU_HEADLESS=1` runs Playwright's full
  Chromium headless on the real GPU through Vulkan (`--use-angle=vulkan
--use-vulkan`); the benchmark uses it. Tab memory is the resident size of
  the page's renderer process; the GPU process is reported apart.
- **Reason**: comparisons need both layouts drawn the same way and the
  GPU's positions in a file. Headed runs stall when the display sleeps or
  the window is covered: Chrome stops animation frames and screenshots, and
  the benchmark hung for minutes. Summing every Chromium process counted
  1.2 GB for a 336-segment graph.

## 2026-10-26: The spec is a Claude Doc with twelve milestones

- **Decision**: the spec lives in the Claude Doc "GRAPE: Build Spec", rewritten
  to match what milestones 0 to 3 built, with an architecture map, a target
  code layout and twelve milestones: 4 Interaction, 5 Scale, 6 Display,
  7 WebGL2 fallback, 8 Graph features, 9 Sequence search, 10 Export and
  sharing, 11 Release. `CLAUDE.md` and `/milestone` read it with the docs
  tools.
- **Reason**: the PDF export drifted from the code (name, npm, FASTG, GFA 2,
  layout details), and the old milestone 4 held about twelve features.
- **Alternatives**: keep the PDF and add `docs/plan.md`; keep nine milestones.

## 2026-10-26: Double mode shifts strands at draw time, as Bandage does

- **Decision**: double mode adds no layout points. Each strand is drawn from
  the shared chain, shifted sideways along the line's normal by 2 units.
- **Reason**: Bandage lays out one chain per segment pair (`addToOgdfGraph`
  skips a node whose complement is already in OGDF) and shifts each strand
  in `GraphicsItemNode::shiftPointSideways` by `doubleModeNodeSeparation`
  (2.0, `settings.cpp`). Switching is instant and costs no memory.
- **Alternatives**: separate strand chains held side by side by springs (the
  old spec text; twice the points, about 7M for a 1M graph).

## 2026-10-26: The WebGL2 fallback comes right after Display

- **Decision**: milestone 4 introduces the `Backend` and `LayoutDriver`
  interfaces; the WebGL2 backend is milestone 7, before graph features,
  search and export, which are then built and tested on both backends.
- **Reason**: Chrome on Linux enables WebGPU by default only on Intel Gen12+
  GPUs and Firefox only on Windows and Apple-silicon macOS (MDN
  browser-compat-data), so many users get WebGL2; with WebGL2 in CI from
  milestone 7, headless CI covers real rendering.
- **Alternatives**: the WebGL2 backend last, as the old spec had it.

## 2026-10-26: A sequence worker owns sequences

- **Decision**: after parsing, the parse worker (renamed the graph worker in
  milestone 4) hands the packed bases, or the `File` and offsets for plain
  input, to a sequence worker that serves sequences, raw lines and FASTA, and
  later the k-mer index and search.
- **Reason**: building the index must not block info, find and filter
  queries. The hand-off briefly holds the packed bases twice.
- **Alternatives**: sequences and search in the parse worker; a search worker
  that streams the file again.

## 2026-10-26: zustand holds UI state

- **Decision**: one zustand store (5.0.15) in `web/src/state`, sliced by
  concern; `state/bridge.ts` alone sends engine commands and writes engine
  events back. Owner's choice.
- **Reason**: share links and session files need the view as one serialisable
  object, and panels should not each hold engine handles.
- **Alternatives**: a hand-written store on `useSyncExternalStore`; React
  state lifted into `App`.

## 2026-10-26: Box select runs on the GPU under WebGPU

- **Decision**: shift-drag selection is a compute pass over ribbon pieces
  that returns a segment bitset; the WebGL2 backend queries a CPU grid.
- **Reason**: positions live on the GPU while the layout runs; reading back a
  1M graph's points (about 28 MB) to build a grid would take a worker round
  trip. The spec's CPU grid remains the WebGL2 path.

## 2026-10-26: Sequences, raw lines and FASTA move into milestone 4

- **Decision**: the info panel ships with the sequence preview, copy, FASTA
  and the raw GFA line (plain files only; gzipped files cannot be read at an
  offset). The parser stores each `S` line's offset for plain files.
- **Reason**: owner's choice; the info panel is incomplete without them.

## 2026-10-26: Bundled examples are real graphs under permissive licences

- **Decision**: the Acacia chloroplast by Unicycler and the Acacia
  mitochondrion by SPAdes (CC-BY-4.0), the LPA region and the human
  mitochondrion from minigraph (MIT), credited in the menu.
- **Reason**: the SPAdes bacterial sample is GPL-3.0 and cannot ship inside
  the MIT site without care.
- **Alternatives**: synthetic graphs from `gfa-gen`; a mix.

## 2026-10-26: A Scale milestone owns the 1M targets

- **Decision**: milestone 5 brings the 1M graph within its targets, accepted
  on the development laptop (Intel UHD 620, below the spec's reference
  class); a Ryzen 9 9950 desktop is a second benchmark machine when needed.
- **Reason**: the first 1M run (`gfa-gen --segments 1000000`, headless on
  the GPU) measured parse 14.5 s, first usable 133.6 s, settled 380 s, 49 fps
  zoomed in, 16 fps zoomed out and 2,003 MB of tab memory: layout times miss
  and memory is at the limit before milestone 4 adds anything.
- **Alternatives**: memory in milestone 4 and speed in milestone 7; record
  the miss and move on.

## 2026-10-26: Never draw a graph without positions, and cap zoom until the layout is usable

- **Decision**: after a new graph is set, the backend draws and picks nothing
  until positions arrive; a GPU layout start refits the camera to the coarsest
  level's start positions; and until the layout has refined to level 3,
  zooming in stops at 8 times the fitted zoom.
- **Reason**: zooming 25 wheel steps into the settled 200k graph (near the
  1000x maximum) and restarting the layout lost the GPU device
  (`VK_ERROR_DEVICE_LOST`) on the development laptop, before and after
  picking was added. A new graph's position buffer is all zeros until the
  layout worker's hierarchy arrives, seconds later, so the old zoomed-in view
  drew every one of 700k ribbon pieces as a capsule some 2,500 px wide on the
  same point. Coarse levels stack points the same way, which the zoom cap
  guards against. With both, the restart and a 40-step zoom during the first
  seconds of a 200k load keep the device. Owner's choice.
- **Alternatives**: refitting only (deep zoom in the first seconds of a load
  could still stack ribbons); deferring to milestone 5.

## 2026-10-26: One store, one bridge, one RPC client

- **Decision**: `createAppStore(services)` builds the zustand store from
  slices (file, layout, display, selection, toasts) around injected services:
  the graph, sequence and layout clients, the engine factory and backend
  detection. `state/bridge.ts` alone holds the engine; it drops an engine that
  arrives after a newer attach or a detach. `workers/rpc.ts` is the one worker
  client: every response echoes its request's id, updates (progress, partial
  results) go to a callback, the final response resolves, `error` rejects,
  and cancelling terminates and respawns the worker. Development builds put
  the store and the bridge's `send` and `on` on `window.grapeTest`.
- **Reason**: tests drive the store with fake services and no browser; the
  React tree never sees a worker or the engine; StrictMode's double mount
  cannot leak an engine.
- **Alternatives**: services as module singletons (untestable without
  mocking imports); a client class per worker with its own message plumbing.

## 2026-10-26: Exports reproduce Bandage byte for byte

- **Decision**: FASTA export follows Bandage's "Save selected node
  sequences": `>NODE_<name>+_length_<length>_cov_<depth>` headers, sequences
  wrapped at 70 columns, N for every base of a segment without a sequence,
  segments in `compareNodePointers` order (numeric when both names are
  integers that differ, else by name with its sign). Depth prints as
  `QByteArray::number(double)` does (printf `%g`, 6 significant digits), and
  an unknown depth prints as Bandage's default, 1. Copying sequences joins
  them with newlines and no headers, as Bandage's copy does. FASTG segments
  known only from their reverse record are reverse-complemented with
  Bandage's table, which keeps case and drops characters it does not know.
  Gzipped input now keeps lowercase spans next to the 2-bit bases so decoded
  sequences keep the file's case.
- **Reason**: owner's choice: people moving from Bandage must get the same
  files. Bandage's defaults apply only when exporting; stored data keeps
  GRAPE's own (depth NaN when unknown). Sources: `getFasta` and
  `getNodeNameForFasta` (graph/debruijnnode.cpp), `addNewlinesToSequence`
  and `getReverseComplement` (graph/assemblygraph.cpp),
  `saveSelectedSequencesToFile` and `copySelectedSequencesToClipboard`
  (ui/mainwindow.cpp), `compareNodePointers` (ui/mygraphicsscene.cpp).
- **Alternatives**: `>name` with GRAPE's own wrapping; name plus `LN`/`DP`
  tags.

## 2026-10-26: Segment line offsets for plain files

- **Decision**: the parser stores each segment's `S` line (or FASTG header)
  offset, 8 bytes per segment, for plain input only. The raw line in the info
  panel keeps 100 bases at each end of a longer sequence and up to 64 KB of
  tags.
- **Reason**: the spec's raw line; gzipped files cannot be read at an offset.
  The fixed memory per segment for plain input rises from 44.8 to 52.8 bytes,
  still under the 64-byte target.

## 2026-10-26: Picking

- **Decision**: ribbons are drawn again into an `r32uint` texture at half the
  canvas resolution, holding segment id plus one, 0 for background. A texel
  belongs to a ribbon when its centre lies inside the capsule, with no
  antialiasing; the last piece drawn wins, as on screen. Links are not
  pickable. The texture is redrawn only when the view or positions changed,
  and a pick reads back one texel. Hover picks at most once a frame, one in
  flight, and again after the camera moves under a still pointer. A press
  that moves less than 4 CSS pixels is a click. Measured on the 200k graph:
  a pick answers in 2.4 ms (median of 25), 32 ms at most.
- **Reason**: the spec's picking. A centre test is what the CPU reference
  can reproduce exactly, so the GPU check compares every texel not within
  0.02 units of a capsule's edge.

## 2026-10-26: Pins are step sizes on level 0

- **Decision**: dragging a segment moves its points on level 0 of the GPU
  layout and pins it by setting their step size to 0 (`Node.y`), so the
  force kernels need no extra buffer (`pull_and_move` already binds the
  default limit of 8 storage buffers). "Re-layout selection" sets the step
  size of every point outside the selection to 0 for the length of one
  refinement. A refinement runs the second half of level 0's cooling
  schedule again; restarting from the first iteration's temperature shook the
  whole bacterial graph after a single drag. Measurements during a
  refinement do not repack components, so packing stays as it was. Before the
  layout reaches level 0, dragging pans. A new layout clears the pins.
- **Reason**: the spec's pinning; level 0 holds every point, and the
  hierarchy's own step sizes give back each point's mobility when it is
  unpinned.
- **Alternatives**: a pinned bitset read by `pull_and_move` (a ninth storage
  buffer); a separate refinement kernel with its own temperature.

## 2026-10-27: Interaction benchmark zooms in on a segment

- **Decision**: `npm run bench:interaction` zooms toward a segment it finds on
  screen, times hover, clicks and box select while that view holds segments,
  then measures frame rates. Its pan clears hover first, because a press on a
  hovered segment now drags and pins it.
- **Reason**: zooming toward the canvas centre landed in a gap between the
  200k graph's ten components, so the "zoomed in" frame rate was measured on
  an empty screen. `bench:layout` still zooms toward the centre, so its 200k
  zoomed-in figure in `bench/results.md` may share that flaw; milestone 5
  should re-measure it with the anchored helper.

## 2026-10-27: Coarsening visits nodes in index order

- **Decision**: heavy-edge matching visits nodes in index order instead of
  Walshaw's random order. Coarsening no longer depends on the seed; the
  coarsest level's start positions still do.
- **Reason**: a chain's points are numbered along it on every level, so in
  order they pair up completely, while random order on a path leaves about
  one node in seven unmatched. Measured natively on the 1M synthetic graph:
  coarsening fell from 8.9 to 3.3 s (random order missed the cache on every
  node), and the work before the layout is usable from 376M to 283M
  node-iterations.
- **Alternatives**: random order with unmatched nodes joining a neighbour's
  pair (triples, a new prolongation step); pairing chain points by hand on
  level 0 only.

## 2026-10-27: Iteration budgets scale with level size

- **Decision**: a level's iterations are its old budget (50 on level 0,
  doubling per level up to 400, 500 on the coarsest) capped at
  `400,000 × refine / nodes`, never below 100 (twice level 0's 50). Presets
  scale both.
  The hierarchy carries the budgets, so the CPU reference and the GPU apply
  the same rule. Quality is checked against the CPU reference and, on the
  200k graph, also against the milestone 3 reference (edge CV 0.725, 1,059
  overlaps), so both cannot get worse together. Owner's choice.
- **Reason**: on the 1M graph, levels 1 to 4 (305k to 1.8M nodes) held most
  of the work at 100 to 400 iterations each. The cap brings the whole layout
  from about 1,059M to 454M node-iterations, and the work before it is usable
  from 283M to about 109M. Levels under 50k nodes keep their budgets, so the
  small standard graphs lay out as before. A floor of 50 left the 200k graph
  with 1,784 overlaps, 15 over the milestone 3 guard; the floor is now 100.
- **Alternatives**: stopping a level once its energy converges (needs a GPU
  side flag to stay deterministic whatever the batch sizes); fewer passes per
  iteration.

## 2026-10-27: Pages deploys from CI with the Actions source

- **Decision**: CI builds `web/dist` and deploys it with
  `actions/deploy-pages` on every push to `main`, after the gate passes. The
  gate's own production build is the one deployed. Pages is set to the
  "GitHub Actions" source. This comes before milestone 11 so the live site can
  be tried early; the offline service worker still lands in milestone 11.
- **Reason**: no `gh-pages` branch full of build output, and a broken `main`
  never reaches the site. The relative Vite base already serves the build from
  `/GRAPE/`.
- **Alternatives**: a `gh-pages` branch pushed by a workflow; a separate
  build for the site (could differ from what the gate tested).

## 2026-10-27: Segments are coloured in the shader from one segment table

- **Decision**: every per-segment value the shaders read (depth, GC, length,
  component, CL and C2 colours, chain start and piece count) sits in one
  storage buffer as runs of one u32 per segment, each run written straight
  from its typed array. A style uniform holds the colour mode, the scale and
  range, the colours and the 256-entry viridis ramp, so changing a mode or a
  range is one uniform write. Random and component colours step the hue by
  the golden ratio as an exact u32 sequence (`start + i * 0x9E3779B9`), which
  replaces the per-segment colour buffer; random colours differ slightly
  from milestones 2 to 5. `engine/style/colors.ts` computes the same colours
  on the CPU for tests and exports. CL and C2 colours of 0 (fully transparent
  black) count as no tag.
- **Reason**: the spec's one-uniform-write rule and its limit of 8 storage
  buffers per stage; runs avoid a packing loop over a million segments on
  the main thread; f32 loses the hue's fraction past about 2^24 ids.
- **Alternatives**: a colour buffer rewritten on the CPU for each mode (a
  4 MB write and a loop per change at 1M); interleaved records (a packing
  loop); viridis or Bandage's black-to-red ramp (owner chose viridis).

## 2026-10-27: Double mode draws both strands from one chain, with Bandage's strand colours

- **Decision**: in double mode each ribbon and link is drawn twice, once per
  strand, from the same layout points. Each point moves 2 units along the
  left normal of the direction its neighbours give it, for the strand that
  reads that way (`shiftPointSideways`), so the reverse strand lands on the
  other side. A link's ends move by the left normal of the way it leaves its
  first segment and the right normal of the way it enters the next, which
  puts every link, its mirror and self-loops on the strands they name. Each
  strand ends in Bandage's 45 degree arrowhead. The reverse strand takes
  Bandage's negative colours: lightness 90 instead of 150 for random (and
  component) colours, `uniformNegativeNodeColour` in uniform mode, and its
  own C2 tag in tag mode.
- **Reason**: Bandage's look and colour rules (graph/graphicsitemnode.cpp,
  program/settings.cpp); with a 2-unit shift and 5-unit ribbons the strands
  overlap by a unit, and only the colour tells them apart.
- **Alternatives**: one colour for both strands (they read as one wide
  ribbon); strand chains of their own (rejected on 2026-10-26).

## 2026-10-27: Label font atlas from msdf-bmfont-xml, committed

- **Decision**: `npm run font-atlas` builds a multi-channel signed distance
  field atlas of JetBrains Mono Regular 2.304 (SIL OFL 1.1, fetched at a
  pinned tag and SHA-256) for ASCII 32 to 126, at size 42 with a distance
  range of 8 so a 12 px label still has room for its 1 px halo, with
  msdf-bmfont-xml 2.8.0, a
  pinned devDependency. The 512x256 atlas, its glyph metrics and the font's
  licence are committed in web/public/fonts; nothing of the tool ships.
- **Reason**: owner's choice of a true MSDF, as the spec asks; the tool runs
  once. `npm audit` reports a high advisory in zod under the tool's jimp
  dependency, which never runs in the app.
- **Alternatives**: a single-channel SDF rendered in Playwright's Chromium
  (no dependency, softer corners); msdf-atlas-gen's binary (needs building
  on Linux).

## 2026-10-27: Labels are placed on the GPU and their text comes from the graph worker

- **Decision**: label text follows Bandage's `getNodeText` (LB and L2, then
  name, length as `1,234 bp`, depth as `formatDepthForDisplay` writes it),
  built in gfa-core; an unknown depth shows no line. The graph worker sends
  per segment a placing rank (longest first) and the label's box, and later
  the text of the labels that win. Placement runs on the GPU over a screen
  grid of 6 CSS px cells, once the view rests for 150 ms and at least every
  600 ms while it moves; the best 2,000 winners by rank show, each centred
  on its chain's midpoint in both display modes. Names stay in the graph
  worker; the engine caches the text of up to 20,000 labels.
- **Reason**: the spec's placement rule; one copy of the names; a label per
  segment keeps double mode readable.
- **Alternatives**: a label per strand in double mode, as Bandage's names
  carry their sign; the name arena on the main thread (the spec's
  Architecture text, a second copy of every name).

## 2026-10-27: The CPU layout pins and refines as the GPU layout does

- **Decision**: the CPU layout (the WebGL2 backend's layout) pins a dragged
  segment by giving its level 0 points step size 0, and a refinement runs
  the second half of level 0's cooling schedule again, moving only the
  selection for "Re-layout selection". Component offsets are fixed once the
  layout settles or is first refined, so a drag never repacks components.
  Refinement iterations do not count towards the layout's progress.
- **Reason**: both backends behave alike; the decisions of 2026-10-25 (pins
  are step sizes on level 0) carry over without a second scheme.
- **Alternatives**: a separate pinned bitset read by the force loop; repacking
  after each refinement (components jump while dragging).

## 2026-10-27: The WebGL2 backend reads data from textures and culls on the CPU

- **Decision**: the WebGL2 shaders are a line-for-line port of graph.wgsl
  and glyphs.wgsl. Positions, pieces, links, the segment table and the
  selection live in data textures 4096 texels wide (`RG32F`, `RG32UI`,
  `RGBA32UI`, `R32UI`) read with `texelFetch`; the view and style are two
  std140 uniform blocks packed by the same code as WebGPU's uniforms
  (engine/style/uniforms.ts), whose WGSL layout gives the same offsets.
  The layout worker sends a uniform grid over pieces and links (gfa-core
  `layout::Grid`, about four pieces per cell, items covering more than 16
  cells on a wide list) with each set of positions; the main thread culls
  pieces, links and highlighted pieces over it into instance lists kept in
  index order, and draws every item without a list when the view holds the
  whole grid. Dots for short segments are decided in the vertex shader.
  Box select, bounds and label placement follow query.wgsl and labels.wgsl
  on the CPU, so both backends select and place the same. Picking reads one
  texel of an `R32UI` framebuffer through a pixel buffer and a fence, so it
  never stalls the main thread.
- **Reason**: WebGL2 has no storage buffers or compute shaders (spec,
  Rendering: WebGL2 backend); textures keep the shaders identical to the
  WGSL ones, and drawing in index order keeps overlaps the same as WebGPU.
- **Alternatives**: per-instance vertex attributes expanded on the CPU
  (copies every piece's points each frame); a grid built on the main thread
  (the spec puts it in the layout worker); synchronous `readPixels` (stalls).

## 2026-10-27: `?renderer=webgl2` forces the fallback; layout controls go through the engine

- **Decision**: the query parameter `?renderer=webgl2` makes a WebGPU machine
  use the WebGL2 backend, for users and tests, like `?layout=cpu`; it is not
  part of the share link (M10). Under WebGL2 the engine's layout driver
  (`CpuLayoutDriver`) turns pause, drag, unpin and re-layout into
  `layout-control` events that the store forwards to the layout worker, so
  the store's actions are the same on both backends and only the store talks
  to workers.
- **Reason**: chosen by the owner; one path for every control.
- **Alternatives**: a production-ignored parameter; a settings toggle; store
  actions calling the worker directly for the CPU layout.

## 2026-10-27: The examples ship gzipped from public/examples

- **Decision**: the four example graphs are stored gzipped (`gzip -9n`,
  470 KB in all) in `web/public/examples/` with a `CREDITS.md` that carries
  the CC-BY-4.0 attribution (Anna Syme 2020, Zenodo 5722622) and the MIT
  notices of odgi and minigraph, checked at their sources. The menu shows
  each credit and licence. Loading fetches the file from the site itself and
  opens it as any other file, so the parser's gzip path serves it.
- **Reason**: a fifth of the plain size; the menu is a same-origin request
  with no user data, within the privacy rules.
- **Alternatives**: plain files (2.6 MB); importing them into the bundle.

## 2026-10-27: Screenshot tests compare the backends and WebGL2 baselines

- **Decision**: `screenshots.spec.ts` draws each bundled example on WebGPU
  with `?layout=cpu` and on WebGL2 from the same seed, so both draw the
  same CPU layout, and fails when more than 1% of the canvas pixels differ by
  more than 48 summed over the channels (measured on this laptop: 0.000% on
  all four). That comparison needs WebGPU and runs under `check:headed`; CI
  checks the WebGL2 pictures against committed baselines
  (`screenshots.spec.ts-snapshots/*-webgl2-linux.png`, made with
  Playwright's headless Chromium and SwiftShader) with the same 1% tolerance.
- **Reason**: chosen by the owner; the GPU layout and the CPU layout differ,
  so only a shared layout compares renderers; CI has no WebGPU.
- **Alternatives**: only the headed comparison; baselines for both backends.

## 2026-10-27: Chain merging follows Bandage's "Merge all possible nodes"

- **Decision**: gfa-core `analysis/chains.rs` and `analysis/merge.rs` copy
  Bandage's `mergeAllPossible`, `mergeNodes` and `getUniqueNodeName`
  (graph/assemblygraph.cpp). Segments are visited in the order of
  Bandage's node map (name plus sign, byte order of UTF-8, which matches
  QString order outside the supplementary planes); each unvisited one grows
  forward, then backward, through links that are the only one at both ends.
  A merged segment's name joins its members' names with `_`, with `_2`,
  `_3`… while the name is taken; its depth is the members' depth weighted by
  their lengths; its sequence is the first member's followed by each next
  member's less the overlap of the link into it, untrimmed when the overlap
  is longer than the member (`modifySequenceUsingOverlap`, graph/path.cpp).
  Links from a chain back into itself are dropped, so a chain that is a whole
  circle loses its closing link, as in Bandage (chosen by the owner). Merged
  segments carry no custom colours or labels. Paths are mapped onto the
  merged segments, consecutive steps through one merged segment collapsing.
- **Where GRAPE differs**: an unknown depth is left out of the weighted mean
  instead of counting as Bandage's 1.0 (the same whenever every member has a
  depth or none does); segments with `*` sequences keep their `LN` lengths,
  where Bandage gives the merged node an empty sequence and length 0; GC is
  the members' GC weighted by the bases each keeps, an estimate.
- **Reason**: users moving from Bandage get the same merged graph; the
  property test (`tests/chains.rs`) checks that every walk through the
  merged graph spells the bases of the original walk it stands for.
- **Alternatives**: keeping a circle's closing link (recommended, declined
  by the owner); merging only for display, keeping the original segments.

## 2026-10-27: The GFA writer is Bandage's "Save entire graph to GFA"

- **Decision**: gfa-core `write/gfa.rs` writes what Bandage's
  `saveEntireGraphToGfa` writes (graph/assemblygraph.cpp,
  graph/debruijnnode.cpp, graph/debruijnedge.cpp, program/globals.cpp):
  `S` lines in the order of Bandage's node map (name plus `+`), each with
  its sequence or `*`, `LN:i`, the depth in the file's depth tag (`DP:f` as
  printf's `%g`, or `KC`/`RC`/`FC` as `int(depth × length + 0.5)`; the tag
  is the one the last segment with a depth used, KC for FASTG, none when no
  segment had one; an unknown depth counts as Bandage's 1.0), then
  `LB:z`, `L2:z`, `CL:z` and `C2:z` with Bandage's colour names
  (`getColourName`, first match in its list, else `#rrggbb`). Each link is
  written once as its positive edge (`isPositiveEdge`) with the overlap of
  the first line that gave it, `nM`, sorted by `compareEdgePointers`.
- **Where GRAPE differs**: a segment without a sequence keeps its real
  `LN` and counts from it, where Bandage measures the `*` and writes
  `LN:i:1` (chosen by the owner); edges Bandage's sort leaves tied are
  ordered by their names with signs; a link of unknown overlap is `0M`.
- **Reason**: exports match Bandage byte for byte for the same graph.
- **Alternatives**: writing `LN:i:1` as Bandage does; GRAPE's own order.
