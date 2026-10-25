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
- **Reason**: headless Chromium on CI and on Windows returns no WebGPU adapter.

## 2026-10-23: Root npm workspace and one gate script

- **Decision**: the repo root is an npm workspace (`web` is its only package)
  with one lockfile, and `scripts/check.mjs` is the single quality gate, run
  locally and by CI on Linux and Windows.
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

## 2026-10-24: Link overlaps keep one side

- **Decision**: a link is stored once in canonical form with the overlap
  length on its From side. CIGARs with indels or clipping set a flag and get
  one summary warning.
- **Reason**: the GFA 1 spec makes From the reference and To the query, so
  the two sides differ only for non-`M` CIGARs, which assemblers rarely
  write. Exact trimming matters first for chain merging.

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

## 2026-10-24: Fuzzing on Windows uses MSVC AddressSanitizer

- **Decision**: `npm run fuzz` installs nightly and cargo-fuzz, finds MSVC's
  `clang_rt.asan_dynamic-x86_64.dll` with vswhere and puts it on PATH.
- **Reason**: without the DLL the fuzz binary exits with
  STATUS_DLL_NOT_FOUND, and `-s none` fails to link on MSVC (unresolved
  `__start/__stop___sancov_pcs`).

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

## 2026-10-24: Links keep both overlap sides (supersedes "Link overlaps keep one side")

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
  same worker is the WebGL2 fallback's layout in milestone 8. Computing link
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
