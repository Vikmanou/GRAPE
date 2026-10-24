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
  (*M. xanthus*, 595k segments) went from 31 to about 55 MB/s in WASM, and
  sequence-heavy synthetic graphs from about 115 to over 400 MB/s.
- **Alternatives**: sort-based link deduplication at the end of parsing
  (more transient memory); resolving names in batches. Left for later.
- **Dependency**: `memchr` 2.8.3, the standard SIMD byte search crate.

## 2026-10-24: WASM SIMD required

- **Decision**: `.cargo/config.toml` builds the WASM core with `simd128`.
- **Reason**: every browser GRAPE supports has WASM SIMD (Chrome 91, Firefox
  89, Safari 16.4), and the parser's byte scanning uses it.
