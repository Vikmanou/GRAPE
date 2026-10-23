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

Prerequisites: Rust (pinned by `rust-toolchain.toml`), Node 22+, pnpm, and
`wasm-bindgen-cli` at the exact version pinned in `Cargo.toml`:

```sh
cargo install wasm-bindgen-cli --version 0.2.129 --locked
```

```sh
cargo test --workspace          # Rust core, native
cd web
pnpm install
pnpm dev                        # builds the WASM module, then starts Vite
pnpm test                       # Vitest
pnpm e2e                        # Playwright (run `pnpm wasm` first)
pnpm e2e --headed               # same, with a real GPU so WebGPU is exercised
```

`pnpm typecheck` and `pnpm e2e` need the WASM bindings in `web/src/wasm/pkg`,
which `pnpm wasm` (or `pnpm dev`) generates. Headless Chromium usually has no
WebGPU adapter, so headless runs exercise the fallback path only.

## Layout

```
crates/gfa-core/   parser, graph store, algorithms (pure Rust, tested natively)
crates/gfa-wasm/   wasm-bindgen bindings around gfa-core
web/               Vite + React + TypeScript app, WebGPU engine, workers
docs/decisions.md  design decision log
```

## License

MIT
