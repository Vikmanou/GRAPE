//! Core of GRAPE: GFA and FASTG parsing, the graph store, graph algorithms,
//! stats and sequence search. Pure Rust with no browser dependencies, so
//! everything here is tested natively.

mod builder;
mod components;
pub mod csr;
mod fastg;
mod fields;
mod gfa;
mod graph;
mod names;
mod parser;
mod paths;
mod seq;
mod stats;
mod store;
mod warnings;

pub use builder::RecordCounts;
pub use components::Components;
pub use graph::{Format, Graph, MemoryReport};
pub use names::{Arena, Names};
pub use parser::{ParseOptions, Parser, parse};
pub use paths::{PathKind, Paths, REVERSE};
pub use seq::{DEFAULT_BUDGET, Packed, Run, SeqMode};
pub use stats::Stats;
pub use store::{Links, NO_SEQ, Segments, link_bits, seg_flags};
pub use warnings::{FatalError, MAX_STORED, Severity, Warning, WarningKind, Warnings};

/// Version of this crate, reported to the UI so a stale WASM build is visible.
pub const VERSION: &str = env!("CARGO_PKG_VERSION");

/// Placeholder from milestone 0 that proves the WASM call path; replaced by
/// the parser bindings.
pub fn count_lines(bytes: &[u8]) -> u64 {
    let newlines = bytes.iter().filter(|&&b| b == b'\n').count() as u64;
    let unterminated = matches!(bytes.last(), Some(&b) if b != b'\n');
    newlines + u64::from(unterminated)
}
